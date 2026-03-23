import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Derive __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR   = path.join(__dirname, '..', 'mock-data');

// Safe asynchronous JSON loader with improved error handling
async function loadJsonAsync(filename, defaultValue = {}) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return raw ? JSON.parse(raw) : defaultValue;
  } catch (err) {
    console.warn(`⚠️ Failed to load ${filename}: ${err.message}`);
    return defaultValue;
  }
}

// Cache the reason details and scenarios on startup to prevent reloading every time
let reasonDetails = {};
let reasonScenarios = {};

function normalize(value = '') {
  return String(value).toLowerCase();
}

function simpleSimilarityScore(source, query) {
  const sourceText = normalize(source);
  const queryText = normalize(query);
  if (!queryText) return 0;
  if (sourceText.includes(queryText)) return queryText.length + 5;

  const queryTerms = queryText.split(/\W+/).filter(Boolean);
  return queryTerms.reduce((score, term) => (sourceText.includes(term) ? score + term.length : score), 0);
}

// Cache initialization for data files
async function initializeData() {
  reasonDetails = await loadJsonAsync('reasonDetails.json');
  reasonScenarios = await loadJsonAsync('reasonScenarios.json');

}

// Start initialization
initializeData();

/**
 * Get detailed information for a specific reason code under a network.
 * @param {string} network - The network name (e.g., "visa")
 * @param {string} code - The reason code (e.g., "13.1")
 * @returns {object} Reason details including evidence requirements and strategy tips
 */
export function getReasonDetails(network, code) {
  const key = String(network).toLowerCase();
  const details = (reasonDetails[key] || {})[code];

  if (!details) {
    return {
      reasonCode: code,
      title: null,
      description: null,
      evidenceRequirements: [],
      strategyTips: [],
    };
  }

  return { reasonCode: code, ...details };
}

/**
 * Lookup the best-match reason code for a given scenario description using fuzzy matching.
 * @param {string} network - The network name (e.g., "visa")
 * @param {string} scenario - The user's free-form dispute description
 * @returns {object} The best-matched reason code and associated data
 */
export function lookupReasonCodeByScenario(network, scenario) {
  const key = String(network).toLowerCase();
  
  const scenarios = Object.values(reasonScenarios);
  let bestMatch = null;
  let bestScore = 0;
  for (const item of scenarios) {
    const score = simpleSimilarityScore(`${item.scenarioPattern || ''} ${item.description || ''}`, scenario);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }
  const match = bestMatch;

  if (!match || !match.reasonCode) {
    return {
      reasonCode: null,
      title: null,
      description: null,
      evidenceRequirements: [],
      strategyTips: [],
      network: key,
    };
  }

  return { network: key, ...match };
}

/**
 * Find all reason codes that match a specific keyword in their title or description.
 * Implements fuzzy search for partial matches.
 * @param {string} network - The network name (e.g., "visa")
 * @param {string} keyword - A keyword for searching reason titles and descriptions
 * @returns {Array} List of reason codes and associated details
 */
export function findReasonByKeyword(network, keyword) {
  const key = String(network).toLowerCase();
  const items = reasonDetails[key] || {};

  const normalizedKeyword = normalize(keyword);
  return Object.values(items)
    .filter(item => normalize(item.title).includes(normalizedKeyword) || normalize(item.description).includes(normalizedKeyword))
    .map(item => ({
      reasonCode: item.reasonCode,
      title: item.title,
      description: item.description,
      evidenceRequirements: item.evidenceRequirements,
      strategyTips: item.strategyTips
  }));
}

/**
 * Get all reason codes available for a given network.
 * @param {string} network - The network name (e.g., "visa")
 * @returns {object} A map of all reason codes for the specified network
 */
export function getAllReasonCodesForNetwork(network) {
  const key = String(network).toLowerCase();
  return reasonDetails[key] || {};
}

/**
 * Retrieve the evidence requirements for a specific reason code.
 * @param {string} network - The network name (e.g., "visa")
 * @param {string} code - The reason code (e.g., "13.1")
 * @returns {Array} List of evidence requirements for the given reason code
 */
export function getEvidenceRequirements(network, code) {
  const { evidenceRequirements } = getReasonDetails(network, code);
  return Array.isArray(evidenceRequirements) ? evidenceRequirements : [];
}

/**
 * Find reason codes for a network that contain any of the given keywords in `matchKeywords`.
 * @param {string} network - Network like "visa" or "amex"
 * @param {Array<string>} keywords - User's words or phrases
 * @returns {Array} Matching reason code entries
 */
export function matchReasonByKeywordSet(network, keywords = []) {
  const key = String(network).toLowerCase();
  const items = reasonDetails[key] || {};

  return Object.entries(items)
    .filter(([code, data]) =>
      Array.isArray(data.matchKeywords) &&
      data.matchKeywords.some(k =>
        keywords.some(input =>
          input.toLowerCase().includes(k.toLowerCase()) ||
          k.toLowerCase().includes(input.toLowerCase())
        )
      )
    )
    .map(([code, data]) => ({ reasonCode: code, ...data }));
}
