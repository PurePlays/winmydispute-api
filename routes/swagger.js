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
    return {
      openapi: '3.0.0',
      info: { title: 'WinMyDispute API', version: '1.0.0' },
      paths: {}
    };
  }
};

// Define routes
router.get('/api/v1/openapi.json', (_req, res) => {
  return res.json(loadSpec());
});

router.use('/api/v1/docs', swaggerUi.serve, (_req, res, next) => {
  const spec = loadSpec();
  return swaggerUi.setup(spec, { explorer: true })(_req, res, next);
});

export default router;
