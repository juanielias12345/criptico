'use strict';

// Registro de auditoría. Es inalterable: la base rechaza borrar o reescribir
// registros (ver 005_company.sql). Cada entrada dice quién (persona, agente o
// sistema), qué, sobre qué objeto, con qué resultado y, si lo hubo, qué costo.
async function audit(db, { actorId, actorKind, actorLabel, action, targetKind, targetId, details, ipHash, outcome, costAmount, costCurrency }) {
  await db.run(
    `INSERT INTO audit_log(actor_id, actor_kind, actor_label, action, target_kind, target_id, details, ip_hash, outcome, cost_amount, cost_currency)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [actorId || null, actorKind || (actorId ? 'person' : 'system'), actorLabel || null, action, targetKind || null, targetId || null,
      details ? JSON.stringify(details) : null, ipHash || null, outcome || 'ok', costAmount ?? null, costAmount != null ? (costCurrency || 'USD') : null]);
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
