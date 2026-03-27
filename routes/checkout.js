import express from 'express';
import asyncHandler from '../services/asyncHandler.js';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { recordAuditEvent } from '../services/auditLogService.js';
import { normalizeEmail } from '../services/licenseStore.js';
import { createCheckoutSession, validateCheckoutPayload } from '../services/checkoutService.js';

const router = express.Router();

const checkoutLimiter = createRateLimit({
  name: 'checkout',
  max: 24,
  windowMs: 60 * 60 * 1000,
  keyFn: req => normalizeEmail(req.body?.email) || req.ip || 'anonymous',
  envMax: process.env.CHECKOUT_RATE_LIMIT_MAX,
  envWindowMs: process.env.CHECKOUT_RATE_LIMIT_WINDOW_MS
});

router.post(
  '/api/v1/create-checkout-session',
  verifyOpenAIBearer,
  checkoutLimiter,
  asyncHandler(async (req, res) => {
    const validation = validateCheckoutPayload(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({
        error: validation.error,
        requestId: req.requestId || null
      });
    }

    const session = await createCheckoutSession(validation.value);
    if (session.alreadyLicensed) {
      await recordAuditEvent({
        eventType: 'checkout.already_licensed',
        category: 'payment',
        requestId: req.requestId,
        actorType: 'gpt-token',
        actorId: req.auth?.tokenId || null,
        email: validation.value.email,
        status: 'success',
        message: 'Checkout request short-circuited because the email is already licensed.'
      });
      return res.status(409).json({
        licensed: true,
        status: 'paid',
        email: validation.value.email,
        message: 'This email already has premium access.',
        requestId: req.requestId || null
      });
    }

    await recordAuditEvent({
      eventType: 'checkout.session_created',
      category: 'payment',
      requestId: req.requestId,
      actorType: 'gpt-token',
      actorId: req.auth?.tokenId || null,
      email: validation.value.email,
      status: 'success',
      message: 'Stripe Checkout session created.',
      metadata: {
        sessionId: session.sessionId
      }
    });

    return res.json({
      sessionId: session.sessionId,
      url: session.url,
      expiresAt: session.expiresAt
    });
  })
);

export default router;
