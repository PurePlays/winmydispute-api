import express from 'express';
import validator from 'validator';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { recordAuditEvent } from '../services/auditLogService.js';
import { getLicenseByEmail, normalizeEmail } from '../services/licenseStore.js';

const router = express.Router();

const licenseLookupLimiter = createRateLimit({
  name: 'license-lookup',
  max: 120,
  windowMs: 60 * 60 * 1000,
  keyFn: req => normalizeEmail(req.query.email) || req.ip || 'anonymous',
  envMax: process.env.LICENSE_LOOKUP_RATE_LIMIT_MAX,
  envWindowMs: process.env.LICENSE_LOOKUP_RATE_LIMIT_WINDOW_MS
});

router.get('/auth/check-license', verifyOpenAIBearer, licenseLookupLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.query.email);
    if (!email || !validator.isEmail(email)) {
      return res.status(400).json({
        error: 'A valid email query parameter is required.',
        requestId: req.requestId || null
      });
    }

    const license = await getLicenseByEmail(email);
    await recordAuditEvent({
      eventType: 'license.lookup',
      category: 'payment',
      requestId: req.requestId,
      actorType: 'gpt-token',
      actorId: req.auth?.tokenId || null,
      email,
      status: license?.status === 'paid' ? 'success' : 'not-found',
      message: 'License status checked.'
    });
    res.json({
      licensed: license?.status === 'paid',
      status: license?.status || 'unpaid',
      email
    });
  } catch (error) {
    next(error);
  }
});

export default router;
