const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const redis = require('redis');
const { matchReasonByKeywordSet } = require('../services/reasonService');

const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    tls: process.env.REDIS_TLS === 'true'
  },
  password: process.env.REDIS_PASSWORD || undefined
});

redisClient.connect().catch(console.error);

router.post('/api/v1/intake', async (req, res) => {
  if (!redisClient.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }

  const intakeData = req.body;

  if (!intakeData || typeof intakeData !== 'object' || Array.isArray(intakeData)) {
    return res.status(400).json({ error: 'Invalid intake format' });
  }

  try {
    const keywords = (intakeData.description || '')
      .split(/\W+/)
      .filter(w => w.length > 2); // basic keyword split

    const network = intakeData.network || 'visa';
    const matches = matchReasonByKeywordSet(network, keywords);

    intakeData.recommendedReasons = matches.slice(0, 3); // keep top 3 matches

    const id = `intake:${crypto.randomUUID()}`;
    await redisClient.set(id, JSON.stringify(intakeData));
    res.status(201).json({ message: 'Intake data saved', id, recommendedReasons: intakeData.recommendedReasons });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save intake data' });
  }
});

router.get('/api/v1/intake/:id', async (req, res) => {
  if (!redisClient.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }

  const id = req.params.id;

  try {
    const data = await redisClient.get(id);
    if (data) {
      res.json(JSON.parse(data));
    } else {
      res.status(404).json({ error: 'Intake data not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve intake data' });
  }
});

module.exports = router;

# Redis Configuration
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false

# App Environment
NODE_ENV=development