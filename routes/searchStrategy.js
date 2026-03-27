import express from 'express';
import { searchStrategies } from '../services/disputeSchemaService.js';

const router = express.Router();

router.get('/api/v1/search-strategy', async (req, res) => {
  const query = String(req.query.query || '').trim().toLowerCase();
  if (query.length < 2) {
    return res.json([]);
  }

  return res.json(searchStrategies(query));
});

export default router;
