import crypto from 'crypto';

export default function requestContext(req, res, next) {
  const incomingRequestId = typeof req.headers['x-request-id'] === 'string'
    ? req.headers['x-request-id'].trim()
    : '';
  const requestId = incomingRequestId || crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
}
