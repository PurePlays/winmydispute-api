import { registerJobProcessor } from './jobQueueService.js';
import { buildExhibitPacket } from './exhibitPackagerService.js';
import { recordAuditEvent } from './auditLogService.js';
import { saveCaseVersion } from './caseFileService.js';
import { extractEvidenceFromStoredFiles } from './evidenceExtractionService.js';
import { buildPremiumResponse, normalizeIntake } from './premiumFlowService.js';
import { createPremiumReportDocument } from './reportDocumentService.js';
import { createSubmissionBundle } from './submissionBundleService.js';

registerJobProcessor('evidence.extract', async job => {
  const fields = job.input?.fields || {};
  const extraction = await extractEvidenceFromStoredFiles(job.input?.storedFileIds || [], fields);
  const exhibitPacket = buildExhibitPacket({
    providedItems: extraction.files.map(file => ({
      title: file.documentType || file.filename,
      description: file.summary || file.extractedText || file.filename,
      filename: file.filename
    }))
  });
  const caseState = await saveCaseVersion({
    caseId: fields.caseId || undefined,
    email: job.email,
    stage: 'evidence-extracted',
    intake: fields,
    extraction: {
      ...extraction,
      exhibitPacket,
      storedFileIds: job.input?.storedFileIds || []
    },
    source: 'evidence-upload-async'
  });

  await recordAuditEvent({
    eventType: 'evidence.extract_async_completed',
    category: 'premium',
    requestId: job.requestId,
    actorType: 'job',
    actorId: job.jobId,
    email: job.email,
    caseId: caseState.caseFile.caseId,
    status: 'success',
    message: 'Asynchronous evidence extraction completed.',
    metadata: {
      extractedCount: extraction.extractedCount
    }
  });

  return {
    email: job.email,
    ...extraction,
    exhibitPacket,
    caseFile: caseState.caseFile,
    caseVersion: caseState.version
  };
});

registerJobProcessor('report.generate', async job => {
  const intake = normalizeIntake({
    ...(job.input?.intake || {}),
    email: job.email
  });
  const premiumResponse = await buildPremiumResponse({
    ...(job.input?.intake || {}),
    email: job.email
  });
  const document = await createPremiumReportDocument({
    intake,
    premium: premiumResponse,
    format: job.input?.format || intake.outputFormat
  });
  const caseState = await saveCaseVersion({
    caseId: intake.caseId || undefined,
    email: job.email,
    stage: 'document-generated',
    intake,
    premium: premiumResponse,
    artifact: document,
    artifacts: document.artifacts || [],
    source: 'premium-report-async'
  });

  await recordAuditEvent({
    eventType: 'report.generate_async_completed',
    category: 'premium',
    requestId: job.requestId,
    actorType: 'job',
    actorId: job.jobId,
    email: job.email,
    caseId: caseState.caseFile.caseId,
    status: 'success',
    message: 'Asynchronous premium report generation completed.',
    metadata: {
      format: document.format,
      includeRedactedVersion: document.includeRedactedVersion
    }
  });

  return {
    ...document,
    caseFile: caseState.caseFile,
    caseVersion: caseState.version
  };
});

registerJobProcessor('bundle.generate', async job => {
  const intake = normalizeIntake({
    ...(job.input?.intake || {}),
    email: job.email
  });
  const premiumResponse = await buildPremiumResponse({
    ...(job.input?.intake || {}),
    email: job.email
  });
  const bundle = await createSubmissionBundle({
    intake,
    premium: premiumResponse,
    format: job.input?.format || intake.outputFormat
  });
  const caseState = await saveCaseVersion({
    caseId: intake.caseId || undefined,
    email: job.email,
    stage: 'bundle-generated',
    intake,
    premium: premiumResponse,
    artifact: bundle,
    source: 'submission-bundle-async'
  });

  await recordAuditEvent({
    eventType: 'bundle.generate_async_completed',
    category: 'premium',
    requestId: job.requestId,
    actorType: 'job',
    actorId: job.jobId,
    email: job.email,
    caseId: caseState.caseFile.caseId,
    status: 'success',
    message: 'Asynchronous submission bundle generation completed.',
    metadata: {
      itemCount: bundle.bundleItems.length
    }
  });

  return {
    ...bundle,
    caseFile: caseState.caseFile,
    caseVersion: caseState.version
  };
});
