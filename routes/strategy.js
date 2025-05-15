import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();
const strategies = JSON.parse(fs.readFileSync(path.resolve('mock-data/rebuttalStrategies.json'), 'utf-8'));

router.get('/api/v1/strategy/:network/:code', (req, res) => {
  const { network, code } = req.params;
  if (!strategies[network] || !strategies[network][code]) {
    return res.status(404).json({ error: 'Strategy not found for this reason code.' });
  }

  return res.status(200).json({
    network,
    code,
    ...strategies[network][code]
  });
});

export default router;