import { getDatabase, parseJsonColumn } from './databaseService.js';

function normalizeText(value = '') {
  return String(value || '').trim();
}

export async function recordAuditEvent({
  eventType,
  category = 'system',
  severity = 'info',
  requestId = null,
  actorType = 'system',
  actorId = null,
  email = null,
  caseId = null,
  status = 'success',
  message = '',
  metadata = {}
} = {}) {
  if (!normalizeText(eventType)) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const result = getDatabase().prepare(`
    INSERT INTO audit_events (
      event_type, category, severity, request_id, actor_type, actor_id,
      email, case_id, status, message, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizeText(eventType),
    normalizeText(category) || 'system',
    normalizeText(severity) || 'info',
    normalizeText(requestId) || null,
    normalizeText(actorType) || 'system',
    normalizeText(actorId) || null,
    normalizeText(email).toLowerCase() || null,
    normalizeText(caseId) || null,
    normalizeText(status) || 'success',
    normalizeText(message) || null,
    JSON.stringify(metadata || {}),
    createdAt
  );

  return {
    id: Number(result.lastInsertRowid),
    createdAt
  };
}

export async function listAuditEvents({ email = null, caseId = null, limit = 100 } = {}) {
  const rows = getDatabase().prepare(`
    SELECT id, event_type, category, severity, request_id, actor_type, actor_id,
           email, case_id, status, message, metadata_json, created_at
    FROM audit_events
    WHERE (? IS NULL OR email = ?)
      AND (? IS NULL OR case_id = ?)
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(
    normalizeText(email).toLowerCase() || null,
    normalizeText(email).toLowerCase() || null,
    normalizeText(caseId) || null,
    normalizeText(caseId) || null,
    Math.max(1, Math.min(Number(limit) || 100, 500))
  );

  return rows.map(row => ({
    id: row.id,
    eventType: row.event_type,
    category: row.category,
    severity: row.severity,
    requestId: row.request_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    email: row.email,
    caseId: row.case_id,
    status: row.status,
    message: row.message,
    metadata: parseJsonColumn(row.metadata_json, {}),
    createdAt: row.created_at
  }));
}
