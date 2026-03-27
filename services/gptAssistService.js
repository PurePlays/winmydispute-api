import { getIssuerRecord, normalizeNetwork } from './disputeSchemaService.js';
import { getMerchantVerticalProfile } from './merchantVerticalService.js';
import { normalizeIntake } from './premiumFlowService.js';
import {
  getAllReasonCodesForNetwork,
  getReasonDetails,
  getSupportedReasonNetworks,
  lookupReasonCodeByScenario
} from './reasonService.js';

function normalizeText(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueItems(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function scoreKeywordMatch(source, query) {
  const sourceText = normalizeText(source);
  const queryText = normalizeText(query);
  if (!queryText) return 0;
  if (sourceText.includes(queryText)) return queryText.length + 8;

  return queryText
    .split(/\W+/)
    .filter(term => term.length > 2)
    .reduce((score, term) => (sourceText.includes(term) ? score + term.length : score), 0);
}

function listMissingFields(intake) {
  const missing = [];

  if (!intake.network) missing.push('network');
  if (!intake.issuer || intake.issuer === 'Your card issuer') missing.push('issuer');
  if (!intake.merchantName || intake.merchantName === 'the merchant') missing.push('merchantName');
  if (!intake.transactionDateIso) missing.push('transactionDate');
  if (intake.transactionAmountValue === null) missing.push('transactionAmount');
  if (!intake.description) missing.push('description');

  return missing;
}

function buildNormalizationNotes(intake) {
  const notes = [];

  if (intake.transactionDateIso && intake.transactionDateIso !== intake.transactionDate) {
    notes.push(`Normalized transaction date to ${intake.transactionDateIso}.`);
  }

  if (intake.transactionAmountValue !== null && intake.transactionAmount !== `$${intake.transactionAmountValue.toFixed(2)}`) {
    notes.push(`Parsed transaction amount as $${intake.transactionAmountValue.toFixed(2)}.`);
  }

  if (intake.merchantVertical) {
    notes.push(`Inferred merchant vertical as ${intake.merchantVertical}.`);
  }

  return notes;
}

function getReasonSearchHaystack(result) {
  return [
    result.title,
    result.description,
    ...(result.strategyTips || []),
    ...(result.evidenceRequirements || [])
  ].filter(Boolean).join(' ');
}

function normalizeReasonSearchResult(network, result, query) {
  return {
    network,
    reasonCode: result.reasonCode,
    title: result.title,
    description: result.description,
    strategyTips: Array.isArray(result.strategyTips) ? result.strategyTips.slice(0, 3) : [],
    evidenceRequirements: Array.isArray(result.evidenceRequirements) ? result.evidenceRequirements.slice(0, 5) : [],
    score: scoreKeywordMatch(getReasonSearchHaystack(result), query)
  };
}

function getCoverageTerms(text) {
  return normalizeText(text)
    .split(/\W+/)
    .filter(term => term.length > 3);
}

function recommendationCovered(recommendation, providedText) {
  const terms = getCoverageTerms(recommendation);
  if (terms.length === 0) {
    return false;
  }

  return terms.some(term => providedText.includes(term));
}

function buildRecommendedEvidence(reasonDetails, verticalProfile) {
  return uniqueItems([
    ...(Array.isArray(reasonDetails?.evidenceRequirements) ? reasonDetails.evidenceRequirements : []),
    ...(Array.isArray(reasonDetails?.evidenceToFocusOn) ? reasonDetails.evidenceToFocusOn : []),
    ...(Array.isArray(verticalProfile?.evidenceToFocusOn) ? verticalProfile.evidenceToFocusOn : [])
  ]);
}

function deriveReadinessLevel(score) {
  if (score >= 85) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 50) return 'needs-more-evidence';
  return 'thin';
}

export function normalizeDisputeIntakePayload(input = {}) {
  const intake = normalizeIntake(input);
  const reasonMatch = intake.description
    ? lookupReasonCodeByScenario(intake.network, intake.description)
    : {
        reasonCode: null,
        title: null,
        description: null,
        network: intake.network,
        confidence: 0
      };

  return {
    normalizedIntake: intake,
    missingFields: listMissingFields(intake),
    normalizationNotes: buildNormalizationNotes(intake),
    reasonMatch
  };
}

export function searchReasonProfiles({ query = '', network = null, limit = 8 } = {}) {
  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery.length < 2) {
    return [];
  }

  const normalizedNetwork = normalizeNetwork(network);
  const candidateNetworks = normalizedNetwork
    ? [normalizedNetwork]
    : getSupportedReasonNetworks();
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 8, 20));

  const results = candidateNetworks.flatMap(candidateNetwork => (
    Object.entries(getAllReasonCodesForNetwork(candidateNetwork))
      .map(([reasonCode, item]) => normalizeReasonSearchResult(candidateNetwork, {
        reasonCode,
        title: item.title,
        description: item.description,
        strategyTips: item.strategyTips || [],
        evidenceRequirements: item.evidenceRequirements || []
      }, normalizedQuery))
  ));

  return results
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, boundedLimit);
}

