import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBinDataSummary, getBinMetadata as getBinMetadataFromStore } from './binDataService.js';
import { buildDisputeSchema } from './disputeSchemaBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'mock-data');
const SCHEMA_FILE = path.join(__dirname, '..', 'mock-data', 'disputeSchema.json');
const NETWORKS = ['visa', 'mastercard', 'amex', 'discover'];
const TEXT_REPLACEMENTS = [
  [/\bunauthorised\b/g, 'unauthorized'],
  [/\bunathorized\b/g, 'unauthorized'],
  [/\bunauthorizd\b/g, 'unauthorized'],
  [/\bcancelled\b/g, 'canceled'],
  [/\bcancled\b/g, 'canceled'],
  [/\bcancld\b/g, 'canceled'],
  [/\bcancelation\b/g, 'cancellation'],
  [/\bsubcription\b/g, 'subscription'],
  [/\bsubscrption\b/g, 'subscription'],
  [/\bsubscripton\b/g, 'subscription'],
  [/\bsubscribtion\b/g, 'subscription'],
  [/\brenewel\b/g, 'renewal'],
  [/\brecieved\b/g, 'received'],
  [/\brecive?d\b/g, 'received'],
  [/\bdelievered\b/g, 'delivered'],
  [/\bdeliverd\b/g, 'delivered'],
  [/\bchargd\b/g, 'charged'],
  [/\bdidnt\b/g, 'did not'],
  [/\bwasnt\b/g, 'was not'],
  [/\bcouldnt\b/g, 'could not'],
  [/\bauto[\s-]?renew(?:al)?\b/g, 'recurring billing'],
  [/\bdouble[\s-]?charged?\b/g, 'duplicate charge']
];

let schemaCache = null;

function readJsonFileSync(filename, fallback) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, filename), 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function buildSchemaFromLegacyFiles() {
  return buildDisputeSchema({
    reasonScenarios: readJsonFileSync('reasonScenarios.json', []),
    reasonDetails: readJsonFileSync('reasonDetails.json', {}),
    rebuttalStrategies: readJsonFileSync('rebuttalStrategies.json', {}),
    issuers: readJsonFileSync('issuers.json', []),
    issuerOperationalProfiles: readJsonFileSync('issuerOperationalProfiles.json', {}),
    reasonLabeledExamples: readJsonFileSync('reasonLabeledExamples.json', {}),
    generatedAt: new Date().toISOString()
  });
}

