import {
  getReasonNode,
  getSupportedNetworks,
  loadDisputeSchema,
  lookupReasonCodeByScenario as lookupFromSchema,
  normalizeNetwork
} from './disputeSchemaService.js';

function normalize(value = '') {
  return String(value || '').trim().toLowerCase();
}

function scoreTextMatch(source, query) {
  const sourceText = normalize(source);
  const queryText = normalize(query);
  if (!queryText) return 0;
  if (sourceText.includes(queryText)) return queryText.length + 5;

  const queryTerms = queryText.split(/\W+/).filter(Boolean);
  return queryTerms.reduce((score, term) => (sourceText.includes(term) ? score + term.length : score), 0);
}

export function getReasonDetails(network, code) {
  const reason = getReasonNode(network, code);
  if (!reason) {
    return {
      reasonCode: code,
      title: null,
      description: null,
      evidenceRequirements: [],
      strategyTips: [],
      commonMerchantRebuttals: [],
      evidenceToFocusOn: [],
      customerStrategy: null
    };
  }

  return reason;
}

export function lookupReasonCodeByScenario(network, scenario) {
  const match = lookupFromSchema(network, scenario);
  if (!match.reasonCode) {
    return {
      reasonCode: null,
      title: null,
      description: null,
      evidenceRequirements: [],
      strategyTips: [],
      network: normalizeNetwork(network)
    };
  }

  const reason = getReasonDetails(match.network, match.reasonCode);
  return {
    reasonCode: match.reasonCode,
    title: reason.title,
    description: reason.description,
    evidenceRequirements: reason.evidenceRequirements || [],
    strategyTips: reason.strategyTips || [],
    network: match.network,
    confidence: match.confidence
  };
}

export function findReasonByKeyword(network, keyword) {
  const normalizedNetwork = normalizeNetwork(network);
  if (!normalizedNetwork) {
    return [];
  }

  const reasonCodes = loadDisputeSchema().networks?.[normalizedNetwork]?.reasonCodes || {};
  const normalizedKeyword = normalize(keyword);

  return Object.entries(reasonCodes)
    .filter(([, item]) => {
      const haystack = [
        item.title,
        item.description,
        item.customerStrategy,
        ...(item.strategyTips || []),
        ...(item.commonMerchantRebuttals || [])
      ].join(' ');
      return normalize(haystack).includes(normalizedKeyword);
    })
    .map(([reasonCode, item]) => ({
      reasonCode,
      title: item.title,
      description: item.description,
      evidenceRequirements: item.evidenceRequirements || [],
      strategyTips: item.strategyTips || []
    }));
}

export function getAllReasonCodesForNetwork(network) {
  const normalizedNetwork = normalizeNetwork(network);
  if (!normalizedNetwork) {
    return {};
  }

  return loadDisputeSchema().networks?.[normalizedNetwork]?.reasonCodes || {};
}

export function getEvidenceRequirements(network, code) {
  const { evidenceRequirements } = getReasonDetails(network, code);
  return Array.isArray(evidenceRequirements) ? evidenceRequirements : [];
}

export function matchReasonByKeywordSet(network, keywords = []) {
  const normalizedNetwork = normalizeNetwork(network);
  const reasonCodes = normalizedNetwork
    ? loadDisputeSchema().networks?.[normalizedNetwork]?.reasonCodes || {}
    : {};

  const query = keywords.join(' ').trim();
  return Object.entries(reasonCodes)
    .map(([reasonCode, item]) => ({
      reasonCode,
      item,
      score: scoreTextMatch([
        item.title,
        item.description,
        item.customerStrategy,
        ...(item.strategyTips || []),
        ...(item.evidenceToFocusOn || [])
      ].join(' '), query)
    }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .map(({ reasonCode, item }) => ({ reasonCode, ...item }));
}

export function getSupportedReasonNetworks() {
  return getSupportedNetworks();
}
