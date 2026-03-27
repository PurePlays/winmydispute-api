import { getDatabase, resetDatabaseForTesting } from './databaseService.js';

function normalizeText(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function normalizeOutcomeRecord(input = {}) {
  const outcome = normalizeText(input.outcome);
  if (!outcome || !['won', 'lost', 'partial', 'reversed', 'denied'].includes(outcome)) {
    return null;
  }

  return {
    reasonCode: input.reasonCode ? String(input.reasonCode).trim() : null,
    network: normalizeText(input.network),
    issuer: input.issuer ? String(input.issuer).trim() : null,
    merchantVertical: normalizeText(input.merchantVertical),
    merchantType: input.merchantType ? String(input.merchantType).trim() : null,
    outcome,
    amount: Number.isFinite(Number(input.amount)) ? Number(input.amount) : null,
    notes: input.notes ? String(input.notes).trim() : null,
    createdAt: new Date().toISOString()
  };
}

function mapOutcomeRow(row) {
  return {
    reasonCode: row.reason_code,
    network: row.network,
    issuer: row.issuer,
    merchantVertical: row.merchant_vertical,
    merchantType: row.merchant_type,
    outcome: row.outcome,
    amount: row.amount,
    notes: row.notes,
    createdAt: row.created_at
  };
}

export function resetOutcomeFeedbackForTesting() {
  resetDatabaseForTesting();
}

export async function loadOutcomeFeedback() {
  const rows = getDatabase()
    .prepare(`
      SELECT reason_code, network, issuer, merchant_vertical, merchant_type, outcome, amount, notes, created_at
      FROM outcome_feedback
      ORDER BY created_at ASC, id ASC
    `)
    .all();

  return rows.map(mapOutcomeRow);
}

export async function recordOutcomeFeedback(input = {}) {
  const record = normalizeOutcomeRecord(input);
  if (!record) {
    throw new Error('Outcome feedback must include a supported outcome value.');
  }

  getDatabase().prepare(`
    INSERT INTO outcome_feedback (
      reason_code, network, issuer, merchant_vertical, merchant_type, outcome, amount, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.reasonCode,
    record.network,
    record.issuer,
    record.merchantVertical,
    record.merchantType,
    record.outcome,
    record.amount,
    record.notes,
    record.createdAt
  );

  return record;
}

export async function summarizeOutcomeFeedback({ network, reasonCode, issuer, merchantVertical } = {}) {
  const normalizedNetwork = normalizeText(network);
  const normalizedReasonCode = reasonCode ? String(reasonCode).trim() : null;
  const normalizedIssuer = issuer ? String(issuer).trim().toLowerCase() : null;
  const normalizedVertical = normalizeText(merchantVertical);

  const rows = getDatabase()
    .prepare(`
      SELECT outcome, issuer, network, reason_code, merchant_vertical
      FROM outcome_feedback
      WHERE (? IS NULL OR network = ?)
        AND (? IS NULL OR reason_code = ?)
        AND (? IS NULL OR lower(issuer) = ?)
        AND (? IS NULL OR merchant_vertical = ?)
    `)
    .all(
      normalizedNetwork, normalizedNetwork,
      normalizedReasonCode, normalizedReasonCode,
      normalizedIssuer, normalizedIssuer,
      normalizedVertical, normalizedVertical
    );

  const winLike = rows.filter(row => ['won', 'reversed', 'partial'].includes(row.outcome)).length;
  const sampleSize = rows.length;
  const winRate = sampleSize > 0 ? Number((winLike / sampleSize).toFixed(2)) : null;

  return {
    sampleSize,
    winRate,
    hasEnoughData: sampleSize >= 5
  };
}
