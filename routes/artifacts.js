import express from 'express';
import fs from 'fs/promises';
import asyncHandler from '../services/asyncHandler.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { recordAuditEvent } from '../services/auditLogService.js';
import { hasArtifactTokenSecret, verifySignedArtifactAccess } from '../services/artifactAccessService.js';
import { getStoredFile } from '../services/fileStorageService.js';

const router = express.Router();

const artifactLimiter = createRateLimit({
  name: 'artifact-download',
  max: 240,
  windowMs: 60 * 60 * 1000,
  keyFn: req => req.ip || 'anonymous',
  envMax: process.env.ARTIFACT_DOWNLOAD_RATE_LIMIT_MAX,
  envWindowMs: process.env.ARTIFACT_DOWNLOAD_RATE_LIMIT_WINDOW_MS
});

function sanitizeDownloadFilename(filename = '') {
  const normalized = String(filename || '').replace(/[\r\n"]/g, '').trim();
  return normalized || 'winmydispute-artifact';
}

router.get('/api/v1/artifacts/:fileId', artifactLimiter, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  const { expires, signature } = req.query;

  if (!hasArtifactTokenSecret()) {
    return res.status(503).json({
      error: 'Artifact downloads are not configured.',
      requestId: req.requestId || null
    });
  }

  if (!verifySignedArtifactAccess({
    fileId,
    expiresAt: expires,
    signature
  })) {
    return res.status(403).json({
      error: 'Artifact link is invalid or has expired.',
      requestId: req.requestId || null
    });
  }

  const file = await getStoredFile(fileId);
  if (!file || file.kind !== 'artifact') {
    return res.status(404).json({
      error: 'Artifact not found.',
      requestId: req.requestId || null
    });
  }

  let buffer;
  try {
    buffer = await fs.readFile(file.storagePath);
  } catch {
    return res.status(404).json({
      error: 'Artifact file is unavailable.',
      requestId: req.requestId || null
    });
  }

  await recordAuditEvent({
    eventType: 'artifact.downloaded',
    category: 'artifact',
    requestId: req.requestId,
    actorType: 'signed-link',
    actorId: file.fileId,
    email: file.email,
    caseId: file.caseId,
    status: 'success',
    message: 'Signed artifact download completed.',
    metadata: {
      filename: file.originalFilename,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes
    }
  });

  res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizeDownloadFilename(file.originalFilename)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(buffer);
}));

export default router;
