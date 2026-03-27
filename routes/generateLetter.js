import express from 'express';
import validator from 'validator';
import asyncHandler from '../services/asyncHandler.js';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { recordAuditEvent } from '../services/auditLogService.js';
import { isEmailLicensed, normalizeEmail } from '../services/licenseStore.js';
import { enqueueJob } from '../services/jobQueueService.js';
import { getPremiumAccessDecision } from '../services/premiumAccessService.js';
import { createPremiumReportDocument } from '../services/reportDocumentService.js';
import { saveCaseVersion } from '../services/caseFileService.js';
import { createSubmissionBundle } from '../services/submissionBundleService.js';
import {
  buildPremiumResponse,
  buildPreviewResponse,
  normalizeIntake
} from '../services/premiumFlowService.js';

const router = express.Router();

function requestKey(req) {
  return normalizeEmail(req.body?.email) || req.ip || 'anonymous';
}

const previewLimiter = createRateLimit({
  name: 'preview',
  max: 180,
  windowMs: 60 * 1000,
  keyFn: requestKey,
  envMax: process.env.PREVIEW_RATE_LIMIT_MAX,
  envWindowMs: process.env.PREVIEW_RATE_LIMIT_WINDOW_MS
});

const premiumLimiter = createRateLimit({
  name: 'premium-generate',
  max: 60,
  windowMs: 60 * 1000,
  keyFn: requestKey,
  envMax: process.env.PREMIUM_RATE_LIMIT_MAX,
  envWindowMs: process.env.PREMIUM_RATE_LIMIT_WINDOW_MS
});

function validateDisputeInput(req, res) {
  const intake = normalizeIntake(req.body || {});

  if (!intake.description) {
    res.status(400).json({
      error: 'A dispute description is required.',
      requestId: req.requestId || null
    });
    return null;
  }

  return intake;
}

function wantsAsync(body = {}) {
  const value = body?.async;
  if (typeof value === 'boolean') {
    return value;
  }
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function ensurePremiumAccess(req, res, intake) {
  const decision = await getPremiumAccessDecision({
    email: intake.email,
    source: 'gpt',
    intent: 'full-dispute-kit'
  });
  if (!decision.ok) {
    res.status(decision.statusCode).json({
      ...('error' in decision ? { error: decision.error } : {}),
      ...('upgradeRequired' in decision ? { upgradeRequired: decision.upgradeRequired } : {}),
      ...('checkoutUrl' in decision ? { checkoutUrl: decision.checkoutUrl } : {}),
      ...('message' in decision ? { message: decision.message } : {}),
      requestId: req.requestId || null
    });
    return null;
  }

  return decision.email;
}

router.post(
  '/api/v1/disputes/preview',
  verifyOpenAIBearer,
  previewLimiter,
  asyncHandler(async (req, res) => {
    const intake = validateDisputeInput(req, res);
    if (!intake) {
      return;
    }

    let licensed = false;
    if (intake.email) {
      if (!validator.isEmail(intake.email)) {
        return res.status(400).json({
          error: 'A valid email is required when provided.',
          requestId: req.requestId || null
        });
      }
      licensed = await isEmailLicensed(intake.email);
    }

    const preview = await buildPreviewResponse(req.body, {
      upgradeRequired: !licensed
    });

    return res.json(preview);
  })
);

router.post(
  '/api/v1/generate-letter',
  verifyOpenAIBearer,
  premiumLimiter,
  asyncHandler(async (req, res) => {
    const intake = validateDisputeInput(req, res);
    if (!intake) {
      return;
    }

    const email = await ensurePremiumAccess(req, res, intake);
    if (!email) {
      return;
    }

    const premiumResponse = await buildPremiumResponse({
      ...req.body,
      email
    });
    const caseState = await saveCaseVersion({
      caseId: intake.caseId || undefined,
      email,
      stage: 'premium-generated',
      intake: normalizeIntake({ ...req.body, email }),
      premium: premiumResponse,
      source: 'premium-api'
    });
    await recordAuditEvent({
      eventType: 'premium.package_generated',
      category: 'premium',
      requestId: req.requestId,
      actorType: 'gpt-token',
      actorId: req.auth?.tokenId || null,
      email,
      caseId: caseState.caseFile.caseId,
      status: 'success',
      message: 'Premium dispute package generated.'
    });

    return res.json({
      ...premiumResponse,
      caseFile: caseState.caseFile,
      caseVersion: caseState.version
    });
  })
);

router.post(
  '/api/v1/generate-report-document',
  verifyOpenAIBearer,
  premiumLimiter,
  asyncHandler(async (req, res) => {
    const intake = validateDisputeInput(req, res);
    if (!intake) {
      return;
    }

    const email = await ensurePremiumAccess(req, res, intake);
    if (!email) {
      return;
    }

    if (wantsAsync(req.body)) {
      const job = await enqueueJob({
        kind: 'report.generate',
        email,
        caseId: intake.caseId || undefined,
        requestId: req.requestId || null,
        input: {
          intake: { ...req.body, email },
          format: req.body?.outputFormat || req.body?.documentFormat || intake.outputFormat
        }
      });

      await recordAuditEvent({
        eventType: 'report.generate_async_queued',
        category: 'premium',
        requestId: req.requestId,
        actorType: 'gpt-token',
        actorId: req.auth?.tokenId || null,
        email,
        caseId: intake.caseId || null,
        status: 'queued',
        message: 'Premium report generation queued asynchronously.',
        metadata: {
          jobId: job.jobId
        }
      });

      return res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        email,
        requestId: req.requestId || null
      });
    }
    const premiumResponse = await buildPremiumResponse({
      ...req.body,
      email
    });
    const document = await createPremiumReportDocument({
      intake: normalizeIntake({ ...req.body, email }),
      premium: premiumResponse,
      format: req.body?.outputFormat || req.body?.documentFormat || intake.outputFormat
    });
    const caseState = await saveCaseVersion({
      caseId: intake.caseId || undefined,
      email,
      stage: 'document-generated',
      intake: normalizeIntake({ ...req.body, email }),
      premium: premiumResponse,
      artifact: document,
      artifacts: document.artifacts || [],
      source: 'premium-report'
    });
    await recordAuditEvent({
      eventType: 'report.generated',
      category: 'premium',
      requestId: req.requestId,
      actorType: 'gpt-token',
      actorId: req.auth?.tokenId || null,
      email,
      caseId: caseState.caseFile.caseId,
      status: 'success',
      message: 'Premium report document generated.',
      metadata: {
        format: document.format,
        includeRedactedVersion: document.includeRedactedVersion
      }
    });

    return res.json({
      ...document,
      caseFile: caseState.caseFile,
      caseVersion: caseState.version
    });
  })
);

