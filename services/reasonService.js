import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Fuse from 'fuse.js';  // Fuzzy search library

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

// Initialize Fuse.js fuzzy search options for scenarios
const fuseOptions = {
  includeScore: true,
  keys: ['scenarioPattern', 'description'],  // Searching on specific fields
  threshold: 0.4,  // Lower threshold for higher accuracy
};

// Cache initialization for data files
async function initializeData() {
  reasonDetails = await loadJsonAsync('reasonDetails.json');
  reasonScenarios = await loadJsonAsync('reasonScenarios.json');

  // Initialize the Fuse.js search object
  reasonScenariosFuse = new Fuse(Object.values(reasonScenarios), fuseOptions);
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
  
  // Fuzzy matching using Fuse.js
  const result = reasonScenariosFuse.search(scenario);
  const match = result[0]?.item;

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

  // Set up Fuse.js for keyword search within title and description
  const fuse = new Fuse(Object.values(items), {
    includeScore: true,
    keys: ['title', 'description'],
  });

  const result = fuse.search(keyword);

  return result.map(item => ({
    reasonCode: item.item.reasonCode,
    title: item.item.title,
    description: item.item.description,
    evidenceRequirements: item.item.evidenceRequirements,
    strategyTips: item.item.strategyTips,
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