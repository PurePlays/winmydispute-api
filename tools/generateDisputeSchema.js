import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildDisputeSchema } from '../services/disputeSchemaBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'mock-data');

async function loadJson(filename, fallback) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function main() {
  const [reasonScenarios, reasonDetails, rebuttalStrategies, issuers, issuerOperationalProfiles, reasonLabeledExamples] = await Promise.all([
    loadJson('reasonScenarios.json', []),
    loadJson('reasonDetails.json', {}),
    loadJson('rebuttalStrategies.json', {}),
    loadJson('issuers.json', []),
    loadJson('issuerOperationalProfiles.json', {}),
    loadJson('reasonLabeledExamples.json', {})
  ]);

  const schema = buildDisputeSchema({
    reasonScenarios,
    reasonDetails,
    rebuttalStrategies,
    issuers,
    issuerOperationalProfiles,
    reasonLabeledExamples,
    generatedAt: new Date().toISOString()
  });

  await fs.writeFile(
    path.join(DATA_DIR, 'disputeSchema.json'),
    `${JSON.stringify(schema, null, 2)}\n`,
    'utf8'
  );

  console.log(`Generated disputeSchema.json with ${schema.scenarios.length} scenario mappings.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
