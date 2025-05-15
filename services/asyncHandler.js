import { performance } from 'perf_hooks'; // For performance monitoring
import rateLimit from 'express-rate-limit'; // To add rate limiting
import * as Sentry from '@sentry/node'; // For error tracking (optional integration)

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS = 100; // Limit each IP to 100 requests per minute

/**
 * Setup rate limiting for routes.
 * @param {Object} app - Express app instance
 */
function applyRateLimiting(app) {
  app.use(
    '/api', // Apply to all /api routes
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: MAX_REQUESTS,
      message: 'Too many requests, please try again later.',
    })
  );
}

/**
 * Custom asyncHandler function that wraps around an async route handler
 * for better error handling, performance monitoring, logging, and rate limiting.
 *
 * @param {Function} fn - An async route handler that returns a Promise
 * @returns {Function} A middleware function
 */
export default function asyncHandler(fn) {
  return async function (req, res, next) {
    const start = performance.now(); // Start performance tracking

    try {
      await fn(req, res, next); // Execute the async function

      const duration = performance.now() - start; // End performance tracking
      console.log(`Route ${req.originalUrl} executed in ${duration.toFixed(2)}ms`);

    } catch (err) {
      // If an error occurs, log it
      console.error(`Error occurred on route ${req.originalUrl}:`, err);

      // Optional: Send the error to an external error tracking service (e.g., Sentry)
      Sentry.captureException(err);

      // If it's a validation error, respond with a 400 status code
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }

      // Otherwise, it's a server error, respond with a 500 status code
      res.status(500).json({ error: 'Internal server error' });

      // Pass the error to Express's global error handler
      next(err);
    }
  };
}

/**
 * Custom error class for validation errors
 * Used to catch errors like invalid input or incorrect parameters
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

// Sentry error tracking setup (optional)
Sentry.init({ dsn: process.env.SENTRY_DSN }); // Make sure to add your Sentry DSN in the environment variables

export { applyRateLimiting, ValidationError };