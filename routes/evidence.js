import express from 'express';
import asyncHandler from '../services/asyncHandler.js';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { recordAuditEvent } from '../services/auditLogService.js';
import { buildExhibitPacket } from '../services/exhibitPackagerService.js';
import { getPremiumAccessDecision } from '../services/premiumAccessService.js';
import { saveCaseVersion } from '../services/caseFileService.js';
import { storeUploadedFiles } from '../services/fileStorageService.js';
import { enqueueJob } from '../services/jobQueueService.js';
import {
  cleanupUploadedFiles,
  extractEvidenceFromFiles,
  flattenUploadedFiles,
  normalizeEvidenceFields,
  parseEvidenceUploadRequest
} from '../services/evidenceExtractionService.js';

const router = express.Router();

const evidenceLimiter = createRateLimit({
  name: 'evidence-extract',
  max: 24,
  windowMs: 60 * 60 * 1000,
  keyFn: req => req.ip || 'anonymous',
  envMax: process.env.EVIDENCE_RATE_LIMIT_MAX,
  envWindowMs: process.env.EVIDENCE_RATE_LIMIT_WINDOW_MS
});

router.post('/api/v1/evidence/extract', verifyOpenAIBearer, evidenceLimiter, asyncHandler(async (req, res) => {
  let parsed = null;

  try {
    parsed = await parseEvidenceUploadRequest(req);
    const fields = normalizeEvidenceFields(parsed.fields);

    const decision = await getPremiumAccessDecision({
      email: fields.email,
      source: 'gpt',
      intent: 'full-dispute-kit'
    });

    if (!decision.ok) {
      return res.status(decision.statusCode).json({
        ...('error' in decision ? { error: decision.error } : {}),
        ...('upgradeRequired' in decision ? { upgradeRequired: decision.upgradeRequired } : {}),
        ...('checkoutUrl' in decision ? { checkoutUrl: decision.checkoutUrl } : {}),
        ...('message' in decision ? { message: decision.message } : {}),
        requestId: req.requestId || null
      });
    }

    const uploadedFiles = flattenUploadedFiles(parsed.files);
    const storedFiles = await storeUploadedFiles(uploadedFiles, {
      email: decision.email,
      caseId: fields.caseId || undefined,
      metadata: {
        requestId: req.requestId || null
      }
    });

    if (fields.async) {
      const job = await enqueueJob({
        kind: 'evidence.extract',
        email: decision.email,
        caseId: fields.caseId || undefined,
        requestId: req.requestId || null,
        input: {
          fields: {
            ...fields,
            email: decision.email
          },
          storedFileIds: storedFiles.map(file => file.fileId)
        }
      });

      await recordAuditEvent({
        eventType: 'evidence.extract_async_queued',
        category: 'premium',
        requestId: req.requestId,
        actorType: 'gpt-token',
        actorId: req.auth?.tokenId || null,
        email: decision.email,
        caseId: fields.caseId || null,
        status: 'queued',
        message: 'Evidence extraction queued asynchronously.',
        metadata: {
          jobId: job.jobId,
          storedFileIds: storedFiles.map(file => file.fileId)
        }
      });

      return res.status(202).json({
        email: decision.email,
        jobId: job.jobId,
        status: job.status,
        storedFiles: storedFiles.map(file => ({
          fileId: file.fileId,
          originalFilename: file.originalFilename,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256
        })),
        requestId: req.requestId || null
      });
    }

    const extraction = await extractEvidenceFromFiles(parsed.files, fields);
    const exhibitPacket = buildExhibitPacket({
      providedItems: extraction.files.map(file => ({
        title: file.documentType || file.filename,
        description: file.summary || file.extractedText || file.filename,
        filename: file.filename
      }))
    });
    const caseState = await saveCaseVersion({
      caseId: fields.caseId || undefined,
      email: decision.email,
      stage: 'evidence-extracted',
      intake: fields,
      extraction: {
        ...extraction,
        exhibitPacket,
        storedFiles: storedFiles.map(file => ({
          fileId: file.fileId,
          originalFilename: file.originalFilename,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256
        }))
      },
      source: 'evidence-upload'
    });

    await recordAuditEvent({
      eventType: 'evidence.extracted',
      category: 'premium',
      requestId: req.requestId,
      actorType: 'gpt-token',
      actorId: req.auth?.tokenId || null,
      email: decision.email,
      caseId: caseState.caseFile.caseId,
      status: 'success',
      message: 'Evidence extracted successfully.',
      metadata: {
        extractedCount: extraction.extractedCount,
        storedFileIds: storedFiles.map(file => file.fileId)
      }
    });

    return res.json({
      email: decision.email,
      ...extraction,
      exhibitPacket,
      storedFiles: storedFiles.map(file => ({
        fileId: file.fileId,
        originalFilename: file.originalFilename,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256
      })),
      caseFile: caseState.caseFile,
      caseVersion: caseState.version
    });
  } finally {
    if (parsed?.files) {
      await cleanupUploadedFiles(parsed.files);
    }
  }
}));

export default router;
