import validator from 'validator';
import { createCheckoutSession } from './checkoutService.js';
import { isEmailLicensed, normalizeEmail } from './licenseStore.js';

export async function getPremiumAccessDecision({
  email,
  source = 'gpt',
  intent = 'full-dispute-kit'
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !validator.isEmail(normalizedEmail)) {
    return {
      ok: false,
      statusCode: 400,
      error: 'A valid email is required for premium access.'
    };
  }

  let licensed = await isEmailLicensed(normalizedEmail);
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
        message: 'Premium access requires a one-time $6.99 payment. Pay with the same email, then return to continue.'
      };
    }

    licensed = true;
  }

  if (!licensed) {
    return {
      ok: false,
      statusCode: 402,
      upgradeRequired: true,
      message: 'Premium access is required for this endpoint.'
    };
  }

  return {
    ok: true,
    email: normalizedEmail
  };
}
