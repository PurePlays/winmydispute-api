import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { getDatabase } from './databaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_BINS_FILE = path.join(__dirname, '..', 'mock-data', 'bins.json');
const DEFAULT_BIN_CSV_FILE = path.join(__dirname, '..', 'mock-data', 'bin-list.csv');

let binMapCache = null;
let binSummaryCache = null;
let csvLookupCache = new Map();

function getBinsFilePath() {
  return process.env.BINS_FILE_PATH || DEFAULT_BINS_FILE;
}

function getBinCsvFilePath() {
  return process.env.BIN_LIST_CSV_PATH || DEFAULT_BIN_CSV_FILE;
}

export function resetBinDataForTesting() {
  binMapCache = null;
  binSummaryCache = null;
  csvLookupCache = new Map();
}

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeBrandToNetwork(value) {
  const brand = String(value || '').trim().toLowerCase();

  switch (brand) {
    case 'visa':
      return 'visa';
    case 'mastercard':
      return 'mastercard';
    case 'american express':
    case 'amex':
      return 'amex';
    case 'discover':
      return 'discover';
    default:
      return brand || null;
  }
}

function normalizeCardType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

export function normalizeBinRecord(raw = {}) {
  const bin = String(raw.bin ?? raw.BIN ?? '').trim();
  if (!/^\d{6}$/.test(bin)) {
    return null;
  }

  const rawBrand = normalizeString(raw.rawBrand ?? raw.brand ?? raw.Brand ?? raw.network);
  return {
    bin,
    network: normalizeBrandToNetwork(rawBrand),
    rawBrand,
    issuer: normalizeString(raw.issuer ?? raw.Issuer),
    issuerPhone: normalizeString(raw.issuerPhone ?? raw.IssuerPhone),
    issuerUrl: normalizeString(raw.issuerUrl ?? raw.IssuerUrl),
    cardType: normalizeCardType(raw.cardType ?? raw.Type),
    cardSubType: normalizeString(raw.cardSubType ?? raw.Category),
    country: normalizeString(raw.country ?? raw.isoCode2),
    countryCode3: normalizeString(raw.countryCode3 ?? raw.isoCode3),
    countryName: normalizeString(raw.countryName ?? raw.CountryName)
  };
}

function parseCsvLine(line = '') {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function loadBinMapFromJson() {
  const filePath = getBinsFilePath();

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    const entries = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed || {}).map(([bin, value]) => ({ bin, ...value }));

    return new Map(
      entries
        .map(normalizeBinRecord)
        .filter(Boolean)
        .map(record => [record.bin, record])
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`⚠️ Failed to load bins.json: ${error.message}`);
    }
    return new Map();
  }
}

function getBinMap() {
  if (!binMapCache) {
    binMapCache = loadBinMapFromJson();
  }

  return binMapCache;
}

async function findBinInCsv(bin) {
  if (csvLookupCache.has(bin)) {
    return csvLookupCache.get(bin);
  }

  const csvPath = getBinCsvFilePath();
  if (!fs.existsSync(csvPath)) {
    csvLookupCache.set(bin, null);
    return null;
  }

  const stream = fs.createReadStream(csvPath, 'utf8');
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let headers = null;
  let match = null;

  try {
    for await (const line of reader) {
      if (!headers) {
        headers = parseCsvLine(line);
        continue;
      }

      const values = parseCsvLine(line);
      if (values[0] !== bin) {
        continue;
      }

      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
      match = normalizeBinRecord(row);
      break;
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  csvLookupCache.set(bin, match || null);
  return match || null;
}

function countJsonBinEntries(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const matches = raw.match(/"\d{6}"\s*:/g);
    return matches ? matches.length : 0;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`⚠️ Failed to summarize bins.json: ${error.message}`);
    }
    return 0;
  }
}

