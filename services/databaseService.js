import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATABASE_FILE = path.join(__dirname, '..', 'mock-data', 'app.sqlite');
const DEFAULT_LICENSES_FILE = path.join(__dirname, '..', 'mock-data', 'licenses.json');
const DEFAULT_LEGACY_PAID_USERS_FILE = path.join(__dirname, '..', 'paidUsers.json');
const DEFAULT_OUTCOME_FILE = path.join(__dirname, '..', 'mock-data', 'outcomeFeedback.json');
const DEFAULT_CASES_FILE = path.join(__dirname, '..', 'mock-data', 'caseFiles.json');
const DEFAULT_CASE_STORAGE_DIR = path.join(__dirname, '..', 'mock-data', 'case-files');

let database;

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeEmail(email = '') {
  return normalizeText(email).toLowerCase();
}

function parseJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = null) {
  return JSON.stringify(value ?? fallback ?? null);
}

function getDatabaseFilePath() {
  return process.env.DATABASE_FILE_PATH || DEFAULT_DATABASE_FILE;
}

function getLicensesFilePath() {
  return process.env.LICENSES_FILE_PATH || DEFAULT_LICENSES_FILE;
}

function getLegacyPaidUsersFilePath() {
  return process.env.LEGACY_PAID_USERS_FILE_PATH || DEFAULT_LEGACY_PAID_USERS_FILE;
}

function getOutcomeFilePath() {
  return process.env.OUTCOME_FEEDBACK_FILE_PATH || DEFAULT_OUTCOME_FILE;
}

function getCasesFilePath() {
  return process.env.CASE_FILES_FILE_PATH || DEFAULT_CASES_FILE;
}

