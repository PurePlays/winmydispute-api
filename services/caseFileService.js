import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { createSignedArtifactAccess } from './artifactAccessService.js';
import { getDatabase, parseJsonColumn, resetDatabaseForTesting, toJsonColumn } from './databaseService.js';
import { normalizeEmail } from './licenseStore.js';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function buildNaturalKey({ email, intake = {} } = {}) {
  const payload = [
    normalizeEmail(email),
    normalizeText(intake.merchantName).toLowerCase(),
    normalizeText(intake.transactionDateIso || intake.transactionDate).toLowerCase(),
    normalizeText(intake.transactionAmountValue ?? intake.transactionAmount).toLowerCase(),
    normalizeText(intake.description).toLowerCase()
  ].join('|');

  return crypto.createHash('sha1').update(payload).digest('hex');
}

function sanitizeVersionData({ stage, intake, extraction, premium, artifact, artifacts, source, notes }) {
  const normalizedArtifacts = Array.isArray(artifacts) ? artifacts.filter(Boolean) : [];
  return {
    stage: normalizeText(stage),
    source: normalizeText(source || 'api'),
    notes: normalizeText(notes || ''),
    intake: intake || null,
    extraction: extraction || null,
    premium: premium || null,
    artifact: artifact || normalizedArtifacts[0] || null,
    artifacts: normalizedArtifacts
  };
}

function buildCaseSummary(record) {
  const latestArtifactFileIds = parseJsonColumn(record.latest_artifact_file_ids_json, []);
  return {
    caseId: record.case_id,
    email: record.email,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    latestStage: record.latest_stage,
    versionCount: Number(record.version_count || 0),
    merchantName: record.merchant_name,
    issuer: record.issuer,
    network: record.network,
    reasonCode: record.reason_code || null,
    confidence: record.confidence ?? null,
    merchantVertical: record.merchant_vertical || null,
    latestArtifactFileIds,
    latestArtifactFormats: parseJsonColumn(record.latest_artifact_formats_json, []),
    latestArtifactUrls: latestArtifactFileIds.length > 0
      ? latestArtifactFileIds.map(fileId => createSignedArtifactAccess({ fileId }).url)
      : parseJsonColumn(record.latest_artifact_urls_json, [])
  };
}

export function resetCaseFilesForTesting() {
  resetDatabaseForTesting();
}

