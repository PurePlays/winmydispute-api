import validator from 'validator';
import { createCheckoutSession } from './checkoutService.js';
import { getLicenseByEmail, normalizeEmail } from './licenseStore.js';
import {
  exchangePremiumAccessToken,
  getPresentedCheckoutSessionId,
  getPresentedPremiumAccessToken,
  verifyPremiumAccessToken
} from './premiumAccessTokenService.js';

export function extractPremiumAccessContext(req) {
  return {
    premiumAccessToken: getPresentedPremiumAccessToken({
      premiumAccessToken: req.body?.premiumAccessToken || req.query?.premiumAccessToken,
      accessToken: req.body?.accessToken || req.query?.accessToken,
      headers: req.headers
    }),
    checkoutSessionId: getPresentedCheckoutSessionId({
      checkoutSessionId: req.body?.checkoutSessionId || req.query?.checkoutSessionId,
      sessionId: req.body?.sessionId || req.query?.sessionId,
      headers: req.headers
    })
  };
}

export async function getPremiumAccessDecision({
  email,
  source = 'gpt',
  intent = 'full-dispute-kit',
  premiumAccessToken = '',
  checkoutSessionId = ''
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !validator.isEmail(normalizedEmail)) {
    return {
      ok: false,
      statusCode: 400,
      error: 'A valid email is required for premium access.'
    };
  }

  const license = await getLicenseByEmail(normalizedEmail);
  const licensed = license?.status === 'paid';
  if (!licensed) {
    const checkout = await createCheckoutSession({
      email: normalizedEmail,
      source,
      intent
    });

    if (!checkout.alreadyLicensed) {
      return {
        ok: false,
        statusCode: 402,
        upgradeRequired: true,
        checkoutUrl: checkout.url,
        checkoutSessionId: checkout.sessionId,
        message: 'Premium access requires a one-time $6.99 payment. Pay with the same email, then return to continue.'
      };
    }
  }

  if (premiumAccessToken) {
    const verified = await verifyPremiumAccessToken(premiumAccessToken, {
      expectedEmail: normalizedEmail
    });

    if (!verified.ok) {
      return {
        ok: false,
        statusCode: verified.statusCode,
        error: verified.error
      };
    }

    return {
      ok: true,
      email: normalizedEmail,
      premiumAccessToken
    };
  }

  if (checkoutSessionId) {
    const exchanged = await exchangePremiumAccessToken({
      email: normalizedEmail,
      sessionId: checkoutSessionId
    });

    if (!exchanged.ok) {
      return {
        ok: false,
        statusCode: exchanged.statusCode,
        error: exchanged.error
      };
    }

    return {
      ok: true,
      email: normalizedEmail,
      premiumAccessToken: exchanged.premiumAccessToken
    };
  }

  return {
    ok: false,
    statusCode: 401,
    accessTokenRequired: true,
    licensed: true,
    message: 'Premium access requires a premium access token or the matching Stripe checkout session ID. Re-check the license with the same email and session ID after payment.'
  };
}
