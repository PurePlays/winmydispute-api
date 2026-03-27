import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import request from 'supertest';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'winmydispute-tests-'));
const licensesFile = path.join(tempRoot, 'licenses.json');
const legacyPaidUsersFile = path.join(tempRoot, 'paidUsers.json');
const binsFile = path.join(tempRoot, 'bins.json');
const outcomeFeedbackFile = path.join(tempRoot, 'outcomeFeedback.json');
const downloadsDir = path.join(tempRoot, 'downloads');
const caseFilesFile = path.join(tempRoot, 'caseFiles.json');
const caseStorageDir = path.join(tempRoot, 'case-files');
const databaseFile = path.join(tempRoot, 'app.sqlite');
const storageRootDir = path.join(tempRoot, 'storage');

process.env.NODE_ENV = 'test';
process.env.BASE_URL = 'https://example.test';
process.env.STRIPE_SECRET_KEY = 'sk_test_example';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_example';
process.env.ARTIFACT_TOKEN_SECRET = 'artifact_test_secret_example';
process.env.CHECKOUT_PRODUCT_IMAGE_URL = 'https://example.test/stripe-product.png';
process.env.OPENAI_BEARER = 'test-openai-bearer';
process.env.OPENAI_BEARERS_JSON = JSON.stringify({
  primary: 'test-openai-bearer',
  secondary: 'test-openai-bearer-rotated'
});
process.env.DATABASE_FILE_PATH = databaseFile;
process.env.LICENSES_FILE_PATH = licensesFile;
process.env.LEGACY_PAID_USERS_FILE_PATH = legacyPaidUsersFile;
process.env.BINS_FILE_PATH = binsFile;
process.env.OUTCOME_FEEDBACK_FILE_PATH = outcomeFeedbackFile;
process.env.DOCUMENT_DOWNLOADS_DIR = downloadsDir;
process.env.CASE_FILES_FILE_PATH = caseFilesFile;
process.env.CASE_FILE_STORAGE_DIR = caseStorageDir;
process.env.STORAGE_ROOT_DIR = storageRootDir;
process.env.CHECKOUT_RATE_LIMIT_MAX = '2';

const { default: app } = await import('../index.js');
const { resetDatabaseForTesting } = await import('../services/databaseService.js');
const { loadLicenses, resetLicenseStoreForTesting } = await import('../services/licenseStore.js');
const { setStripeClientForTesting, resetStripeClientForTesting } = await import('../services/stripeClient.js');
const { resetRateLimitsForTesting } = await import('../middleware/rateLimit.js');
const { resetBinDataForTesting } = await import('../services/binDataService.js');
const { resetOutcomeFeedbackForTesting } = await import('../services/outcomeFeedbackService.js');
const { resetJobQueueForTesting } = await import('../services/jobQueueService.js');
const {
  loadCaseById,
  loadCaseMetadataForEmail,
  resetCaseFilesForTesting
} = await import('../services/caseFileService.js');
const {
  resetEvidenceAiClientForTesting,
  setEvidenceAiClientForTesting
} = await import('../services/evidenceExtractionService.js');

let checkoutCounter = 0;
let lastCheckoutPayload = null;

function authHeader() {
  return { Authorization: `Bearer ${process.env.OPENAI_BEARER}` };
}

async function waitForJob(jobId, email, premiumAccessToken = '') {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const query = { email };
    if (premiumAccessToken) {
      query.premiumAccessToken = premiumAccessToken;
    }

    const response = await request(app)
      .get(`/api/v1/jobs/${jobId}`)
      .set(authHeader())
      .query(query);

    if (response.status === 200 && ['completed', 'failed'].includes(response.body.status)) {
      return response;
    }

    await new Promise(resolve => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function fulfillPremiumLicense(email, sessionId) {
  const event = {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        payment_status: 'paid',
        amount_total: 699,
        customer_email: email,
        metadata: {
          email,
          source: 'gpt',
          intent: 'full-dispute-kit',
          product: 'winmydispute-full-dispute-kit',
          amount: '699'
        }
      }
    }
  };

  const response = await request(app)
    .post('/api/v1/stripe-webhook')
    .set('stripe-signature', 'good-signature')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event));

  assert.equal(response.status, 200);
}

