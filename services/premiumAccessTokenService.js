import crypto from 'crypto';
import { getLicenseByEmail, normalizeEmail } from './licenseStore.js';

const PREMIUM_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

function hasValue(value) {
  return Boolean(String(value || '').trim());
}

function getSigningSecret() {
  return String(
    process.env.PREMIUM_ACCESS_TOKEN_SECRET
    || process.env.ARTIFACT_TOKEN_SECRET
    || ''
  ).trim();
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(serialized) {
  return JSON.parse(Buffer.from(String(serialized || ''), 'base64url').toString('utf8'));
}

function signPayload(serializedPayload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(serializedPayload, 'utf8')
    .digest('base64url');
}

function splitToken(token) {
  const value = String(token || '').trim();
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  return {
    payload: parts[0],
    signature: parts[1]
  };
}

export function getPresentedPremiumAccessToken(source = {}) {
  return String(
    source.premiumAccessToken
    || source.accessToken
    || source.headers?.['x-premium-access-token']
    || ''
  ).trim();
}

export function getPresentedCheckoutSessionId(source = {}) {
  return String(
    source.checkoutSessionId
    || source.sessionId
    || source.headers?.['x-premium-session-id']
    || ''
  ).trim();
}

export function createPremiumAccessToken({
  email,
  stripeSessionId = null,
  licenseUpdatedAt = null,
  expiresInSeconds = PREMIUM_ACCESS_TOKEN_TTL_SECONDS
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  const secret = getSigningSecret();

  if (!normalizedEmail) {
    throw new Error('Cannot create a premium access token without an email.');
  }

  if (!secret) {
    throw new Error('Missing premium access token signing secret.');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: normalizedEmail,
    sid: hasValue(stripeSessionId) ? String(stripeSessionId).trim() : null,
    luv: hasValue(licenseUpdatedAt) ? String(licenseUpdatedAt).trim() : null,
    iat: now,
    exp: now + Math.max(60, Number(expiresInSeconds) || PREMIUM_ACCESS_TOKEN_TTL_SECONDS)
  };

  const serializedPayload = encodePayload(payload);
  const signature = signPayload(serializedPayload, secret);
  return `${serializedPayload}.${signature}`;
}

export async function verifyPremiumAccessToken(token, { expectedEmail = null } = {}) {
  const secret = getSigningSecret();
  if (!secret) {
    return {
      ok: false,
      statusCode: 500,
      error: 'Server is missing premium access token configuration.'
    };
  }

  const parsed = splitToken(token);
  if (!parsed) {
    return {
      ok: false,
      statusCode: 401,
      error: 'A premium access token is required.'
    };
  }

  const expectedSignature = signPayload(parsed.payload, secret);
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const providedBuffer = Buffer.from(parsed.signature, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Invalid premium access token.'
    };
  }

  let payload;
  try {
    payload = decodePayload(parsed.payload);
  } catch {
    return {
      ok: false,
      statusCode: 403,
      error: 'Invalid premium access token.'
    };
  }

  const normalizedEmail = normalizeEmail(payload?.sub);
  const expectedNormalizedEmail = normalizeEmail(expectedEmail);
  if (!normalizedEmail || (expectedNormalizedEmail && normalizedEmail !== expectedNormalizedEmail)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Premium access token does not match the requested email.'
    };
  }

  const expiresAt = Number(payload?.exp || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Premium access token has expired.'
    };
  }

  const license = await getLicenseByEmail(normalizedEmail);
  if (!license || license.status !== 'paid') {
    return {
      ok: false,
      statusCode: 403,
      error: 'No active premium license was found for this token.'
    };
  }

  if (hasValue(payload?.sid) && hasValue(license.stripeSessionId) && String(payload.sid).trim() !== String(license.stripeSessionId).trim()) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Premium access token is no longer valid for this license.'
    };
  }

  if (hasValue(payload?.luv) && hasValue(license.updatedAt) && String(payload.luv).trim() !== String(license.updatedAt).trim()) {
    return {
      ok: false,
      statusCode: 403,
      error: 'Premium access token is stale. Exchange the checkout session for a fresh token.'
    };
  }

  return {
    ok: true,
    email: normalizedEmail,
    license
  };
}

export async function exchangePremiumAccessToken({ email, sessionId } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedSessionId = String(sessionId || '').trim();

  if (!normalizedEmail) {
    return {
      ok: false,
      statusCode: 400,
      error: 'A valid email is required to exchange a premium access token.'
    };
  }

  if (!normalizedSessionId) {
    return {
      ok: false,
      statusCode: 400,
      error: 'A checkout session ID is required to exchange a premium access token.'
    };
  }

  const license = await getLicenseByEmail(normalizedEmail);
  if (!license || license.status !== 'paid') {
    return {
      ok: false,
      statusCode: 404,
      error: 'No paid license was found for this email.'
    };
  }

  if (!hasValue(license.stripeSessionId) || String(license.stripeSessionId).trim() !== normalizedSessionId) {
    return {
      ok: false,
      statusCode: 403,
      error: 'The checkout session does not match this paid license.'
    };
  }

  return {
    ok: true,
    email: normalizedEmail,
    premiumAccessToken: createPremiumAccessToken({
      email: normalizedEmail,
      stripeSessionId: license.stripeSessionId,
      licenseUpdatedAt: license.updatedAt
    })
  };
}
