import pdf from 'html-pdf';
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  HeadingLevel,
  BorderStyle
} from 'docx';
import { createSignedArtifactAccess } from './artifactAccessService.js';
import { storeBuffer } from './fileStorageService.js';
import { applyRedactionToCase } from './redactionService.js';

function escapeHtml(value = '') {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeFormat(value = '') {
  const format = String(value || '').trim().toLowerCase();
  if (['word', 'doc', 'docx'].includes(format)) return 'docx';
  if (['rtf', 'word-compatible-rtf'].includes(format)) return 'rtf';
  if (['text', 'txt'].includes(format)) return 'txt';
  return 'pdf';
}

function normalizeRedactionMode(value = '') {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'strict') return 'strict';
  if (mode === 'standard' || mode === 'redacted') return 'standard';
  return 'none';
}

function escapeRtf(value = '') {
  return String(value || '')
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll('\n', '\\par ');
}

function buildList(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p class="empty">No items provided.</p>';
  }

  return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function asArray(items = []) {
  return Array.isArray(items) ? items.filter(Boolean) : [];
}

function sectionHeading(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 120 }
  });
}

function subHeading(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 80 }
  });
}

function bulletParagraphs(items = []) {
  const normalized = asArray(items);
  if (normalized.length === 0) {
    return [new Paragraph({ text: 'No items provided.', italics: true })];
  }

  return normalized.map(item => new Paragraph({
    text: String(item),
    bullet: { level: 0 },
    spacing: { after: 60 }
  }));
}

