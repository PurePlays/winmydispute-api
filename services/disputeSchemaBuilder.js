function normalizeIssuerKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeNetwork(value = '') {
  return String(value || '').trim().toLowerCase();
}

export function buildDisputeSchema({
  reasonScenarios = [],
  reasonDetails = {},
  rebuttalStrategies = {},
  issuers = [],
  issuerOperationalProfiles = {},
  reasonLabeledExamples = {},
  bins = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const scenarioEntries = Array.isArray(reasonScenarios)
    ? reasonScenarios
        .filter(entry => entry?.network && entry?.scenarioPattern && entry?.reasonCode)
        .map(entry => ({
          network: normalizeNetwork(entry.network),
          scenarioPattern: String(entry.scenarioPattern).trim(),
          reasonCode: String(entry.reasonCode).trim()
        }))
    : [];

  const networks = {};
  for (const [network, reasonCodes] of Object.entries(reasonDetails || {})) {
    const normalizedNetwork = normalizeNetwork(network);
    if (!normalizedNetwork) {
      continue;
    }

    networks[normalizedNetwork] = { reasonCodes: {} };

    for (const [reasonCode, detailNode] of Object.entries(reasonCodes || {})) {
      const strategyNode = rebuttalStrategies?.[normalizedNetwork]?.[reasonCode] || {};
      const labeledExamples = reasonLabeledExamples?.[normalizedNetwork]?.[reasonCode] || [];
      networks[normalizedNetwork].reasonCodes[reasonCode] = {
        title: detailNode?.title || null,
        description: detailNode?.description || null,
        category: detailNode?.category || null,
        timeLimitIssuer: detailNode?.timeLimitIssuer || null,
        timeLimitAcquirer: detailNode?.timeLimitAcquirer || null,
        maxDisputeWindow: detailNode?.timeLimitIssuer || null,
        typicalCauses: Array.isArray(detailNode?.typicalCauses) ? detailNode.typicalCauses : [],
        preventionSteps: Array.isArray(detailNode?.preventionSteps) ? detailNode.preventionSteps : [],
        evidenceRequirements: Array.isArray(detailNode?.evidenceRequirements)
          ? detailNode.evidenceRequirements
          : Array.isArray(strategyNode?.evidenceToFocusOn)
            ? strategyNode.evidenceToFocusOn
            : [],
        commonMerchantRebuttals: Array.isArray(strategyNode?.commonMerchantRebuttals)
          ? strategyNode.commonMerchantRebuttals
          : [],
        strategyTips: Array.isArray(strategyNode?.strategyTips)
          ? strategyNode.strategyTips
          : Array.isArray(detailNode?.strategyTips)
            ? detailNode.strategyTips
            : [],
        evidenceToFocusOn: Array.isArray(strategyNode?.evidenceToFocusOn)
          ? strategyNode.evidenceToFocusOn
          : [],
        customerStrategy: strategyNode?.customerStrategy || null,
        labeledExamples: Array.isArray(labeledExamples) ? labeledExamples : []
      };
    }
  }

  const issuerMap = {};
  for (const issuer of issuers || []) {
    const key = normalizeIssuerKey(issuer?.issuer);
    if (!key) {
      continue;
    }

    const operationalProfile = issuerOperationalProfiles?.[key] || {};
    issuerMap[key] = {
      name: issuer.issuer,
      contact: {
        phoneSupport: null,
        fax: null,
        uploadPortal: null,
        mailingAddress: null,
        submissionNotes: [],
        ...issuer.contact,
        ...operationalProfile
      }
    };
  }

  return {
    schemaVersion: String(generatedAt).slice(0, 10),
    generatedAt,
    scenarios: scenarioEntries,
    networks,
    issuers: issuerMap,
    bins: bins && typeof bins === 'object' ? bins : {}
  };
}
