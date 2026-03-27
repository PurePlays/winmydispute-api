import pdf from 'html-pdf';
import { createSignedArtifactAccess } from './artifactAccessService.js';
import {
  getBinMetadata,
  getIssuerRecord,
  getReasonNode,
  getRebuttalStrategy as getSchemaRebuttalStrategy,
  lookupReasonCodeByScenario as lookupFromSchema,
  normalizeNetwork
} from './disputeSchemaService.js';
import { storeBuffer } from './fileStorageService.js';
import { summarizeOutcomeFeedback } from './outcomeFeedbackService.js';

function uniqueItems(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function formatAmount(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return `$${numeric.toFixed(2)}`;
  }
  return value || 'the transaction amount';
}

export async function resolveBinToIssuer(bin) {
  return await getBinMetadata(bin) || {
    bin,
    network: null,
    rawBrand: null,
    issuer: null,
    issuerPhone: null,
    issuerUrl: null,
    cardType: null,
    cardSubType: null,
    country: null,
    countryCode3: null,
    countryName: null
  };
}

export async function getIssuerContact(name) {
  const issuer = getIssuerRecord(name);
  if (!issuer) {
    return {
      issuer: name,
      phoneSupport: null,
      fax: null,
      uploadPortal: null,
      mailingAddress: null,
      submissionNotes: []
    };
  }

  return {
    issuer: issuer.name,
    ...issuer.contact
  };
}

export async function lookupReasonCodeByScenario(network, scenario) {
  return lookupFromSchema(network, scenario);
}

export async function getReasonCodeDetails(network, code) {
  const reasonNode = getReasonNode(network, code);
  if (!reasonNode) {
    throw new Error(`Reason code not found: ${network}/${code}`);
  }

  return reasonNode;
}

export async function buildEvidencePacket({ network, reasonCode, transactionAmount, transactionDate, merchantResponse, consumerEvidence }) {
  const reasonNode = await getReasonCodeDetails(network, reasonCode);
  const strategy = getSchemaRebuttalStrategy(network, reasonCode) || {
    strategyTips: [],
    evidenceToFocusOn: [],
    commonMerchantRebuttals: [],
    customerStrategy: ''
  };

  return {
    compiledEvidence: uniqueItems([
      ...reasonNode.evidenceRequirements,
      ...strategy.evidenceToFocusOn,
      transactionAmount ? `Documentation showing the disputed amount: ${formatAmount(transactionAmount)}` : null,
      transactionDate ? `Timeline proof for the disputed date: ${transactionDate}` : null,
      merchantResponse ? 'Merchant response or denial message' : null,
      consumerEvidence ? 'Consumer-supplied supporting evidence' : null
    ]),
    submissionTips: uniqueItems([
      ...strategy.strategyTips,
      ...(reasonNode.preventionSteps || [])
    ]).slice(0, 8),
    estimatedSuccessRate: strategy.customerStrategy ? 0.82 : 0.68
  };
}

export async function generateDisputeLetter({
  cardholderName,
  issuer,
  merchantName,
  transactionAmount,
  transactionDate,
  reasonCode,
  network
}) {
  const reasonNode = getReasonNode(network, reasonCode);
  const issuerContact = await getIssuerContact(issuer);
  const dateFormatted = transactionDate
    ? new Date(`${transactionDate}T00:00:00Z`).toLocaleDateString('en-US')
    : 'the transaction date';

  const body = [
    `Dear ${issuer} Disputes Department,`,
    '',
    `I am writing to dispute a charge of ${formatAmount(transactionAmount)} on ${dateFormatted} from ${merchantName}.`,
    `The transaction aligns most closely with reason code ${reasonCode}${reasonNode?.title ? ` (${reasonNode.title})` : ''}.`,
    '',
    `Please review this matter and reverse the charge in accordance with the applicable dispute rules.`,
    issuerContact.mailingAddress ? `Supporting documents may be sent to: ${issuerContact.mailingAddress}` : null,
    '',
    'Sincerely,',
    cardholderName
  ].filter(Boolean).join('\n');

  return {
    letterText: body,
    recommendedSubjectLine: `Dispute of Charge - ${reasonCode}`,
    letterPdfUrl: null
  };
}

export async function estimateDisputeSuccess({
  network,
  reasonCode,
  consumerEvidence,
  priorAttemptsToResolve,
  merchantResponse,
  transactionAmount,
  issuer,
  merchantVertical
}) {
  const hasReasonProfile = Boolean(getReasonNode(network, reasonCode));
  let score = hasReasonProfile ? 0.68 : 0.5;
  if (consumerEvidence) score += 0.15;
  if (priorAttemptsToResolve) score += 0.08;
  if (merchantResponse) score += 0.03;
  if (Number(transactionAmount) > 1000) score -= 0.02;

  const outcomeSummary = await summarizeOutcomeFeedback({
    network,
    reasonCode,
    issuer,
    merchantVertical
  });
  if (outcomeSummary.hasEnoughData && typeof outcomeSummary.winRate === 'number') {
    score = (score * 0.55) + (outcomeSummary.winRate * 0.45);
  }

  const estimatedSuccessRate = Math.max(0.2, Math.min(Number(score.toFixed(2)), 0.95));

  return {
    estimatedSuccessRate,
    rationale: outcomeSummary.hasEnoughData
      ? 'Estimate blends heuristic dispute signals with anonymized historical outcome feedback for similar disputes.'
      : hasReasonProfile
        ? 'Estimate is boosted by a canonical reason-code profile plus the evidence supplied.'
        : 'Estimate is based on generic dispute heuristics because no canonical reason profile matched.',
    modelType: outcomeSummary.hasEnoughData ? 'blended-historical-and-heuristic' : 'heuristic',
    sampleSize: outcomeSummary.sampleSize
  };
}

export async function getRebuttalStrategy({ network, reasonCode }) {
  const strategy = getSchemaRebuttalStrategy(network, reasonCode);
  if (!strategy) {
    throw new Error(`No rebuttal strategy for ${network}/${reasonCode}`);
  }

  return strategy;
}

export async function generateCfpbComplaintSummary({ network, issuer, transaction = {}, summary }) {
  const networkLabel = normalizeNetwork(network) || 'unknown network';
  return [
    `Complaint Summary:`,
    `On ${transaction.date || 'the transaction date'}, a charge of ${formatAmount(transaction.amount)} at ${transaction.merchant || 'the merchant'} remained unresolved.`,
    `Details: ${summary}`,
    `Issuer: ${issuer}`,
    `Network: ${networkLabel}`
  ].join('\n');
}

export async function downloadDisputeLetter(letterHtml, { email = null } = {}) {
  const html = `<html><head><meta charset="utf-8"><title>Dispute Letter</title></head><body>${letterHtml}</body></html>`;
  const buffer = await new Promise((resolve, reject) => {
    pdf.create(html, { format: 'Letter' }).toBuffer((error, buf) => (error ? reject(error) : resolve(buf)));
  });

  const filename = `dispute-letter-${Date.now()}.pdf`;
  const stored = await storeBuffer({
    kind: 'artifact',
    email,
    originalFilename: filename,
    declaredContentType: 'application/pdf',
    buffer,
    metadata: {
      artifactType: 'legacy-letter-download'
    }
  });

  return createSignedArtifactAccess({ fileId: stored.fileId }).url;
}
