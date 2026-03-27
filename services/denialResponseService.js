import { buildPremiumResponse, normalizeIntake } from './premiumFlowService.js';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function uniqueItems(items = []) {
  return Array.from(new Set(items.map(item => normalizeText(item)).filter(Boolean)));
}

function buildRebuttalTargets(text = '', premium = {}) {
  const targets = [];
  const normalized = normalizeText(text).toLowerCase();

  if (normalized.includes('cancel')) {
    targets.push('Show the exact cancellation date and that billing continued afterward.');
  }
  if (normalized.includes('deliver') || normalized.includes('tracking')) {
    targets.push('Challenge delivery proof with any address mismatch, timing issue, or lack of signature linkage.');
  }
  if (normalized.includes('access') || normalized.includes('login') || normalized.includes('download')) {
    targets.push('Focus on lack of meaningful post-charge use and request issuer review of actual usage logs.');
  }
  if (normalized.includes('term') || normalized.includes('policy') || normalized.includes('agreed')) {
    targets.push('Point out any unclear, buried, or misleading terms and when they were actually disclosed.');
  }
  if (normalized.includes('insufficient') || normalized.includes('not enough')) {
    targets.push('Fill the evidence gap directly with a tighter chronology and the strongest exhibits first.');
  }

  return uniqueItems([
    ...targets,
    ...(premium.strategySet?.commonMerchantRebuttals || []).slice(0, 3).map(item => `Preempt likely rebuttal: ${item}`)
  ]);
}

function buildAdditionalEvidenceRequests(input = {}, premium = {}) {
  return uniqueItems([
    'A copy of the denial or representment notice from the issuer',
    'A timeline showing every merchant contact and every disputed billing date',
    ...(premium.evidencePacket?.recommendedEvidence || []).slice(0, 6),
    normalizeText(input.denialEvidence) ? null : 'Any screenshot, receipt, or email that directly contradicts the denial reason',
    normalizeText(input.issuerReferenceNumber) ? null : 'The issuer dispute or case reference number'
  ]);
}

function buildCounterLetter(intake, premium, denialSummary, rebuttalTargets) {
  return [
    `${new Date().toLocaleDateString('en-US')}`,
    '',
    intake.cardholderName || '[Cardholder Name]',
    '',
    `Re: Follow-up on denied dispute for ${intake.merchantName} on ${intake.transactionDateIso || intake.transactionDate}`,
    '',
    'Dear Disputes Department,',
    '',
    'I am requesting reconsideration of the denied dispute referenced above.',
    `The dispute remains best aligned with reason code ${premium.reasonCode || 'to be confirmed'} and the denial does not resolve the core issue: ${intake.description}.`,
    denialSummary ? `Denial summary: ${denialSummary}` : null,
    '',
    `Consumer position: ${premium.strategySet?.customerStrategy || ''}`,
    '',
    'Key rebuttal points:',
    ...rebuttalTargets.map(item => `- ${item}`),
    '',
    'Please review the attached follow-up evidence and reopen the investigation.',
    '',
    'Sincerely,',
    intake.cardholderName || '[Cardholder Name]'
  ].filter(Boolean).join('\n');
}

export async function buildDenialResponsePackage(input = {}) {
  const intake = normalizeIntake(input);
  const premium = await buildPremiumResponse(input);
  const denialSummary = normalizeText(input.denialSummary || input.denialReason || input.issuerFinding || input.merchantResponseText);
  const rebuttalTargets = buildRebuttalTargets([
    denialSummary,
    normalizeText(input.denialEvidence),
    normalizeText(input.merchantResponseText)
  ].filter(Boolean).join(' '), premium);
  const additionalEvidenceRequests = buildAdditionalEvidenceRequests(input, premium);
  const counterLetter = buildCounterLetter(intake, premium, denialSummary, rebuttalTargets);
  const reviewFlags = uniqueItems([
    !denialSummary ? 'The denial reason is still vague and should be copied into the case exactly.' : null,
    additionalEvidenceRequests.length > 5 ? 'More supporting proof is needed before a strong reconsideration package can be sent.' : null
  ]);

  return {
    email: premium.email,
    caseId: normalizeText(input.caseId) || null,
    reasonCode: premium.reasonCode,
    network: premium.network,
    denialSummary: denialSummary || null,
    counterLetter,
    rebuttalTargets,
    counterStrategy: [
      'Lead with the exact part of the denial that is wrong or incomplete.',
      'Attach only the strongest contradictory exhibits first.',
      'Tie each exhibit directly to the dispute theory and reason code.'
    ],
    additionalEvidenceRequests,
    submissionPlan: {
      recommendedPackageOrder: [
        'Follow-up cover note',
        'Counter letter',
        'Updated exhibit index',
        'New or stronger contradictory evidence',
        'Original dispute reference information'
      ],
      steps: [
        {
          order: 1,
          title: 'Anchor the response to the denial',
          description: 'Quote the denial reason briefly and explain why it is incomplete or incorrect.'
        },
        {
          order: 2,
          title: 'Attach only stronger follow-up proof',
          description: 'Prioritize cancellation timestamps, contradictory merchant emails, account logs, and denial-specific evidence.'
        },
        {
          order: 3,
          title: 'Request written reconsideration',
          description: 'Ask the issuer to reopen or escalate the review and respond in writing.'
        }
      ],
      qualityChecks: [
        'Every new point is tied to a specific denial claim.',
        'The follow-up package adds new value instead of repeating the original submission verbatim.',
        'The denial reference number and disputed transaction details are included.'
      ]
    },
    reviewFlags
  };
}
