import express from 'express';
import { getSchemaSummary } from '../services/disputeSchemaService.js';

const router = express.Router();

router.get('/api/v1/meta/schema', (_req, res) => {
  res.json(getSchemaSummary());
});

export default router;
