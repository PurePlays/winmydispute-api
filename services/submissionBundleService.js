import fs from 'fs/promises';
import JSZip from 'jszip';
import { createSignedArtifactAccess } from './artifactAccessService.js';
import { getStoredFilesByIds, storeBuffer } from './fileStorageService.js';
import { createPremiumReportDocument } from './reportDocumentService.js';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function buildSubmissionPlanText(premium = {}) {
  return [
    'Submission Plan',
    '',
    'Recommended Package Order:',
    ...((premium.submissionPlan?.recommendedPackageOrder || []).map(item => `- ${item}`)),
    '',
    'Quality Checks:',
    ...((premium.submissionPlan?.qualityChecks || []).map(item => `- ${item}`))
  ].join('\n');
}

function buildExhibitIndexText(premium = {}) {
  return [
    'Exhibit Index',
    '',
    ...((premium.exhibitPacket?.exhibitIndex || []).map(item => item))
  ].join('\n');
}

export async function createSubmissionBundle({ intake, premium, format = 'pdf' }) {
  const document = await createPremiumReportDocument({ intake, premium, format });
  const artifacts = Array.isArray(document.artifacts) && document.artifacts.length > 0
    ? document.artifacts
    : [document];
  const zip = new JSZip();
  const storedArtifacts = await getStoredFilesByIds(artifacts.map(artifact => artifact.fileId));
  const storedArtifactMap = new Map(storedArtifacts.map(file => [file.fileId, file]));

  for (const artifact of artifacts) {
    const stored = storedArtifactMap.get(artifact.fileId);
    if (!stored) {
      throw new Error(`Missing stored artifact for ${artifact.filename}`);
    }

    const buffer = await fs.readFile(stored.storagePath);
    zip.file(artifact.filename, buffer);
  }

  zip.file('submission-plan.txt', `${buildSubmissionPlanText(premium)}\n`);
  zip.file('exhibit-index.txt', `${buildExhibitIndexText(premium)}\n`);
  zip.file('case-summary.json', `${JSON.stringify({
    intake,
    premium: {
      email: premium.email,
      reasonCode: premium.reasonCode,
      network: premium.network,
      merchantVertical: premium.merchantVertical,
      successEstimate: premium.successEstimate,
      reviewFlags: premium.reviewFlags
    }
  }, null, 2)}\n`);

  const bundleFilename = `winmydispute-submission-bundle-${Date.now()}.zip`;
  const bundleBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const stored = await storeBuffer({
    kind: 'artifact',
    email: premium?.email || intake?.email || null,
    caseId: intake?.caseId || null,
    originalFilename: bundleFilename,
    declaredContentType: 'application/zip',
    buffer: bundleBuffer,
    metadata: {
      artifactType: 'submission-bundle',
      requestedOutputFormat: normalizeText(format) || 'pdf'
    }
  });
  const access = createSignedArtifactAccess({ fileId: stored.fileId });

  return {
    kind: 'artifact',
    fileId: stored.fileId,
    format: 'zip',
    filename: bundleFilename,
    url: access.url,
    expiresAt: access.expiresAt,
    contentType: 'application/zip',
    bundleItems: [
      ...artifacts.map(artifact => artifact.filename),
      'submission-plan.txt',
      'exhibit-index.txt',
      'case-summary.json'
    ],
    sourceArtifacts: artifacts.map(artifact => ({
      filename: artifact.filename,
      format: artifact.format,
      variant: artifact.variant || 'full',
      redactionMode: artifact.redactionMode || 'none'
    })),
    requestedOutputFormat: normalizeText(format) || 'pdf',
    sizeBytes: stored.sizeBytes,
    sha256: stored.sha256
  };
}
