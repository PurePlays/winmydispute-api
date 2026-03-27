import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import formidable from 'formidable';
import { PDFParse } from 'pdf-parse';
import { getStoredFilesByIds } from './fileStorageService.js';

const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_FILE_SIZE = 15 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm', '.xml', '.rtf', '.log']);
const IMAGE_MIME_PREFIX = 'image/';
const DATE_PATTERN = /\b(?:\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b/i;
const MONEY_PATTERN = /\$?\d[\d,]*(?:\.\d{2})?\b/;
const REBUTTAL_PATTERNS = [
  { pattern: /final sale|non[- ]refundable/i, label: 'Merchant may argue the purchase was final or non-refundable.' },
  { pattern: /delivered|tracking|signed/i, label: 'Merchant may rely on delivery or tracking proof.' },
  { pattern: /accessed|downloaded|login/i, label: 'Merchant may argue the service or digital product was accessed.' },
  { pattern: /terms|policy|agreed/i, label: 'Merchant may argue the customer agreed to the posted terms.' },
  { pattern: /cancellation.*not|did not cancel|not completed/i, label: 'Merchant may argue cancellation was incomplete or invalid.' },
  { pattern: /refund denied|refund refused|declined refund/i, label: 'Merchant may argue a refund was not owed under policy.' }
];

let evidenceAiClientOverride = null;

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueItems(items = []) {
  return Array.from(new Set(items.map(item => normalizeText(item)).filter(Boolean)));
}

function firstValue(value, fallback = '') {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }
  return value ?? fallback;
}

function getUploadDir() {
  return process.env.EVIDENCE_UPLOADS_DIR || path.join(os.tmpdir(), 'winmydispute-evidence');
}

function getFileExtension(filename = '') {
  return path.extname(String(filename || '')).toLowerCase();
}

function isTextLikeFile(file) {
  const mimetype = String(file.mimetype || '').toLowerCase();
  return mimetype.startsWith('text/')
    || mimetype === 'application/json'
    || mimetype === 'application/xml'
    || TEXT_EXTENSIONS.has(getFileExtension(file.originalFilename));
}

function isPdfFile(file) {
  const mimetype = String(file.mimetype || '').toLowerCase();
  return mimetype === 'application/pdf' || getFileExtension(file.originalFilename) === '.pdf';
}

function isImageFile(file) {
  const mimetype = String(file.mimetype || '').toLowerCase();
  return mimetype.startsWith(IMAGE_MIME_PREFIX);
}

function inferDocumentType({ filename, mimetype, text }) {
  const normalizedFilename = normalizeText(filename).toLowerCase();
  const normalizedMime = normalizeText(mimetype).toLowerCase();
  const normalizedText = normalizeText(text).toLowerCase();

  if (normalizedMime.startsWith('image/')) return 'screenshot';
  if (normalizedMime === 'application/pdf') return 'pdf';
  if (normalizedFilename.includes('receipt') || normalizedText.includes('receipt')) return 'receipt';
  if (normalizedFilename.includes('invoice') || normalizedText.includes('invoice')) return 'invoice';
  if (normalizedFilename.includes('email') || normalizedText.includes('from:') || normalizedText.includes('subject:')) return 'email';
  if (normalizedFilename.includes('chat') || normalizedText.includes('chat transcript')) return 'chat';
  if (normalizedFilename.includes('statement') || normalizedText.includes('statement')) return 'statement';
  if (normalizedFilename.includes('tracking') || normalizedText.includes('tracking')) return 'tracking';
  return 'supporting-document';
}

function buildHeuristicSummary(text = '', { filename, mimetype } = {}) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => normalizeText(line))
    .filter(Boolean);

  const candidateLines = lines.filter(line => (
    DATE_PATTERN.test(line)
    || MONEY_PATTERN.test(line)
    || /(cancel|refund|charge|charged|renew|merchant|delivery|tracking|invoice|receipt|statement|unauthor|dispute)/i.test(line)
  ));

  const summarySource = candidateLines.length > 0 ? candidateLines : lines;
  const summary = summarySource.slice(0, 3).join(' ');

  const timelineItems = uniqueItems(lines.filter(line => DATE_PATTERN.test(line)).slice(0, 8));
  const evidenceItems = uniqueItems((candidateLines.length > 0 ? candidateLines : lines).slice(0, 8));
  const rebuttalConcerns = uniqueItems(REBUTTAL_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label));
  const warnings = [];

  if (!summary) {
    warnings.push('The file did not contain enough readable text to summarize confidently.');
  }

  if (String(text || '').trim().length < 30) {
    warnings.push('Very little readable text was found in this file.');
  }

  return {
    documentType: inferDocumentType({ filename, mimetype, text }),
    summary,
    extractedText: normalizeText(text),
    evidenceItems,
    timelineItems,
    rebuttalConcerns,
    warnings
  };
}

