import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const strategyIndexPath = path.join(__dirname, '..', 'strategyIndex.json');
const strategyDbPath = path.join(__dirname, '..', 'mock-data', 'rebuttalStrategies.json');

async function loadJson(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (_err) {
    return fallback;
  }
}

router.get('/api/v1/search-strategy', async (req, res) => {
  const query = String(req.query.query || '').trim().toLowerCase();
  if (query.length < 2) {
    return res.json([]);
  }

  const [strategyIndex, strategyDb] = await Promise.all([
    loadJson(strategyIndexPath, {}),
    loadJson(strategyDbPath, {})
  ]);

  const strategyIds = new Set();
  Object.entries(strategyIndex).forEach(([keyword, ids]) => {
    if (keyword.includes(query) && Array.isArray(ids)) {
      ids.forEach(id => strategyIds.add(id));
    }
  });

  const results = Array.from(strategyIds).map(id => {
    const [network, code] = id.split(':');
    return {
      network,
      code,
      title: strategyDb?.[network]?.[code]?.customerStrategy?.slice(0, 80) || 'Strategy match',
      strategy: strategyDb?.[network]?.[code] || null
    };
  });

  return res.json(results.slice(0, 10));
});

export default router;
