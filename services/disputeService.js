import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdf from 'html-pdf';
import { google } from 'googleapis';

// Derive __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define directories
const DATA_DIR = path.join(__dirname, '..', 'mock-data');
const DOWNLOADS_DIR = path.join(__dirname, '..', 'static', 'downloads');

// Ensure downloads folder exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * Load JSON from disk asynchronously, returning defaultValue on any error.
 * @template T
 * @param {string} filename     File under mock-data/
 * @param {T}        defaultValue
 * @returns {Promise<T>}
 */
async function loadJsonAsync(filename, defaultValue) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8').trim();
    return raw ? JSON.parse(raw) : defaultValue;
  } catch (err) {
    console.warn(`⚠️ [disputeService] could not load ${filename}: ${err.message}`);
    return defaultValue;
  }
}

// Core datasets (loaded asynchronously)
let bins = {};
let issuers = {};
let reasonScenarios = {};
let reasonDetails = {};
let rebuttalDB = {};

async function initializeData() {
  bins = await loadJsonAsync('bins.json', {});
  issuers = await loadJsonAsync('issuers.json', {});
  reasonScenarios = await loadJsonAsync('reasonScenarios.json', {});
  reasonDetails = await loadJsonAsync('reasonDetails.json', {});
  rebuttalDB = await loadJsonAsync('rebuttalStrategies.json', {});
}

initializeData();

/**
 * Map a BIN to issuer metadata asynchronously.
 * @param {string} bin
 * @returns {Promise<object>}
 */
export async function resolveBinToIssuer(bin) {
  return bins[bin] || { bin, network: null, issuer: null, cardType: null, cardSubType: null, country: null };
}

/**
 * Retrieve dispute contact info for an issuer asynchronously.
 * @param {string} name
 * @returns {Promise<object>}
 */
export async function getIssuerContact(name) {
  return issuers[name] || {
    issuer: name,
    phoneSupport: null,
    fax: null,
    uploadPortal: null,
    mailingAddress: null,
    submissionNotes: []
  };
}

/**
 * Suggest a reason code by searching scenario patterns asynchronously.
 * @param {string} network
 * @param {string} scenario
 * @returns {Promise<{reasonCode: string|null, title: string|null, description: string|null, network: string}>}
 */
export async function lookupReasonCodeByScenario(network, scenario) {
  const patterns = reasonScenarios[network] || [];
  const text = (scenario || '').toLowerCase();
  const match = patterns.find(r =>
    (r.scenarioPattern || '').toLowerCase().split('|').some(p => text.includes(p.trim()))
  );
  return match || { reasonCode: null, title: null, description: null, network };
}

/**
 * Fetch full reason-code details asynchronously.
 * @param {string} network
 * @param {string} code
 * @returns {Promise<object>}
 */
export async function getReasonCodeDetails(network, code) {
  const details = (reasonDetails[network] || {})[code];
  if (!details) {
    throw new Error(`⚠️ Reason code not found: ${network}/${code}`);
  }
  return { reasonCode: code, ...details };
}

/**
 * Build an evidence packet for a dispute asynchronously.
 * @param {{network: string, reasonCode: string}} opts
 * @returns {Promise<{compiledEvidence: string[], submissionTips: string[], estimatedSuccessRate: number}>}
 */
export async function buildEvidencePacket({ network, reasonCode }) {
  const details = await getReasonCodeDetails(network, reasonCode);
  return {
    compiledEvidence: details.evidenceRequirements || [],
    submissionTips: details.strategyTips || [],
    estimatedSuccessRate: 0.8
  };
}

/**
 * Generate a simple text dispute letter asynchronously.
 * @param {{cardholderName: string, issuer: string, merchantName: string, transactionAmount: number, transactionDate: string, reasonCode: string}} params
 * @returns {Promise<{letterText: string, recommendedSubjectLine: string, letterPdfUrl: string|null}>}
 */
export async function generateDisputeLetter({
  cardholderName,
  issuer,
  merchantName,
  transactionAmount,
  transactionDate,
  reasonCode
}) {
  const dateFormatted = new Date(transactionDate).toLocaleDateString('en-US') || transactionDate;
  const body = `Dear ${issuer},\n\nI am writing to dispute a charge of \$${transactionAmount} on ${dateFormatted} from ${merchantName} (Reason Code: ${reasonCode}).\nPlease investigate and reverse this charge in accordance with applicable regulations.\n\nThank you for your prompt attention.\n\nSincerely,\n${cardholderName}`;

  return {
    letterText: body,
    recommendedSubjectLine: `Dispute of Charge – ${reasonCode}`,
    letterPdfUrl: null
  };
}

/**
 * Estimate dispute success based on consumer evidence and prior attempts to resolve.
 * @param {{consumerEvidence?: boolean, priorAttemptsToResolve?: boolean}} opts
 * @returns {Promise<{estimatedSuccessRate: number, rationale: string}>}
 */
export async function estimateDisputeSuccess({ consumerEvidence, priorAttemptsToResolve }) {
  let score = 0.5;
  if (consumerEvidence) score += 0.3;
  if (priorAttemptsToResolve) score += 0.1;

  return {
    estimatedSuccessRate: Math.min(score, 0.99),
    rationale: 'Heuristic-based estimate: evidence and resolution attempts boost success odds.'
  };
}

/**
 * Return merchant rebuttal strategy for a reason code asynchronously.
 * @param {{network: string, reasonCode: string}} opts
 * @returns {Promise<object>}
 */
export async function getRebuttalStrategy({ network, reasonCode }) {
  const strat = (rebuttalDB[network] || {})[reasonCode];
  if (!strat) {
    throw new Error(`⚠️ No rebuttal strategy for ${network}/${reasonCode}`);
  }
  return strat;
}

/**
 * Generate a CFPB complaint summary for escalation asynchronously.
 * @param {{network: string, issuer: string, transaction: {date: string, amount: number, merchant: string}, summary: string}} opts
 * @returns {Promise<string>}
 */
export async function generateCfpbComplaintSummary({ network, issuer, transaction, summary }) {
  return (
    `Complaint Summary:\n\n` +
    `On ${transaction.date}, a \$${transaction.amount} charge at ${transaction.merchant} was disputed but unresolved.\n\n` +
    `Details: ${summary}\nIssuer: ${issuer}\nNetwork: ${network}`
  );
}

/**
 * Generate and save a PDF dispute letter asynchronously.
 * @param {string} letterHtml
 * @returns {Promise<string>} URL path to download
 */
export async function downloadDisputeLetter(letterHtml) {
  const html = `<html><head><meta charset="utf-8"><title>Dispute Letter</title></head><body>${letterHtml}</body></html>`;
  const buffer = await new Promise((resolve, reject) => {
    pdf.create(html, { format: 'Letter' }).toBuffer((err, buf) => err ? reject(err) : resolve(buf));
  });

  const filename = `dispute-letter-${Date.now()}.pdf`;
  const filePath = path.join(DOWNLOADS_DIR, filename);
  fs.writeFileSync(filePath, buffer);

  // This path is served by your static middleware
  return `/downloads/${filename}`;
}