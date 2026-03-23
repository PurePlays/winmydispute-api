process.on('uncaughtException', err => {
  console.error('🔥 Uncaught Exception:', err);
});
process.on('unhandledRejection', err => {
  console.error('🔥 Unhandled Rejection:', err);
});

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import helmet from 'helmet';
import * as Sentry from '@sentry/node';

// Routers
import apiRouter from './routes/api.js';
import binLookupRouter from './routes/binLookup.js';
import checkoutRouter from './routes/checkout.js';
import generateLetterRouter from './routes/generateLetter.js';
import intakeRouter from './routes/intake.js';
import letterRouter from './routes/letter.js';
import strategyRouter from './routes/strategy.js';
import swaggerRouter from './routes/swagger.js';
import webhookRouter from './routes/stripeWebhook.js';
import searchStrategyRouter from './routes/searchStrategy.js';

// Services
import { findReasonByKeyword } from './services/reasonService.js';
import { matchScenarioToReasonCode } from './services/matchScenarioToReasonCode.js';

const authFromToken = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : null;

  if (token) {
    req.user = { id: token.slice(0, 12), token };
  }
  next();
};

// OpenAI Plugin Token Verification Middleware
function verifyOpenAIPluginToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.OPENAI_BEARER;

  if (!authHeader || !authHeader.startsWith('Bearer ') || !expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const provided = authHeader.replace('Bearer ', '');
  if (provided !== expectedToken) {
    return res.status(403).json({ error: 'Invalid or missing verification token' });
  }

  next();
}

dotenv.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0, // Capture 100% of transactions for performance monitoring
  sendDefaultPii: false, // Avoid sending PII unless required
  environment: process.env.NODE_ENV || 'development'
});

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app        = express();
const port       = process.env.PORT || 3000;

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ Missing STRIPE_SECRET_KEY. Exiting.');
  process.exit(1);
}

const TOKENS_FILE = path.join(__dirname, 'tokens.json');

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// Sentry request handler (should be before all other middleware)
if (Sentry.Handlers?.requestHandler && Sentry.Handlers?.tracingHandler) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

app.use(authFromToken); // Inject req.user if token is valid
// ─── Sentry Test Route ───────────────────────────────────────────────────────
app.get('/test-sentry', (_req, res) => {
  throw new Error('Test Sentry error');
});

// ─── Static Assets & Legal Pages ──────────────────────────────────────────────
const staticDir = path.join(__dirname, 'static');
app.use(express.static(staticDir, { dotfiles: 'allow' }));

app.get('/terms', (_req, res) => res.sendFile(path.join(staticDir, 'terms.html')));
app.get('/privacy', (_req, res) => res.sendFile(path.join(staticDir, 'privacy.html')));
app.get('/success', (_req, res) => res.sendFile(path.join(staticDir, 'success.html')));
app.get('/privacy-policy.txt', (_req, res) => res.sendFile(path.join(staticDir, 'privacy-policy.txt')));
app.get('/.well-known/openai-plugin.json', (_req, res) => res.sendFile(path.join(__dirname, 'gpt-config', 'ai-plugin.json')));
app.get('/.well-known/security.txt', (_req, res) => res.type('text/plain').send([
  'Contact: pureplays@icloud.com',
  'Encryption: none',
  'Acknowledgements: none',
  'Preferred-Languages: en'
].join('\n')));

// ─── Serve OpenAPI Spec ───────────────────────────────────────────────────────
app.get('/openapi.yaml', (_req, res) => res.sendFile(path.join(__dirname, 'openapi.yaml')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ─── Testing Endpoints ────────────────────────────────────────────────────────
app.get('/test/visa/keyword/:keyword', (req, res) => {
  const results = findReasonByKeyword('visa', req.params.keyword);
  return results.length
    ? res.json(results)
    : res.status(404).json({ error: 'No matching reasons found' });
});

app.post('/test/match-scenario', (req, res) => {
  const { description } = req.body;
  if (!description) {
    return res.status(400).json({ error: 'Missing description field' });
  }
  const matched = matchScenarioToReasonCode(description);
  return matched.reasonCode
    ? res.json(matched)
    : res.status(404).json({ error: 'No suitable reason code found' });
});

// ─── Token Verification Endpoint ──────────────────────────────────────────────
app.post('/auth/verify-token', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    // Check if the file exists before reading
    let content;
    try {
      content = await fs.readFile(TOKENS_FILE, 'utf-8');
    } catch (e) {
      return res.status(500).json({ error: 'Token file missing' });
    }
    const tokens = JSON.parse(content);
    const entry = tokens.find(t => t.token === token);
    if (!entry) return res.status(404).json({ error: 'Token not found' });
    res.json({ token: entry.token, used: entry.used });
  } catch (err) {
    console.error('❌ Token verify error:', err);
    res.status(500).json({ error: 'Internal error verifying token' });
  }
});

// ─── Admin-only: View all Dispute Sessions ───────────────────────────────────
// Enhanced: Filtering, admin token check, sorted output
app.get('/api/v1/disputes', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { merchant, network, outcome } = req.query;
  const sessionFile = path.resolve(__dirname, 'mock-data/disputeSessions.json');

  try {
    const content = await fs.readFile(sessionFile, 'utf-8');
    let data = JSON.parse(content);

    if (merchant) {
      data = data.filter(d => d.merchant?.toLowerCase().includes(merchant.toLowerCase()));
    }
    if (network) {
      data = data.filter(d => d.network?.toLowerCase() === network.toLowerCase());
    }
    if (outcome) {
      data = data.filter(d => d.outcome?.toLowerCase() === outcome.toLowerCase());
    }

    data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.status(200).json(data);
  } catch (err) {
    console.error('❌ Error reading disputeSessions.json:', err.message);
    res.status(500).json({ error: 'Could not load dispute sessions.' });
  }
});

