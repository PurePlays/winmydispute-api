import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, parseJsonColumn } from './databaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STORAGE_ROOT = path.join(__dirname, '..', 'secure-storage');

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm', '.xml', '.rtf', '.log']);
const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/xml',
  'text/xml',
  'application/rtf',
  'text/rtf',
  'text/html'
]);
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DOCUMENT_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip'
]);
const BINARY_SIGNATURES = [
  {
    match: buffer => buffer.slice(0, 5).toString('utf8') === '%PDF-',
    ext: '.pdf',
    mimeType: 'application/pdf'
  },
  {
    match: buffer => buffer.length >= 8
      && buffer[0] === 0x89
      && buffer[1] === 0x50
      && buffer[2] === 0x4E
      && buffer[3] === 0x47,
    ext: '.png',
    mimeType: 'image/png'
  },
  {
    match: buffer => buffer.length >= 3
      && buffer[0] === 0xFF
      && buffer[1] === 0xD8
      && buffer[2] === 0xFF,
    ext: '.jpg',
    mimeType: 'image/jpeg'
  },
  {
    match: buffer => buffer.length >= 12
      && buffer.slice(0, 4).toString('utf8') === 'RIFF'
      && buffer.slice(8, 12).toString('utf8') === 'WEBP',
    ext: '.webp',
    mimeType: 'image/webp'
  },
  {
    match: buffer => buffer.length >= 4
      && buffer[0] === 0x50
      && buffer[1] === 0x4B
      && [0x03, 0x05, 0x07].includes(buffer[2])
      && [0x04, 0x06, 0x08].includes(buffer[3]),
    ext: originalFilename => extFromFilename(originalFilename) === '.docx' ? '.docx' : '.zip',
    mimeType: originalFilename => extFromFilename(originalFilename) === '.docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/zip'
  }
];

function normalizeText(value = '') {
  return String(value || '').trim();
}

function getStorageRoot() {
  return process.env.STORAGE_ROOT_DIR || DEFAULT_STORAGE_ROOT;
}

function extFromFilename(filename = '') {
  return path.extname(String(filename || '')).toLowerCase();
}

function isTextLikeBuffer(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let nonPrintable = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }

    const isPrintable = byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128;
    if (!isPrintable) {
      nonPrintable += 1;
    }
  }

  return sample.length === 0 || (nonPrintable / sample.length) < 0.05;
}

function sniffKind(buffer, originalFilename = '', declaredContentType = '') {
  for (const signature of BINARY_SIGNATURES) {
    if (signature.match(buffer)) {
      return {
        ext: typeof signature.ext === 'function'
          ? signature.ext(originalFilename, declaredContentType)
          : signature.ext,
        mimeType: typeof signature.mimeType === 'function'
          ? signature.mimeType(originalFilename, declaredContentType)
          : signature.mimeType
      };
    }
  }

  const declared = normalizeText(declaredContentType).toLowerCase();
  const extension = extFromFilename(originalFilename);
  const looksTextLike = isTextLikeBuffer(buffer);
  if (looksTextLike && (TEXT_EXTENSIONS.has(extension) || TEXT_MIME_TYPES.has(declared))) {
    return {
      ext: extension || '.txt',
      mimeType: TEXT_MIME_TYPES.has(declared) ? declared : extension === '.csv' ? 'text/csv' : 'text/plain'
    };
  }

  return null;
}

function isAllowedKind(sniffed) {
  if (!sniffed) {
    return false;
  }

  return sniffed.mimeType === 'application/pdf'
    || TEXT_MIME_TYPES.has(sniffed.mimeType)
    || IMAGE_MIME_TYPES.has(sniffed.mimeType)
    || DOCUMENT_MIME_TYPES.has(sniffed.mimeType);
}

function mapStoredFileRow(row) {
  if (!row) {
    return null;
  }

  return {
    fileId: row.file_id,
    kind: row.kind,
    caseId: row.case_id,
    email: row.email,
    originalFilename: row.original_filename,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    storagePath: row.storage_path,
    metadata: parseJsonColumn(row.metadata_json, {}),
    createdAt: row.created_at
  };
}

async function ensureStorageDir(subdir = '') {
  const storageDir = path.join(getStorageRoot(), subdir);
  await fs.mkdir(storageDir, { recursive: true });
  return storageDir;
}

export async function storeBuffer({
  kind = 'evidence',
  email = null,
  caseId = null,
  originalFilename = 'file',
  declaredContentType = 'application/octet-stream',
  buffer,
  metadata = {}
} = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Cannot store an empty file buffer.');
  }

  const sniffed = sniffKind(buffer, originalFilename, declaredContentType);
  if (!isAllowedKind(sniffed)) {
    throw new Error('Unsupported or unsafe file type.');
  }

  const fileId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const safeExt = sniffed.ext || extFromFilename(originalFilename) || '.bin';
  const filename = `${fileId}${safeExt}`;
  const subdir = kind === 'artifact' ? 'artifacts' : 'evidence';
  const storageDir = await ensureStorageDir(subdir);
  const storagePath = path.join(storageDir, filename);
  await fs.writeFile(storagePath, buffer);

  getDatabase().prepare(`
    INSERT INTO stored_files (
      file_id, kind, case_id, email, original_filename, filename,
      content_type, size_bytes, sha256, storage_path, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fileId,
    kind,
    normalizeText(caseId) || null,
    normalizeText(email).toLowerCase() || null,
    normalizeText(originalFilename) || 'file',
    filename,
    sniffed.mimeType,
    buffer.length,
    sha256,
    storagePath,
    JSON.stringify({
      ...metadata,
      declaredContentType: normalizeText(declaredContentType) || null
    }),
    createdAt
  );

  return {
    fileId,
    kind,
    caseId: normalizeText(caseId) || null,
    email: normalizeText(email).toLowerCase() || null,
    originalFilename: normalizeText(originalFilename) || 'file',
    filename,
    contentType: sniffed.mimeType,
    sizeBytes: buffer.length,
    sha256,
    storagePath,
    metadata: {
      ...metadata,
      declaredContentType: normalizeText(declaredContentType) || null
    },
    createdAt
  };
}

export async function storeUploadedFile(file, { email = null, caseId = null, metadata = {} } = {}) {
  const buffer = await fs.readFile(file.filepath);
  return await storeBuffer({
    kind: 'evidence',
    email,
    caseId,
    originalFilename: file.originalFilename || path.basename(file.filepath),
    declaredContentType: file.mimetype || 'application/octet-stream',
    buffer,
    metadata
  });
}

export async function storeUploadedFiles(files = [], context = {}) {
  const results = [];
  for (const file of files) {
    results.push(await storeUploadedFile(file, context));
  }
  return results;
}

export async function getStoredFile(fileId) {
  const row = getDatabase().prepare(`
    SELECT file_id, kind, case_id, email, original_filename, filename,
           content_type, size_bytes, sha256, storage_path, metadata_json, created_at
    FROM stored_files
    WHERE file_id = ?
  `).get(fileId);

  return mapStoredFileRow(row);
}

export async function getStoredFilesByIds(fileIds = []) {
  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return [];
  }

  const select = getDatabase().prepare(`
    SELECT file_id, kind, case_id, email, original_filename, filename,
           content_type, size_bytes, sha256, storage_path, metadata_json, created_at
    FROM stored_files
    WHERE file_id = ?
  `);

  return fileIds
    .map(fileId => mapStoredFileRow(select.get(fileId)))
    .filter(Boolean);
}
