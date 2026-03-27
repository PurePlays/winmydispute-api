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
import artifactsRouter from './routes/artifacts.js';
import binLookupRouter from './routes/binLookup.js';
import casesRouter from './routes/cases.js';
import checkoutRouter from './routes/checkout.js';
import denialRouter from './routes/denial.js';
import evidenceRouter from './routes/evidence.js';
import generateLetterRouter from './routes/generateLetter.js';
import intakeRouter from './routes/intake.js';
import jobsRouter from './routes/jobs.js';
import licenseRouter from './routes/license.js';
import metaRouter from './routes/meta.js';
import strategyRouter from './routes/strategy.js';
import swaggerRouter from './routes/swagger.js';
import webhookRouter from './routes/stripeWebhook.js';
import searchStrategyRouter from './routes/searchStrategy.js';
import requestContext from './middleware/requestContext.js';
import './services/registerJobProcessors.js';

// Services
import { getSchemaSummary } from './services/disputeSchemaService.js';
import { resumePendingJobs } from './services/jobQueueService.js';

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

dotenv.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN?.trim() || undefined,
  tracesSampleRate: 1.0, // Capture 100% of transactions for performance monitoring
  sendDefaultPii: false, // Avoid sending PII unless required
  environment: process.env.NODE_ENV || 'development'
});

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app        = express();
const port       = process.env.PORT || 3000;

function hasValue(value) {
  return Boolean(String(value || '').trim());
}

function getMissingRequiredConfiguration() {
  const requiredChecks = [
    { label: 'BASE_URL', present: hasValue(process.env.BASE_URL) },
    { label: 'STRIPE_SECRET_KEY', present: hasValue(process.env.STRIPE_SECRET_KEY) },
    { label: 'STRIPE_WEBHOOK_SECRET', present: hasValue(process.env.STRIPE_WEBHOOK_SECRET) },
    { label: 'ARTIFACT_TOKEN_SECRET', present: hasValue(process.env.ARTIFACT_TOKEN_SECRET) },
    {
      label: 'OPENAI_BEARER or OPENAI_BEARERS_JSON',
      present: hasValue(process.env.OPENAI_BEARER) || hasValue(process.env.OPENAI_BEARERS_JSON)
    }
  ];

  return requiredChecks
    .filter(check => !check.present)
    .map(check => check.label);
}

const jsonBodyParser = express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(requestContext);

// Stripe webhook must receive the raw request body for signature validation.
app.use('/', webhookRouter);
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/v1/stripe-webhook')) {
    return next();
  }

  return jsonBodyParser(req, res, next);
});

// Sentry request handler (should be before all other middleware)
if (Sentry.Handlers?.requestHandler && Sentry.Handlers?.tracingHandler) {
  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());
}

app.use(authFromToken); // Inject req.user if token is valid

// ─── Static Assets & Legal Pages ──────────────────────────────────────────────
const staticDir = path.join(__dirname, 'static');
app.use(express.static(staticDir, { dotfiles: 'allow' }));

app.get('/terms', (_req, res) => res.sendFile(path.join(staticDir, 'terms.html')));
app.get('/privacy', (_req, res) => res.sendFile(path.join(staticDir, 'privacy.html')));
app.get('/generate', (_req, res) => res.sendFile(path.join(staticDir, 'generate.html')));
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
app.get('/openapi.gpt.yaml', (_req, res) => res.sendFile(path.join(__dirname, 'gpt-config', 'openapi.gpt.yaml')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const missingConfiguration = getMissingRequiredConfiguration();
  const schemaSummary = getSchemaSummary();

  res.status(200).json({
    status: missingConfiguration.length === 0 ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    schemaVersion: schemaSummary.schemaVersion,
    configuration: {
      status: missingConfiguration.length === 0 ? 'ok' : 'missing-required-env',
      missing: missingConfiguration
    }
  });
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
app.use('/', artifactsRouter);
app.use('/', casesRouter);
app.use('/', denialRouter);
app.use('/', evidenceRouter);
app.use('/', generateLetterRouter);
app.use('/', jobsRouter);
app.use('/', checkoutRouter);
app.use('/', licenseRouter);
app.use('/', metaRouter);
app.use('/', strategyRouter);

// Other routers (open or not requiring plugin token)
app.use('/', intakeRouter);
app.use('/', swaggerRouter);
app.use('/', binLookupRouter);
app.use('/', searchStrategyRouter);

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  const statusCode = Number(err?.statusCode);
  const responseStatus = Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600
    ? statusCode
    : 500;

  if (responseStatus >= 500) {
    console.error('❌ Server error:', err);
  } else {
    console.warn(`⚠️ Request failed with ${responseStatus}: ${err?.message || 'Request failed'}`);
  }

  if (responseStatus >= 500) {
    Sentry.setContext('requestInfo', {
      url: _req.originalUrl,
      method: _req.method,
      user: _req.user?.id || 'anonymous',
    });
    Sentry.captureException(err);  // Log the error in Sentry
  }

  res.status(responseStatus).json({
    error: responseStatus >= 500 ? 'Internal server error' : (err?.message || 'Request failed'),
    requestId: _req.requestId || null
  });
});

function startServer() {
  const missingConfiguration = getMissingRequiredConfiguration();
  if (missingConfiguration.length > 0) {
    console.warn(`⚠️ Starting in degraded mode. Missing required environment variables: ${missingConfiguration.join(', ')}`);
  }
  resumePendingJobs();
  return app.listen(port, () => {
    console.log(`✅ WinMyDispute API running on port ${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    startServer();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

export { app, startServer };
export default app;