// ─── Core API Routers ─────────────────────────────────────────────────────────
app.use('/', apiRouter);
// Protect premium plugin API routes with OpenAI plugin token verification
// Updated generateLetterRouter POST route to support PDF & DOCX generation, evidence bundling, and paywall logic
app.post('/api/v1/generate-letter', verifyOpenAIPluginToken, async (req, res, next) => {
  try {
    const { includePdf = true, includeDocx = true, paywallUnlocked = false, evidence = [], rebuttalStrategy = null, ...rest } = req.body;

    // Prepare evidence to include based on paywall status
    let includedEvidence;
    if (paywallUnlocked) {
      includedEvidence = evidence; // Include all evidence
    } else {
      includedEvidence = evidence.length > 0 ? [evidence[0]] : []; // Only 1 free piece of evidence
    }

    // Prepare strategy tips based on paywall
    let strategyTips;
    if (paywallUnlocked && rebuttalStrategy) {
      strategyTips = rebuttalStrategy;
    } else {
      strategyTips = rest.strategyTips ? rest.strategyTips.slice(0,1) : []; // Only 1 strategy tip if paywall locked
    }

    // Generate letter content (pseudo code, replace with actual generation logic)
    const letterContent = `Letter content with strategy tips and evidence.\n\nStrategy Tips:\n${strategyTips.join('\n')}\n\nEvidence:\n${includedEvidence.map((e, i) => `Exhibit ${String.fromCharCode(65 + i)}: ${e.description || 'Evidence item'}`).join('\n')}`;

    const cfpbComplaint = paywallUnlocked
      ? `If your dispute is denied or ignored, you may file a formal complaint with the Consumer Financial Protection Bureau (CFPB) at https://www.consumerfinance.gov/complaint/. Include the dispute letter and reference this merchant: ${rest.merchantName || 'the merchant'}.`
      : null;

    // Generate PDF and DOCX files (pseudo implementation)
    const outputFiles = [];
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });

    if (includePdf) {
      // Generate PDF file path and content
      const pdfPath = path.join(tempDir, `letter_${Date.now()}.pdf`);
      // TODO: Add actual PDF generation logic here
      await fs.writeFile(pdfPath, Buffer.from(letterContent)); // Placeholder write
      outputFiles.push({ path: pdfPath, name: path.basename(pdfPath) });
    }

    if (includeDocx) {
      // Generate DOCX file path and content
      const docxPath = path.join(tempDir, `letter_${Date.now()}.docx`);
      // TODO: Add actual DOCX generation logic here
      await fs.writeFile(docxPath, Buffer.from(letterContent)); // Placeholder write
      outputFiles.push({ path: docxPath, name: path.basename(docxPath) });
    }

    // Bundle evidence files as exhibits (pseudo logic)
    // Rename uploaded files as Exhibit A, B, etc.
    // Since upload logic not added yet, just prepare for bundling

    // Create ZIP archive containing generated files and evidence (pseudo implementation)
    // TODO: Implement ZIP bundling logic and respond with download link or file buffer

    // ─── Save Session to File for Memory/Analytics ─────────────────────────────
    const sessionLog = {
      sessionId: rest.sessionId || `sess_${Date.now()}`,
      timestamp: new Date().toISOString(),
      merchant: rest.merchantName || '',
      amount: rest.transactionAmount || '',
      network: rest.network || '',
      reasonCode: rest.reasonCode || '',
      strategyTips: strategyTips,
      paywallUnlocked,
      transactionDate: rest.transactionDate || '',
      outcome: 'pending'
    };

    const sessionFile = path.resolve(__dirname, 'mock-data/disputeSessions.json');
    let existing = [];
    try {
      const content = await fs.readFile(sessionFile, 'utf-8');
      existing = JSON.parse(content);
    } catch (err) {
      existing = [];
    }
    existing.push(sessionLog);
    await fs.writeFile(sessionFile, JSON.stringify(existing, null, 2));

    // For now, respond with success and file names
    res.json({
      message: 'Letter generated with requested formats and evidence bundling prepared.',
      files: outputFiles.map(f => f.name),
      exhibits: includedEvidence.map((e, i) => ({ label: `Exhibit ${String.fromCharCode(65 + i)}`, description: e.description || 'Evidence item' })),
      cfpbComplaint
    });

  } catch (err) {
    next(err);
  }
});
app.use('/api/v1/generate-letter', generateLetterRouter);
app.use('/api/v1/strategy', verifyOpenAIPluginToken, strategyRouter);

// Other routers (open or not requiring plugin token)
app.use('/intake', intakeRouter);
app.use('/checkout', checkoutRouter);
app.use('/letter', letterRouter);
app.use('/webhook', webhookRouter);
app.use('/', swaggerRouter);
app.use('/', binLookupRouter);
app.use('/', searchStrategyRouter);

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('❌ Server error:', err);
  Sentry.setContext('requestInfo', {
    url: _req.originalUrl,
    method: _req.method,
    user: _req.user?.id || 'anonymous',
  });
  Sentry.captureException(err);  // Log the error in Sentry
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`✅ WinMyDispute API running on port ${port}`);
});
