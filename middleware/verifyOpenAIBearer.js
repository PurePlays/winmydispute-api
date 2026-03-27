import crypto from 'crypto';

function tokensMatch(expectedToken, providedToken) {
  const expectedBuffer = Buffer.from(expectedToken || '', 'utf8');
  const providedBuffer = Buffer.from(providedToken || '', 'utf8');

  if (expectedBuffer.length === 0 || expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function parseConfiguredTokens() {
  const configured = [];
  const rawJson = process.env.OPENAI_BEARERS_JSON;

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string' && entry.trim()) {
            configured.push({ tokenId: `token-${configured.length + 1}`, token: entry.trim() });
          } else if (entry && typeof entry === 'object' && typeof entry.token === 'string' && entry.token.trim()) {
            configured.push({
              tokenId: String(entry.tokenId || entry.id || `token-${configured.length + 1}`).trim(),
              token: entry.token.trim()
            });
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        for (const [tokenId, token] of Object.entries(parsed)) {
          if (typeof token === 'string' && token.trim()) {
            configured.push({ tokenId: String(tokenId).trim(), token: token.trim() });
          }
        }
      }
    } catch {
      // Ignore malformed rotation config and fall back to the legacy single token.
    }
  }

  if (configured.length === 0 && process.env.OPENAI_BEARER) {
    configured.push({
      tokenId: 'legacy-openai-bearer',
      token: process.env.OPENAI_BEARER.trim()
    });
  }

  return configured;
}

export default function verifyOpenAIBearer(req, res, next) {
  const configuredTokens = parseConfiguredTokens();
  const authHeader = req.headers.authorization;

  if (configuredTokens.length === 0) {
    return res.status(500).json({
      error: 'Server is missing OpenAI bearer configuration.',
      requestId: req.requestId || null
    });
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      requestId: req.requestId || null
    });
  }

  const providedToken = authHeader.slice('Bearer '.length).trim();
  const matched = configuredTokens.find(configured => tokensMatch(configured.token, providedToken));
  if (!matched) {
    return res.status(403).json({
      error: 'Invalid bearer token',
      requestId: req.requestId || null
    });
  }

  req.auth = {
    type: 'openai-bearer',
    tokenId: matched.tokenId
  };

  next();
}