function buildCaseSnapshotRows({ intake, premium }) {
  const cells = [
    ['Cardholder', intake.cardholderName],
    ['Issuer', intake.issuer],
    ['Merchant', intake.merchantName],
    ['Amount', intake.transactionAmount],
    ['Transaction Date', intake.transactionDateIso || intake.transactionDate],
    ['Network / Reason', `${premium.network || ''} / ${premium.reasonCode || ''}`],
    ['Merchant Vertical', premium.merchantVertical || 'Not specified'],
    ['Reason-Match Confidence', `${premium.confidence ?? ''}%`],
    ['Desired Outcome', intake.desiredOutcome || ''],
    ['Tone / Length', `${intake.tone} / ${intake.lengthPreference}`],
    ['Privacy Mode', intake.redactionMode || 'none']
  ];

  return cells.map(([label, value]) => new TableRow({
    children: [
      new TableCell({
        width: { size: 28, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
        shading: { fill: 'F3F7F8' }
      }),
      new TableCell({
        width: { size: 72, type: WidthType.PERCENTAGE },
        children: [new Paragraph(String(value || ''))]
      })
    ]
  }));
}

function buildExhibitSummary(packet = null) {
  if (!packet) {
    return 'No exhibit packet available.';
  }

  return `${packet.providedCount || 0} provided exhibits, ${packet.suggestedCount || 0} suggested exhibits.`;
}

function buildReviewFlagLines(flags = []) {
  if (!Array.isArray(flags) || flags.length === 0) {
    return ['No active review flags.'];
  }

  return flags.map(flag => {
    if (!flag || typeof flag !== 'object') {
      return String(flag || '');
    }

    const severity = String(flag.severity || 'info').toUpperCase();
    const message = String(flag.message || '').trim();
    const recommendation = String(flag.recommendation || '').trim();
    return recommendation
      ? `${severity}: ${message} Recommendation: ${recommendation}`
      : `${severity}: ${message}`;
  }).filter(Boolean);
}

function buildReadinessLines(readiness = {}) {
  if (!readiness || typeof readiness !== 'object') {
    return ['Readiness data is not available.'];
  }

  const lines = [
    `Ready for submission: ${readiness.readyForSubmission ? 'Yes' : 'No'}`,
    `Readiness level: ${String(readiness.readinessLevel || 'unknown')}`,
    String(readiness.summary || '').trim(),
    readiness.recommendedNextAction ? `Recommended next action: ${readiness.recommendedNextAction}` : null,
    readiness.recommendedSubmissionChannel ? `Recommended submission channel: ${readiness.recommendedSubmissionChannel}` : null
  ].filter(Boolean);

  const blockers = asArray(readiness.blockers).map(item => `Blocker: ${item}`);
  const missing = asArray(readiness.missingCriticalItems).map(item => `Missing critical item: ${item}`);
  const strongestSignals = asArray(readiness.strongestSignals).map(item => `Strong signal: ${item}`);

  return [...lines, ...blockers, ...missing, ...strongestSignals];
}

function buildDocxDocument({ intake, premium }) {
  return new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: 'WinMyDispute Premium Dispute Report',
            heading: HeadingLevel.TITLE,
            spacing: { after: 120 }
          }),
          new Paragraph({
            text: `Prepared for ${intake.cardholderName || ''} on ${new Date().toLocaleDateString('en-US')}`,
            spacing: { after: 240 }
          }),
          sectionHeading('Dispute Snapshot'),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: buildCaseSnapshotRows({ intake, premium }),
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: 'D8E1E5' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D8E1E5' },
              left: { style: BorderStyle.SINGLE, size: 1, color: 'D8E1E5' },
              right: { style: BorderStyle.SINGLE, size: 1, color: 'D8E1E5' },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'D8E1E5' },
              insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'D8E1E5' }
            }
          }),
          sectionHeading('Consumer Summary'),
          new Paragraph(intake.description || ''),
          sectionHeading('Strategy Summary'),
          subHeading('Customer Strategy'),
          new Paragraph(premium.strategySet?.customerStrategy || ''),
          subHeading('Strategy Tips'),
          ...bulletParagraphs(premium.strategySet?.strategyTips || []),
          subHeading('Anticipated Merchant Rebuttals'),
          ...bulletParagraphs(premium.strategySet?.commonMerchantRebuttals || []),
          sectionHeading('Evidence Packet'),
          subHeading('User-Provided Evidence'),
          ...bulletParagraphs(premium.evidencePacket?.userProvidedEvidence || []),
          subHeading('Recommended Evidence'),
          ...bulletParagraphs(premium.evidencePacket?.recommendedEvidence || premium.evidenceChecklist || []),
          subHeading('Timeline'),
          ...bulletParagraphs(premium.evidencePacket?.timeline || []),
          subHeading('Rebuttal Concerns'),
          ...bulletParagraphs(premium.evidencePacket?.rebuttalConcerns || []),
          sectionHeading('Exhibit Index'),
          new Paragraph(buildExhibitSummary(premium.exhibitPacket)),
          ...bulletParagraphs(premium.exhibitPacket?.exhibitIndex || []),
          sectionHeading('Issuer Submission Guidance'),
          subHeading('Recommended Channels'),
          ...bulletParagraphs(premium.issuerGuidance?.preferredSubmissionChannels || []),
          subHeading('Entry Point'),
          new Paragraph(premium.issuerGuidance?.disputeEntryPoint || 'Use your issuer account or published disputes channel.'),
          subHeading('Notes'),
          ...bulletParagraphs(premium.issuerGuidance?.submissionNotes || []),
          sectionHeading('Submission Plan'),
          subHeading('Recommended Package Order'),
          ...bulletParagraphs(premium.submissionPlan?.recommendedPackageOrder || []),
          subHeading('Steps'),
          ...bulletParagraphs((premium.submissionPlan?.steps || []).map(step => `${step.order}. ${step.title}: ${step.description}`)),
          subHeading('Quality Checks'),
          ...bulletParagraphs(premium.submissionPlan?.qualityChecks || []),
          sectionHeading('Filing Readiness'),
          ...bulletParagraphs(buildReadinessLines(premium.filingReadiness)),
          sectionHeading('Review Flags'),
          ...bulletParagraphs(buildReviewFlagLines(premium.reviewFlags)),
          sectionHeading('Dispute Letter'),
          ...String(premium.letter || '')
            .split('\n')
            .map(line => new Paragraph(line || ' ')),
          sectionHeading('CFPB Summary'),
          new Paragraph(premium.cfpbSummary || '')
        ]
      }
    ]
  });
}

