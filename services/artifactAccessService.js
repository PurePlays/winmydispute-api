import crypto from 'crypto';

function normalizeText(value = '') {
  return String(value || '').trim();
}

export function hasArtifactTokenSecret() {
  return Boolean(normalizeText(process.env.ARTIFACT_TOKEN_SECRET));
}

function getArtifactTokenSecret() {
  const secret = normalizeText(process.env.ARTIFACT_TOKEN_SECRET);
  if (!secret) {
    throw new Error('ARTIFACT_TOKEN_SECRET is required for signed artifact access.');
  }

  return secret;
}

function getArtifactUrlTtlMs() {
  const numeric = Number(process.env.ARTIFACT_URL_TTL_MS);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  return 3 * 24 * 60 * 60 * 1000;
}

function buildSignaturePayload({ fileId, expiresAt }) {
  return `${normalizeText(fileId)}:${normalizeText(expiresAt)}`;
}

function signPayload(payload) {
  return crypto
    .createHmac('sha256', getArtifactTokenSecret())
    .update(payload)
    .digest('hex');
}

function safeHexMatch(expected, provided) {
  const expectedBuffer = Buffer.from(expected || '', 'utf8');
  const providedBuffer = Buffer.from(provided || '', 'utf8');

  if (expectedBuffer.length === 0 || expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function isPlainObject(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]';
}

export function createSignedArtifactAccess({ fileId, ttlMs = getArtifactUrlTtlMs() } = {}) {
  const normalizedFileId = normalizeText(fileId);
  if (!normalizedFileId) {
    throw new Error('A fileId is required to create an artifact download URL.');
  }

  const expiresAt = String(Date.now() + ttlMs);
  const signature = signPayload(buildSignaturePayload({
    fileId: normalizedFileId,
    expiresAt
  }));

  return {
    url: `/api/v1/artifacts/${encodeURIComponent(normalizedFileId)}?expires=${encodeURIComponent(expiresAt)}&signature=${encodeURIComponent(signature)}`,
    expiresAt
  };
}

export function verifySignedArtifactAccess({ fileId, expiresAt, signature } = {}) {
  if (!hasArtifactTokenSecret()) {
    return false;
  }

  const normalizedFileId = normalizeText(fileId);
  const normalizedExpiresAt = normalizeText(expiresAt);
  const normalizedSignature = normalizeText(signature);

  if (!normalizedFileId || !normalizedExpiresAt || !normalizedSignature) {
    return false;
  }

  const expiresAtNumber = Number(normalizedExpiresAt);
  if (!Number.isFinite(expiresAtNumber) || expiresAtNumber <= Date.now()) {
    return false;
  }

  const expectedSignature = signPayload(buildSignaturePayload({
    fileId: normalizedFileId,
    expiresAt: normalizedExpiresAt
  }));

  return safeHexMatch(expectedSignature, normalizedSignature);
}

export function hydrateArtifactAccess(artifact = null) {
  if (!isPlainObject(artifact) || normalizeText(artifact.kind) !== 'artifact' || !normalizeText(artifact.fileId)) {
    return artifact;
  }

  const access = createSignedArtifactAccess({ fileId: artifact.fileId });
  return {
    ...artifact,
    url: access.url,
    expiresAt: access.expiresAt
  };
}

export function hydrateArtifactAccessInValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => hydrateArtifactAccessInValue(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const artifactHydrated = hydrateArtifactAccess(value);
  if (artifactHydrated !== value) {
    return artifactHydrated;
  }

  const clone = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    clone[key] = hydrateArtifactAccessInValue(nestedValue);
  }

  const fileIds = Array.isArray(value.latestArtifactFileIds)
    ? value.latestArtifactFileIds.map(fileId => normalizeText(fileId)).filter(Boolean)
    : [];

  if (fileIds.length > 0) {
    clone.latestArtifactUrls = fileIds.map(fileId => createSignedArtifactAccess({ fileId }).url);
  }

  return clone;
}
