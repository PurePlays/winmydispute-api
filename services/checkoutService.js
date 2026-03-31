import validator from 'validator';
import { getStripeClient } from './stripeClient.js';
import {
  LICENSE_AMOUNT,
  LICENSE_PRODUCT,
  LICENSE_SOURCE_GPT,
  getLicenseByEmail,
  normalizeEmail
} from './licenseStore.js';

export const CHECKOUT_INTENT = 'full-dispute-kit';
export const CHECKOUT_PRODUCT_NAME = 'WinMyDispute Premium Dispute Kit';
export const CHECKOUT_PRODUCT_DESCRIPTION = 'One-time unlock for the full WinMyDispute premium kit, including a dispute letter, evidence packet, exhibit index, rebuttal strategy, CFPB summary, and downloadable PDF or Word report.';
export const CHECKOUT_PRODUCT_UNIT_LABEL = 'Dispute kit';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function isValidPublicUrl(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function getValidatedBaseUrl() {
  const normalized = normalizeText(process.env.BASE_URL);
  if (!isValidPublicUrl(normalized)) {
    throw new Error('Missing or invalid BASE_URL configuration.');
  }

  return normalized.replace(/\/+$/, '');
}

function buildCheckoutProductData() {
  const productData = {
    name: normalizeText(process.env.CHECKOUT_PRODUCT_NAME) || CHECKOUT_PRODUCT_NAME,
    description: normalizeText(process.env.CHECKOUT_PRODUCT_DESCRIPTION) || CHECKOUT_PRODUCT_DESCRIPTION,
    unit_label: normalizeText(process.env.CHECKOUT_PRODUCT_UNIT_LABEL) || CHECKOUT_PRODUCT_UNIT_LABEL
  };

  const imageUrl = normalizeText(process.env.CHECKOUT_PRODUCT_IMAGE_URL);
  if (isValidPublicUrl(imageUrl)) {
    productData.images = [imageUrl];
  }

  return productData;
}

export function validateCheckoutPayload(input = {}) {
  const email = normalizeEmail(input.email);
  const source = typeof input.source === 'string' && input.source.trim() ? input.source.trim() : LICENSE_SOURCE_GPT;
  const intent = typeof input.intent === 'string' && input.intent.trim() ? input.intent.trim() : CHECKOUT_INTENT;

  if (!email || !validator.isEmail(email)) {
    return { ok: false, error: 'A valid email address is required.' };
  }

  if (source !== LICENSE_SOURCE_GPT) {
    return { ok: false, error: 'Unsupported checkout source.' };
  }

  if (intent !== CHECKOUT_INTENT) {
    return { ok: false, error: 'Unsupported checkout intent.' };
  }

  return {
    ok: true,
    value: { email, source, intent }
  };
}

export async function createCheckoutSession({ email, source = LICENSE_SOURCE_GPT, intent = CHECKOUT_INTENT }) {
  const baseUrl = getValidatedBaseUrl();

  const existingLicense = await getLicenseByEmail(email);
  if (existingLicense?.status === 'paid') {
    return {
      alreadyLicensed: true,
      license: existingLicense
    };
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: email,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: buildCheckoutProductData(),
          unit_amount: LICENSE_AMOUNT,
        },
        quantity: 1,
      }
    ],
    metadata: {
      email,
      source,
      intent,
      product: LICENSE_PRODUCT,
      amount: String(LICENSE_AMOUNT)
    },
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/generate?canceled=true`
  });

  return {
    alreadyLicensed: false,
    sessionId: session.id,
    url: session.url,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null
  };
}
