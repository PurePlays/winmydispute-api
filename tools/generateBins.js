import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { createReadStream } from 'fs';
import { fileURLToPath } from 'url';
import { normalizeBinRecord } from '../services/binDataService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'mock-data');
const CSV_FILE = path.join(DATA_DIR, 'bin-list.csv');
const OUTPUT_FILE = path.join(DATA_DIR, 'bins.json');
const SUPPORTED_NETWORKS = new Set(['visa', 'mastercard', 'amex', 'discover']);

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

async function main() {
  const countryFilter = String(process.env.BIN_COUNTRY_FILTER || 'US').trim().toUpperCase() || null;
  const records = {};
  let headers = null;
  let sourceRows = 0;

  const reader = readline.createInterface({
    input: createReadStream(CSV_FILE, 'utf8'),
    crlfDelay: Infinity
  });

  for await (const line of reader) {
    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }

    sourceRows += 1;
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    const record = normalizeBinRecord(row);

    if (!record || !SUPPORTED_NETWORKS.has(record.network)) {
      continue;
    }

    if (countryFilter && record.country !== countryFilter) {
      continue;
    }

    records[record.bin] = record;
  }

  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(records, null, 2)}\n`, 'utf8');

  console.log(`Generated bins.json with ${Object.keys(records).length} supported-network BINs from ${sourceRows} CSV rows${countryFilter ? ` for ${countryFilter}` : ''}.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
