import express from 'express';
import asyncHandler from '../services/asyncHandler.js';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { recordAuditEvent } from '../services/auditLogService.js';
import { saveCaseVersion } from '../services/caseFileService.js';
import { buildDenialResponsePackage } from '../services/denialResponseService.js';
import { getPremiumAccessDecision } from '../services/premiumAccessService.js';
import { normalizeEmail } from '../services/licenseStore.js';

const router = express.Router();

const denialLimiter = createRateLimit({
  name: 'denial-response',
  max: 36,
  windowMs: 60 * 60 * 1000,
  keyFn: req => normalizeEmail(req.body?.email) || req.ip || 'anonymous',
  envMax: process.env.DENIAL_RATE_LIMIT_MAX,
  envWindowMs: process.env.DENIAL_RATE_LIMIT_WINDOW_MS
});

router.post('/api/v1/denials/respond', verifyOpenAIBearer, denialLimiter, asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const decision = await getPremiumAccessDecision({
    email,
    source: 'gpt',
    intent: 'full-dispute-kit'
  });

  if (!decision.ok) {
    return res.status(decision.statusCode).json({
      ...('error' in decision ? { error: decision.error } : {}),
      ...('upgradeRequired' in decision ? { upgradeRequired: decision.upgradeRequired } : {}),
      ...('checkoutUrl' in decision ? { checkoutUrl: decision.checkoutUrl } : {}),
      ...('message' in decision ? { message: decision.message } : {}),
      requestId: req.requestId || null
    });
  }

  const responsePayload = await buildDenialResponsePackage({
    ...req.body,
    email: decision.email
  });
  const caseState = await saveCaseVersion({
    caseId: req.body?.caseId || undefined,
    email: decision.email,
    stage: 'denial-response-generated',
    intake: req.body || {},
    premium: responsePayload,
    source: 'denial-response-api'
  });

  await recordAuditEvent({
    eventType: 'denial.response_generated',
    category: 'premium',
    requestId: req.requestId,
    actorType: 'gpt-token',
    actorId: req.auth?.tokenId || null,
    email: decision.email,
    caseId: caseState.caseFile.caseId,
    status: 'success',
    message: 'Denial response package generated.'
  });

  return res.json({
    ...responsePayload,
    caseFile: caseState.caseFile,
    caseVersion: caseState.version
  });
}));

export default router;
