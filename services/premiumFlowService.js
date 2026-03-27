import validator from 'validator';
import {
  getIssuerRecord,
  getReasonNode,
  getRebuttalStrategy,
  lookupReasonCodeByScenario,
  normalizeNetwork
} from './disputeSchemaService.js';
import { buildExhibitPacket } from './exhibitPackagerService.js';
import { normalizeEmail } from './licenseStore.js';
import { getMerchantVerticalProfile, inferMerchantVertical } from './merchantVerticalService.js';
import { summarizeOutcomeFeedback } from './outcomeFeedbackService.js';

const GENERIC_TIP = 'Gather the clearest proof of what happened, keep your timeline tight, and tie each fact directly to why the charge should be reversed.';

export const PREMIUM_FEATURES = Object.freeze([
  'full-letter',
  'full-strategy-set',
  'evidence-checklist',
  'cfpb-summary'
]);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueItems(items = []) {
  return Array.from(new Set((Array.isArray(items) ? items : []).filter(Boolean)));
}

function normalizeArrayInput(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => formatStructuredListItem(item))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(/\n|;|\|/g)
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [];
}

function formatStructuredListItem(item) {
  if (typeof item === 'string') {
    return normalizeText(item);
  }

  if (!item || typeof item !== 'object') {
    return '';
  }

  const summary = normalizeText(
    item.summary
    || item.description
    || item.text
    || item.caption
    || item.notes
    || item.label
    || item.name
  );
  const filename = normalizeText(item.filename || item.fileName || '');
  const fileType = normalizeText(item.type || item.fileType || item.mimeType || '');
  const extractedText = normalizeText(item.extractedText || item.ocrText || '');
  const prefixParts = [fileType, filename].filter(Boolean);
  const prefix = prefixParts.length ? `${prefixParts.join(' / ')}: ` : '';

  if (summary && extractedText && extractedText !== summary) {
    return `${prefix}${summary} - ${extractedText}`;
  }

  return `${prefix}${summary || extractedText}`;
}

function parseFlexibleAmount(value) {
  if (value === undefined || value === null || value === '') {
    return {
      amountValue: null,
      amountDisplay: ''
    };
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      amountValue: value,
      amountDisplay: `$${value.toFixed(2)}`
    };
  }

  const original = String(value).trim();
  if (!original) {
    return {
      amountValue: null,
      amountDisplay: ''
    };
  }

  let cleaned = original.replace(/[^\d,.\-]/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const decimalDigits = cleaned.length - lastComma - 1;
    cleaned = decimalDigits > 0 && decimalDigits <= 2
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const decimalDigits = cleaned.length - lastDot - 1;
    if (cleaned.split('.').length > 2 || decimalDigits === 3) {
      cleaned = cleaned.replace(/\./g, '');
    }
  }

  const amountValue = Number(cleaned);
  return {
    amountValue: Number.isFinite(amountValue) ? amountValue : null,
    amountDisplay: original
  };
}

function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return '';
  }

  return date.toISOString().slice(0, 10);
}

function parseFlexibleDate(value) {
  const original = normalizeText(String(value || ''));
  if (!original) {
    return {
      dateIso: '',
      dateDisplay: ''
    };
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(original)) {
    return {
      dateIso: original,
      dateDisplay: original
    };
  }

  const isoLikeMatch = original.match(/^(\d{4})[/. -](\d{1,2})[/. -](\d{1,2})$/);
  if (isoLikeMatch) {
    return {
      dateIso: toIsoDate(Number(isoLikeMatch[1]), Number(isoLikeMatch[2]), Number(isoLikeMatch[3])),
      dateDisplay: original
    };
  }

  const slashMatch = original.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const rawYear = Number(slashMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;

    return {
      dateIso: toIsoDate(year, month, day),
      dateDisplay: original
    };
  }

  const parsed = new Date(original);
  if (!Number.isNaN(parsed.getTime())) {
    const dateIso = toIsoDate(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth() + 1,
      parsed.getUTCDate()
    );
    return {
      dateIso,
      dateDisplay: original
    };
  }

  return {
    dateIso: '',
    dateDisplay: original
  };
}