async function issuePremiumAccessToken(email, sessionId) {
  const response = await request(app)
    .get('/auth/check-license')
    .set(authHeader())
    .query({ email, sessionId });

  assert.equal(response.status, 200);
  assert.equal(response.body.licensed, true);
  assert.equal(response.body.status, 'paid');
  assert.match(response.body.premiumAccessToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  return response.body.premiumAccessToken;
}

async function grantPremiumAccess(email, sessionId) {
  await fulfillPremiumLicense(email, sessionId);
  return issuePremiumAccessToken(email, sessionId);
}

function buildStripeMock() {
  return {
    checkout: {
      sessions: {
        create: async payload => {
          checkoutCounter += 1;
          lastCheckoutPayload = payload;
          return {
            id: `cs_test_${checkoutCounter}`,
            url: `https://checkout.stripe.com/pay/cs_test_${checkoutCounter}`,
            expires_at: 1_800_000_000 + checkoutCounter,
            metadata: payload.metadata
          };
        }
      }
    },
    webhooks: {
      constructEvent: (body, signature) => {
        if (signature === 'bad-signature') {
          throw new Error('Invalid signature');
        }

        return JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
      }
    }
  };
}

async function resetState() {
  resetDatabaseForTesting();
  resetRateLimitsForTesting();
  resetStripeClientForTesting();
  resetLicenseStoreForTesting();
  resetBinDataForTesting();
  resetOutcomeFeedbackForTesting();
  resetCaseFilesForTesting();
  resetJobQueueForTesting();
  resetEvidenceAiClientForTesting();
  checkoutCounter = 0;
  lastCheckoutPayload = null;
  await fs.rm(databaseFile, { force: true });
  await fs.rm(`${databaseFile}-shm`, { force: true });
  await fs.rm(`${databaseFile}-wal`, { force: true });
  await fs.rm(licensesFile, { force: true });
  await fs.rm(legacyPaidUsersFile, { force: true });
  await fs.rm(outcomeFeedbackFile, { force: true });
  await fs.rm(downloadsDir, { recursive: true, force: true });
  await fs.rm(caseFilesFile, { force: true });
  await fs.rm(caseStorageDir, { recursive: true, force: true });
  await fs.rm(storageRootDir, { recursive: true, force: true });
  await fs.writeFile(binsFile, `${JSON.stringify({
    '414720': {
      bin: '414720',
      network: 'visa',
      rawBrand: 'VISA',
      issuer: 'Chase',
      issuerPhone: '800-432-3117',
      issuerUrl: 'https://www.chase.com',
      cardType: 'credit',
      cardSubType: 'signature',
      country: 'US',
      countryCode3: 'USA',
      countryName: 'UNITED STATES'
    }
  }, null, 2)}\n`);
  setStripeClientForTesting(buildStripeMock());
}

before(async () => {
  await resetState();
});

beforeEach(async () => {
  await resetState();
});

after(async () => {
  resetStripeClientForTesting();
  resetLicenseStoreForTesting();
  resetBinDataForTesting();
  resetOutcomeFeedbackForTesting();
  resetCaseFilesForTesting();
  resetJobQueueForTesting();
  resetDatabaseForTesting();
  resetEvidenceAiClientForTesting();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('health endpoint returns request tracing and schema status', async () => {
  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.ok(response.body.schemaVersion);
  assert.equal(response.body.configuration.status, 'ok');
  assert.ok(response.headers['x-request-id']);
});

test('health endpoint degrades when the dedicated artifact signing secret is missing', async () => {
  const originalSecret = process.env.ARTIFACT_TOKEN_SECRET;
  delete process.env.ARTIFACT_TOKEN_SECRET;

  try {
    const response = await request(app).get('/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'degraded');
    assert.equal(response.body.configuration.status, 'missing-required-env');
    assert.ok(response.body.configuration.missing.includes('ARTIFACT_TOKEN_SECRET'));
  } finally {
    process.env.ARTIFACT_TOKEN_SECRET = originalSecret;
  }
});

test('schema metadata is available even before disputeSchema.json is generated', async () => {
  const response = await request(app).get('/api/v1/meta/schema');

  assert.equal(response.status, 200);
  assert.ok(response.body.reasonCodeCount > 0);
  assert.ok(response.body.scenarioCount > 0);
  assert.ok(response.body.binCount > 0);
});

test('intake normalization standardizes messy dates and amounts for GPT follow-up', async () => {
  const response = await request(app)
    .post('/api/v1/intake/normalize')
    .set(authHeader())
    .send({
      network: 'visa',
      issuer: 'Chase',
      merchant: 'Netflix',
      date: '03/01/2026',
      amount: '1,234.56',
      description: 'i cancld the subscrption before renewel but they chargd me again'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.normalizedIntake.transactionDateIso, '2026-03-01');
  assert.equal(response.body.normalizedIntake.transactionAmountValue, 1234.56);
  assert.equal(response.body.normalizedIntake.merchantVertical, 'subscription');
  assert.equal(response.body.reasonMatch.reasonCode, '13.2');
  assert.ok(Array.isArray(response.body.normalizationNotes));
});

test('issuer profile returns richer filing guidance for GPT orchestration', async () => {
  const response = await request(app)
    .get('/api/v1/issuers/Chase/profile')
    .set(authHeader());

  assert.equal(response.status, 200);
  assert.equal(response.body.issuer, 'Chase');
  assert.match(response.body.contact.mailingAddress, /Wilmington/i);
  assert.ok(response.body.preferredSubmissionChannels.includes('online account'));
  assert.ok(response.body.evidenceExamples.includes('receipts'));
});

test('reason search returns ranked matches for faster GPT tool use', async () => {
  const response = await request(app)
    .get('/api/v1/reasons/search')
    .set(authHeader())
    .query({
      network: 'visa',
      query: 'canceled subscription renewed anyway',
      limit: 3
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.query, 'canceled subscription renewed anyway');
  assert.equal(response.body.network, 'visa');
  assert.ok(Array.isArray(response.body.results));
  assert.ok(response.body.results.length > 0);
  assert.equal(response.body.results[0].reasonCode, '13.2');
});

test('evidence quality scoring highlights missing proof before filing', async () => {
  const response = await request(app)
    .post('/api/v1/evidence/quality-score')
    .set(authHeader())
    .send({
      network: 'visa',
      issuer: 'Chase',
      merchantName: 'Netflix',
      transactionDate: '03/01/2026',
      transactionAmount: '1,234.56',
      description: 'I canceled before renewal but they charged me again.',
      evidenceItems: ['Cancellation email', 'Account screenshot'],
      timelineItems: ['02/25 canceled service', '03/01 charge posted']
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.reasonCode, '13.2');
  assert.ok(response.body.evidenceQualityScore >= 60);
  assert.ok(Array.isArray(response.body.recommendedEvidence));
  assert.ok(Array.isArray(response.body.missingPriorityEvidence));
});

test('bin lookup returns canonical metadata from the configured bin store', async () => {
  const response = await request(app).get('/api/v1/bins/414720');

  assert.equal(response.status, 200);
  assert.equal(response.body.bin, '414720');
  assert.equal(response.body.network, 'visa');
  assert.equal(response.body.issuer, 'Chase');
  assert.equal(response.body.country, 'US');
});

test('invalid reason-code lookups return 404 instead of 500', async () => {
  const response = await request(app).get('/api/v1/reasons/visa/not-a-real-code');

  assert.equal(response.status, 404);
  assert.match(response.body.error, /reason code not found/i);
});

test('invalid rebuttal strategy requests return 404 instead of 500', async () => {
  const response = await request(app)
    .post('/api/v1/rebuttal/strategy')
    .set(authHeader())
    .send({
      network: 'visa',
      reasonCode: 'not-a-real-code'
    });

  assert.equal(response.status, 404);
  assert.match(response.body.error, /no rebuttal strategy/i);
});

test('legacy letter download rejects raw html uploads', async () => {
  const response = await request(app)
    .post('/api/v1/letter/download')
    .set(authHeader())
    .send({
      email: 'legacy@example.com',
      letterHtml: '<img src=\"file:///etc/passwd\">'
    });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /raw html uploads are no longer supported/i);
});

test('free preview returns one preview tip and premium feature locks', async () => {
  const response = await request(app)
    .post('/api/v1/disputes/preview')
    .set(authHeader())
    .send({
      network: 'visa',
      issuer: 'Chase',
      description: 'I canceled before renewal but the merchant charged me anyway.'
    });

  assert.equal(response.status, 200);
  assert.equal(typeof response.body.reasonCode, 'string');
  assert.equal(response.body.network, 'visa');
  assert.equal(typeof response.body.confidence, 'number');
  assert.equal(typeof response.body.previewTip, 'string');
  assert.ok(response.body.previewTip.length > 0);
  assert.deepEqual(response.body.premiumFeatures, [
    'full-letter',
    'full-strategy-set',
    'evidence-checklist',
    'cfpb-summary'
  ]);
});

test('preview matching uses reason text signals beyond the tiny scenario map', async () => {
  const response = await request(app)
    .post('/api/v1/disputes/preview')
    .set(authHeader())
    .send({
      network: 'visa',
      issuer: 'Chase',
      description: 'The merchant kept billing my subscription after I ended it and I never used the service again.'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.reasonCode, '13.2');
  assert.equal(response.body.network, 'visa');
  assert.ok(response.body.confidence >= 45);
});

test('preview tolerates common typos and returns a reason-match note', async () => {
  const response = await request(app)
    .post('/api/v1/disputes/preview')
    .set(authHeader())
    .send({
      network: 'visa',
      issuer: 'Chase',
      description: 'I cancld the subscrption before renewel but they chargd me again.'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.reasonCode, '13.2');
  assert.equal(response.body.merchantVertical, 'subscription');
  assert.match(response.body.confidenceNote, /not a guaranteed outcome score/i);
});

test('legacy paidUsers migration seeds the canonical license file', async () => {
  await fs.writeFile(legacyPaidUsersFile, JSON.stringify(['migrated@example.com'], null, 2));
  resetLicenseStoreForTesting();

  const response = await request(app)
    .get('/auth/check-license')
    .set(authHeader())
    .query({ email: 'migrated@example.com' });

  assert.equal(response.status, 200);
  assert.equal(response.body.licensed, true);

  const licenses = await loadLicenses();
  assert.equal(licenses.length, 1);
  assert.equal(licenses[0].email, 'migrated@example.com');
  assert.equal(licenses[0].status, 'paid');
});

test('checkout rejects invalid emails', async () => {
  const response = await request(app)
    .post('/api/v1/create-checkout-session')
    .set(authHeader())
    .send({
      email: 'not-an-email',
      source: 'gpt',
      intent: 'full-dispute-kit'
    });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /valid email/i);
});

test('checkout creates a Stripe URL for a valid unpaid email', async () => {
  const response = await request(app)
    .post('/api/v1/create-checkout-session')
    .set(authHeader())
    .send({
      email: 'buyer@example.com',
      source: 'gpt',
      intent: 'full-dispute-kit'
    });

  assert.equal(response.status, 200);
  assert.match(response.body.sessionId, /^cs_test_/);
  assert.match(response.body.url, /^https:\/\/checkout\.stripe\.com\/pay\//);
  assert.ok(response.body.expiresAt);
  assert.equal(lastCheckoutPayload.line_items[0].price_data.product_data.name, 'WinMyDispute Premium Dispute Kit');
  assert.match(lastCheckoutPayload.line_items[0].price_data.product_data.description, /One-time unlock for the full WinMyDispute premium kit/i);
  assert.equal(lastCheckoutPayload.line_items[0].price_data.product_data.unit_label, 'Dispute kit');
  assert.deepEqual(lastCheckoutPayload.line_items[0].price_data.product_data.images, ['https://example.test/stripe-product.png']);
});

test('checkout limiter returns 429 after repeated requests for the same email', async () => {
  const payload = {
    email: 'ratelimit@example.com',
    source: 'gpt',
    intent: 'full-dispute-kit'
  };

  const first = await request(app).post('/api/v1/create-checkout-session').set(authHeader()).send(payload);
  const second = await request(app).post('/api/v1/create-checkout-session').set(authHeader()).send(payload);
  const third = await request(app).post('/api/v1/create-checkout-session').set(authHeader()).send(payload);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);
  assert.equal(third.body.error, 'Too many requests');
});

test('license check flips from unpaid to paid after webhook fulfillment and remains idempotent', async () => {
  const before = await request(app)
    .get('/auth/check-license')
    .set(authHeader())
    .query({ email: 'paid@example.com' });

  assert.equal(before.status, 200);
  assert.equal(before.body.licensed, false);

  await fulfillPremiumLicense('paid@example.com', 'cs_paid_123');
  await fulfillPremiumLicense('paid@example.com', 'cs_paid_123');


  const licenses = await loadLicenses();
  assert.equal(licenses.length, 1);
  assert.equal(licenses[0].email, 'paid@example.com');
  assert.equal(licenses[0].stripeSessionId, 'cs_paid_123');

  const after = await request(app)
    .get('/auth/check-license')
    .set(authHeader())
    .query({ email: 'paid@example.com' });

  assert.equal(after.status, 200);
  assert.equal(after.body.licensed, true);
  assert.equal(after.body.status, 'paid');

  const exchanged = await request(app)
    .get('/auth/check-license')
    .set(authHeader())
    .query({ email: 'paid@example.com', sessionId: 'cs_paid_123' });

  assert.equal(exchanged.status, 200);
  assert.match(exchanged.body.premiumAccessToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('license exchange rejects a paid email when the checkout session does not match', async () => {
  await fulfillPremiumLicense('paid-mismatch@example.com', 'cs_paid_mismatch_123');

  const response = await request(app)
    .get('/auth/check-license')
    .set(authHeader())
    .query({ email: 'paid-mismatch@example.com', sessionId: 'cs_wrong_123' });

  assert.equal(response.status, 403);
  assert.match(response.body.error, /does not match/i);
});

test('premium generation returns 402 plus checkout URL when unpaid', async () => {
  const response = await request(app)
    .post('/api/v1/generate-letter')
    .set(authHeader())
    .send({
      email: 'premium@example.com',
      network: 'visa',
      issuer: 'Chase',
      merchantName: 'Example Merchant',
      transactionAmount: 89.99,
      transactionDate: '2026-03-20',
      description: 'I canceled before renewal but the merchant charged me anyway.'
    });

  assert.equal(response.status, 402);
  assert.equal(response.body.upgradeRequired, true);
  assert.match(response.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\/pay\//);
  assert.match(response.body.checkoutSessionId, /^cs_test_/);
});

test('paid emails still need a premium token or matching checkout session for premium generation', async () => {
  await fulfillPremiumLicense('licensed-missing-token@example.com', 'cs_premium_missing_token_123');

  const response = await request(app)
    .post('/api/v1/generate-letter')
    .set(authHeader())
    .send({
      email: 'licensed-missing-token@example.com',
      network: 'visa',
      issuer: 'Chase',
      merchantName: 'Example Merchant',
      transactionAmount: 89.99,
      transactionDate: '2026-03-20',
      description: 'I canceled before renewal but the merchant charged me anyway.'
    });

  assert.equal(response.status, 401);
  assert.equal(response.body.accessTokenRequired, true);
  assert.equal(response.body.licensed, true);
});

test('premium generation returns the full premium payload when licensed and session-bound', async () => {
  const premiumAccessToken = await grantPremiumAccess('licensed@example.com', 'cs_premium_123');

  const response = await request(app)
    .post('/api/v1/generate-letter')
    .set(authHeader())
    .send({
      premiumAccessToken,
      email: 'licensed@example.com',
      network: 'visa',
      issuer: 'Chase',
      cardholderName: 'Jane Doe',
      addressLine1: '123 Main St',
      addressLine2: 'Miami, FL 33101',
      phone: '3055551212',
      merchantName: 'Example Merchant',
      transactionAmount: 89.99,
      transactionDate: '2026-03-20',
      description: 'I canceled before renewal but the merchant charged me anyway.'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.email, 'licensed@example.com');
  assert.equal(response.body.premiumAccessToken, premiumAccessToken);
  assert.equal(typeof response.body.letter, 'string');
  assert.equal(typeof response.body.cfpbSummary, 'string');
  assert.ok(Array.isArray(response.body.evidenceChecklist));
  assert.ok(Array.isArray(response.body.strategySet.strategyTips));
  assert.equal(response.body.merchantVertical, 'subscription');
  assert.equal(typeof response.body.successEstimate.estimatedSuccessRate, 'number');
  assert.ok(Array.isArray(response.body.reviewFlags));
  assert.equal(typeof response.body.filingReadiness.readyForSubmission, 'boolean');
  assert.equal(typeof response.body.filingReadiness.readinessLevel, 'string');
  assert.ok(Array.isArray(response.body.filingReadiness.blockers));
  assert.ok(Array.isArray(response.body.filingReadiness.missingCriticalItems));
  assert.equal(typeof response.body.filingReadiness.recommendedNextAction, 'string');
  assert.equal(response.body.documentPreferences.preferredOutputFormat, 'pdf');
  assert.equal(response.body.documentPreferences.preferredRedactionMode, 'none');
  assert.ok(response.body.documentPreferences.supportedRedactionModes.includes('standard'));
  assert.ok(Array.isArray(response.body.exhibitPacket.exhibitIndex));
  assert.ok(response.body.exhibitPacket.exhibitIndex[0].startsWith('Exhibit '));
  assert.ok(Array.isArray(response.body.issuerGuidance.preferredSubmissionChannels));
  assert.ok(Array.isArray(response.body.submissionPlan.steps));
  assert.ok(response.body.caseFile.caseId);
  assert.equal(response.body.caseVersion.stage, 'premium-generated');
});

test('premium generation normalizes structured evidence, flexible dates, and output preferences', async () => {
  const premiumAccessToken = await grantPremiumAccess('normalize@example.com', 'cs_premium_norm_123');

  const response = await request(app)
    .post('/api/v1/generate-letter')
    .set(authHeader())
    .send({
      premiumAccessToken,
      email: 'normalize@example.com',
      network: 'visa',
      issuer: 'Chase',
      cardholderName: 'Jane Doe',
      merchantName: 'Example Subscription',
      transactionAmount: '1,234.56',
      transactionDate: '3/20/26',
      tone: 'strong',
      lengthPreference: 'full',
      outputFormat: 'word',
      description: 'I cancld the subscrption before renewel but they chargd me again.',
      evidenceItems: [
        {
          type: 'screenshot',
          filename: 'cancel-email.png',
          summary: 'Cancellation confirmation',
          extractedText: 'Shows cancellation completed on 3/18/26'
        }
      ],
      timelineItems: [
        '3/18/26: canceled service',
        '3/20/26: charge posted'
      ]
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.reasonCode, '13.2');
  assert.equal(response.body.documentPreferences.preferredOutputFormat, 'docx');
  assert.equal(response.body.documentPreferences.lengthPreference, 'detailed');
  assert.ok(response.body.filingReadiness.strongestSignals.length >= 1);
  assert.match(response.body.letter, /March|2026|3\/20\/26/);
  assert.ok(response.body.evidencePacket.userProvidedEvidence[0].includes('cancel-email.png'));
});

test('premium report generation returns a downloadable native docx document and saves artifact metadata', async () => {
  const premiumAccessToken = await grantPremiumAccess('report@example.com', 'cs_report_123');

  const response = await request(app)
    .post('/api/v1/generate-report-document')
    .set(authHeader())
    .send({
      premiumAccessToken,
      email: 'report@example.com',
      network: 'visa',
      issuer: 'Chase',
      cardholderName: 'Jane Doe',
      merchantName: 'Example Merchant',
      transactionAmount: '89,99',
      transactionDate: '03-20-2026',
      outputFormat: 'word',
      description: 'I canceled before renewal but the merchant charged me anyway.',
      evidenceItems: ['Cancellation email', 'Statement screenshot']
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.premiumAccessToken, premiumAccessToken);
  assert.equal(response.body.format, 'docx');
  assert.equal(response.body.variant, 'full');
  assert.equal(response.body.redactionMode, 'none');
  assert.match(response.body.filename, /\.docx$/);
  assert.match(response.body.url, /^\/api\/v1\/artifacts\/.+\?expires=\d+&signature=/);
  assert.ok(response.body.fileId);
  assert.equal(response.body.artifacts.length, 1);
  assert.ok(response.body.caseFile.caseId);
  assert.equal(response.body.caseVersion.stage, 'document-generated');

  const download = await request(app).get(response.body.url);
  assert.equal(download.status, 200);
  assert.equal(download.headers['content-type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const savedCase = await loadCaseById(response.body.caseFile.caseId);
  assert.ok(savedCase);
  assert.ok(savedCase.latestArtifactFormats.includes('docx'));
  assert.ok(savedCase.latestArtifactFileIds.includes(response.body.fileId));
  assert.equal(savedCase.latestArtifactUrls.length, 1);
});

test('async report generation returns a job and completed result can be fetched later', async () => {
  const premiumAccessToken = await grantPremiumAccess('async-report@example.com', 'cs_async_report_123');

  const queued = await request(app)
    .post('/api/v1/generate-report-document')
    .set(authHeader())
    .send({
      async: true,
      premiumAccessToken,
      email: 'async-report@example.com',
      network: 'visa',
      issuer: 'Chase',
      cardholderName: 'Jane Doe',
      merchantName: 'Example Merchant',
      transactionAmount: '89.99',
      transactionDate: '2026-03-20',
      outputFormat: 'text',
      description: 'I canceled before renewal but the merchant charged me anyway.'
    });

  assert.equal(queued.status, 202);
  assert.equal(queued.body.status, 'pending');
  assert.ok(queued.body.jobId);
  assert.equal(queued.body.premiumAccessToken, premiumAccessToken);

  const completed = await waitForJob(queued.body.jobId, 'async-report@example.com', premiumAccessToken);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, 'completed');
  assert.equal(completed.body.premiumAccessToken, premiumAccessToken);
  assert.equal(completed.body.result.format, 'text');
  assert.ok(completed.body.result.caseFile.caseId);
});

test('report generation can return both full and redacted artifacts for shareable packets', async () => {
  const premiumAccessToken = await grantPremiumAccess('redacted@example.com', 'cs_report_redacted_123');

  const response = await request(app)
    .post('/api/v1/generate-report-document')
    .set(authHeader())
    .send({
      premiumAccessToken,
      email: 'redacted@example.com',
      network: 'visa',
      issuer: 'Chase',
      cardholderName: 'Jane Doe',
      addressLine1: '123 Main St',
      addressLine2: 'Miami, FL 33101',
      phone: '3055551212',
      merchantName: 'Example Merchant',
      transactionAmount: '89.99',
      transactionDate: '2026-03-20',
      outputFormat: 'text',
      redactionMode: 'standard',
      includeRedactedVersion: true,
      description: 'I canceled before renewal but the merchant charged me anyway.'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.premiumAccessToken, premiumAccessToken);
  assert.equal(response.body.format, 'text');
  assert.equal(response.body.variant, 'full');
  assert.equal(response.body.redactionMode, 'none');
  assert.equal(response.body.requestedRedactionMode, 'standard');
  assert.equal(response.body.includeRedactedVersion, true);
  assert.equal(response.body.artifacts.length, 2);
  assert.equal(response.body.redactedArtifact.variant, 'redacted');
  assert.equal(response.body.redactedArtifact.redactionMode, 'standard');
  assert.ok(response.body.redactedArtifact.fileId);

  const redactedDownload = await request(app).get(response.body.redactedArtifact.url);
  assert.equal(redactedDownload.status, 200);
  assert.match(redactedDownload.text, /\[REDACTED_PHONE\]/);
  assert.match(redactedDownload.text, /\[REDACTED_ADDRESS\]/);
});

test('evidence extraction returns 402 plus checkout URL when unpaid', async () => {
  const response = await request(app)
    .post('/api/v1/evidence/extract')
    .set(authHeader())
    .field('email', 'evidence-unpaid@example.com')
    .field('description', 'The merchant charged me after I canceled.')
    .attach('files', Buffer.from('Cancellation confirmed on 3/18/2026'), {
      filename: 'evidence.txt',
      contentType: 'text/plain'
    });

  assert.equal(response.status, 402);
  assert.equal(response.body.upgradeRequired, true);
  assert.match(response.body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\/pay\//);
  assert.match(response.body.checkoutSessionId, /^cs_test_/);
});

test('evidence extraction returns structured evidence for text and OCR-backed image files', async () => {
  const premiumAccessToken = await grantPremiumAccess('evidence@example.com', 'cs_evidence_123');

  setEvidenceAiClientForTesting({
    extractStructuredEvidence: async () => ({
      documentType: 'screenshot',
      summary: 'Screenshot shows refund denied and cancellation acknowledged.',
      extractedText: 'Refund denied. Cancellation received on 03/18/2026.',
      evidenceItems: ['Refund denied message', 'Cancellation acknowledged by merchant'],
      timelineItems: ['03/18/2026: merchant acknowledged cancellation'],
      rebuttalConcerns: ['Merchant may argue cancellation was incomplete or invalid.'],
      warnings: []
    })
  });

  const response = await request(app)
    .post('/api/v1/evidence/extract')
    .set(authHeader())
    .field('premiumAccessToken', premiumAccessToken)
    .field('email', 'evidence@example.com')
    .field('description', 'I canceled before renewal but they charged me anyway.')
    .field('merchantName', 'Example Subscription')
    .attach('files', Buffer.from([
      'Cancellation email',
      '03/18/2026: Customer canceled the service.',
      '03/20/2026: Renewal charge posted.',
      'Refund denied by support.'
    ].join('\n')), {
      filename: 'cancellation-email.txt',
      contentType: 'text/plain'
    })
    .attach('files', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D]), {
      filename: 'refund-chat.png',
      contentType: 'image/png'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.email, 'evidence@example.com');
  assert.equal(response.body.premiumAccessToken, premiumAccessToken);
  assert.equal(response.body.extractedCount, 2);
  assert.ok(Array.isArray(response.body.files));
  assert.ok(response.body.files.some(file => file.extractionMode === 'text-read'));
  assert.ok(response.body.files.some(file => file.extractionMode === 'openai-ocr'));
  assert.ok(response.body.combined.evidenceItems.includes('Refund denied by support.'));
  assert.ok(response.body.combined.timelineItems.some(item => item.includes('03/18/2026')));
  assert.ok(Array.isArray(response.body.exhibitPacket.exhibitIndex));
  assert.ok(response.body.exhibitPacket.exhibitIndex[0].startsWith('Exhibit '));
  assert.equal(response.body.storedFiles.length, 2);
  assert.ok(response.body.caseFile.caseId);
  assert.equal(response.body.caseVersion.stage, 'evidence-extracted');
});

test('evidence extraction can run asynchronously and return the completed result via jobs', async () => {
  const premiumAccessToken = await grantPremiumAccess('evidence-async@example.com', 'cs_evidence_async_123');

  const queued = await request(app)
    .post('/api/v1/evidence/extract')
    .set(authHeader())
    .field('async', 'true')
    .field('premiumAccessToken', premiumAccessToken)
    .field('email', 'evidence-async@example.com')
    .field('description', 'I canceled before renewal but they charged me anyway.')
    .attach('files', Buffer.from('03/18/2026 cancellation email\nRefund denied by support.'), {
      filename: 'followup.txt',
      contentType: 'text/plain'
    });

  assert.equal(queued.status, 202);
  assert.ok(queued.body.jobId);
  assert.equal(queued.body.storedFiles.length, 1);
  assert.equal(queued.body.premiumAccessToken, premiumAccessToken);

  const completed = await waitForJob(queued.body.jobId, 'evidence-async@example.com', premiumAccessToken);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, 'completed');
  assert.equal(completed.body.premiumAccessToken, premiumAccessToken);
  assert.equal(completed.body.result.extractedCount, 1);
  assert.ok(completed.body.result.exhibitPacket.exhibitIndex[0].startsWith('Exhibit '));
});

test('submission bundle generation returns a zip package with bundle metadata', async () => {
  const premiumAccessToken = await grantPremiumAccess('bundle@example.com', 'cs_bundle_123');

  const response = await request(app)
    .post('/api/v1/generate-submission-bundle')
    .set(authHeader())
    .send({
      premiumAccessToken,
      email: 'bundle@example.com',
      network: 'visa',
      issuer: 'Chase',
      cardholderName: 'Jane Doe',
      merchantName: 'Example Merchant',
      transactionAmount: '89.99',
      transactionDate: '2026-03-20',
      outputFormat: 'text',
      includeRedactedVersion: true,
      redactionMode: 'standard',
      description: 'I canceled before renewal but the merchant charged me anyway.'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.premiumAccessToken, premiumAccessToken);
  assert.equal(response.body.format, 'zip');
  assert.match(response.body.url, /^\/api\/v1\/artifacts\/.+\?expires=\d+&signature=/);
  assert.ok(response.body.bundleItems.includes('submission-plan.txt'));
  assert.ok(response.body.bundleItems.includes('exhibit-index.txt'));
  assert.equal(response.body.caseVersion.stage, 'bundle-generated');

  const download = await request(app).get(response.body.url);
  assert.equal(download.status, 200);
  assert.equal(download.headers['content-type'], 'application/zip');
});

test('denial response endpoint generates a reconsideration package', async () => {
  const premiumAccessToken = await grantPremiumAccess('denial@example.com', 'cs_denial_123');

  const response = await request(app)
    .post('/api/v1/denials/respond')
    .set(authHeader())
    .send({
      premiumAccessToken,
      email: 'denial@example.com',
      network: 'visa',
      issuer: 'Chase',
      cardholderName: 'Jane Doe',
      merchantName: 'Example Merchant',
      transactionAmount: '89.99',
      transactionDate: '2026-03-20',
      description: 'I canceled before renewal but the merchant charged me anyway.',
      denialSummary: 'The issuer denied the claim because the merchant says cancellation was incomplete.'
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.premiumAccessToken, premiumAccessToken);
  assert.equal(typeof response.body.counterLetter, 'string');
  assert.ok(Array.isArray(response.body.rebuttalTargets));
  assert.ok(Array.isArray(response.body.additionalEvidenceRequests));
  assert.equal(response.body.caseVersion.stage, 'denial-response-generated');
});

test('saved case history can be listed and fetched by premium email', async () => {
  const premiumAccessToken = await grantPremiumAccess('case@example.com', 'cs_case_123');

  const premium = await request(app)
    .post('/api/v1/generate-letter')
    .set(authHeader())
    .send({
      premiumAccessToken,
      email: 'case@example.com',
      network: 'visa',
      issuer: 'Chase',
      cardholderName: 'Jane Doe',
      merchantName: 'Example Merchant',
      transactionAmount: 89.99,
      transactionDate: '2026-03-20',
      description: 'I canceled before renewal but the merchant charged me anyway.'
    });

  assert.equal(premium.status, 200);

  const listed = await request(app)
    .get('/api/v1/cases')
    .set(authHeader())
    .query({ email: 'case@example.com', premiumAccessToken });

  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.cases[0].caseId, premium.body.caseFile.caseId);
  assert.deepEqual(listed.body.cases[0].latestArtifactFileIds, []);
  assert.equal(listed.body.premiumAccessToken, premiumAccessToken);

  const detail = await request(app)
    .get(`/api/v1/cases/${premium.body.caseFile.caseId}`)
    .set(authHeader())
    .query({ email: 'case@example.com', premiumAccessToken });

  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.body.versions));
  assert.ok(detail.body.versions.length >= 1);
  assert.equal(detail.body.premiumAccessToken, premiumAccessToken);

  const unauthorizedList = await request(app)
    .get('/api/v1/cases')
    .set(authHeader())
    .query({ email: 'case@example.com' });

  assert.equal(unauthorizedList.status, 401);
  assert.equal(unauthorizedList.body.accessTokenRequired, true);

  const directCases = await loadCaseMetadataForEmail('case@example.com');
  assert.equal(directCases.length, 1);

  const legacyDownloads = await request(app).get('/downloads/not-allowed-anymore.pdf');
  assert.equal(legacyDownloads.status, 404);
});

test('historical outcome feedback changes the success estimate model once enough data exists', async () => {
  for (const outcome of ['won', 'won', 'reversed', 'partial', 'lost']) {
    const feedback = await request(app)
      .post('/api/v1/disputes/outcome-feedback')
      .set(authHeader())
      .send({
        network: 'visa',
        reasonCode: '13.2',
        issuer: 'Chase',
        merchantVertical: 'subscription',
        outcome
      });

    assert.equal(feedback.status, 201);
  }

  const estimate = await request(app)
    .post('/api/v1/disputes/estimate-success')
    .set(authHeader())
    .send({
      network: 'visa',
      reasonCode: '13.2',
      issuer: 'Chase',
      merchantVertical: 'subscription',
      consumerEvidence: 'Cancellation email and screenshots',
      priorAttemptsToResolve: true
    });

  assert.equal(estimate.status, 200);
  assert.equal(estimate.body.modelType, 'blended-historical-and-heuristic');
  assert.equal(estimate.body.sampleSize, 5);
  assert.match(estimate.body.rationale, /historical outcome feedback/i);
});
