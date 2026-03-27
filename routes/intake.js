import express from 'express';
import crypto from 'crypto';
import { matchReasonByKeywordSet } from '../services/reasonService.js';

const router = express.Router();
const intakeStore = new Map();

let redisClient = null;
if (process.env.ENABLE_REDIS_INTAKE === 'true') {
  try {
    const redis = await import('redis');
    redisClient = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT || 6379),
        tls: process.env.REDIS_TLS === 'true'
      },
      password: process.env.REDIS_PASSWORD || undefined
    });
    redisClient.connect().catch(err => {
      console.warn('⚠️ Redis connection failed, using in-memory intake store:', err.message);
      redisClient = null;
    });
  } catch (_err) {
    console.warn('⚠️ ENABLE_REDIS_INTAKE is true but the redis package is not installed. Falling back to the in-memory intake store.');
  }
}

router.post('/api/v1/intake', express.json(), async (req, res) => {
  const intakeData = req.body;
  if (!intakeData || typeof intakeData !== 'object' || Array.isArray(intakeData)) {
    return res.status(400).json({ error: 'Invalid intake format' });
  }

  try {
    const keywords = String(intakeData.description || '')
      .split(/\W+/)
      .filter(word => word.length > 2);

    const network = String(intakeData.network || 'visa');
    const recommendedReasons = matchReasonByKeywordSet(network, keywords).slice(0, 3);
    const id = `intake:${crypto.randomUUID()}`;
    const payload = { ...intakeData, recommendedReasons };

    if (redisClient?.isOpen) {
      await redisClient.set(id, JSON.stringify(payload));
    } else {
      intakeStore.set(id, payload);
    }

    return res.status(201).json({ message: 'Intake data saved', id, recommendedReasons });
  } catch (_error) {
    return res.status(500).json({ error: 'Failed to save intake data' });
  }
});

router.get('/api/v1/intake/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (redisClient?.isOpen) {
      const data = await redisClient.get(id);
      if (!data) {
        return res.status(404).json({ error: 'Intake data not found' });
      }
      return res.json(JSON.parse(data));
    }

    const intakeData = intakeStore.get(id);
    if (!intakeData) {
      return res.status(404).json({ error: 'Intake data not found' });
    }

    return res.json(intakeData);
  } catch (_error) {
    return res.status(500).json({ error: 'Failed to retrieve intake data' });
  }
});

export default router;
