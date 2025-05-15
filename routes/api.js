// routes/api.js (Polished)
import crypto from 'crypto';
import express from 'express';
import asyncHandler from '../services/asyncHandler.js';
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

const router = express.Router();

// GET /api/v1/bins/:bin - identify card issuer
router.get('/api/v1/bins/:bin', asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const result = await resolveBinToIssuer(req.params.bin);
  res.json(result);
}));

// GET /api/v1/issuers/:issuer/contact - get issuer contact info
router.get('/api/v1/issuers/:issuer/contact', asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const contact = await getIssuerContact(req.params.issuer);
  res.json(contact);
}));

// GET /api/v1/reasons/lookup?network=&scenario= - suggest reason code
router.get('/api/v1/reasons/lookup', asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const { network, scenario } = req.query;
  const reason = await lookupReasonCodeByScenario(network, scenario);
  res.json(reason);
}));

// GET /api/v1/reasons/:network/:code - get reason code details
router.get('/api/v1/reasons/:network/:code', asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const details = await getReasonCodeDetails(req.params.network, req.params.code);
  res.json(details);
}));

// POST /api/v1/builder/evidence-packet - build evidence checklist
router.post('/api/v1/builder/evidence-packet', express.json(), asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid input format' });
  }
  const packet = await buildEvidencePacket(body);
  res.json(packet);
}));

// POST /api/v1/letter/generate - generate dispute letter (JSON)
router.post('/api/v1/letter/generate', express.json(), asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid input format' });
  }
  const letter = await generateDisputeLetter(body);
  res.json(letter);
}));

// POST /api/v1/letter/download - return PDF URL
router.post('/api/v1/letter/download', express.json(), asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid input format' });
  }
  const url = await downloadDisputeLetter(body.letterHtml);
  res.json({ downloadUrl: url });
}));

// POST /api/v1/disputes/estimate-success - predict success rate
router.post('/api/v1/disputes/estimate-success', express.json(), asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid input format' });
  }
  const estimate = await estimateDisputeSuccess(body);
  res.json(estimate);
}));

// POST /api/v1/rebuttal/strategy - merchant rebuttal tactics
router.post('/api/v1/rebuttal/strategy', express.json(), asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid input format' });
  }
  const strategy = await getRebuttalStrategy(body);
  res.json(strategy);
}));

// POST /api/v1/cfpb/complaint-summary - generate CFPB complaint
router.post('/api/v1/cfpb/complaint-summary', express.json(), asyncHandler(async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid input format' });
  }
  const summary = await generateCfpbComplaintSummary(body);
  res.json({ summary });
}));

export default router;