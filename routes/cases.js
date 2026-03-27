import express from 'express';
import validator from 'validator';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { normalizeEmail } from '../services/licenseStore.js';
import { getPremiumAccessDecision } from '../services/premiumAccessService.js';
import { loadCaseById, loadCaseMetadataForEmail } from '../services/caseFileService.js';

const router = express.Router();

const caseLimiter = createRateLimit({
  name: 'cases',
  max: 120,
  windowMs: 60 * 60 * 1000,
  keyFn: req => normalizeEmail(req.query.email) || req.ip || 'anonymous',
  envMax: process.env.CASES_RATE_LIMIT_MAX,
  envWindowMs: process.env.CASES_RATE_LIMIT_WINDOW_MS
});

async function ensureCaseAccess(req, res) {
  const email = normalizeEmail(req.query.email);
  if (!email || !validator.isEmail(email)) {
    res.status(400).json({
      error: 'A valid email query parameter is required.',
      requestId: req.requestId || null
    });
    return null;
  }

  const decision = await getPremiumAccessDecision({
    email,
    source: 'gpt',
    intent: 'full-dispute-kit'
  });

  if (!decision.ok) {
    res.status(decision.statusCode).json({
      ...('error' in decision ? { error: decision.error } : {}),
      ...('upgradeRequired' in decision ? { upgradeRequired: decision.upgradeRequired } : {}),
      ...('checkoutUrl' in decision ? { checkoutUrl: decision.checkoutUrl } : {}),
      ...('message' in decision ? { message: decision.message } : {}),
      requestId: req.requestId || null
    });
    return null;
  }

  return decision.email;
}

router.get('/api/v1/cases', verifyOpenAIBearer, caseLimiter, async (req, res, next) => {
  try {
    const email = await ensureCaseAccess(req, res);
    if (!email) {
      return;
    }

    const cases = await loadCaseMetadataForEmail(email);
    res.json({
      email,
      count: cases.length,
      cases
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/v1/cases/:caseId', verifyOpenAIBearer, caseLimiter, async (req, res, next) => {
  try {
    const email = await ensureCaseAccess(req, res);
    if (!email) {
      return;
    }

    const record = await loadCaseById(req.params.caseId);
    if (!record || record.email !== email) {
      return res.status(404).json({
        error: 'Case file not found.',
        requestId: req.requestId || null
      });
    }

    res.json(record);
  } catch (error) {
    next(error);
  }
});

export default router;
