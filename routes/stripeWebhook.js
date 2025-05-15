import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import Stripe from 'stripe';
import { google } from 'googleapis';
import express from 'express';

const router = express.Router();

// Initialize Stripe with the secret key from environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2022-11-15',
});

// Map each product to a corresponding sheet and tab name
const productMap = {
  'prod_SJ8hXpOpveuJER': {
    sheetId: '1_LH7NDq2aW5RjrWLIBluRxFSDv8kgjzEP4Cz5dSfbfQ',
    sheetTab: 'SheetFormatter_Licenses',
    label: 'Sheet Formatter Pro'
  },
  'prod_WINMYDISPUTEGPT': {
    sheetId: '1abcXYZwinmydisputesheetid', // Replace with actual ID
    sheetTab: 'WinMyDispute_Licenses',
    label: 'WinMyDispute Pro'
  }
};

// Function to save license information to the Google Sheets document
async function saveToLicenseSheet(productId, email, stripeId) {
  const config = productMap[productId];
  if (!config) {
    console.error(`❌ Unknown product ID: ${productId}`);
    throw new Error('Unknown product ID');
  }

  // Setup Google Sheets authentication and client
  const auth = new google.auth.GoogleAuth({
    keyFile: './service-accounts/sheet-writer.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const now = new Date().toISOString();

  try {
    // Append the license data to the corresponding sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.sheetId,
      range: `${config.sheetTab}!A:D`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[email, now, stripeId, 'TRUE']],
      },
    });
    console.log(`✅ License recorded for: ${email} under ${config.label}`);
  } catch (err) {
    console.error(`🔥 Error saving to Google Sheets: ${err.message}`);
    throw new Error('Error saving to Google Sheets');
  }
}

// Webhook endpoint to handle Stripe events
router.post('/api/v1/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    console.error('❌ Redis unavailable');
    return res.status(503).send('Redis unavailable');
  }

  let event;
  try {
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).send('Missing Stripe signature');
    }
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Process successful checkout sessions
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      // Fetch line items to identify the purchased product
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });

      // Find the purchased product in the line items
      const match = lineItems.data.find(item =>
        Object.keys(productMap).includes(item.price.product)
      );

      if (match) {
        const email = session.customer_details?.email;
        const stripeId = session.id;
        if (!email || !stripeId) {
          console.error('❌ Missing email or session ID in checkout session');
          return res.status(400).send('Invalid checkout session data');
        }

        await saveToLicenseSheet(match.price.product, email, stripeId);

        // Also store license in Redis
        try {
          if (req.redis?.isOpen) {
            await req.redis.set(`license:${email}`, 'true');
            console.log(`✅ Redis: stored license for ${email}`);
          } else {
            console.warn('⚠️ Redis not available, skipped storing license');
          }
        } catch (redisErr) {
          console.error('❌ Redis store error:', redisErr.message);
        }

        // Fallback: add email to local paidUsers.json for license check redundancy
        const PAID_FILE = path.resolve('./mock-data/paidUsers.json');
        try {
          const current = JSON.parse(await fs.readFile(PAID_FILE, 'utf8'));
          if (!current.includes(email)) {
            current.push(email);
            await fs.writeFile(PAID_FILE, JSON.stringify(current, null, 2));
            console.log(`✅ Email added to local paid users file: ${email}`);
          } else {
            console.log(`ℹ️ Email already in local paid users file: ${email}`);
          }
        } catch (writeErr) {
          console.error('❌ Error updating paidUsers.json:', writeErr.message);
        }
      } else {
        console.warn('⚠️ No matching product found in line items');
      }
    } catch (err) {
      console.error('🔥 Error processing purchase:', err.message);
    }
  } else {
    // Handle unsupported event types
    console.warn(`⚠️ Unsupported event type: ${event.type}`);
    return res.status(400).send('Unsupported event type');
  }

  // Respond to Stripe that the event was received successfully
  res.status(200).send('Event received');
});

export default router;