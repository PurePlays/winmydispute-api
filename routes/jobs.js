import express from 'express';
import validator from 'validator';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { getJob } from '../services/jobQueueService.js';
import {
  extractPremiumAccessContext,
  getPremiumAccessDecision
} from '../services/premiumAccessService.js';
import { normalizeEmail } from '../services/licenseStore.js';

const router = express.Router();

const jobsLimiter = createRateLimit({
  name: 'jobs',
  max: 240,
  windowMs: 60 * 60 * 1000,
  keyFn: req => normalizeEmail(req.query.email) || req.ip || 'anonymous',
  envMax: process.env.JOBS_RATE_LIMIT_MAX,
  envWindowMs: process.env.JOBS_RATE_LIMIT_WINDOW_MS
});

async function ensureJobAccess(req, res) {
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

router.get('/api/v1/jobs/:jobId', verifyOpenAIBearer, jobsLimiter, async (req, res, next) => {
  try {
    const access = await ensureJobAccess(req, res);
    if (!access) {
      return;
    }

    const job = await getJob(req.params.jobId);
    if (!job || job.email !== access.email) {
      return res.status(404).json({
        error: 'Job not found.',
        requestId: req.requestId || null
      });
    }

    return res.json({
      ...job,
      premiumAccessToken: access.premiumAccessToken
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
