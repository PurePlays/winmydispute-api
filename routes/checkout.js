// routes/checkout.js (Polished Final Version)

import express from 'express';
import Stripe from 'stripe';
import validator from 'validator';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import asyncHandler from '../services/asyncHandler.js';
import crypto from 'crypto';

dotenv.config();

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Derive __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, '..', 'checkout-log.json');

/**
 * POST /api/v1/create-checkout-session
 * Body: { email: string }
 */
router.post(
  '/api/v1/create-checkout-session',
  express.json(),
  asyncHandler(async (req, res) => {
    if (req.redis && !req.redis.isOpen) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { email } = req.body;

    if (typeof email !== 'string' || email.length > 100 || !validator.isEmail(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    // Rate limiting: one checkout session per 5 minutes per email
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);

    let logs = [];
    try {
      const content = await fs.readFile(LOG_FILE, 'utf-8');
      logs = JSON.parse(content);
    } catch (err) {
      // No logs yet — that's fine
    }

    const recentAttempt = logs.find(log => log.email === email && new Date(log.timestamp).getTime() > fiveMinutesAgo);
    if (recentAttempt) {
      return res.status(429).json({ error: 'Please wait a few minutes before trying again.' });
    }

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Full Dispute Letter Kit' },
          unit_amount: 699, // $6.99
        },
        quantity: 1
      }],
      customer_email: email,
      metadata: { purpose: 'dispute-kit' },
      success_url: `${process.env.BASE_URL}/generate.html?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/generate.html?canceled=true`
    });

    // Log the session
    logs.push({ email, sessionId: session.id, timestamp: new Date().toISOString() });
    await fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2));

    res.json({ url: session.url, sessionId: session.id });
  })
);

export default router;
