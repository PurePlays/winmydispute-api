import express from 'express';
import validator from 'validator';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { normalizeEmail } from '../services/licenseStore.js';
import {
  extractPremiumAccessContext,
  getPremiumAccessDecision
} from '../services/premiumAccessService.js';
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
    intent: 'full-dispute-kit',
    ...extractPremiumAccessContext(req)
  });

  if (!decision.ok) {
    res.status(decision.statusCode).json({
      ...('error' in decision ? { error: decision.error } : {}),
      ...('upgradeRequired' in decision ? { upgradeRequired: decision.upgradeRequired } : {}),
      ...('checkoutUrl' in decision ? { checkoutUrl: decision.checkoutUrl } : {}),
      ...('checkoutSessionId' in decision ? { checkoutSessionId: decision.checkoutSessionId } : {}),
      ...('accessTokenRequired' in decision ? { accessTokenRequired: decision.accessTokenRequired } : {}),
      ...('licensed' in decision ? { licensed: decision.licensed } : {}),
      ...('message' in decision ? { message: decision.message } : {}),
      requestId: req.requestId || null
    });
    return null;
  }

  return decision;
}

router.get('/api/v1/cases', verifyOpenAIBearer, caseLimiter, async (req, res, next) => {
  try {
    const access = await ensureCaseAccess(req, res);
    if (!access) {
      return;
    }

    const cases = await loadCaseMetadataForEmail(access.email);
    res.json({
      email: access.email,
      count: cases.length,
      cases,
      premiumAccessToken: access.premiumAccessToken
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/v1/cases/:caseId', verifyOpenAIBearer, caseLimiter, async (req, res, next) => {
  try {
    const access = await ensureCaseAccess(req, res);
    if (!access) {
      return;
    }

    const record = await loadCaseById(req.params.caseId);
    if (!record || record.email !== access.email) {
      return res.status(404).json({
        error: 'Case file not found.',
        requestId: req.requestId || null
      });
    }

    res.json({
      ...record,
      premiumAccessToken: access.premiumAccessToken
    });
  } catch (error) {
    next(error);
  }
});

export default router;
