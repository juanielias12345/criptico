'use strict';

async function audit(db, { actorId, action, targetKind, targetId, details, ipHash }) {
  await db.run(
    'INSERT INTO audit_log(actor_id, action, target_kind, target_id, details, ip_hash) VALUES (?,?,?,?,?,?)',
    [actorId || null, action, targetKind || null, targetId || null, details ? JSON.stringify(details) : null, ipHash || null]);
}

async function logError(db, scope, err, details) {
  try {
    await db.run('INSERT INTO error_log(scope, message, details) VALUES (?,?,?)',
      [scope, String(err && err.message ? err.message : err).slice(0, 1000), details ? JSON.stringify(details).slice(0, 4000) : null]);
  } catch (e) {
    console.error('[error_log]', scope, err, e);
  }
}

module.exports = { audit, logError };
