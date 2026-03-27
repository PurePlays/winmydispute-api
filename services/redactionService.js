function normalizeText(value = '') {
  return String(value || '');
}

function maskCardLikeNumbers(value = '') {
  return normalizeText(value).replace(/\b(?:\d[ -]*?){13,19}\b/g, match => {
    const digits = match.replace(/\D/g, '');
    const last4 = digits.slice(-4);
    return `[REDACTED_CARD_${last4}]`;
  });
}

function maskLongNumbers(value = '') {
  return normalizeText(value).replace(/\b\d{8,}\b/g, '[REDACTED_NUMBER]');
}

export function redactText(value = '', mode = 'standard') {
  let redacted = normalizeText(value);
  if (!redacted || mode === 'none') {
    return redacted;
  }

  redacted = maskCardLikeNumbers(redacted)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g, '[REDACTED_PHONE]');
  redacted = maskLongNumbers(redacted);
  redacted = redacted
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way|place|pl)\b/gi, '[REDACTED_ADDRESS]')
    .replace(/\b[A-Z][a-z]+,\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, '[REDACTED_CITY_STATE_ZIP]')
    .replace(/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, '[REDACTED_STATE_ZIP]');

  if (mode === 'strict') {
    redacted = redacted
      .replace(/\b(?:apt|suite|ste|unit)\s+\w+\b/gi, '[REDACTED_UNIT]');
  }

  return redacted;
}

function redactArray(items = [], mode = 'standard') {
  return Array.isArray(items) ? items.map(item => redactText(item, mode)) : [];
}

function redactObjectValues(object = {}, mode = 'standard', fields = []) {
  const clone = { ...object };
  for (const field of fields) {
    if (field in clone) {
      clone[field] = redactText(clone[field], mode);
    }
  }
  return clone;
}

export function applyRedactionToCase({ intake, premium, mode = 'standard' } = {}) {
  if (mode === 'none') {
    return { intake, premium };
  }

  const originalName = normalizeText(intake?.cardholderName || '');
  const redactedName = mode === 'strict' ? '[REDACTED_NAME]' : redactText(intake?.cardholderName, mode);
  const redactedIntake = {
    ...intake,
    cardholderName: redactedName,
    addressLine1: '[REDACTED_ADDRESS]',
    addressLine2: redactText(intake.addressLine2, mode),
    phone: '[REDACTED_PHONE]',
    email: '[REDACTED_EMAIL]',
    description: redactText(intake.description, mode),
    evidenceSummary: redactText(intake.evidenceSummary, mode),
    evidenceItems: redactArray(intake.evidenceItems, mode),
    timelineItems: redactArray(intake.timelineItems, mode),
    merchantRebuttalConcerns: redactArray(intake.merchantRebuttalConcerns, mode),
    desiredOutcome: redactText(intake.desiredOutcome, mode)
  };

  const redactedPremium = {
    ...premium,
    letter: redactText(premium.letter, mode),
    cfpbSummary: redactText(premium.cfpbSummary, mode),
    strategySet: {
      ...premium.strategySet,
      customerStrategy: redactText(premium.strategySet?.customerStrategy, mode),
      strategyTips: redactArray(premium.strategySet?.strategyTips, mode),
      commonMerchantRebuttals: redactArray(premium.strategySet?.commonMerchantRebuttals, mode),
      evidenceToFocusOn: redactArray(premium.strategySet?.evidenceToFocusOn, mode)
    },
    evidenceChecklist: redactArray(premium.evidenceChecklist, mode),
    evidencePacket: premium.evidencePacket ? {
      ...premium.evidencePacket,
      userProvidedEvidence: redactArray(premium.evidencePacket.userProvidedEvidence, mode),
      recommendedEvidence: redactArray(premium.evidencePacket.recommendedEvidence, mode),
      timeline: redactArray(premium.evidencePacket.timeline, mode),
      rebuttalConcerns: redactArray(premium.evidencePacket.rebuttalConcerns, mode),
      evidenceFocus: redactArray(premium.evidencePacket.evidenceFocus, mode)
    } : premium.evidencePacket,
    issuerGuidance: premium.issuerGuidance ? redactObjectValues(premium.issuerGuidance, mode, [
      'mailingAddress',
      'disputeEntryPoint',
      'filingWindowNote',
      'statusTracking'
    ]) : premium.issuerGuidance,
    submissionPlan: premium.submissionPlan ? {
      ...premium.submissionPlan,
      recommendedPackageOrder: redactArray(premium.submissionPlan.recommendedPackageOrder, mode),
      steps: Array.isArray(premium.submissionPlan.steps)
        ? premium.submissionPlan.steps.map(step => ({
          ...step,
          title: redactText(step.title, mode),
          description: redactText(step.description, mode)
        }))
        : [],
      qualityChecks: redactArray(premium.submissionPlan.qualityChecks, mode)
    } : premium.submissionPlan,
    exhibitPacket: premium.exhibitPacket ? {
      ...premium.exhibitPacket,
      exhibitIndex: redactArray(premium.exhibitPacket.exhibitIndex, mode),
      exhibits: Array.isArray(premium.exhibitPacket.exhibits)
        ? premium.exhibitPacket.exhibits.map(exhibit => ({
          ...exhibit,
          title: redactText(exhibit.title, mode),
          description: redactText(exhibit.description, mode),
          filename: exhibit.filename ? redactText(exhibit.filename, mode) : exhibit.filename
        }))
        : []
    } : premium.exhibitPacket
  };

  if (mode === 'strict' && originalName) {
    const replaceName = value => String(value || '').split(originalName).join(redactedName);
    redactedPremium.letter = replaceName(redactedPremium.letter);
    redactedPremium.cfpbSummary = replaceName(redactedPremium.cfpbSummary);
  }

  return {
    intake: redactedIntake,
    premium: redactedPremium
  };
}
