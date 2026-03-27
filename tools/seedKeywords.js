// tools/seedKeywords.js
import fs from 'fs';
import path from 'path';

const filepath = path.resolve('./mock-data/reasonDetails.json');
const raw = fs.readFileSync(filepath, 'utf-8');
const data = JSON.parse(raw);

// Helper: check if string contains any keywords
const matches = (text, keywords) => {
  return keywords.some(k => text.toLowerCase().includes(k));
};

// Master keyword seed list
const keywordMap = [
  {
    match: ['fraud', 'unauthorized', 'not present'],
    keywords: ['unauthorized', 'stolen card', 'I didn’t do this', 'fraudulent charge']
  },
  {
    match: ['not received', 'non-receipt', 'not delivered', 'missing', 'not provided'],
    keywords: ['never got it', 'missing', 'didn’t arrive', 'didn’t receive item', 'not delivered']
  },
  {
    match: ['duplicate', 'double', 'processed twice'],
    keywords: ['charged twice', 'billed two times', 'duplicate transaction']
  },
  {
    match: ['credit not processed', 'refund not issued'],
    keywords: ['no refund', 'didn’t get my credit', 'refund not posted']
  },
  {
    match: ['not as described', 'misrepresentation', 'wrong item'],
    keywords: ['not as described', 'wrong item', 'not what I ordered']
  },
  {
    match: ['services canceled', 'subscription', 'recurring'],
    keywords: ['charged after canceling', 'subscription billed again', 'recurring charge']
  },
  {
    match: ['authorization', 'declined', 'no auth'],
    keywords: ['no authorization', 'declined but charged', 'forced transaction']
  },
  {
    match: ['expired card'],
    keywords: ['card expired', 'used expired card']
  }
];

let filled = 0;

for (const network in data) {
  for (const code in data[network]) {
    const entry = data[network][code];
    if (!Array.isArray(entry.matchKeywords) || entry.matchKeywords.length > 0) continue;

    const text = (entry.title + ' ' + entry.description).toLowerCase();
    for (const map of keywordMap) {
      if (matches(text, map.match)) {
        entry.matchKeywords = map.keywords;
        filled++;
        break;
      }
    }
  }
}

fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
console.log(`✅ Added matchKeywords to ${filled} reason codes.`);