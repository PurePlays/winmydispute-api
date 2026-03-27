import { getDatabase, resetDatabaseForTesting } from './databaseService.js';

export const LICENSE_PRODUCT = 'winmydispute-full-dispute-kit';
export const LICENSE_AMOUNT = 699;
export const LICENSE_SOURCE_GPT = 'gpt';
export const LICENSE_STATUS_PAID = 'paid';

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function normalizeTimestamp(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function buildLicenseRecord(input, fallback = {}) {
  const email = normalizeEmail(input?.email || fallback?.email);
  if (!email) {
    return null;
  }

  return {
    email,
    status: LICENSE_STATUS_PAID,
    stripeSessionId: input?.stripeSessionId ?? fallback?.stripeSessionId ?? null,
    product: input?.product || fallback?.product || LICENSE_PRODUCT,
    amount: Number.isFinite(Number(input?.amount))
      ? Number(input.amount)
      : Number.isFinite(Number(fallback?.amount))
        ? Number(fallback.amount)
        : LICENSE_AMOUNT,
    source: input?.source || fallback?.source || LICENSE_SOURCE_GPT,
    createdAt: normalizeTimestamp(input?.createdAt || fallback?.createdAt),
    updatedAt: normalizeTimestamp(input?.updatedAt || fallback?.updatedAt)
  };
}

function mapLicenseRow(row) {
  if (!row) {
    return null;
  }

  return {
    email: row.email,
    status: row.status,
    stripeSessionId: row.stripe_session_id,
    product: row.product,
    amount: Number(row.amount),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function dedupeLicenses(records = []) {
  const deduped = new Map();
  for (const record of records) {
    const normalized = buildLicenseRecord(record, deduped.get(normalizeEmail(record?.email)));
    if (!normalized) {
      continue;
    }

    const existing = deduped.get(normalized.email);
    deduped.set(normalized.email, buildLicenseRecord({
      ...existing,
      ...normalized,
      createdAt: existing?.createdAt || normalized.createdAt,
      updatedAt: normalized.updatedAt
    }, existing));
  }

  return Array.from(deduped.values()).sort((left, right) => left.email.localeCompare(right.email));
}

export async function loadLicenses() {
  const rows = getDatabase()
    .prepare(`
      SELECT email, status, stripe_session_id, product, amount, source, created_at, updated_at
      FROM licenses
      ORDER BY email ASC
    `)
    .all();

  return rows.map(mapLicenseRow);
}

export async function saveLicenses(records) {
  const db = getDatabase();
  const normalized = dedupeLicenses(Array.isArray(records) ? records : []);
  const insert = db.prepare(`
    INSERT INTO licenses (
      email, status, stripe_session_id, product, amount, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM licenses');
    for (const record of normalized) {
      insert.run(
        record.email,
        record.status,
        record.stripeSessionId,
        record.product,
        record.amount,
        record.source,
        record.createdAt,
        record.updatedAt
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return normalized;
}

export async function getLicenseByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const row = getDatabase()
    .prepare(`
      SELECT email, status, stripe_session_id, product, amount, source, created_at, updated_at
      FROM licenses
      WHERE email = ?
    `)
    .get(normalizedEmail);

  return mapLicenseRow(row);
}

export async function isEmailLicensed(email) {
  const license = await getLicenseByEmail(email);
  return license?.status === LICENSE_STATUS_PAID;
}

export async function upsertLicense(input) {
  const normalizedEmail = normalizeEmail(input?.email);
  if (!normalizedEmail) {
    throw new Error('Cannot upsert license without an email.');
  }

  const db = getDatabase();
  const existingRow = db.prepare(`
    SELECT email, status, stripe_session_id, product, amount, source, created_at, updated_at
    FROM licenses
    WHERE email = ? OR (? IS NOT NULL AND stripe_session_id = ?)
    LIMIT 1
  `).get(normalizedEmail, input?.stripeSessionId ?? null, input?.stripeSessionId ?? null);
  const existing = mapLicenseRow(existingRow);

  const nextRecord = buildLicenseRecord({
    ...existing,
    ...input,
    email: normalizedEmail,
    status: LICENSE_STATUS_PAID,
    updatedAt: new Date().toISOString()
  }, existing);

  db.prepare(`
    INSERT INTO licenses (
      email, status, stripe_session_id, product, amount, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      status = excluded.status,
      stripe_session_id = excluded.stripe_session_id,
      product = excluded.product,
      amount = excluded.amount,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run(
    nextRecord.email,
    nextRecord.status,
    nextRecord.stripeSessionId,
    nextRecord.product,
    nextRecord.amount,
    nextRecord.source,
    nextRecord.createdAt,
    nextRecord.updatedAt
  );

  return nextRecord;
}

export function resetLicenseStoreForTesting() {
  resetDatabaseForTesting();
}
