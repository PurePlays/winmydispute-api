import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();
const bins = JSON.parse(fs.readFileSync(path.resolve('mock-data/bins.json'), 'utf-8'));

router.get('/api/v1/lookup-bin/:bin', (req, res) => {
  const { bin } = req.params;
  if (!/^\d{6}$/.test(bin)) {
    return res.status(400).json({ error: 'Invalid BIN. Must be 6 digits.' });
  }

  const match = bins.find(entry => entry.bin === bin);
  if (!match) {
    return res.status(404).json({ error: 'BIN not found.' });
  }

  return res.status(200).json(match);
});

export default router;