router.post(
  '/api/v1/generate-submission-bundle',
  verifyOpenAIBearer,
  premiumLimiter,
  asyncHandler(async (req, res) => {
    const intake = validateDisputeInput(req, res);
    if (!intake) {
      return;
    }

    const email = await ensurePremiumAccess(req, res, intake);
    if (!email) {
      return;
    }

    if (wantsAsync(req.body)) {
      const job = await enqueueJob({
        kind: 'bundle.generate',
        email,
        caseId: intake.caseId || undefined,
        requestId: req.requestId || null,
        input: {
          intake: { ...req.body, email },
          format: req.body?.outputFormat || req.body?.documentFormat || intake.outputFormat
        }
      });

      await recordAuditEvent({
        eventType: 'bundle.generate_async_queued',
        category: 'premium',
        requestId: req.requestId,
        actorType: 'gpt-token',
        actorId: req.auth?.tokenId || null,
        email,
        caseId: intake.caseId || null,
        status: 'queued',
        message: 'Submission bundle generation queued asynchronously.',
        metadata: {
          jobId: job.jobId
        }
      });

      return res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        email,
        requestId: req.requestId || null
      });
    }

    const premiumResponse = await buildPremiumResponse({
      ...req.body,
      email
    });
    const bundle = await createSubmissionBundle({
      intake: normalizeIntake({ ...req.body, email }),
      premium: premiumResponse,
      format: req.body?.outputFormat || req.body?.documentFormat || intake.outputFormat
    });
    const caseState = await saveCaseVersion({
      caseId: intake.caseId || undefined,
      email,
      stage: 'bundle-generated',
      intake: normalizeIntake({ ...req.body, email }),
      premium: premiumResponse,
      artifact: bundle,
      source: 'submission-bundle'
    });

    await recordAuditEvent({
      eventType: 'bundle.generated',
      category: 'premium',
      requestId: req.requestId,
      actorType: 'gpt-token',
      actorId: req.auth?.tokenId || null,
      email,
      caseId: caseState.caseFile.caseId,
      status: 'success',
      message: 'Submission bundle generated.',
      metadata: {
        itemCount: bundle.bundleItems.length
      }
    });

    return res.json({
      ...bundle,
      caseFile: caseState.caseFile,
      caseVersion: caseState.version
    });
  })
);

export default router;
