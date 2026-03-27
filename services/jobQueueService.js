import { v4 as uuidv4 } from 'uuid';
import { hydrateArtifactAccessInValue } from './artifactAccessService.js';
import { getDatabase, parseJsonColumn, resetDatabaseForTesting, toJsonColumn } from './databaseService.js';

const processors = new Map();
let workerRunning = false;
let wakeTimer = null;

function normalizeText(value = '') {
  return String(value || '').trim();
}

function mapJobRow(row) {
  if (!row) {
    return null;
  }

  return {
    jobId: row.job_id,
    kind: row.kind,
    status: row.status,
    email: row.email,
    caseId: row.case_id,
    requestId: row.request_id,
    input: parseJsonColumn(row.input_json, {}),
    result: hydrateArtifactAccessInValue(parseJsonColumn(row.result_json, null)),
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

function scheduleWorker() {
  if (wakeTimer) {
    return;
  }

  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void processPendingJobs();
  }, 10);
}

async function processPendingJobs() {
  if (workerRunning) {
    return;
  }

  workerRunning = true;
  try {
    while (true) {
      const db = getDatabase();
      const nextRow = db.prepare(`
        SELECT job_id, kind, status, email, case_id, request_id,
               input_json, result_json, error_message,
               created_at, updated_at, started_at, completed_at
        FROM jobs
        WHERE status = 'pending'
        ORDER BY datetime(created_at) ASC, job_id ASC
        LIMIT 1
      `).get();

      if (!nextRow) {
        break;
      }

      const job = mapJobRow(nextRow);
      const processor = processors.get(job.kind);
      const startedAt = new Date().toISOString();

      db.prepare(`
        UPDATE jobs
        SET status = 'running',
            updated_at = ?,
            started_at = ?
        WHERE job_id = ?
      `).run(startedAt, startedAt, job.jobId);

      try {
        if (!processor) {
          throw new Error(`No processor registered for job kind ${job.kind}`);
        }

        const result = await processor(job);
        const completedAt = new Date().toISOString();
        db.prepare(`
          UPDATE jobs
          SET status = 'completed',
              updated_at = ?,
              completed_at = ?,
              result_json = ?,
              error_message = NULL
          WHERE job_id = ?
        `).run(completedAt, completedAt, toJsonColumn(result), job.jobId);
      } catch (error) {
        const completedAt = new Date().toISOString();
        db.prepare(`
          UPDATE jobs
          SET status = 'failed',
              updated_at = ?,
              completed_at = ?,
              error_message = ?
          WHERE job_id = ?
        `).run(completedAt, completedAt, String(error.message || error), job.jobId);
      }
    }
  } finally {
    workerRunning = false;
  }
}

export function registerJobProcessor(kind, processor) {
  if (!normalizeText(kind)) {
    throw new Error('A job kind is required.');
  }

  processors.set(kind, processor);
}

export async function enqueueJob({
  kind,
  email = null,
  caseId = null,
  requestId = null,
  input = {}
} = {}) {
  const jobId = uuidv4();
  const now = new Date().toISOString();

  getDatabase().prepare(`
    INSERT INTO jobs (
      job_id, kind, status, email, case_id, request_id,
      input_json, result_json, error_message, created_at, updated_at, started_at, completed_at
    ) VALUES (?, ?, 'pending', ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL)
  `).run(
    jobId,
    normalizeText(kind),
    normalizeText(email).toLowerCase() || null,
    normalizeText(caseId) || null,
    normalizeText(requestId) || null,
    toJsonColumn(input),
    now,
    now
  );

  scheduleWorker();
  return await getJob(jobId);
}

export async function getJob(jobId) {
  const row = getDatabase().prepare(`
    SELECT job_id, kind, status, email, case_id, request_id,
           input_json, result_json, error_message,
           created_at, updated_at, started_at, completed_at
    FROM jobs
    WHERE job_id = ?
  `).get(jobId);

  return mapJobRow(row);
}

export function resumePendingJobs() {
  scheduleWorker();
}

export function resetJobQueueForTesting() {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  workerRunning = false;
  resetDatabaseForTesting();
}