function buildReportHtml({ intake, premium }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>WinMyDispute Report</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #1d2a30; margin: 40px; line-height: 1.55; }
    h1, h2, h3 { color: #173f45; margin-bottom: 8px; }
    h1 { font-size: 24px; border-bottom: 2px solid #173f45; padding-bottom: 8px; }
    h2 { font-size: 18px; margin-top: 24px; }
    p, li { font-size: 12px; }
    .muted { color: #55656b; }
    .card { border: 1px solid #d8e1e5; padding: 14px 16px; margin-top: 12px; border-radius: 8px; background: #fbfcfd; }
    .grid { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .grid td { border: 1px solid #d8e1e5; padding: 8px 10px; vertical-align: top; font-size: 12px; }
    .label { width: 180px; font-weight: bold; background: #f3f7f8; }
    .letter { white-space: pre-wrap; border: 1px solid #d8e1e5; padding: 14px; background: white; }
    .empty { color: #66757c; font-style: italic; }
  </style>
</head>
<body>
  <h1>WinMyDispute Premium Dispute Report</h1>
  <p class="muted">Prepared for ${escapeHtml(intake.cardholderName)} on ${escapeHtml(new Date().toLocaleDateString('en-US'))}</p>

  <h2>Dispute Snapshot</h2>
  <table class="grid">
    <tr><td class="label">Cardholder</td><td>${escapeHtml(intake.cardholderName)}</td></tr>
    <tr><td class="label">Issuer</td><td>${escapeHtml(intake.issuer)}</td></tr>
    <tr><td class="label">Merchant</td><td>${escapeHtml(intake.merchantName)}</td></tr>
    <tr><td class="label">Amount</td><td>${escapeHtml(intake.transactionAmount)}</td></tr>
    <tr><td class="label">Transaction Date</td><td>${escapeHtml(intake.transactionDateIso || intake.transactionDate)}</td></tr>
    <tr><td class="label">Network / Reason</td><td>${escapeHtml(premium.network || '')} / ${escapeHtml(premium.reasonCode || '')}</td></tr>
    <tr><td class="label">Merchant Vertical</td><td>${escapeHtml(premium.merchantVertical || 'Not specified')}</td></tr>
    <tr><td class="label">Reason-Match Confidence</td><td>${escapeHtml(String(premium.confidence ?? ''))}%</td></tr>
    <tr><td class="label">Desired Outcome</td><td>${escapeHtml(intake.desiredOutcome || '')}</td></tr>
    <tr><td class="label">Tone / Length</td><td>${escapeHtml(intake.tone)} / ${escapeHtml(intake.lengthPreference)}</td></tr>
    <tr><td class="label">Privacy Mode</td><td>${escapeHtml(intake.redactionMode || 'none')}</td></tr>
  </table>

  <h2>Consumer Summary</h2>
  <div class="card">
    <p>${escapeHtml(intake.description)}</p>
  </div>

  <h2>Strategy Summary</h2>
  <div class="card">
    <h3>Customer Strategy</h3>
    <p>${escapeHtml(premium.strategySet.customerStrategy || '')}</p>
    <h3>Strategy Tips</h3>
    ${buildList(premium.strategySet.strategyTips || [])}
    <h3>Anticipated Merchant Rebuttals</h3>
    ${buildList(premium.strategySet.commonMerchantRebuttals || [])}
  </div>

  <h2>Evidence Packet</h2>
  <div class="card">
    <h3>User-Provided Evidence</h3>
    ${buildList(premium.evidencePacket?.userProvidedEvidence || [])}
    <h3>Recommended Evidence</h3>
    ${buildList(premium.evidencePacket?.recommendedEvidence || premium.evidenceChecklist || [])}
    <h3>Timeline</h3>
    ${buildList(premium.evidencePacket?.timeline || [])}
    <h3>Rebuttal Concerns</h3>
    ${buildList(premium.evidencePacket?.rebuttalConcerns || [])}
  </div>

  <h2>Exhibit Index</h2>
  <div class="card">
    <p>${escapeHtml(buildExhibitSummary(premium.exhibitPacket))}</p>
    ${buildList(premium.exhibitPacket?.exhibitIndex || [])}
  </div>

  <h2>Issuer Submission Guidance</h2>
  <div class="card">
    <h3>Recommended Channels</h3>
    ${buildList(premium.issuerGuidance?.preferredSubmissionChannels || [])}
    <h3>Entry Point</h3>
    <p>${escapeHtml(premium.issuerGuidance?.disputeEntryPoint || 'Use your issuer account or published disputes channel.')}</p>
    <h3>Notes</h3>
    ${buildList(premium.issuerGuidance?.submissionNotes || [])}
  </div>

  <h2>Submission Plan</h2>
  <div class="card">
    <h3>Recommended Package Order</h3>
    ${buildList(premium.submissionPlan?.recommendedPackageOrder || [])}
    <h3>Steps</h3>
    ${buildList((premium.submissionPlan?.steps || []).map(step => `${step.order}. ${step.title}: ${step.description}`))}
    <h3>Quality Checks</h3>
    ${buildList(premium.submissionPlan?.qualityChecks || [])}
  </div>

  <h2>Filing Readiness</h2>
  <div class="card">
    ${buildList(buildReadinessLines(premium.filingReadiness))}
  </div>

  <h2>Review Flags</h2>
  <div class="card">
    ${buildList(buildReviewFlagLines(premium.reviewFlags))}
  </div>

  <h2>Dispute Letter</h2>
  <div class="letter">${escapeHtml(premium.letter || '')}</div>

  <h2>CFPB Summary</h2>
  <div class="card">
    <p>${escapeHtml(premium.cfpbSummary || '')}</p>
  </div>
</body>
</html>`;
}

function buildRtf({ intake, premium }) {
  const lines = [
    '{\\rtf1\\ansi\\deff0',
    '{\\fonttbl{\\f0 Times New Roman;}{\\f1 Arial;}}',
    '\\fs28 \\b WinMyDispute Premium Dispute Report\\b0\\par',
    `\\fs22 Prepared for ${escapeRtf(intake.cardholderName || '')}\\par`,
    '\\par',
    '\\b Dispute Snapshot\\b0\\par',
    `Issuer: ${escapeRtf(intake.issuer || '')}\\par`,
    `Merchant: ${escapeRtf(intake.merchantName || '')}\\par`,
    `Amount: ${escapeRtf(intake.transactionAmount || '')}\\par`,
    `Transaction Date: ${escapeRtf(intake.transactionDateIso || intake.transactionDate || '')}\\par`,
    `Network / Reason: ${escapeRtf(premium.network || '')} / ${escapeRtf(premium.reasonCode || '')}\\par`,
    `Merchant Vertical: ${escapeRtf(premium.merchantVertical || 'Not specified')}\\par`,
    `Reason-Match Confidence: ${escapeRtf(String(premium.confidence ?? ''))}%\\par`,
    `Privacy Mode: ${escapeRtf(intake.redactionMode || 'none')}\\par`,
    '\\par',
    '\\b Consumer Summary\\b0\\par',
    `${escapeRtf(intake.description || '')}\\par`,
    '\\par',
    '\\b Strategy\\b0\\par',
    `${escapeRtf(premium.strategySet?.customerStrategy || '')}\\par`,
    ...(premium.strategySet?.strategyTips || []).map(item => `- ${escapeRtf(item)}\\par`),
    '\\par',
    '\\b Evidence Packet\\b0\\par',
    ...(premium.evidencePacket?.recommendedEvidence || premium.evidenceChecklist || []).map(item => `- ${escapeRtf(item)}\\par`),
    '\\par',
    '\\b Exhibit Index\\b0\\par',
    `${escapeRtf(buildExhibitSummary(premium.exhibitPacket))}\\par`,
    ...(premium.exhibitPacket?.exhibitIndex || []).map(item => `- ${escapeRtf(item)}\\par`),
    '\\par',
    '\\b Issuer Submission Guidance\\b0\\par',
    ...(premium.issuerGuidance?.preferredSubmissionChannels || []).map(item => `- ${escapeRtf(item)}\\par`),
    premium.issuerGuidance?.disputeEntryPoint ? `${escapeRtf(premium.issuerGuidance.disputeEntryPoint)}\\par` : null,
    '\\par',
    '\\b Submission Plan\\b0\\par',
    ...(premium.submissionPlan?.recommendedPackageOrder || []).map(item => `- ${escapeRtf(item)}\\par`),
    ...(premium.submissionPlan?.steps || []).map(step => `- ${escapeRtf(`${step.order}. ${step.title}: ${step.description}`)}\\par`),
    ...(premium.submissionPlan?.qualityChecks || []).map(item => `- ${escapeRtf(item)}\\par`),
    '\\par',
    '\\b Filing Readiness\\b0\\par',
    ...buildReadinessLines(premium.filingReadiness).map(item => `${escapeRtf(item)}\\par`),
    '\\par',
    '\\b Review Flags\\b0\\par',
    ...buildReviewFlagLines(premium.reviewFlags).map(item => `${escapeRtf(item)}\\par`),
    '\\par',
    '\\b Dispute Letter\\b0\\par',
    `${escapeRtf(premium.letter || '')}\\par`,
    '\\par',
    '\\b CFPB Summary\\b0\\par',
    `${escapeRtf(premium.cfpbSummary || '')}\\par`,
    '}'
  ].filter(Boolean);

  return lines.join('\n');
}

function buildTextReport({ intake, premium }) {
  return [
    'WinMyDispute Premium Dispute Report',
    '',
    `Issuer: ${intake.issuer || ''}`,
    `Merchant: ${intake.merchantName || ''}`,
    `Amount: ${intake.transactionAmount || ''}`,
    `Transaction Date: ${intake.transactionDateIso || intake.transactionDate || ''}`,
    `Privacy Mode: ${intake.redactionMode || 'none'}`,
    '',
    'Filing Readiness:',
    ...buildReadinessLines(premium.filingReadiness),
    '',
    'Review Flags:',
    ...buildReviewFlagLines(premium.reviewFlags),
    '',
    'Exhibit Index:',
    ...(premium.exhibitPacket?.exhibitIndex || ['No exhibit packet available.']),
    '',
    premium.letter || '',
    '',
    `CFPB Summary: ${premium.cfpbSummary || ''}`
  ].join('\n');
}

async function createSingleReportArtifact({
  intake,
  premium,
  resolvedFormat,
  baseStem,
  variant = 'full',
  redactionMode = 'none'
}) {
  const suffix = variant === 'redacted' ? '-redacted' : '';
  const baseName = `${baseStem}${suffix}`;
  if (resolvedFormat === 'pdf') {
    const html = buildReportHtml({ intake, premium });
    const buffer = await new Promise((resolve, reject) => {
      pdf.create(html, { format: 'Letter', border: '0.5in' }).toBuffer((error, value) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(value);
      });
    });

    const filename = `${baseName}.pdf`;
    const stored = await storeBuffer({
      kind: 'artifact',
      email: premium?.email || intake?.email || null,
      caseId: intake?.caseId || null,
      originalFilename: filename,
      declaredContentType: 'application/pdf',
      buffer,
      metadata: {
        artifactType: 'premium-report',
        format: 'pdf',
        variant,
        redactionMode
      }
    });
    const access = createSignedArtifactAccess({ fileId: stored.fileId });
    return {
      kind: 'artifact',
      fileId: stored.fileId,
      format: 'pdf',
      filename,
      url: access.url,
      expiresAt: access.expiresAt,
      contentType: 'application/pdf',
      variant,
      redactionMode,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256
    };
  }

  if (resolvedFormat === 'docx') {
    const filename = `${baseName}.docx`;
    const document = buildDocxDocument({ intake, premium });
    const buffer = await Packer.toBuffer(document);
    const stored = await storeBuffer({
      kind: 'artifact',
      email: premium?.email || intake?.email || null,
      caseId: intake?.caseId || null,
      originalFilename: filename,
      declaredContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer,
      metadata: {
        artifactType: 'premium-report',
        format: 'docx',
        variant,
        redactionMode
      }
    });
    const access = createSignedArtifactAccess({ fileId: stored.fileId });
    return {
      kind: 'artifact',
      fileId: stored.fileId,
      format: 'docx',
      filename,
      url: access.url,
      expiresAt: access.expiresAt,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      variant,
      redactionMode,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256
    };
  }

  if (resolvedFormat === 'rtf') {
    const filename = `${baseName}.rtf`;
    const buffer = Buffer.from(`${buildRtf({ intake, premium })}\n`, 'utf8');
    const stored = await storeBuffer({
      kind: 'artifact',
      email: premium?.email || intake?.email || null,
      caseId: intake?.caseId || null,
      originalFilename: filename,
      declaredContentType: 'application/rtf',
      buffer,
      metadata: {
        artifactType: 'premium-report',
        format: 'word-compatible-rtf',
        variant,
        redactionMode
      }
    });
    const access = createSignedArtifactAccess({ fileId: stored.fileId });
    return {
      kind: 'artifact',
      fileId: stored.fileId,
      format: 'word-compatible-rtf',
      filename,
      url: access.url,
      expiresAt: access.expiresAt,
      contentType: 'application/rtf',
      variant,
      redactionMode,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256
    };
  }

  const filename = `${baseName}.txt`;
  const content = buildTextReport({ intake, premium });
  const buffer = Buffer.from(`${content}\n`, 'utf8');
  const stored = await storeBuffer({
    kind: 'artifact',
    email: premium?.email || intake?.email || null,
    caseId: intake?.caseId || null,
    originalFilename: filename,
    declaredContentType: 'text/plain',
    buffer,
    metadata: {
      artifactType: 'premium-report',
      format: 'text',
      variant,
      redactionMode
    }
  });
  const access = createSignedArtifactAccess({ fileId: stored.fileId });
  return {
    kind: 'artifact',
    fileId: stored.fileId,
    format: 'text',
    filename,
    url: access.url,
    expiresAt: access.expiresAt,
    contentType: 'text/plain',
    variant,
    redactionMode,
    sizeBytes: stored.sizeBytes,
    sha256: stored.sha256
  };
}

export async function createPremiumReportDocument({ intake, premium, format = 'pdf' }) {
  const resolvedFormat = normalizeFormat(format);
  const requestedRedactionMode = normalizeRedactionMode(intake?.redactionMode || 'none');
  const includeRedactedVersion = Boolean(intake?.includeRedactedVersion);
  const baseStem = `winmydispute-report-${Date.now()}`;
  const artifacts = [];

  if (includeRedactedVersion) {
    const fullArtifact = await createSingleReportArtifact({
      intake: { ...intake, redactionMode: 'none' },
      premium,
      resolvedFormat,
      baseStem,
      variant: 'full',
      redactionMode: 'none'
    });
    artifacts.push(fullArtifact);

    const redactedMode = requestedRedactionMode === 'none' ? 'standard' : requestedRedactionMode;
    const redacted = applyRedactionToCase({ intake, premium, mode: redactedMode });
    const redactedArtifact = await createSingleReportArtifact({
      intake: { ...redacted.intake, redactionMode: redactedMode },
      premium: redacted.premium,
      resolvedFormat,
      baseStem,
      variant: 'redacted',
      redactionMode: redactedMode
    });
    artifacts.push(redactedArtifact);

    return {
      ...fullArtifact,
      requestedRedactionMode,
      includeRedactedVersion: true,
      artifacts,
      redactedArtifact
    };
  }

  const primaryPayload = requestedRedactionMode === 'none'
    ? { intake: { ...intake, redactionMode: 'none' }, premium }
    : applyRedactionToCase({ intake, premium, mode: requestedRedactionMode });
  const primaryArtifact = await createSingleReportArtifact({
    intake: {
      ...primaryPayload.intake,
      redactionMode: requestedRedactionMode === 'none' ? 'none' : requestedRedactionMode
    },
    premium: primaryPayload.premium,
    resolvedFormat,
    baseStem,
    variant: requestedRedactionMode === 'none' ? 'full' : 'redacted',
    redactionMode: requestedRedactionMode
  });

  return {
    ...primaryArtifact,
    requestedRedactionMode,
    includeRedactedVersion: false,
    artifacts: [primaryArtifact]
  };
}
