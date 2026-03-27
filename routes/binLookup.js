import express from 'express';
import asyncHandler from '../services/asyncHandler.js';
import { resolveBinToIssuer } from '../services/disputeService.js';

const router = express.Router();

router.get('/api/v1/lookup-bin/:bin', asyncHandler(async (req, res) => {
  const { bin } = req.params;
  if (!/^\d{6}$/.test(bin)) {
    return res.status(400).json({
      error: 'Invalid BIN. Must be 6 digits.',
      requestId: req.requestId || null
    });
  }

  const match = await resolveBinToIssuer(bin);
  if (!match?.network && !match?.issuer) {
    return res.status(404).json({
      error: 'BIN not found.',
      requestId: req.requestId || null
    });
  }

  return res.status(200).json(match);
}));

export default router;