function getEvidenceAiClient() {
  if (evidenceAiClientOverride) {
    return evidenceAiClientOverride;
  }

  if (!process.env.OPENAI_API_KEY || process.env.OCR_PROVIDER === 'none') {
    return null;
  }

  return {
    extractStructuredEvidence: async ({ buffer, file, context }) => {
      const filename = file.originalFilename || 'evidence-file';
      const mimetype = String(file.mimetype || 'application/octet-stream');
      const model = process.env.OPENAI_OCR_MODEL || 'gpt-4.1-mini';
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: {
          documentType: { type: 'string' },
          summary: { type: 'string' },
          extractedText: { type: 'string' },
          evidenceItems: { type: 'array', items: { type: 'string' } },
          timelineItems: { type: 'array', items: { type: 'string' } },
          rebuttalConcerns: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } }
        },
        required: ['documentType', 'summary', 'extractedText', 'evidenceItems', 'timelineItems', 'rebuttalConcerns', 'warnings']
      };

      const content = [
        {
          type: 'input_text',
          text: [
            'Extract dispute-relevant evidence from the attached file.',
            'Return concise structured JSON only.',
            'Do not invent facts.',
            'Focus on merchant promises, transaction facts, dates, amounts, cancellation/refund evidence, delivery evidence, and likely merchant rebuttal points.',
            context?.description ? `Dispute context: ${context.description}` : null,
            context?.merchantName ? `Merchant: ${context.merchantName}` : null,
            context?.issuer ? `Issuer: ${context.issuer}` : null
          ].filter(Boolean).join('\n')
        }
      ];

      if (isPdfFile(file)) {
        content.push({
          type: 'input_file',
          filename,
          file_data: `data:${mimetype};base64,${buffer.toString('base64')}`
        });
      } else {
        content.push({
          type: 'input_image',
          image_url: `data:${mimetype};base64,${buffer.toString('base64')}`
        });
      }

      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: 'user',
              content
            }
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'evidence_extraction',
              schema
            }
          }
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.error?.message || `OpenAI OCR request failed with status ${response.status}.`;
        throw new Error(message);
      }

      const outputText = data.output_text
        || data.output?.flatMap(output => output.content || [])
          .map(contentItem => contentItem.text || '')
          .join('\n')
        || '';

      const parsed = JSON.parse(outputText);
      return {
        documentType: normalizeText(parsed.documentType) || inferDocumentType({ filename, mimetype, text: parsed.extractedText }),
        summary: normalizeText(parsed.summary),
        extractedText: normalizeText(parsed.extractedText),
        evidenceItems: uniqueItems(parsed.evidenceItems || []),
        timelineItems: uniqueItems(parsed.timelineItems || []),
        rebuttalConcerns: uniqueItems(parsed.rebuttalConcerns || []),
        warnings: uniqueItems(parsed.warnings || [])
      };
    }
  };
}

export function setEvidenceAiClientForTesting(client) {
  evidenceAiClientOverride = client;
}

export function resetEvidenceAiClientForTesting() {
  evidenceAiClientOverride = null;
}

export async function parseEvidenceUploadRequest(req) {
  const uploadDir = getUploadDir();
  await fs.mkdir(uploadDir, { recursive: true });

  const form = formidable({
    multiples: true,
    keepExtensions: true,
    maxFiles: Number(process.env.EVIDENCE_MAX_FILES || DEFAULT_MAX_FILES),
    maxFileSize: Number(process.env.EVIDENCE_MAX_FILE_SIZE || DEFAULT_MAX_FILE_SIZE),
    uploadDir,
    allowEmptyFiles: false
  });

  return await new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ fields, files });
    });
  });
}

export function normalizeEvidenceFields(fields = {}) {
  return {
    caseId: normalizeText(firstValue(fields.caseId)),
    email: normalizeText(firstValue(fields.email)),
    description: normalizeText(firstValue(fields.description)),
    merchantName: normalizeText(firstValue(fields.merchantName)),
    issuer: normalizeText(firstValue(fields.issuer)),
    network: normalizeText(firstValue(fields.network)),
    async: ['true', '1', 'yes', 'on'].includes(normalizeText(firstValue(fields.async)).toLowerCase())
  };
}

export function flattenUploadedFiles(files = {}) {
  return Object.values(files).flatMap(value => Array.isArray(value) ? value : [value]).filter(Boolean);
}

async function extractTextFromPlainFile(file) {
  return await fs.readFile(file.filepath, 'utf8');
}

function buildUnsupportedResult(file, warning) {
  return {
    filename: file.originalFilename || path.basename(file.filepath),
    mimeType: file.mimetype || 'application/octet-stream',
    size: file.size || 0,
    sourceType: isPdfFile(file) ? 'pdf' : isImageFile(file) ? 'image' : isTextLikeFile(file) ? 'text' : 'binary',
    extractionMode: 'unsupported',
    ocrApplied: false,
    documentType: inferDocumentType({
      filename: file.originalFilename,
      mimetype: file.mimetype,
      text: ''
    }),
    summary: '',
    extractedText: '',
    evidenceItems: [],
    timelineItems: [],
    rebuttalConcerns: [],
    warnings: [warning]
  };
}

