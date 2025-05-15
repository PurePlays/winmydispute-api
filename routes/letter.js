// routes/letter.js (Final Polished Version)
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import asyncHandler from '../services/asyncHandler.js';
import crypto from 'crypto';

dotenv.config();

// Stripe setup for payment handling
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const BASE = process.env.BASE_URL;
const PAID_FILE = path.join(process.cwd(), 'paidUsers.json');

// Ensure the "paidUsers.json" file exists
(async () => {
  try {
    await fs.access(PAID_FILE);  // Check if the file exists
  } catch {
    await fs.writeFile(PAID_FILE, '[]');  // If not, create it with an empty array
  }
})();

// POST /api/v1/letter/generate - Endpoint to generate dispute letter
router.post(
  '/api/v1/letter/generate',
  express.json(),
  asyncHandler(async (req, res) => {
    const { email, disputeDetails } = req.body;

    if (req.redis && !req.redis.isOpen) {
      return res.status(503).json({ success: false, message: 'Redis unavailable' });
    }

    // Validate input: Check if email and dispute details are provided
    if (!email) return res.status(400).json({ success: false, message: 'Email is required.' });
    if (!disputeDetails) return res.status(400).json({ success: false, message: 'Dispute details are required.' });

    if (typeof email !== 'string' || email.length > 100 || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Invalid email format.' });
    }

    if (typeof disputeDetails !== 'string' || disputeDetails.length < 20) {
      return res.status(400).json({ success: false, message: 'Invalid or too short dispute details.' });
    }

    // Load paid users list
    const paidUsers = JSON.parse(await fs.readFile(PAID_FILE, 'utf-8'));

    // Check if the email belongs to a paid user
    if (!paidUsers.includes(email)) {
      try {
        // Create a Stripe Checkout session for payment
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: {
                  name: 'Full Dispute Kit',
                },
                unit_amount: 699,  // $6.99 in cents
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          success_url: `${BASE}/payment-success`,
          cancel_url: `${BASE}/payment-cancel`,
        });

        // Tease the content for non-paid users with the payment prompt
        const teaser = `Dear [Merchant], ... Unlock full dispute kit for $6.99.`;
        return res.status(402).json({
          success: false,
          teaser,
          paywall: {
            sessionId: session.id,
            url: session.url,
          },
        });
      } catch (err) {
        console.error('🔥 Error creating Stripe session:', err.message);
        return res.status(500).json({ success: false, message: 'Internal server error. Please try again.' });
      }
    }

    // For paid users, return the full dispute letter and related content
    try {
      const successRate = '92%';  // Placeholder success rate, to be calculated based on data
      const rebuttalStrategies = [
        'Provide evidence of similar cases from your account history.',
        'Show that the merchant failed to deliver the promised service.',
      ];  // Rebuttal strategies for the user to respond to merchant's counterarguments
      const cfpbSupport = 'If the dispute is unsuccessful, we will assist with filing a CFPB complaint.';
      
      // Return full dispute kit content to the user
      res.json({
        success: true,
        letter: disputeDetails, // Return the full dispute letter text
        successRate,
        rebuttalStrategies,
        cfpbSupport,
      });
    } catch (err) {
      console.error('🔥 Error processing dispute letter:', err.message);
      res.status(500).json({ success: false, message: 'An error occurred while generating the letter.' });
    }
  })
);

export default router;