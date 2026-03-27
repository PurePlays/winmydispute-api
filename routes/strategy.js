import express from 'express';
import verifyOpenAIBearer from '../middleware/verifyOpenAIBearer.js';
import { getRebuttalStrategy } from '../services/disputeSchemaService.js';

const router = express.Router();

router.get('/api/v1/strategy/:network/:code', verifyOpenAIBearer, (req, res) => {
  const { network, code } = req.params;
  const strategy = getRebuttalStrategy(network, code);

  if (!strategy) {
    return res.status(404).json({ error: 'Strategy not found for this reason code.' });
  }

  return res.status(200).json({
    network,
    code,
    ...strategy
  });
});

export default router;
