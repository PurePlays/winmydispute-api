import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';

const openapiPath = path.join(process.cwd(), 'openapi.yaml');
const openapi = await fs.readFile(openapiPath, 'utf8');

test('OpenAPI documents the canonical GPT flow and rate-limit behavior', () => {
  const requiredPaths = [
    '/health',
    '/api/v1/meta/schema',
    '/api/v1/intake/normalize',
    '/api/v1/disputes/preview',
    '/api/v1/create-checkout-session',
    '/api/v1/stripe-webhook',
    '/auth/check-license',
    '/api/v1/issuers/{issuer}/profile',
    '/api/v1/reasons/search',
    '/api/v1/generate-letter',
    '/api/v1/generate-report-document',
    '/api/v1/generate-submission-bundle',
    '/api/v1/denials/respond',
    '/api/v1/evidence/extract',
    '/api/v1/evidence/quality-score',
    '/api/v1/jobs/{jobId}',
    '/api/v1/artifacts/{fileId}',
    '/api/v1/cases',
    '/api/v1/cases/{caseId}',
    '/api/v1/disputes/estimate-success',
    '/api/v1/disputes/outcome-feedback'
  ];

  for (const apiPath of requiredPaths) {
    assert.match(openapi, new RegExp(apiPath.replaceAll('/', '\\/')));
  }

  assert.match(openapi, /TooManyRequests/);
  assert.match(openapi, /NormalizedIntakeResponse/);
  assert.match(openapi, /ReasonSearchResponse/);
  assert.match(openapi, /IssuerProfile/);
  assert.match(openapi, /UpgradeRequiredResponse/);
  assert.match(openapi, /DocumentPreferences/);
  assert.match(openapi, /EvidenceExtractionResponse/);
  assert.match(openapi, /EvidenceQualityScoreResponse/);
  assert.match(openapi, /ExhibitPacket/);
  assert.match(openapi, /IssuerGuidance/);
  assert.match(openapi, /SuccessEstimate/);
  assert.match(openapi, /FilingReadiness/);
  assert.match(openapi, /ReviewFlag/);
  assert.match(openapi, /DenialResponse/);
  assert.match(openapi, /SubmissionBundleResponse/);
  assert.match(openapi, /JobStatusResponse/);
  assert.match(openapi, /CaseFileSummary/);
  assert.match(openapi, /SubmissionPlan/);
  assert.match(openapi, /ReportArtifact/);
  assert.match(openapi, /bearerAuth/);
  assert.match(openapi, /premiumAccessToken:/);
  assert.match(openapi, /checkoutSessionId:/);
  assert.match(openapi, /previewTip:/);
  assert.match(openapi, /redactionMode:/);
  assert.match(openapi, /requestId:/);
});
