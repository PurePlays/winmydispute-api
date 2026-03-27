import Stripe from 'stripe';

let stripeClient;
let stripeClientOverride = null;

export function setStripeClientForTesting(client) {
  stripeClientOverride = client;
}

export function resetStripeClientForTesting() {
  stripeClientOverride = null;
  stripeClient = null;
}

export function getStripeClient() {
  if (stripeClientOverride) {
    return stripeClientOverride;
  }

  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Missing STRIPE_SECRET_KEY configuration.');
    }

    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2022-11-15',
    });
  }

  return stripeClient;
}