function normalizeTone(value = '') {
  const tone = normalizeText(value).toLowerCase();
  if (['assertive', 'firm', 'strong'].includes(tone)) return 'assertive';
  if (['concise', 'brief', 'short'].includes(tone)) return 'concise';
  if (['empathetic', 'calm', 'polite'].includes(tone)) return 'empathetic';
  return 'formal';
}

function normalizeLengthPreference(value = '') {
  const length = normalizeText(value).toLowerCase();
  if (['short', 'brief', 'compact'].includes(length)) return 'short';
  if (['detailed', 'long', 'full'].includes(length)) return 'detailed';
  return 'standard';
}

function normalizeRedactionMode(value = '') {
  const mode = normalizeText(value).toLowerCase();
  if (mode === 'strict') return 'strict';
  if (mode === 'standard' || mode === 'redacted') return 'standard';
  return 'none';
}

function normalizeOutputFormat(value = '') {
  const format = normalizeText(value).toLowerCase();
  if (['pdf', 'portable document format'].includes(format)) return 'pdf';
  if (['word', 'doc', 'docx', 'microsoft word'].includes(format)) return 'docx';
  if (['rtf', 'word-compatible-rtf'].includes(format)) return 'word-compatible-rtf';
  if (['text', 'plain text'].includes(format)) return 'text';
  return 'pdf';
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function getNestedValue(input, pathSegments) {
  let current = input;
  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function pickString(input, paths, fallback = '') {
  for (const pathSegments of paths) {
    const value = getNestedValue(input, pathSegments);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function pickValue(input, paths, fallback = null) {
  for (const pathSegments of paths) {
    const value = getNestedValue(input, pathSegments);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return fallback;
}

export function normalizeIntake(input = {}) {
  const email = normalizeEmail(pickString(input, [
    ['email'],
    ['answers', 'question5']
  ]));

  const description = pickString(input, [
    ['description'],
    ['disputeDetails'],
    ['summary'],
    ['answers', 'question11']
  ]);

  const transactionAmount = pickValue(input, [
    ['transactionAmount'],
    ['amount'],
    ['answers', 'question7']
  ]);
  const amount = parseFlexibleAmount(transactionAmount);
  const transactionDate = parseFlexibleDate(pickString(input, [
    ['transactionDate'],
    ['date'],
    ['answers', 'question8']
  ], ''));
  const merchantName = pickString(input, [
    ['merchantName'],
    ['merchant'],
    ['answers', 'question6']
  ], 'the merchant');
  const descriptionText = description;
  const merchantVertical = inferMerchantVertical({
    merchantVertical: pickString(input, [['merchantVertical'], ['vertical'], ['merchantType']], ''),
    merchantName,
    description: descriptionText
  });

  return {
    caseId: pickString(input, [
      ['caseId']
    ], ''),
    email,
    network: normalizeNetwork(pickString(input, [
      ['network'],
      ['cardNetwork'],
      ['answers', 'cardBrand']
    ])),
    issuer: pickString(input, [
      ['issuer'],
      ['issuerName'],
      ['userIssuer']
    ], 'Your card issuer'),
    cardholderName: pickString(input, [
      ['cardholderName'],
      ['name'],
      ['answers', 'question1']
    ], '[Cardholder Name]'),
    addressLine1: pickString(input, [
      ['addressLine1'],
      ['address'],
      ['answers', 'question2']
    ], ''),
    addressLine2: pickString(input, [
      ['addressLine2'],
      ['cityStateZip'],
      ['answers', 'question3']
    ], ''),
    phone: pickString(input, [
      ['phone'],
      ['answers', 'question4']
    ], ''),
    merchantName,
    merchantVertical,
    transactionAmount: amount.amountDisplay || (transactionAmount === null ? '' : String(transactionAmount).trim()),
    transactionAmountValue: amount.amountValue,
    transactionDate: transactionDate.dateDisplay || 'the transaction date',
    transactionDateIso: transactionDate.dateIso || '',
    description,
    evidenceSummary: pickString(input, [
      ['evidenceSummary'],
      ['supportingEvidence'],
      ['answers', 'question11']
    ], ''),
    evidenceItems: normalizeArrayInput(pickValue(input, [
      ['evidenceItems'],
      ['evidence'],
      ['attachmentsSummary'],
      ['supportingDocuments']
    ], [])),
    timelineItems: normalizeArrayInput(pickValue(input, [
      ['timelineItems'],
      ['timeline'],
      ['eventTimeline']
    ], [])),
    merchantRebuttalConcerns: normalizeArrayInput(pickValue(input, [
      ['merchantRebuttalConcerns'],
      ['anticipatedMerchantRebuttals']
    ], [])),
    desiredOutcome: pickString(input, [
      ['desiredOutcome'],
      ['requestedResolution']
    ], 'Reverse the charge or provide a billing credit.'),
    tone: normalizeTone(pickString(input, [
      ['tone']
    ], 'formal')),
    lengthPreference: normalizeLengthPreference(pickString(input, [
      ['lengthPreference'],
      ['responseLength'],
      ['documentLength']
    ], 'standard')),
    outputFormat: normalizeOutputFormat(pickString(input, [
      ['outputFormat'],
      ['documentFormat']
    ], 'pdf')),
    redactionMode: normalizeRedactionMode(pickString(input, [
      ['redactionMode'],
      ['privacyMode']
    ], 'none')),
    includeRedactedVersion: normalizeBoolean(pickValue(input, [
      ['includeRedactedVersion'],
      ['generateRedactedVersion'],
      ['includePrivacyCopy']
    ], false), false)
  };
}

function buildPreviewTip(strategyEntry, reasonEntry) {
  if (strategyEntry?.strategyTips?.[0]) {
    return strategyEntry.strategyTips[0];
  }

  if (strategyEntry?.evidenceToFocusOn?.[0]) {
    return `Lead with evidence that shows ${strategyEntry.evidenceToFocusOn[0]}.`;
  }

  if (reasonEntry?.preventionSteps?.[0]) {
    return reasonEntry.preventionSteps[0];
  }

  return GENERIC_TIP;
}

function buildEvidenceChecklist(reasonEntry, strategyEntry, intake, verticalProfile) {
  const checklist = new Set([
    'Card statement showing the disputed charge',
    'Order receipt, invoice, or confirmation',
    'Screenshots or emails showing what was promised',
    'Timeline of your attempts to resolve the issue with the merchant'
  ]);

  if (normalizeText(intake.evidenceSummary)) {
    checklist.add(`Any proof already mentioned by the user: ${normalizeText(intake.evidenceSummary)}`);
  }

  for (const item of intake.evidenceItems || []) {
    checklist.add(item);
  }

  for (const item of reasonEntry?.evidenceRequirements || []) {
    checklist.add(item);
  }

  for (const item of strategyEntry?.evidenceToFocusOn || []) {
    checklist.add(item);
  }

  for (const item of verticalProfile?.evidenceToFocusOn || []) {
    checklist.add(item);
  }

  return Array.from(checklist);
}

function buildStrategySet(strategyEntry, reasonEntry, verticalProfile, intake) {
  const strategyTips = [
    ...(Array.isArray(strategyEntry?.strategyTips) ? strategyEntry.strategyTips : []),
    ...(Array.isArray(verticalProfile?.strategyTips) ? verticalProfile.strategyTips : [])
  ];
  const rebuttals = [
    ...(Array.isArray(strategyEntry?.commonMerchantRebuttals) ? strategyEntry.commonMerchantRebuttals : []),
    ...(Array.isArray(verticalProfile?.commonMerchantRebuttals) ? verticalProfile.commonMerchantRebuttals : []),
    ...(Array.isArray(intake.merchantRebuttalConcerns) ? intake.merchantRebuttalConcerns : [])
  ];
  const evidenceToFocusOn = [
    ...(Array.isArray(strategyEntry?.evidenceToFocusOn) ? strategyEntry.evidenceToFocusOn : []),
    ...(Array.isArray(verticalProfile?.evidenceToFocusOn) ? verticalProfile.evidenceToFocusOn : [])
  ];

  return {
    customerStrategy: verticalProfile?.customerStrategy || strategyEntry?.customerStrategy || 'Center the dispute on the strongest factual mismatch between what was promised and what actually happened.',
    strategyTips: strategyTips.length
      ? Array.from(new Set(strategyTips))
      : [buildPreviewTip(strategyEntry, reasonEntry)],
    commonMerchantRebuttals: Array.from(new Set(rebuttals)),
    evidenceToFocusOn: Array.from(new Set(evidenceToFocusOn)),
    merchantVertical: intake.merchantVertical || null,
    verticalStrategy: verticalProfile?.customerStrategy || null
  };
}

function formatAmount(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return `$${numeric.toFixed(2)}`;
  }
  return value || 'the transaction amount';
}

function buildLetter(intake, reasonCode, reasonEntry, strategySet) {
  const issuer = getIssuerRecord(intake.issuer);
  const issuerContact = issuer?.contact || {
    phoneSupport: null,
    mailingAddress: 'Use your issuer’s published disputes mailing address.',
    submissionNotes: []
  };
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const addressBlock = [intake.cardholderName, intake.addressLine1, intake.addressLine2, intake.phone, intake.email]
    .filter(Boolean)
    .join('\n');
  const notes = issuerContact.submissionNotes?.length
    ? `\nSupporting notes:\n- ${issuerContact.submissionNotes.join('\n- ')}`
    : '';
  const toneOpeners = {
    formal: 'I am writing to formally dispute the charge described below.',
    assertive: 'I am disputing this charge and requesting prompt corrective action based on the facts and supporting evidence.',
    concise: 'I am disputing the charge identified below and requesting a reversal.',
    empathetic: 'I respectfully request a review of the charge below and the supporting information I have provided.'
  };
  const chronology = intake.timelineItems?.length
    ? [
        '',
        'Timeline:',
        ...intake.timelineItems.map(item => `- ${item}`)
      ]
    : [];
  const evidenceSection = intake.evidenceItems?.length && intake.lengthPreference !== 'short'
    ? [
        '',
        'Supporting evidence already available:',
        ...intake.evidenceItems.map(item => `- ${item}`)
      ]
    : [];

  return [
    `${today}`,
    '',
    addressBlock || intake.cardholderName,
    '',
    'Disputes Department',
    intake.issuer,
    issuerContact.mailingAddress,
    '',
    `Subject: Dispute of Charge - ${intake.merchantName} - ${intake.transactionDate} - ${formatAmount(intake.transactionAmount)}`,
    '',
    'Dear Disputes Department,',
    '',
    toneOpeners[intake.tone] || toneOpeners.formal,
    '',
    `I am writing to dispute a charge of ${formatAmount(intake.transactionAmountValue ?? intake.transactionAmount)} from ${intake.merchantName} dated ${intake.transactionDateIso || intake.transactionDate}.`,
    `Based on the facts available, this aligns most closely with reason code ${reasonCode || 'to be confirmed'}${reasonEntry?.title ? ` (${reasonEntry.title})` : ''}.`,
    '',
    `Dispute summary: ${intake.description || 'The consumer states that the charge should be reversed based on the submitted facts.'}`,
    '',
    `Why this dispute should be credited: ${strategySet.customerStrategy}`,
    ...(intake.lengthPreference === 'detailed' ? chronology : []),
    ...(intake.lengthPreference !== 'short' ? evidenceSection : []),
    '',
    `Requested action: ${intake.desiredOutcome}`,
    '',
    `Issuer support contact: ${issuerContact.phoneSupport || 'See your card statement for the disputes phone number.'}`,
    `${notes}`.trim(),
    '',
    'Sincerely,',
    intake.cardholderName
  ].filter(Boolean).join('\n');
}

function buildEvidencePacket(intake, evidenceChecklist, strategySet) {
  return {
    userProvidedEvidence: intake.evidenceItems || [],
    recommendedEvidence: evidenceChecklist,
    timeline: intake.timelineItems || [],
    rebuttalConcerns: intake.merchantRebuttalConcerns || [],
    evidenceFocus: strategySet.evidenceToFocusOn || []
  };
}

function buildCfpbSummary(intake, reasonCode, reasonEntry, strategySet) {
  return [
    `I am seeking CFPB assistance regarding a disputed card charge from ${intake.merchantName} dated ${intake.transactionDate} for ${formatAmount(intake.transactionAmount)}.`,
    `The dispute most closely aligns with reason code ${reasonCode || 'to be confirmed'}${reasonEntry?.title ? ` (${reasonEntry.title})` : ''}.`,
    `Key issue: ${intake.description || 'The transaction should be reversed based on the facts submitted.'}`,
    'Requested resolution: Reverse the charge, correct any billing error, and confirm the investigation outcome in writing.',
    `Consumer position: ${strategySet.customerStrategy}`
  ].join(' ');
}

function buildIssuerGuidance(intake) {
  const issuer = getIssuerRecord(intake.issuer);
  const contact = issuer?.contact || {};

  return {
    issuer: issuer?.name || intake.issuer,
    phoneSupport: contact.phoneSupport || null,
    fax: contact.fax || null,
    uploadPortal: contact.uploadPortal || null,
    mailingAddress: contact.mailingAddress || null,
    preferredSubmissionChannels: Array.isArray(contact.preferredSubmissionChannels) ? contact.preferredSubmissionChannels : [],
    disputeEntryPoint: contact.disputeEntryPoint || null,
    evidenceExamples: Array.isArray(contact.evidenceExamples) ? contact.evidenceExamples : [],
    filingWindowNote: contact.filingWindowNote || null,
    statusTracking: contact.statusTracking || null,
    submissionNotes: Array.isArray(contact.submissionNotes) ? contact.submissionNotes : []
  };
}

function buildSubmissionPlan(intake, premium = {}, evidenceChecklist = [], exhibitPacket = null) {
  const channels = premium.issuerGuidance?.preferredSubmissionChannels || [];
  const primaryChannel = channels[0] || 'your issuer dispute channel';
  const evidenceCount = Array.isArray(evidenceChecklist) ? evidenceChecklist.length : 0;

  return {
    recommendedPackageOrder: exhibitPacket?.recommendedPackageOrder || [
      'Cover note or dispute summary',
      'Dispute letter',
      'Evidence packet with labeled exhibits',
      'Timeline and merchant communications',
      'Any issuer-specific form or reference number'
    ],
    steps: [
      {
        order: 1,
        title: 'Finalize the dispute package',
        description: `Review the letter, evidence packet, and timeline for accuracy before submitting through ${primaryChannel}.`
      },
      {
        order: 2,
        title: 'Label every exhibit',
        description: exhibitPacket?.exhibits?.length
          ? `Use the exhibit index and reference ${exhibitPacket.exhibits[0].label}${exhibitPacket.exhibits[1] ? ` through ${exhibitPacket.exhibits[Math.min(exhibitPacket.exhibits.length - 1, 3)].label}` : ''} directly in the dispute letter or summary.`
          : `Number the strongest ${Math.max(3, Math.min(evidenceCount, 8))} exhibits and reference those exhibit labels directly in the dispute letter or summary.`
      },
      {
        order: 3,
        title: 'Submit through the best issuer path',
        description: premium.issuerGuidance?.disputeEntryPoint
          || 'Use the issuer portal or support flow listed in the issuer guidance section.'
      },
      {
        order: 4,
        title: 'Track the case and respond quickly',
        description: premium.issuerGuidance?.statusTracking
          || 'Monitor the dispute for follow-up questions and answer any issuer requests quickly.'
      }
    ],
    qualityChecks: [
      'Dates, amounts, and merchant names match across every document.',
      'Every factual claim is supported by a screenshot, statement line, email, or timeline item.',
      'The dispute theory is consistent from the summary through the final letter.',
      'The package includes the clearest proof that the merchant failed, mischarged, or billed after cancellation.'
    ]
  };
}

async function buildSuccessEstimate(analysis, evidenceChecklist = []) {
  const intake = analysis.intake;
  let score = analysis.reasonEntry ? 0.68 : 0.5;
  if ((intake.evidenceItems || []).length > 0 || normalizeText(intake.evidenceSummary)) score += 0.15;
  if ((intake.timelineItems || []).length > 0) score += 0.05;
  if ((intake.merchantRebuttalConcerns || []).length > 0) score += 0.03;
  if (Array.isArray(evidenceChecklist) && evidenceChecklist.length >= 5) score += 0.03;
  if (Number(intake.transactionAmountValue) > 1000) score -= 0.02;

  const outcomeSummary = await summarizeOutcomeFeedback({
    network: analysis.network,
    reasonCode: analysis.reasonCode,
    issuer: intake.issuer,
    merchantVertical: intake.merchantVertical
  });

  if (outcomeSummary.hasEnoughData && typeof outcomeSummary.winRate === 'number') {
    score = (score * 0.55) + (outcomeSummary.winRate * 0.45);
  }

  const estimatedSuccessRate = Math.max(0.2, Math.min(Number(score.toFixed(2)), 0.95));
  return {
    estimatedSuccessRate,
    modelType: outcomeSummary.hasEnoughData ? 'blended-historical-and-heuristic' : 'heuristic',
    sampleSize: outcomeSummary.sampleSize,
    rationale: outcomeSummary.hasEnoughData
      ? 'Estimate blends case heuristics with anonymized outcomes from similar disputes.'
      : 'Estimate is based mainly on heuristic dispute signals because historical matching data is still limited.'
  };
}

function buildReviewFlags(analysis, successEstimate) {
  const intake = analysis.intake;
  const flags = [];

  if (analysis.confidence < 55) {
    flags.push({
      code: 'low-confidence-reason-match',
      severity: analysis.confidence < 40 ? 'high' : 'medium',
      message: 'The dispute facts do not yet map strongly to one reason code.',
      recommendation: 'Confirm exactly what happened, especially whether this was non-receipt, cancellation, fraud, or misrepresentation.'
    });
  }

  if (!intake.transactionDateIso) {
    flags.push({
      code: 'date-needs-review',
      severity: 'medium',
      message: 'The transaction date was not normalized with confidence.',
      recommendation: 'Verify the posted transaction date before final submission.'
    });
  }

  if (intake.transactionAmountValue === null) {
    flags.push({
      code: 'amount-needs-review',
      severity: 'medium',
      message: 'The transaction amount is still ambiguous.',
      recommendation: 'Confirm the exact amount from the statement or receipt.'
    });
  }

  if (!normalizeText(intake.evidenceSummary) && (!Array.isArray(intake.evidenceItems) || intake.evidenceItems.length === 0)) {
    flags.push({
      code: 'thin-evidence-package',
      severity: 'medium',
      message: 'No concrete evidence items have been supplied yet.',
      recommendation: 'Add the strongest screenshots, receipts, emails, or statement lines before filing.'
    });
  }

  if (successEstimate.modelType === 'heuristic') {
    flags.push({
      code: 'limited-historical-calibration',
      severity: 'low',
      message: 'The success estimate is still mostly heuristic for this dispute profile.',
      recommendation: 'Treat the score as directional guidance, not a guarantee.'
    });
  }

  return flags;
}

function mapFlagToMissingItem(flag) {
  switch (flag?.code) {
    case 'low-confidence-reason-match':
      return 'A sharper description of what happened and why the charge should be reversed';
    case 'date-needs-review':
      return 'The exact posted transaction date from the statement';
    case 'amount-needs-review':
      return 'The exact disputed amount from the statement or receipt';
    case 'thin-evidence-package':
      return 'At least one concrete supporting document, screenshot, receipt, or email';
    default:
      return '';
  }
}

function buildFilingReadiness(analysis, evidencePacket, issuerGuidance, reviewFlags, successEstimate) {
  const missingCriticalItems = uniqueItems(
    reviewFlags
      .map(mapFlagToMissingItem)
      .filter(Boolean)
  );

  const blockers = reviewFlags
    .filter(flag => flag.severity === 'high' || ['date-needs-review', 'amount-needs-review', 'thin-evidence-package'].includes(flag.code))
    .map(flag => flag.recommendation);

  const strongestSignals = uniqueItems([
    analysis.reasonEntry?.title
      ? `The facts align with ${analysis.reasonCode} (${analysis.reasonEntry.title}).`
      : '',
    Array.isArray(evidencePacket?.userProvidedEvidence) && evidencePacket.userProvidedEvidence.length > 0
      ? `${evidencePacket.userProvidedEvidence.length} supporting evidence item${evidencePacket.userProvidedEvidence.length === 1 ? '' : 's'} already included.`
      : '',
    Array.isArray(evidencePacket?.timeline) && evidencePacket.timeline.length > 0
      ? `A timeline with ${evidencePacket.timeline.length} key event${evidencePacket.timeline.length === 1 ? '' : 's'} is already available.`
      : '',
    Array.isArray(issuerGuidance?.preferredSubmissionChannels) && issuerGuidance.preferredSubmissionChannels.length > 0
      ? `Issuer-specific submission options are available for ${issuerGuidance.issuer || analysis.intake.issuer}.`
      : '',
    successEstimate.modelType === 'blended-historical-and-heuristic'
      ? 'The estimated outcome is informed by similar historical dispute outcomes.'
      : ''
  ]).slice(0, 4);

  const evidenceGap = missingCriticalItems.some(item => /supporting document|screenshot|receipt|email/i.test(item));
  let readinessLevel = 'ready';
  if (blockers.length > 0) {
    readinessLevel = evidenceGap ? 'needs-evidence' : 'needs-review';
    if (!evidenceGap && blockers.length === 1 && analysis.confidence >= 60) {
      readinessLevel = 'almost-ready';
    }
  }

  const recommendedSubmissionChannel = Array.isArray(issuerGuidance?.preferredSubmissionChannels)
    ? issuerGuidance.preferredSubmissionChannels[0] || null
    : null;

  const recommendedNextAction = readinessLevel === 'ready'
    ? (issuerGuidance?.disputeEntryPoint
      || (recommendedSubmissionChannel
        ? `Submit the package through ${recommendedSubmissionChannel}.`
        : 'Submit the package through your issuer dispute channel.'))
    : blockers[0]
      || 'Review the highlighted issues before submitting the package.';

  let summary = 'The package looks submission-ready.';
  if (readinessLevel === 'almost-ready') {
    summary = 'The package is close, but one important issue should be cleaned up before filing.';
  } else if (readinessLevel === 'needs-review') {
    summary = 'The package needs a factual review before it is submission-ready.';
  } else if (readinessLevel === 'needs-evidence') {
    summary = 'The package needs stronger supporting evidence before it is submission-ready.';
  }

  return {
    readyForSubmission: readinessLevel === 'ready',
    readinessLevel,
    summary,
    strongestSignals,
    blockers,
    missingCriticalItems,
    recommendedNextAction,
    recommendedSubmissionChannel
  };
}

export async function buildDisputeAnalysis(input = {}) {
  const intake = normalizeIntake(input);
  const match = lookupReasonCodeByScenario(intake.network, intake.description);
  const reasonCode = match.reasonCode;
  const network = match.network || intake.network || 'visa';
  const reasonEntry = reasonCode ? getReasonNode(network, reasonCode) : null;
  const strategyEntry = reasonCode ? getRebuttalStrategy(network, reasonCode) : null;
  const verticalProfile = getMerchantVerticalProfile(intake.merchantVertical);

  return {
    intake,
    reasonCode,
    network,
    confidence: match.confidence ?? 36,
    reasonEntry,
    strategyEntry,
    verticalProfile,
    previewTip: buildPreviewTip(strategyEntry, reasonEntry)
  };
}

export async function buildPreviewResponse(input = {}, options = {}) {
  const analysis = await buildDisputeAnalysis(input);
  const successEstimate = await buildSuccessEstimate(analysis);
  const reviewFlags = buildReviewFlags(analysis, successEstimate);

  return {
    reasonCode: analysis.reasonCode,
    network: analysis.network,
    merchantVertical: analysis.intake.merchantVertical || null,
    confidence: analysis.confidence,
    confidenceNote: 'This confidence measures how strongly the facts match the likely dispute reason. It is not a guaranteed outcome score.',
    previewTip: analysis.previewTip,
    successEstimate,
    reviewFlags,
    upgradeRequired: options.upgradeRequired ?? true,
    premiumFeatures: [...PREMIUM_FEATURES]
  };
}

export async function buildPremiumResponse(input = {}) {
  const analysis = await buildDisputeAnalysis(input);
  const email = normalizeEmail(analysis.intake.email);

  if (!email || !validator.isEmail(email)) {
    throw new Error('A valid email is required for premium generation.');
  }

  const strategySet = buildStrategySet(analysis.strategyEntry, analysis.reasonEntry, analysis.verticalProfile, analysis.intake);
  const evidenceChecklist = buildEvidenceChecklist(analysis.reasonEntry, analysis.strategyEntry, analysis.intake, analysis.verticalProfile);
  const evidencePacket = buildEvidencePacket(analysis.intake, evidenceChecklist, strategySet);
  const providedEvidenceKeys = new Set((evidencePacket.userProvidedEvidence || []).map(item => normalizeText(item).toLowerCase()));
  const exhibitPacket = buildExhibitPacket({
    providedItems: evidencePacket.userProvidedEvidence || [],
    suggestedItems: (evidencePacket.recommendedEvidence || [])
      .filter(item => !providedEvidenceKeys.has(normalizeText(item).toLowerCase()))
  });
  const letter = buildLetter(analysis.intake, analysis.reasonCode, analysis.reasonEntry, strategySet);
  const cfpbSummary = buildCfpbSummary(analysis.intake, analysis.reasonCode, analysis.reasonEntry, strategySet);
  const issuerGuidance = buildIssuerGuidance(analysis.intake);
  const submissionPlan = buildSubmissionPlan(analysis.intake, { issuerGuidance }, evidenceChecklist, exhibitPacket);
  const successEstimate = await buildSuccessEstimate(analysis, evidenceChecklist);
  const reviewFlags = buildReviewFlags(analysis, successEstimate);
  const filingReadiness = buildFilingReadiness(
    analysis,
    evidencePacket,
    issuerGuidance,
    reviewFlags,
    successEstimate
  );

  return {
    email,
    reasonCode: analysis.reasonCode,
    network: analysis.network,
    merchantVertical: analysis.intake.merchantVertical || null,
    confidence: analysis.confidence,
    letter,
    strategySet,
    evidenceChecklist,
    evidencePacket,
    exhibitPacket,
    issuerGuidance,
    submissionPlan,
    cfpbSummary,
    successEstimate,
    reviewFlags,
    filingReadiness,
    documentPreferences: {
      tone: analysis.intake.tone,
      lengthPreference: analysis.intake.lengthPreference,
      preferredOutputFormat: analysis.intake.outputFormat,
      preferredRedactionMode: analysis.intake.redactionMode,
      includeRedactedVersion: analysis.intake.includeRedactedVersion,
      supportedDocumentFormats: ['pdf', 'docx', 'word-compatible-rtf', 'text'],
      supportedRedactionModes: ['none', 'standard', 'strict'],
      supportedToneOptions: ['formal', 'assertive', 'concise', 'empathetic'],
      supportedLengthOptions: ['short', 'standard', 'detailed'],
      formattingStyle: 'standard-professional'
    }
  };
}
