import express from 'express';
import asyncHandler from '../services/asyncHandler.js';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import {
  resolveBinToIssuer,
  getIssuerContact,
  lookupReasonCodeByScenario,
  getReasonCodeDetails,
  buildEvidencePacket,
  generateDisputeLetter,
  downloadDisputeLetter,
  estimateDisputeSuccess,
  getRebuttalStrategy,
  generateCfpbComplaintSummary
} from '../services/disputeService.js';
import { recordOutcomeFeedback } from '../services/outcomeFeedbackService.js';

const router = express.Router();

const writeLimiter = createRateLimit({
  name: 'api-write',
  max: 90,
  windowMs: 60 * 1000,
  keyFn: req => req.body?.email || req.ip || 'anonymous',
  envMax: process.env.API_WRITE_RATE_LIMIT_MAX,
  envWindowMs: process.env.API_WRITE_RATE_LIMIT_WINDOW_MS
});

function ensureJsonObject(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({
      error: 'Invalid input format',
      requestId: req.requestId || null
    });
    return null;
  }

  return body;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// GET /api/v1/bins/:bin - identify card issuer
router.get('/api/v1/bins/:bin', asyncHandler(async (req, res) => {
  const result = await resolveBinToIssuer(req.params.bin);
  res.json(result);
}));

// GET /api/v1/issuers/:issuer/contact - get issuer contact info
router.get('/api/v1/issuers/:issuer/contact', asyncHandler(async (req, res) => {
  const contact = await getIssuerContact(req.params.issuer);
  res.json(contact);
}));

// GET /api/v1/reasons/lookup?network=&scenario= - suggest reason code
router.get('/api/v1/reasons/lookup', asyncHandler(async (req, res) => {
  const { network, scenario } = req.query;
  const reason = await lookupReasonCodeByScenario(network, scenario);
  res.json(reason);
}));

// GET /api/v1/reasons/:network/:code - get reason code details
router.get('/api/v1/reasons/:network/:code', asyncHandler(async (req, res) => {
  const details = await getReasonCodeDetails(req.params.network, req.params.code);
  res.json(details);
}));

// POST /api/v1/builder/evidence-packet - build evidence checklist
router.post('/api/v1/builder/evidence-packet', verifyOpenAIBearer, writeLimiter, asyncHandler(async (req, res) => {
  const body = ensureJsonObject(req, res);
  if (!body) {
    return;
  }

  const packet = await buildEvidencePacket(body);
  res.json(packet);
}));

// POST /api/v1/letter/generate - generate dispute letter (JSON)
router.post('/api/v1/letter/generate', verifyOpenAIBearer, writeLimiter, asyncHandler(async (req, res) => {
  const body = ensureJsonObject(req, res);
  if (!body) {
    return;
  }

  const letter = await generateDisputeLetter(body);
  res.json(letter);
}));

// POST /api/v1/letter/download - return PDF URL
router.post('/api/v1/letter/download', verifyOpenAIBearer, writeLimiter, asyncHandler(async (req, res) => {
  const body = ensureJsonObject(req, res);
  if (!body) {
    return;
  }

  const html = typeof body.letterHtml === 'string' && body.letterHtml.trim()
    ? body.letterHtml
    : typeof body.letterText === 'string' && body.letterText.trim()
      ? `<pre>${escapeHtml(body.letterText)}</pre>`
      : '';

  if (!html) {
    return res.status(400).json({
      error: 'letterText or letterHtml is required',
      requestId: req.requestId || null
    });
  }

  const url = await downloadDisputeLetter(html, {
    email: typeof body.email === 'string' ? body.email : null
  });
  res.json({ downloadUrl: url });
}));

// POST /api/v1/disputes/estimate-success - predict success rate
router.post('/api/v1/disputes/estimate-success', verifyOpenAIBearer, writeLimiter, asyncHandler(async (req, res) => {
  const body = ensureJsonObject(req, res);
  if (!body) {
    return;
  }

  const estimate = await estimateDisputeSuccess(body);
  res.json(estimate);
}));

// POST /api/v1/rebuttal/strategy - merchant rebuttal tactics
router.post('/api/v1/rebuttal/strategy', verifyOpenAIBearer, writeLimiter, asyncHandler(async (req, res) => {
  const body = ensureJsonObject(req, res);
  if (!body) {
    return;
  }

  const strategy = await getRebuttalStrategy(body);
  res.json(strategy);
}));

// POST /api/v1/cfpb/complaint-summary - generate CFPB complaint
router.post('/api/v1/cfpb/complaint-summary', verifyOpenAIBearer, writeLimiter, asyncHandler(async (req, res) => {
  const body = ensureJsonObject(req, res);
  if (!body) {
    return;
  }

  const summary = await generateCfpbComplaintSummary(body);
  res.json({ summary });
}));

router.post('/api/v1/disputes/outcome-feedback', verifyOpenAIBearer, writeLimiter, asyncHandler(async (req, res) => {
  const body = ensureJsonObject(req, res);
  if (!body) {
    return;
  }

  const normalizedOutcome = String(body.outcome || '').trim().toLowerCase();
  if (!body.network || !body.reasonCode || !normalizedOutcome) {
    return res.status(400).json({
      error: 'network, reasonCode, and outcome are required',
      requestId: req.requestId || null
    });
  }

  if (!['won', 'lost', 'partial', 'reversed', 'denied'].includes(normalizedOutcome)) {
    return res.status(400).json({
      error: 'outcome must be one of won, lost, partial, reversed, or denied',
      requestId: req.requestId || null
    });
  }

  const saved = await recordOutcomeFeedback({
    ...body,
    outcome: normalizedOutcome
  });
  res.status(201).json({
    recorded: true,
    outcome: saved.outcome,
    reasonCode: saved.reasonCode,
    network: saved.network,
    requestId: req.requestId || null
  });
}));

export default router;