function getCaseStorageDir() {
  return process.env.CASE_FILE_STORAGE_DIR || DEFAULT_CASE_STORAGE_DIR;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licenses (
      email TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      stripe_session_id TEXT UNIQUE,
      product TEXT NOT NULL,
      amount INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cases (
      case_id TEXT PRIMARY KEY,
      natural_key TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      latest_stage TEXT NOT NULL,
      version_count INTEGER NOT NULL DEFAULT 0,
      merchant_name TEXT,
      issuer TEXT,
      network TEXT,
      reason_code TEXT,
      confidence INTEGER,
      merchant_vertical TEXT,
      latest_artifact_file_ids_json TEXT NOT NULL DEFAULT '[]',
      latest_artifact_formats_json TEXT NOT NULL DEFAULT '[]',
      latest_artifact_urls_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_cases_email ON cases(email);
    CREATE INDEX IF NOT EXISTS idx_cases_natural_key ON cases(email, natural_key);

    CREATE TABLE IF NOT EXISTS case_versions (
      version_id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      stage TEXT NOT NULL,
      source TEXT NOT NULL,
      notes TEXT,
      intake_json TEXT,
      extraction_json TEXT,
      premium_json TEXT,
      artifact_json TEXT,
      artifacts_json TEXT,
      FOREIGN KEY(case_id) REFERENCES cases(case_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_case_versions_case_id ON case_versions(case_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS outcome_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reason_code TEXT,
      network TEXT,
      issuer TEXT,
      merchant_vertical TEXT,
      merchant_type TEXT,
      outcome TEXT NOT NULL,
      amount REAL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_outcome_feedback_lookup
      ON outcome_feedback(network, reason_code, issuer, merchant_vertical);

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      request_id TEXT,
      actor_type TEXT,
      actor_id TEXT,
      email TEXT,
      case_id TEXT,
      status TEXT,
      message TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_case_id ON audit_events(case_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_email ON audit_events(email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_created_at_id ON audit_events(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_email_created_at_id ON audit_events(email, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_events_case_id_created_at_id ON audit_events(case_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      email TEXT,
      case_id TEXT,
      request_id TEXT,
      input_json TEXT,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_email ON jobs(email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at_job_id ON jobs(status, created_at ASC, job_id ASC);

    CREATE TABLE IF NOT EXISTS stored_files (
      file_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      case_id TEXT,
      email TEXT,
      original_filename TEXT NOT NULL,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stored_files_case_id ON stored_files(case_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stored_files_email ON stored_files(email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cases_email_updated_at ON cases(email, updated_at DESC);

    CREATE TABLE IF NOT EXISTS bin_metadata (
      bin TEXT PRIMARY KEY,
      network TEXT,
      raw_brand TEXT,
      issuer TEXT,
      issuer_phone TEXT,
      issuer_url TEXT,
      card_type TEXT,
      card_sub_type TEXT,
      country TEXT,
      country_code3 TEXT,
      country_name TEXT,
      source_kind TEXT NOT NULL,
      loaded_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bin_metadata_network ON bin_metadata(network);

    CREATE TABLE IF NOT EXISTS bin_usage_stats (
      bin TEXT PRIMARY KEY,
      lookup_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT NOT NULL,
      FOREIGN KEY(bin) REFERENCES bin_metadata(bin) ON DELETE CASCADE
    );
  `);
}

function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
  return row?.value ?? null;
}

function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getColumnNames(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => row.name);
}

function ensureColumn(db, tableName, columnName, alterStatement) {
  const columns = getColumnNames(db, tableName);
  if (!columns.includes(columnName)) {
    db.exec(alterStatement);
  }
}

function migrateLicenses(db) {
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM licenses').get();
  if (Number(countRow?.count || 0) > 0) {
    return;
  }

  const seen = new Set();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO licenses (
      email, status, stripe_session_id, product, amount, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const rawLicenses = parseJsonFile(getLicensesFilePath(), []);
  for (const record of Array.isArray(rawLicenses) ? rawLicenses : []) {
    const email = normalizeEmail(record?.email);
    if (!email || seen.has(email)) {
      continue;
    }

    seen.add(email);
    insert.run(
      email,
      normalizeText(record?.status) || 'paid',
      record?.stripeSessionId ?? null,
      normalizeText(record?.product) || 'winmydispute-full-dispute-kit',
      Number.isFinite(Number(record?.amount)) ? Number(record.amount) : 699,
      normalizeText(record?.source) || 'gpt',
      normalizeText(record?.createdAt) || now,
      normalizeText(record?.updatedAt) || now
    );
  }

  if (seen.size > 0) {
    return;
  }

  const legacyPaidUsers = parseJsonFile(getLegacyPaidUsersFilePath(), []);
  for (const emailInput of Array.isArray(legacyPaidUsers) ? legacyPaidUsers : []) {
    const email = normalizeEmail(emailInput);
    if (!email || seen.has(email)) {
      continue;
    }

    seen.add(email);
    insert.run(
      email,
      'paid',
      null,
      'winmydispute-full-dispute-kit',
      699,
      'legacy-paidUsers-migration',
      now,
      now
    );
  }
}

function migrateOutcomeFeedback(db) {
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM outcome_feedback').get();
  if (Number(countRow?.count || 0) > 0) {
    return;
  }

  const records = parseJsonFile(getOutcomeFilePath(), []);
  if (!Array.isArray(records) || records.length === 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO outcome_feedback (
      reason_code, network, issuer, merchant_vertical, merchant_type, outcome, amount, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const record of records) {
    const outcome = normalizeText(record?.outcome).toLowerCase();
    if (!outcome) {
      continue;
    }

    insert.run(
      record?.reasonCode ? String(record.reasonCode).trim() : null,
      normalizeText(record?.network).toLowerCase() || null,
      normalizeText(record?.issuer) || null,
      normalizeText(record?.merchantVertical).toLowerCase() || null,
      normalizeText(record?.merchantType) || null,
      outcome,
      Number.isFinite(Number(record?.amount)) ? Number(record.amount) : null,
      normalizeText(record?.notes) || null,
      normalizeText(record?.createdAt) || new Date().toISOString()
    );
  }
}

function migrateCases(db) {
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM cases').get();
  if (Number(countRow?.count || 0) > 0) {
    return;
  }

  const caseRecords = parseJsonFile(getCasesFilePath(), []);
  if (!Array.isArray(caseRecords) || caseRecords.length === 0) {
    return;
  }

  const insertCase = db.prepare(`
    INSERT INTO cases (
      case_id, natural_key, email, created_at, updated_at, latest_stage, version_count,
      merchant_name, issuer, network, reason_code, confidence, merchant_vertical,
      latest_artifact_file_ids_json, latest_artifact_formats_json, latest_artifact_urls_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVersion = db.prepare(`
    INSERT INTO case_versions (
      version_id, case_id, created_at, stage, source, notes,
      intake_json, extraction_json, premium_json, artifact_json, artifacts_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const versionBaseDir = getCaseStorageDir();

  for (const record of caseRecords) {
    const caseId = normalizeText(record?.caseId);
    const email = normalizeEmail(record?.email);
    if (!caseId || !email) {
      continue;
    }

    insertCase.run(
      caseId,
      normalizeText(record?.naturalKey) || `${email}|${caseId}`,
      email,
      normalizeText(record?.createdAt) || new Date().toISOString(),
      normalizeText(record?.updatedAt) || new Date().toISOString(),
      normalizeText(record?.latestStage) || 'migrated',
      Number.isFinite(Number(record?.versionCount)) ? Number(record.versionCount) : 0,
      normalizeText(record?.merchantName) || null,
      normalizeText(record?.issuer) || null,
      normalizeText(record?.network).toLowerCase() || null,
      normalizeText(record?.reasonCode) || null,
      Number.isFinite(Number(record?.confidence)) ? Number(record.confidence) : null,
      normalizeText(record?.merchantVertical) || null,
      stringifyJson(record?.latestArtifactFileIds || []),
      stringifyJson(record?.latestArtifactFormats || []),
      stringifyJson(record?.latestArtifactUrls || [])
    );

    const versionsDir = path.join(versionBaseDir, caseId, 'versions');
    if (!fs.existsSync(versionsDir)) {
      continue;
    }

    const entries = fs.readdirSync(versionsDir)
      .filter(entry => entry.endsWith('.json'))
      .sort();

    for (const entry of entries) {
      const version = parseJsonFile(path.join(versionsDir, entry), null);
      if (!version?.versionId) {
        continue;
      }

      insertVersion.run(
        String(version.versionId),
        caseId,
        normalizeText(version.createdAt) || new Date().toISOString(),
        normalizeText(version.stage) || 'migrated',
        normalizeText(version.source) || 'legacy-json-migration',
        normalizeText(version.notes) || '',
        stringifyJson(version.intake),
        stringifyJson(version.extraction),
        stringifyJson(version.premium),
        stringifyJson(version.artifact),
        stringifyJson(version.artifacts || [])
      );
    }
  }
}

function runSchemaMigrations(db) {
  ensureColumn(
    db,
    'cases',
    'latest_artifact_file_ids_json',
    "ALTER TABLE cases ADD COLUMN latest_artifact_file_ids_json TEXT NOT NULL DEFAULT '[]'"
  );
}

function migrateLegacyData(db) {
  if (getMeta(db, 'legacy-json-migration-complete') === 'true') {
    return;
  }

  db.exec('BEGIN');
  try {
    migrateLicenses(db);
    migrateOutcomeFeedback(db);
    migrateCases(db);
    setMeta(db, 'legacy-json-migration-complete', 'true');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function initializeDatabase() {
  const databasePath = getDatabaseFilePath();
  ensureParentDir(databasePath);

  const db = new DatabaseSync(databasePath);
  createSchema(db);
  runSchemaMigrations(db);
  migrateLegacyData(db);
  setMeta(db, 'schema-version', '2');
  return db;
}

export function parseJsonColumn(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toJsonColumn(value, fallback = null) {
  return stringifyJson(value, fallback);
}

export function getDatabase() {
  if (!database) {
    database = initializeDatabase();
  }

  return database;
}

export function resetDatabaseForTesting() {
  if (database) {
    try {
      database.close();
    } catch {
      // Ignore close failures in test cleanup.
    }
  }
  database = null;
}