function countCsvEntries(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw
      .split(/\r?\n/g)
      .map(line => line.trim())
      .filter(Boolean);

    return lines.length > 1 ? lines.length - 1 : 0;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`⚠️ Failed to summarize BIN CSV: ${error.message}`);
    }
    return 0;
  }
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

function getBinStoreCount(db) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM bin_metadata').get();
  return Number(row?.count || 0);
}

function getSourceSignature(source) {
  try {
    const stats = fs.statSync(source.path);
    return `${source.kind}:${path.resolve(source.path)}:${stats.size}:${Math.trunc(stats.mtimeMs)}`;
  } catch {
    return null;
  }
}

function getSeedSourceLabel(kind) {
  return kind === 'csv' ? 'bin-list.csv-fallback' : 'bins.json';
}

function getSeedCandidates() {
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (kind, filePath) => {
    const resolvedPath = path.resolve(filePath);
    const key = `${kind}:${resolvedPath}`;
    if (seen.has(key) || !fs.existsSync(filePath)) {
      return;
    }
    seen.add(key);
    candidates.push({ kind, path: filePath, resolvedPath });
  };

  if (process.env.BINS_FILE_PATH) {
    pushCandidate('json', getBinsFilePath());
  }
  if (process.env.BIN_LIST_CSV_PATH) {
    pushCandidate('csv', getBinCsvFilePath());
  }

  pushCandidate('csv', getBinCsvFilePath());
  pushCandidate('json', getBinsFilePath());

  return candidates;
}

function insertBinRecord(statement, record, sourceKind, loadedAt) {
  if (!record) {
    return 0;
  }

  statement.run(
    record.bin,
    record.network,
    record.rawBrand,
    record.issuer,
    record.issuerPhone,
    record.issuerUrl,
    record.cardType,
    record.cardSubType,
    record.country,
    record.countryCode3,
    record.countryName,
    sourceKind,
    loadedAt
  );

  return 1;
}

function seedBinStoreFromJson(insertStatement, filePath, sourceKind, loadedAt) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  const entries = Array.isArray(parsed)
    ? parsed
    : Object.entries(parsed || {}).map(([bin, value]) => ({ bin, ...value }));

  let count = 0;
  for (const entry of entries) {
    count += insertBinRecord(insertStatement, normalizeBinRecord(entry), sourceKind, loadedAt);
  }
  return count;
}

async function seedBinStoreFromCsv(insertStatement, filePath, sourceKind, loadedAt) {
  const stream = fs.createReadStream(filePath, 'utf8');
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let headers = null;
  let count = 0;

  try {
    for await (const line of reader) {
      if (!headers) {
        headers = parseCsvLine(line);
        continue;
      }

      const values = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
      count += insertBinRecord(insertStatement, normalizeBinRecord(row), sourceKind, loadedAt);
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return count;
}

async function rebuildBinStore(db, source) {
  const loadedAt = new Date().toISOString();
  const insertStatement = db.prepare(`
    INSERT INTO bin_metadata (
      bin, network, raw_brand, issuer, issuer_phone, issuer_url,
      card_type, card_sub_type, country, country_code3, country_name,
      source_kind, loaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM bin_usage_stats');
    db.exec('DELETE FROM bin_metadata');

    const count = source.kind === 'json'
      ? seedBinStoreFromJson(insertStatement, source.path, source.kind, loadedAt)
      : await seedBinStoreFromCsv(insertStatement, source.path, source.kind, loadedAt);

    setMeta(db, 'bin-store-signature', source.signature);
    setMeta(db, 'bin-store-source-kind', source.kind);
    setMeta(db, 'bin-store-loaded-at', loadedAt);
    db.exec('COMMIT');
    return count;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getCurrentBinStoreSummary(db) {
  const count = getBinStoreCount(db);
  const signature = getMeta(db, 'bin-store-signature');
  const sourceKind = getMeta(db, 'bin-store-source-kind');
  if (!count || !signature || !sourceKind) {
    return null;
  }

  const activeSource = getSeedCandidates()
    .map(candidate => ({ ...candidate, signature: getSourceSignature(candidate) }))
    .find(candidate => candidate.signature === signature);

  if (!activeSource) {
    return null;
  }

  return {
    count,
    source: getSeedSourceLabel(sourceKind)
  };
}

async function ensureBinStoreReady() {
  const db = getDatabase();
  const stateCount = getBinStoreCount(db);
  const currentSignature = getMeta(db, 'bin-store-signature');
  const candidates = getSeedCandidates()
    .map(candidate => ({ ...candidate, signature: getSourceSignature(candidate) }))
    .filter(candidate => Boolean(candidate.signature));

  if (stateCount > 0 && currentSignature && candidates.some(candidate => candidate.signature === currentSignature)) {
    return db;
  }

  for (const candidate of candidates) {
    try {
      const count = await rebuildBinStore(db, candidate);
      if (count > 0) {
        return db;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to seed BIN SQLite store from ${candidate.kind}: ${error.message}`);
    }
  }

  return db;
}