export async function saveCaseVersion({
  caseId,
  email,
  stage,
  intake = null,
  extraction = null,
  premium = null,
  artifact = null,
  artifacts = [],
  source = 'api',
  notes = ''
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('A valid email is required to persist a case file.');
  }

  const db = getDatabase();
  const naturalKey = buildNaturalKey({ email: normalizedEmail, intake: intake || {} });
  let record = null;

  if (caseId) {
    record = db.prepare('SELECT * FROM cases WHERE case_id = ?').get(caseId) || null;
  }

  if (!record) {
    record = db.prepare('SELECT * FROM cases WHERE email = ? AND natural_key = ? LIMIT 1').get(normalizedEmail, naturalKey) || null;
  }

  const now = new Date().toISOString();
  const resolvedCaseId = record?.case_id || caseId || uuidv4();
  const versionId = uuidv4();
  const versionPayload = sanitizeVersionData({ stage, intake, extraction, premium, artifact, artifacts, source, notes });
  const latestArtifacts = [artifact, ...(Array.isArray(artifacts) ? artifacts : [])].filter(Boolean);

  db.exec('BEGIN');
  try {
    if (!record) {
      db.prepare(`
        INSERT INTO cases (
          case_id, natural_key, email, created_at, updated_at, latest_stage, version_count,
          merchant_name, issuer, network, reason_code, confidence, merchant_vertical,
          latest_artifact_file_ids_json, latest_artifact_formats_json, latest_artifact_urls_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        resolvedCaseId,
        naturalKey,
        normalizedEmail,
        now,
        now,
        normalizeText(stage),
        0,
        normalizeText(intake?.merchantName) || null,
        normalizeText(intake?.issuer) || null,
        normalizeText(premium?.network || intake?.network).toLowerCase() || null,
        premium?.reasonCode || null,
        premium?.confidence ?? null,
        premium?.merchantVertical || intake?.merchantVertical || null,
        '[]',
        '[]',
        '[]'
      );

      record = db.prepare('SELECT * FROM cases WHERE case_id = ?').get(resolvedCaseId);
    }

    db.prepare(`
      INSERT INTO case_versions (
        version_id, case_id, created_at, stage, source, notes,
        intake_json, extraction_json, premium_json, artifact_json, artifacts_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      versionId,
      resolvedCaseId,
      now,
      versionPayload.stage,
      versionPayload.source,
      versionPayload.notes,
      toJsonColumn(versionPayload.intake),
      toJsonColumn(versionPayload.extraction),
      toJsonColumn(versionPayload.premium),
      toJsonColumn(versionPayload.artifact),
      toJsonColumn(versionPayload.artifacts, [])
    );

    const currentFileIds = new Set(parseJsonColumn(record.latest_artifact_file_ids_json, []));
    const currentFormats = new Set(parseJsonColumn(record.latest_artifact_formats_json, []));
    const currentUrls = new Set(parseJsonColumn(record.latest_artifact_urls_json, []));
    for (const item of latestArtifacts) {
      if (normalizeText(item.fileId)) {
        currentFileIds.add(normalizeText(item.fileId));
      }
      currentFormats.add(normalizeText(item.format));
      currentUrls.add(normalizeText(item.url));
    }

    db.prepare(`
      UPDATE cases
      SET updated_at = ?,
          latest_stage = ?,
          version_count = ?,
          merchant_name = ?,
          issuer = ?,
          network = ?,
          reason_code = ?,
          confidence = ?,
          merchant_vertical = ?,
          latest_artifact_file_ids_json = ?,
          latest_artifact_formats_json = ?,
          latest_artifact_urls_json = ?
      WHERE case_id = ?
    `).run(
      now,
      normalizeText(stage),
      Number(record.version_count || 0) + 1,
      normalizeText(intake?.merchantName || record.merchant_name) || null,
      normalizeText(intake?.issuer || record.issuer) || null,
      normalizeText(premium?.network || intake?.network || record.network).toLowerCase() || null,
      premium?.reasonCode || record.reason_code || null,
      premium?.confidence ?? record.confidence ?? null,
      premium?.merchantVertical || intake?.merchantVertical || record.merchant_vertical || null,
      JSON.stringify(Array.from(currentFileIds).filter(Boolean)),
      JSON.stringify(Array.from(currentFormats).filter(Boolean)),
      JSON.stringify(Array.from(currentUrls).filter(Boolean)),
      resolvedCaseId
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const updated = db.prepare('SELECT * FROM cases WHERE case_id = ?').get(resolvedCaseId);
  return {
    caseFile: buildCaseSummary(updated),
    version: {
      versionId,
      createdAt: now,
      stage: normalizeText(stage)
    }
  };
}

export async function loadCaseMetadataForEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const rows = getDatabase()
    .prepare('SELECT * FROM cases WHERE email = ? ORDER BY updated_at DESC')
    .all(normalizedEmail);

  return rows.map(buildCaseSummary);
}

export async function loadCaseById(caseId) {
  const record = getDatabase()
    .prepare('SELECT * FROM cases WHERE case_id = ?')
    .get(caseId);

  if (!record) {
    return null;
  }

  const versions = getDatabase()
    .prepare(`
      SELECT version_id, created_at, stage, source, notes
      FROM case_versions
      WHERE case_id = ?
      ORDER BY created_at DESC
    `)
    .all(caseId)
    .map(row => ({
      versionId: row.version_id,
      createdAt: row.created_at,
      stage: row.stage,
      source: row.source,
      notes: row.notes
    }));

  return {
    ...buildCaseSummary(record),
    versions
  };
}
