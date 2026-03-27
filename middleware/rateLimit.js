const buckets = new Map();

function resolveWindowMs(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveMax(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function resetRateLimitsForTesting() {
  buckets.clear();
}

export function createRateLimit({
  name,
  max = 60,
  windowMs = 60 * 1000,
  keyFn = req => req.ip || 'anonymous',
  envMax,
  envWindowMs
}) {
  const effectiveMax = resolveMax(envMax, max);
  const effectiveWindowMs = resolveWindowMs(envWindowMs, windowMs);

  return (req, res, next) => {
    const identifier = keyFn(req) || 'anonymous';
    const now = Date.now();
    const bucketKey = `${name}:${identifier}`;
    const existing = buckets.get(bucketKey);

    let bucket = existing;
    if (!bucket || now >= bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + effectiveWindowMs
      };
    }

    bucket.count += 1;
    buckets.set(bucketKey, bucket);

    const remaining = Math.max(effectiveMax - bucket.count, 0);
    res.setHeader('X-RateLimit-Limit', String(effectiveMax));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > effectiveMax) {
      return res.status(429).json({
        error: 'Too many requests',
        requestId: req.requestId || null,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      });
    }

    return next();
  };
}
