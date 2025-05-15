import crypto from 'crypto';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yamljs';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const yamlPath = path.join(__dirname, '..', 'openapi.yaml');

// Helper function to check if the OpenAPI spec exists and load it
const loadSpec = () => {
  try {
    if (fs.existsSync(yamlPath)) {
      return YAML.load(yamlPath);
    } else {
      throw new Error('OpenAPI spec file not found');
    }
  } catch (error) {
    console.error('Error loading OpenAPI spec:', error.message);
    process.exit(1); // Exit the application if the spec is missing
  }
};

// Load the OpenAPI spec
const spec = loadSpec();

// Define routes
router.get('/api/v1/openapi.json', (req, res) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  return res.json(spec);
});

router.use('/api/v1/docs', (req, res, next) => {
  if (req.redis && !req.redis.isOpen) {
    return res.status(503).json({ error: 'Redis unavailable' });
  }
  next();
}, swaggerUi.serve, swaggerUi.setup(spec, { explorer: true }));

export default router;