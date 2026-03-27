import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', 'mock-data', 'merchantVerticalStrategies.json');
const TEXT_REPLACEMENTS = [
  [/\bcancelled\b/g, 'canceled'],
  [/\bcancled\b/g, 'canceled'],
  [/\bcancld\b/g, 'canceled'],
  [/\bsubcription\b/g, 'subscription'],
  [/\bsubscrption\b/g, 'subscription'],
  [/\bsubscripton\b/g, 'subscription'],
  [/\bsubscribtion\b/g, 'subscription'],
  [/\brenewel\b/g, 'renewal'],
  [/\bchargd\b/g, 'charged'],
  [/\bauto[\s-]?renew(?:al)?\b/g, 'recurring']
];

let cache = null;

function normalizeText(value = '') {
  let normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[_-]+/g, ' ');

  for (const [pattern, replacement] of TEXT_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.replace(/\s+/g, ' ').trim();
}

function loadProfiles() {
  if (!cache) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      cache = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      cache = {};
    }
  }

  return cache;
}

export function resetMerchantVerticalCacheForTesting() {
  cache = null;
}

export function getMerchantVerticalProfile(vertical) {
  const profiles = loadProfiles();
  const key = normalizeText(vertical);
  return key ? profiles[key] || null : null;
}

export function inferMerchantVertical({ merchantVertical, merchantName, description } = {}) {
  const explicit = normalizeText(merchantVertical);
  if (explicit && getMerchantVerticalProfile(explicit)) {
    return explicit;
  }

  const profiles = loadProfiles();
  const haystack = [merchantName, description].map(normalizeText).join(' ');

  let bestVertical = null;
  let bestScore = 0;

  for (const [vertical, profile] of Object.entries(profiles)) {
    const score = (profile.keywords || []).reduce((total, keyword) => (
      haystack.includes(normalizeText(keyword)) ? total + normalizeText(keyword).length : total
    ), 0);

    if (score > bestScore) {
      bestScore = score;
      bestVertical = vertical;
    }
  }

  return bestVertical;
}