function mapBinRow(row) {
  if (!row) {
    return null;
  }

  return {
    bin: row.bin,
    network: row.network,
    rawBrand: row.raw_brand,
    issuer: row.issuer,
    issuerPhone: row.issuer_phone,
    issuerUrl: row.issuer_url,
    cardType: row.card_type,
    cardSubType: row.card_sub_type,
    country: row.country,
    countryCode3: row.country_code3,
    countryName: row.country_name
  };
}

function recordBinUsage(db, bin) {
  db.prepare(`
    INSERT INTO bin_usage_stats (bin, lookup_count, last_accessed_at)
    VALUES (?, 1, ?)
    ON CONFLICT(bin) DO UPDATE SET
      lookup_count = lookup_count + 1,
      last_accessed_at = excluded.last_accessed_at
  `).run(bin, new Date().toISOString());
}

function loadBinSummary() {
  try {
    const fromDatabase = getCurrentBinStoreSummary(getDatabase());
    if (fromDatabase) {
      return fromDatabase;
    }
  } catch (error) {
    console.warn(`⚠️ Failed to read BIN SQLite summary: ${error.message}`);
  }

  const binsFilePath = getBinsFilePath();
  const jsonCount = countJsonBinEntries(binsFilePath);
  if (jsonCount > 0) {
    return {
      count: jsonCount,
      source: 'bins.json'
    };
  }

  const csvPath = getBinCsvFilePath();
  if (!fs.existsSync(csvPath)) {
    return {
      count: 0,
      source: fs.existsSync(binsFilePath) ? 'bins.json' : 'none'
    };
  }

  return {
    count: countCsvEntries(csvPath),
    source: 'bin-list.csv-fallback'
  };
}

export function getBinDataSummary() {
  if (!binSummaryCache) {
    binSummaryCache = loadBinSummary();
  }

  return {
    count: binSummaryCache.count,
    source: binSummaryCache.source
  };
}

export async function getBinMetadata(bin) {
  const normalizedBin = String(bin || '').trim();
  if (!/^\d{6}$/.test(normalizedBin)) {
    return null;
  }

  try {
    const db = await ensureBinStoreReady();
    const row = db.prepare(`
      SELECT bin, network, raw_brand, issuer, issuer_phone, issuer_url,
             card_type, card_sub_type, country, country_code3, country_name
      FROM bin_metadata
      WHERE bin = ?
    `).get(normalizedBin);

    if (row) {
      recordBinUsage(db, normalizedBin);
      return mapBinRow(row);
    }
  } catch (error) {
    console.warn(`⚠️ Failed to query BIN SQLite store: ${error.message}`);
  }

  const fromJson = getBinMap().get(normalizedBin);
  if (fromJson) {
    return fromJson;
  }

  return findBinInCsv(normalizedBin);
}
