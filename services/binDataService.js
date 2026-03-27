import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_BINS_FILE = path.join(__dirname, '..', 'mock-data', 'bins.json');
const DEFAULT_BIN_CSV_FILE = path.join(__dirname, '..', 'mock-data', 'bin-list.csv');

let binMapCache = null;
let csvLookupCache = new Map();

function getBinsFilePath() {
  return process.env.BINS_FILE_PATH || DEFAULT_BINS_FILE;
}

function getBinCsvFilePath() {
  return process.env.BIN_LIST_CSV_PATH || DEFAULT_BIN_CSV_FILE;
}

export function resetBinDataForTesting() {
  binMapCache = null;
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

export function getBinDataSummary() {
  const binMap = getBinMap();
  return {
    count: binMap.size,
    source: binMap.size > 0 ? 'bins.json' : (fs.existsSync(getBinCsvFilePath()) ? 'bin-list.csv-fallback' : 'none')
  };
}

export async function getBinMetadata(bin) {
  const normalizedBin = String(bin || '').trim();
  if (!/^\d{6}$/.test(normalizedBin)) {
    return null;
  }

  const fromJson = getBinMap().get(normalizedBin);
  if (fromJson) {
    return fromJson;
  }

  return findBinInCsv(normalizedBin);
}