export function getIssuerProfile(name) {
  const issuer = getIssuerRecord(name);
  if (!issuer) {
    return null;
  }

  const contact = issuer.contact || {};
  return {
    issuer: issuer.name,
    aliases: Array.isArray(issuer.aliases) ? issuer.aliases : [],
    supportedNetworks: Array.isArray(issuer.supportedNetworks) ? issuer.supportedNetworks : [],
    contact: {
      issuer: issuer.name,
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
    },
    notes: Array.isArray(issuer.notes) ? issuer.notes : [],
    evidenceExamples: Array.isArray(contact.evidenceExamples) ? contact.evidenceExamples : [],
    preferredSubmissionChannels: Array.isArray(contact.preferredSubmissionChannels)
      ? contact.preferredSubmissionChannels
      : []
  };
}

export function scoreEvidenceQuality(input = {}) {
  const intake = normalizeIntake(input);
  const reasonMatch = input.reasonCode
    ? {
        reasonCode: String(input.reasonCode).trim(),
        network: intake.network,
        confidence: 100
      }
    : (intake.description ? lookupReasonCodeByScenario(intake.network, intake.description) : null);

  const resolvedNetwork = reasonMatch?.network || intake.network;
  const reasonCode = reasonMatch?.reasonCode || null;
  const reasonDetails = reasonCode && resolvedNetwork
    ? getReasonDetails(resolvedNetwork, reasonCode)
    : null;
  const verticalProfile = getMerchantVerticalProfile(intake.merchantVertical);
  const recommendedEvidence = buildRecommendedEvidence(reasonDetails, verticalProfile);
  const providedEvidence = uniqueItems([
    ...(Array.isArray(intake.evidenceItems) ? intake.evidenceItems : []),
    ...(Array.isArray(intake.timelineItems) ? intake.timelineItems.map(item => `Timeline: ${item}`) : []),
    intake.evidenceSummary ? `Evidence summary: ${intake.evidenceSummary}` : null
  ]);
  const providedText = normalizeText(providedEvidence.join(' '));
  const coveredRecommendations = recommendedEvidence.filter(item => recommendationCovered(item, providedText));
  const missingPriorityEvidence = recommendedEvidence.filter(item => !recommendationCovered(item, providedText));

  let evidenceQualityScore = 20;
  if (intake.network) evidenceQualityScore += 10;
  if (reasonCode) evidenceQualityScore += 10;
  if (intake.issuer && intake.issuer !== 'Your card issuer') evidenceQualityScore += 5;
  if (intake.merchantName && intake.merchantName !== 'the merchant') evidenceQualityScore += 10;
  if (intake.transactionDateIso) evidenceQualityScore += 10;
  if (intake.transactionAmountValue !== null) evidenceQualityScore += 10;
  if (intake.description) evidenceQualityScore += 10;
  if (providedEvidence.length > 0) evidenceQualityScore += 15;
  if ((intake.timelineItems || []).length > 0) evidenceQualityScore += 10;
  if (recommendedEvidence.length > 0) {
    evidenceQualityScore += Math.round((coveredRecommendations.length / recommendedEvidence.length) * 10);
  }

  const warnings = [];
  if (!reasonCode) {
    warnings.push('The intake still does not map confidently to one reason code.');
  }
  if (!intake.transactionDateIso) {
    warnings.push('The transaction date still needs a clean normalized value.');
  }
  if (intake.transactionAmountValue === null) {
    warnings.push('The transaction amount is still ambiguous.');
  }
  if (providedEvidence.length === 0) {
    warnings.push('No concrete evidence items have been provided yet.');
  }
  if ((intake.timelineItems || []).length === 0) {
    warnings.push('A short event timeline would make the package stronger.');
  }

  const boundedScore = Math.max(0, Math.min(evidenceQualityScore, 100));

  return {
    reasonCode,
    reasonTitle: reasonDetails?.title || null,
    merchantVertical: intake.merchantVertical || null,
    evidenceQualityScore: boundedScore,
    readinessLevel: deriveReadinessLevel(boundedScore),
    providedEvidenceCount: providedEvidence.length,
    timelineItemCount: Array.isArray(intake.timelineItems) ? intake.timelineItems.length : 0,
    recommendedEvidence,
    coveredRecommendations,
    missingPriorityEvidence: missingPriorityEvidence.slice(0, 6),
    warnings
  };
}
