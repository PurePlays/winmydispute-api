// enhanceReasonData.js
import fs from 'fs';
import path from 'path';

const filepath = path.resolve('./mock-data/reasonDetails.json');
const raw = fs.readFileSync(filepath, 'utf-8');
const data = JSON.parse(raw);

const extractDays = (val) => {
  const match = typeof val === 'string' && val.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
};

for (const network in data) {
  for (const code in data[network]) {
    const entry = data[network][code];

    const issuerDays = extractDays(entry.timeLimitIssuer);
    const acquirerDays = extractDays(entry.timeLimitAcquirer);

    if (issuerDays !== undefined) entry.timeLimitIssuerDays = issuerDays;
    if (acquirerDays !== undefined) entry.timeLimitAcquirerDays = acquirerDays;

    if (!entry.matchKeywords) {
      entry.matchKeywords = [];
    }
  }
}

fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
console.log('✅ Enhanced reasonDetails.json with day values and matchKeywords[]');