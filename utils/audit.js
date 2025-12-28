const pool = require('../config/db');

function getReqMeta(req) {
  return {
    method: req?.method,
    path: req?.originalUrl,
    ip: req?.ip,
    user_agent: req?.headers?.['user-agent'],
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({ note: 'unserializable_details' });
  }
}

async function writeAuditLog({ collegeId = null, actorUserId = null, action, entityType, entityId, details = {} }) {
  if (!action || !entityType || entityId === undefined || entityId === null) return;
  try {
    await pool.query(
      `INSERT INTO audit_logs (college_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [collegeId, actorUserId, action, entityType, String(entityId), safeJson(details)]
    );
  } catch (err) {
    console.error('[AUDIT_LOG] Failed to write audit log:', err?.message || err);
  }
}

module.exports = { writeAuditLog, getReqMeta };