function readSchemaFromDisk() {
  try {
    const raw = fs.readFileSync(SCHEMA_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn(`⚠️ Failed to load disputeSchema.json: ${error.message}. Falling back to legacy mock-data sources.`);
    return buildSchemaFromLegacyFiles();
  }
}

export function invalidateDisputeSchemaCache() {
  schemaCache = null;
}

export function loadDisputeSchema() {
  if (!schemaCache) {
    schemaCache = readSchemaFromDisk();
  }

  return schemaCache;
}

export function normalizeNetwork(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return NETWORKS.includes(normalized) ? normalized : null;
}

export function normalizeIssuerKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function normalizeScenarioText(value = '') {
  let normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\b\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}\b/g, ' date ')
    .replace(/\$?\d[\d,\s]*(?:[.,]\d{2})?\b/g, ' amount ')
    .replace(/[’']/g, '')
    .replace(/[_-]+/g, ' ');

  for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getScenarioTerms(text) {
  return normalizeScenarioText(text).split(/\W+/).filter(Boolean);
}

function scoreTextByTerms(source, query) {
  const normalizedSource = normalizeScenarioText(source);
  const queryTerms = getScenarioTerms(query);

  if (!normalizedSource || queryTerms.length === 0) {
    return 0;
  }

  return queryTerms.reduce((score, term) => (
    normalizedSource.includes(term) ? score + term.length : score
  ), 0);
}

function scoreScenarioPattern(pattern, scenario) {
  const normalizedPattern = normalizeScenarioText(pattern);
  const normalizedScenario = normalizeScenarioText(scenario);

  if (!normalizedPattern || !normalizedScenario) {
    return 0;
  }

  if (normalizedScenario.includes(normalizedPattern)) {
    return normalizedPattern.split(/\s+/).join('').length + 12;
  }

  return getScenarioTerms(normalizedPattern).reduce((score, term) => (
    normalizedScenario.includes(term) ? score + term.length : score
  ), 0);
}

function buildReasonSearchText(reasonNode = {}) {
  return [
    reasonNode.title,
    reasonNode.description,
    reasonNode.customerStrategy,
    ...(reasonNode.typicalCauses || []),
    ...(reasonNode.preventionSteps || []),
    ...(reasonNode.labeledExamples || []),
    ...(reasonNode.strategyTips || []),
    ...(reasonNode.commonMerchantRebuttals || []),
    ...(reasonNode.evidenceToFocusOn || []),
    ...(reasonNode.evidenceRequirements || [])
  ].filter(Boolean).join(' ');
}

export function getSchemaSummary() {
  const schema = loadDisputeSchema();
  const networks = Object.keys(schema.networks || {});
  const reasonCodeCount = networks.reduce((count, network) => (
    count + Object.keys(schema.networks?.[network]?.reasonCodes || {}).length
  ), 0);
  const binSummary = getBinDataSummary();

  return {
    schemaVersion: schema.schemaVersion || 'unknown',
    generatedAt: schema.generatedAt || null,
    networks,
    scenarioCount: Array.isArray(schema.scenarios) ? schema.scenarios.length : 0,
    reasonCodeCount,
    issuerCount: Object.keys(schema.issuers || {}).length,
    binCount: binSummary.count,
    binDataSource: binSummary.source
  };
}

export function getSupportedNetworks() {
  return Object.keys(loadDisputeSchema().networks || {});
}

export async function getBinMetadata(bin) {
  return getBinMetadataFromStore(bin);
}

export function getIssuerContact(name) {
  const schema = loadDisputeSchema();
  const key = normalizeIssuerKey(name);
  return schema.issuers?.[key]?.contact || null;
}

export function getIssuerRecord(name) {
  const schema = loadDisputeSchema();
  const key = normalizeIssuerKey(name);
  return schema.issuers?.[key] || null;
}

export function getReasonNode(network, code) {
  const schema = loadDisputeSchema();
  const normalizedNetwork = normalizeNetwork(network);
  if (!normalizedNetwork || !code) {
    return null;
  }

  const reason = schema.networks?.[normalizedNetwork]?.reasonCodes?.[String(code).trim()] || null;
  if (!reason) {
    return null;
  }

  return {
    reasonCode: String(code).trim(),
    network: normalizedNetwork,
    ...reason
  };
}

export function getRebuttalStrategy(network, code) {
  const reasonNode = getReasonNode(network, code);
  if (!reasonNode) {
    return null;
  }

  return {
    network: reasonNode.network,
    code: reasonNode.reasonCode,
    commonMerchantRebuttals: Array.isArray(reasonNode.commonMerchantRebuttals)
      ? reasonNode.commonMerchantRebuttals
      : [],
    strategyTips: Array.isArray(reasonNode.strategyTips)
      ? reasonNode.strategyTips
      : [],
    evidenceToFocusOn: Array.isArray(reasonNode.evidenceToFocusOn)
      ? reasonNode.evidenceToFocusOn
      : [],
    customerStrategy: reasonNode.customerStrategy || ''
  };
}

export function lookupReasonCodeByScenario(network, scenario) {
  const schema = loadDisputeSchema();
  const normalizedNetwork = normalizeNetwork(network);
  const scenarioEntries = (schema.scenarios || []).filter(entry => (
    !normalizedNetwork || entry.network === normalizedNetwork
  ));

  const candidateNetworks = normalizedNetwork
    ? [normalizedNetwork]
    : Object.keys(schema.networks || {});

  let bestCandidate = null;
  let bestScore = 0;

  for (const candidateNetwork of candidateNetworks) {
    const reasons = schema.networks?.[candidateNetwork]?.reasonCodes || {};
    for (const [reasonCode, reasonNode] of Object.entries(reasons)) {
      const scenarioScores = scenarioEntries
        .filter(entry => entry.network === candidateNetwork && entry.reasonCode === reasonCode)
        .map(entry => scoreScenarioPattern(entry.scenarioPattern, scenario));

      const scenarioScore = scenarioScores.length > 0 ? Math.max(...scenarioScores) : 0;
      const textScore = scoreTextByTerms(buildReasonSearchText(reasonNode), scenario);
      const combinedScore = (scenarioScore * 4) + textScore;

      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestCandidate = {
          network: candidateNetwork,
          reasonCode,
          reasonNode,
          scenarioPattern: scenarioEntries.find(entry => (
            entry.network === candidateNetwork &&
            entry.reasonCode === reasonCode &&
            scoreScenarioPattern(entry.scenarioPattern, scenario) === scenarioScore
          ))?.scenarioPattern || null
        };
      }
    }
  }

  if (!bestCandidate || bestScore <= 0) {
    return {
      reasonCode: null,
      title: null,
      description: null,
      network: normalizedNetwork,
      confidence: 36
    };
  }

  const boundedScore = Math.min(bestScore, 40);
  const confidence = Math.max(45, Math.min(95, 42 + boundedScore + (normalizedNetwork ? 6 : 0)));

  return {
    reasonCode: bestCandidate.reasonCode,
    title: bestCandidate.reasonNode?.title || null,
    description: bestCandidate.reasonNode?.description || null,
    network: bestCandidate.network,
    confidence,
    scenarioPattern: bestCandidate.scenarioPattern
  };
}

export function searchStrategies(query = '') {
  const schema = loadDisputeSchema();
  const normalizedQuery = normalizeScenarioText(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  const matches = [];
  for (const network of Object.keys(schema.networks || {})) {
    for (const [code, reasonNode] of Object.entries(schema.networks?.[network]?.reasonCodes || {})) {
      const haystack = [
        reasonNode.title,
        reasonNode.description,
        reasonNode.customerStrategy,
        ...(reasonNode.strategyTips || []),
        ...(reasonNode.commonMerchantRebuttals || []),
        ...(reasonNode.evidenceToFocusOn || [])
      ].join(' ').toLowerCase();

      if (haystack.includes(normalizedQuery)) {
        matches.push({
          network,
          code,
          title: reasonNode.title || 'Strategy match',
          strategy: getRebuttalStrategy(network, code)
        });
      }
    }
  }

  return matches.slice(0, 10);
}
