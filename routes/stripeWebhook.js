import express from 'express';
import { createRateLimit } from '../middleware/rateLimit.js';
import { recordAuditEvent } from '../services/auditLogService.js';
import { getStripeClient } from '../services/stripeClient.js';
import { CHECKOUT_INTENT } from '../services/checkoutService.js';
import {
  LICENSE_AMOUNT,
  LICENSE_PRODUCT,
  LICENSE_STATUS_PAID,
  normalizeEmail,
  upsertLicense
} from '../services/licenseStore.js';

const router = express.Router();

const webhookLimiter = createRateLimit({
  name: 'stripe-webhook',
  max: 600,
  windowMs: 60 * 60 * 1000,
  keyFn: req => req.headers['stripe-signature'] || req.ip || 'anonymous',
  envMax: process.env.WEBHOOK_RATE_LIMIT_MAX,
  envWindowMs: process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS
});

async function syncLicenseToGoogleSheet(license) {
  const spreadsheetId = process.env.GOOGLE_SHEETS_LICENSE_SHEET_ID;
  const sheetTab = process.env.GOOGLE_SHEETS_LICENSE_SHEET_TAB;

  if (!spreadsheetId || !sheetTab) {
    return;
  }

  let google;
  try {
    ({ google } = await import('googleapis'));
  } catch (_error) {
    console.warn('⚠️ googleapis not installed. Skipping Google Sheets sync.');
    return;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './service-accounts/sheet-writer.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetTab}!A:G`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        license.email,
        license.status,
        license.product,
        license.amount,
        license.source,
        license.stripeSessionId,
        license.updatedAt
      ]]
    }
  });
}

async function fulfillCheckoutSession(session) {
  const metadata = session.metadata || {};
  const email = normalizeEmail(metadata.email || session.customer_details?.email || session.customer_email);

  if (!email) {
    throw new Error('Missing email in checkout session metadata.');
  }

  if (metadata.intent && metadata.intent !== CHECKOUT_INTENT) {
    return { skipped: true, reason: 'unsupported-intent' };
  }

  if (session.payment_status !== 'paid') {
    return { skipped: true, reason: 'payment-not-complete' };
  }

  const license = await upsertLicense({
    email,
    status: LICENSE_STATUS_PAID,
    stripeSessionId: session.id,
    product: metadata.product || LICENSE_PRODUCT,
    amount: Number(metadata.amount || session.amount_total || LICENSE_AMOUNT),
    source: metadata.source || 'gpt'
  });

  try {
    await syncLicenseToGoogleSheet(license);
  } catch (error) {
    console.warn(`⚠️ Google Sheets sync failed for ${license.email}: ${error.message}`);
  }

  return { skipped: false, license };
}

router.post('/api/v1/stripe-webhook', express.raw({ type: 'application/json' }), webhookLimiter, async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send('Missing STRIPE_WEBHOOK_SECRET configuration.');
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).send('Missing Stripe signature');
  }

  let event;
  try {
    event = getStripeClient().webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('❌ Webhook signature verification failed:', error.message);
    await recordAuditEvent({
      eventType: 'stripe.webhook_signature_failed',
      category: 'payment',
      severity: 'warning',
      requestId: req.requestId,
      actorType: 'stripe',
      status: 'failed',
      message: error.message,
      metadata: {
        signature
      }
    });
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        {
          const result = await fulfillCheckoutSession(event.data.object);
          await recordAuditEvent({
            eventType: 'stripe.webhook_fulfilled',
            category: 'payment',
            requestId: req.requestId,
            actorType: 'stripe',
            email: result.license?.email || event.data.object?.customer_email || null,
            status: result.skipped ? 'skipped' : 'success',
            message: result.skipped ? `Stripe webhook skipped: ${result.reason}` : 'Stripe webhook fulfilled license.',
            metadata: {
              eventType: event.type,
              stripeSessionId: event.data.object?.id || null
            }
          });
        }
        break;
      default:
        console.log(`ℹ️ Ignoring Stripe event type ${event.type}`);
        break;
    }
  } catch (error) {
    console.error('❌ Stripe webhook fulfillment failed:', error.message);
    return res.status(500).send('Webhook processing failed');
  }

  return res.status(200).json({ received: true });
});

export default router;