export async function extractEvidenceFromFiles(files, context = {}) {
  const flattenedFiles = flattenUploadedFiles(files);
  const aiClient = getEvidenceAiClient();
  const results = [];

  for (const file of flattenedFiles) {
    const filename = file.originalFilename || path.basename(file.filepath);
    const mimeType = file.mimetype || 'application/octet-stream';
    try {
      if (isTextLikeFile(file)) {
        const rawText = await extractTextFromPlainFile(file);
        const structured = buildHeuristicSummary(rawText, { filename, mimetype: mimeType });
        results.push({
          filename,
          mimeType,
          size: file.size || 0,
          sourceType: 'text',
          extractionMode: 'text-read',
          ocrApplied: false,
          ...structured
        });
        continue;
      }

      if (isPdfFile(file)) {
        const buffer = await fs.readFile(file.filepath);
        try {
          const parser = new PDFParse({ data: buffer });
          const parsed = await parser.getText();
          await parser.destroy();

          if (normalizeText(parsed.text)) {
            const structured = buildHeuristicSummary(parsed.text, { filename, mimetype: mimeType });
            results.push({
              filename,
              mimeType,
              size: file.size || 0,
              sourceType: 'pdf',
              extractionMode: 'pdf-parse',
              ocrApplied: false,
              ...structured
            });
            continue;
          }
        } catch {
          // Fall through to OCR if configured.
        }

        if (aiClient) {
          const structured = await aiClient.extractStructuredEvidence({
            buffer,
            file,
            context
          });
          results.push({
            filename,
            mimeType,
            size: file.size || 0,
            sourceType: 'pdf',
            extractionMode: 'openai-ocr',
            ocrApplied: true,
            ...structured
          });
          continue;
        }

        results.push(buildUnsupportedResult(file, 'This PDF did not contain readable embedded text and OCR is not configured.'));
        continue;
      }

      if (isImageFile(file)) {
        if (!aiClient) {
          results.push(buildUnsupportedResult(file, 'Image OCR is not configured on this server.'));
          continue;
        }

        const buffer = await fs.readFile(file.filepath);
        const structured = await aiClient.extractStructuredEvidence({
          buffer,
          file,
          context
        });
        results.push({
          filename,
          mimeType,
          size: file.size || 0,
          sourceType: 'image',
          extractionMode: 'openai-ocr',
          ocrApplied: true,
          ...structured
        });
        continue;
      }

      results.push(buildUnsupportedResult(file, 'This file type is not currently supported for automated evidence extraction.'));
    } catch (error) {
      results.push({
        ...buildUnsupportedResult(file, 'Evidence extraction failed for this file.'),
        warnings: uniqueItems([
          'Evidence extraction failed for this file.',
          error.message
        ])
      });
    }
  }

  const combined = {
    summary: uniqueItems(results.map(result => result.summary)).slice(0, 4).join(' '),
    evidenceItems: uniqueItems(results.flatMap(result => result.evidenceItems || [])),
    timelineItems: uniqueItems(results.flatMap(result => result.timelineItems || [])),
    rebuttalConcerns: uniqueItems(results.flatMap(result => result.rebuttalConcerns || [])),
    warnings: uniqueItems(results.flatMap(result => result.warnings || [])),
    recommendedNextSteps: uniqueItems([
      results.some(result => result.ocrApplied)
        ? 'Review the extracted text for OCR mistakes before submitting the dispute packet.'
        : null,
      results.some(result => (result.timelineItems || []).length === 0)
        ? 'Add any missing dates manually so the dispute timeline is complete.'
        : null,
      results.some(result => (result.evidenceItems || []).length === 0)
        ? 'Supplement unreadable files with clearer screenshots or merchant emails when possible.'
        : null
    ])
  };

  return {
    extractedCount: results.length,
    files: results,
    combined
  };
}

export async function extractEvidenceFromStoredFiles(fileIds = [], context = {}) {
  const storedFiles = await getStoredFilesByIds(fileIds);
  const pseudoFiles = storedFiles.map(file => ({
    filepath: file.storagePath,
    originalFilename: file.originalFilename,
    mimetype: file.contentType,
    size: file.sizeBytes
  }));

  return await extractEvidenceFromFiles(pseudoFiles, context);
}

export async function cleanupUploadedFiles(files = {}) {
  const flattenedFiles = flattenUploadedFiles(files);
  await Promise.all(flattenedFiles.map(async file => {
    try {
      await fs.unlink(file.filepath);
    } catch {
      // Ignore cleanup failures for temp uploads.
    }
  }));
}
