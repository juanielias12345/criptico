'use strict';

// Gobierno de la empresa: dos CEO (rol «owner») con autoridad idéntica.
//
// Bandeja de aprobaciones:
//  - Cada pedido guarda la versión exacta que se revisa y su hash. Un voto vale
//    solo para esa versión: si el contenido cambia, la aprobación se invalida y
//    el pedido vuelve a «pendiente» con una versión nueva.
//  - Política «one»: alcanza con un CEO. Política «both»: hacen falta los dos.
//  - Si un CEO aprueba y otro rechaza (o pide cambios) la misma versión, el
//    pedido queda en «conflicto» y en pausa hasta que lo resuelvan.
//  - Nadie aprueba su propio pedido en la política «both» por sí solo.
//  - Al aprobarse, la acción vinculada se ejecuta (si es interna) o queda lista
//    para ejecutarse con evidencia.

const { uuid, now, sha256, parseJson, HttpError } = require('./util');
const { audit } = require('./audit');
const { getSetting } = require('./settings');

const KINDS = {
  post: { area: 'marketing', label: 'Publicación en redes' },
  campaign: { area: 'marketing', label: 'Campaña' },
  article: { area: 'marketing', label: 'Artículo, newsletter o PDF' },
  public_reply: { area: 'community', label: 'Respuesta pública delicada' },
  design_change: { area: 'tech', label: 'Cambio importante de diseño o producto' },
  feature: { area: 'tech', label: 'Funcionalidad nueva' },
  production_change: { area: 'tech', label: 'Cambio en producción' },
  security_change: { area: 'tech', label: 'Cambio crítico de seguridad', policy: 'both', level: 4 },
  legal_doc: { area: 'legal', label: 'Términos o políticas legales', level: 4 },
  legal_high_impact: { area: 'legal', label: 'Decisión legal de alto impacto', policy: 'both', level: 4 },
  budget: { area: 'finance', label: 'Presupuesto o gasto' },
  contract: { area: 'finance', label: 'Contratación o compromiso económico', policy: 'both', level: 4 },
  app_release: { area: 'apps', label: 'Lanzamiento de aplicación' },
  institutional: { area: 'direction', label: 'Comunicación institucional' },
  permission_change: { area: 'direction', label: 'Cambio de permisos de un CEO', policy: 'both', level: 4 },
  automation_policy: { area: 'community', label: 'Política de respuestas automáticas', level: 3 },
  decision: { area: 'direction', label: 'Decisión pendiente' },
};

// Hash canónico: las claves se ordenan para que el mismo contenido dé el mismo hash.
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const hashOf = (content) => sha256(canonical(content));

// Política que corresponde: la del tipo, o «both» si el monto supera el umbral acordado.
async function policyFor(db, kind, amount) {
  const k = KINDS[kind];
  if (!k) throw new HttpError(400, 'invalid_kind');
  let level = k.level || 3;
  // Con la doble aprobación desactivada (decisión de los CEO), alcanza con uno para todo.
  const dual = (await getSetting(db, 'governance.dual_approval')) === true;
  let policy = dual ? (k.policy || 'one') : 'one';
  if (dual && amount != null && Number(amount) > 0) {
    const limit = Number(await getSetting(db, 'governance.dual_approval_amount_usd'));
    if (Number(amount) > limit) { policy = 'both'; level = 4; }
  }
  return { policy, level, area: k.area };
}

// Al desactivar la doble aprobación, los pedidos abiertos que esperaban al segundo CEO pasan a
// «uno alcanza» y se resuelven con los votos que ya tienen.
async function relaxPending(db) {
  if ((await getSetting(db, 'governance.dual_approval')) === true) return 0;
  const items = await db.all("SELECT * FROM approval_items WHERE policy = 'both' AND status = 'pending'");
  for (const item of items) {
    await db.run("UPDATE approval_items SET policy = 'one', updated_at = ? WHERE id = ?", [now(), item.id]);
    const votes = await db.all('SELECT * FROM approval_votes WHERE item_id = ?', [item.id]);
    const status = tally({ ...item, policy: 'one' }, votes, await ownersCount(db));
    if (status === 'pending') continue;
    await db.run('UPDATE approval_items SET status = ?, decided_at = ?, updated_at = ? WHERE id = ?', [status, now(), now(), item.id]);
    const voter = votes.find((v) => v.version === item.version && v.decision === 'approve');
    await audit(db, { actorKind: 'system', action: 'approval.policy_relaxed', targetKind: 'approval', targetId: item.id,
      details: { result: status, reason: 'governance.dual_approval = false' } });
    if (status === 'approved' && voter) await onApproved(db, { ...item, policy: 'one', status }, await db.get('SELECT * FROM users WHERE id = ?', [voter.user_id]));
  }
  return items.length;
}

async function ownersCount(db) {
  return (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND disabled = 0 AND deleted_at IS NULL")).n;
}

async function createRequest(db, { kind, title, summary, content, amount, currency, targetKind, targetId, requestedByKind = 'person', requestedBy }, actor) {
  if (!title || !String(title).trim()) throw new HttpError(400, 'title_required');
  if (content === undefined || content === null || typeof content !== 'object') throw new HttpError(400, 'content_required');
  const p = await policyFor(db, kind, amount);
  const id = uuid();
  const json = JSON.stringify(content);
  const h = hashOf(content);
  await db.run(`INSERT INTO approval_items(id, kind, area, title, summary, content, version, content_hash, policy, level, amount, currency,
      requested_by_kind, requested_by, target_kind, target_id) VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?)`,
  [id, kind, p.area, String(title).slice(0, 200), summary ? String(summary).slice(0, 2000) : null, json, h, p.policy, p.level,
    amount != null ? Number(amount) : null, amount != null ? (currency || 'USD') : null, requestedByKind, requestedBy || (actor && actor.id) || null,
    targetKind || null, targetId || null]);
  await db.run('INSERT INTO approval_versions(item_id, version, content, content_hash, created_by) VALUES (?,?,?,?,?)', [id, 1, json, h, requestedBy || (actor && actor.id) || null]);
  await audit(db, { actorId: actor && actor.id, actorKind: requestedByKind, actorLabel: requestedByKind === 'agent' ? requestedBy : null,
    action: 'approval.requested', targetKind: 'approval', targetId: id, details: { kind, policy: p.policy, hash: h } });
  return get(db, id);
}

// Cambiar el contenido crea una versión nueva e invalida cualquier aprobación previa.
async function revise(db, id, { content, title, summary, amount }, actor) {
  const item = await db.get('SELECT * FROM approval_items WHERE id = ?', [id]);
  if (!item) throw new HttpError(404, 'not_found');
  if (['executed', 'withdrawn'].includes(item.status)) throw new HttpError(409, 'closed', 'El pedido ya está cerrado.');
  const h = hashOf(content);
  if (h === item.content_hash && title === undefined && summary === undefined) return get(db, id);
  const version = item.version + 1;
  const p = await policyFor(db, item.kind, amount !== undefined ? amount : item.amount);
  await db.run('INSERT INTO approval_versions(item_id, version, content, content_hash, created_by) VALUES (?,?,?,?,?)', [id, version, JSON.stringify(content), h, actor && actor.id]);
  await db.run(`UPDATE approval_items SET content = ?, content_hash = ?, version = ?, status = 'pending', decided_at = NULL, policy = ?, level = ?,
      title = COALESCE(?, title), summary = COALESCE(?, summary), amount = ?, updated_at = ? WHERE id = ?`,
  [JSON.stringify(content), h, version, p.policy, p.level, title ? String(title).slice(0, 200) : null, summary ? String(summary).slice(0, 2000) : null,
    amount !== undefined ? amount : item.amount, now(), id]);
  await audit(db, { actorId: actor && actor.id, action: 'approval.revised', targetKind: 'approval', targetId: id,
    details: { from_version: item.version, to_version: version, previous_status: item.status, invalidated: item.status === 'approved' } });
  return get(db, id);
}

// Estado que resulta de los votos sobre la versión vigente.
function tally(item, votes, owners) {
  const cur = votes.filter((v) => v.version === item.version && v.content_hash === item.content_hash);
  const approve = cur.filter((v) => v.decision === 'approve');
  const against = cur.filter((v) => v.decision !== 'approve');
  if (approve.length && against.length) return 'conflict';
  if (against.length) return against.some((v) => v.decision === 'reject') ? 'rejected' : 'changes_requested';
  const need = item.policy === 'both' ? Math.min(2, Math.max(1, owners)) : 1;
  if (item.policy === 'both' && owners < 2) return 'pending';       // «both» exige que existan los dos CEO
  return approve.length >= need ? 'approved' : 'pending';
}

async function vote(db, id, { decision, comment, version, content_hash }, actor) {
  if (!['approve', 'reject', 'changes'].includes(decision)) throw new HttpError(400, 'invalid_decision');
  const item = await db.get('SELECT * FROM approval_items WHERE id = ?', [id]);
  if (!item) throw new HttpError(404, 'not_found');
  if (['executed', 'withdrawn'].includes(item.status)) throw new HttpError(409, 'closed');
  // El voto debe referirse a la versión que la persona vio.
  if (Number(version) !== item.version || content_hash !== item.content_hash) {
    throw new HttpError(409, 'stale_version', 'El contenido cambió desde que lo abriste. Revisá la versión nueva.');
  }
  if (decision !== 'approve' && !String(comment || '').trim()) throw new HttpError(400, 'comment_required', 'Contá el motivo o los cambios que pedís.');
  if (await db.get('SELECT 1 FROM approval_votes WHERE item_id = ? AND version = ? AND user_id = ?', [id, item.version, actor.id])) {
    throw new HttpError(409, 'already_voted', 'Ya decidiste sobre esta versión.');
  }
  await db.run('INSERT INTO approval_votes(item_id, version, content_hash, user_id, decision, comment) VALUES (?,?,?,?,?,?)',
    [id, item.version, item.content_hash, actor.id, decision, comment ? String(comment).slice(0, 2000) : null]);
  const votes = await db.all('SELECT * FROM approval_votes WHERE item_id = ?', [id]);
  const status = tally(item, votes, await ownersCount(db));
  await db.run('UPDATE approval_items SET status = ?, decided_at = ?, updated_at = ? WHERE id = ?',
    [status, status === 'pending' ? null : now(), now(), id]);
  if (status === 'conflict') {
    await db.run('INSERT INTO ceo_conflicts(subject_kind, subject_id, description) VALUES (?,?,?)',
      ['approval', id, `Decisiones opuestas sobre «${item.title}» (versión ${item.version}). La tarea queda en pausa hasta que ambos CEO lo resuelvan.`]);
    if (item.target_kind === 'ops_task') await db.run("UPDATE ops_tasks SET status = 'blocked', blocked_reason = 'Instrucciones opuestas de los CEO' WHERE id = ?", [item.target_id]);
  }
  await audit(db, { actorId: actor.id, action: 'approval.' + decision, targetKind: 'approval', targetId: id,
    details: { version: item.version, hash: item.content_hash, result: status, comment: comment || null } });
  if (status === 'approved') await onApproved(db, { ...item, status }, actor);
  return get(db, id);
}

// Un conflicto se resuelve con una decisión registrada; luego se vuelve a votar la versión.
async function resolveConflict(db, conflictId, resolution, actor) {
  const c = await db.get('SELECT * FROM ceo_conflicts WHERE id = ?', [conflictId]);
  if (!c || c.status !== 'open') throw new HttpError(404, 'not_found');
  if (!String(resolution || '').trim()) throw new HttpError(400, 'resolution_required');
  await db.run("UPDATE ceo_conflicts SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?", [String(resolution).slice(0, 2000), actor.id, now(), c.id]);
  if (c.subject_kind === 'approval') {
    // Los votos quedan en el historial; el pedido vuelve a pendiente con una versión nueva idéntica para votar de nuevo.
    const item = await db.get('SELECT * FROM approval_items WHERE id = ?', [c.subject_id]);
    if (item && item.status === 'conflict') {
      const content = parseJson(item.content, {});
      const version = item.version + 1;
      await db.run('INSERT INTO approval_versions(item_id, version, content, content_hash, created_by) VALUES (?,?,?,?,?)', [item.id, version, item.content, item.content_hash, actor.id]);
      await db.run("UPDATE approval_items SET status = 'pending', version = ?, decided_at = NULL, updated_at = ? WHERE id = ?", [version, now(), item.id]);
      void content;
    }
  }
  await audit(db, { actorId: actor.id, action: 'conflict.resolved', targetKind: c.subject_kind, targetId: c.subject_id, details: { resolution } });
  return { ok: true };
}

async function withdraw(db, id, actor) {
  const item = await db.get('SELECT * FROM approval_items WHERE id = ?', [id]);
  if (!item) throw new HttpError(404, 'not_found');
  if (item.status === 'executed') throw new HttpError(409, 'closed');
  await db.run("UPDATE approval_items SET status = 'withdrawn', updated_at = ? WHERE id = ?", [now(), id]);
  await audit(db, { actorId: actor.id, action: 'approval.withdrawn', targetKind: 'approval', targetId: id });
  return get(db, id);
}

// Efectos de una aprobación sobre el objeto vinculado.
async function onApproved(db, item, actor) {
  const content = parseJson(item.content, {});
  if (item.target_kind === 'content_piece') {
    // La pieza queda aprobada solo si sigue siendo exactamente la versión aprobada.
    const p = await db.get('SELECT * FROM content_pieces WHERE id = ?', [item.target_id]);
    if (p && require('./company').pieceHash(p) === item.content_hash) {
      await db.run("UPDATE content_pieces SET approved_hash = ?, approval_id = ?, status = 'approved', updated_at = ? WHERE id = ?", [item.content_hash, item.id, now(), p.id]);
    }
  }
  if (item.target_kind === 'legal_version') {
    const [docId, version, language] = String(item.target_id).split(':');
    await db.run("UPDATE legal_document_versions SET approval_id = ?, status = 'approved' WHERE doc_id = ? AND version = ? AND language = ? AND content_hash = ?",
      [item.id, docId, Number(version), language, item.content_hash]);
  }
  if (item.kind === 'permission_change' && content.user_id) {
    const u = await db.get('SELECT * FROM users WHERE id = ?', [content.user_id]);
    if (u) {
      await db.run('UPDATE users SET role = ?, disabled = ? WHERE id = ?', [content.role || u.role, content.disabled === undefined ? u.disabled : (content.disabled ? 1 : 0), u.id]);
      if (content.disabled) await db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
      await markExecuted(db, item.id, 'Aplicado en la base al aprobarse', actor);
    }
  }
  if (item.kind === 'security_change' && content.setting) {
    const { setSetting, validateSetting } = require('./settings');
    if (/^(security|governance)\./.test(content.setting) && !validateSetting(content.setting, content.value)) {
      await setSetting(db, content.setting, content.value, actor && actor.id);
      await markExecuted(db, item.id, `Ajuste ${content.setting} = ${JSON.stringify(content.value)} aplicado al aprobarse`, actor);
      if (content.setting === 'governance.dual_approval') await relaxPending(db);
    }
  }
  if (item.target_kind === 'ops_task') {
    await db.run("UPDATE ops_tasks SET status = CASE WHEN status IN ('in_review','pending','blocked') THEN 'approved' ELSE status END, approval_id = ?, updated_at = ? WHERE id = ?", [item.id, now(), item.target_id]);
  }
}

async function markExecuted(db, id, evidence, actor) {
  if (!String(evidence || '').trim()) throw new HttpError(400, 'evidence_required', 'Indicá la evidencia de la ejecución.');
  const item = await db.get('SELECT * FROM approval_items WHERE id = ?', [id]);
  if (!item) throw new HttpError(404, 'not_found');
  if (item.status !== 'approved') throw new HttpError(409, 'not_approved', 'Solo se ejecuta una versión aprobada.');
  await db.run("UPDATE approval_items SET status = 'executed', executed_at = ?, execution_evidence = ?, updated_at = ? WHERE id = ?", [now(), String(evidence).slice(0, 1000), now(), id]);
  await audit(db, { actorId: actor && actor.id, action: 'approval.executed', targetKind: 'approval', targetId: id, details: { evidence } });
}

async function get(db, id) {
  const item = await db.get('SELECT * FROM approval_items WHERE id = ?', [id]);
  if (!item) throw new HttpError(404, 'not_found');
  const votes = await db.all(`SELECT v.*, u.username, u.display_name, u.title FROM approval_votes v JOIN users u ON u.id = v.user_id
    WHERE v.item_id = ? ORDER BY v.id`, [id]);
  const versions = await db.all('SELECT version, content_hash, created_at, created_by FROM approval_versions WHERE item_id = ? ORDER BY version', [id]);
  return { ...item, content: parseJson(item.content, {}), kind_label: (KINDS[item.kind] || {}).label || item.kind,
    votes: votes.map((v) => ({ ...v, current: v.version === item.version && v.content_hash === item.content_hash })), versions };
}

async function list(db, { status, area, limit = 50 } = {}) {
  const where = []; const args = [];
  if (status === 'open') where.push("status IN ('pending','conflict','changes_requested')");
  else if (status) { where.push('status = ?'); args.push(status); }
  if (area) { where.push('area = ?'); args.push(area); }
  const rows = await db.all(`SELECT a.*, (SELECT COUNT(*) FROM approval_votes v WHERE v.item_id = a.id AND v.version = a.version AND v.decision = 'approve') AS approvals
    FROM approval_items a ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE status WHEN 'conflict' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, created_at DESC LIMIT ?`,
  [...args, Math.min(200, limit)]);
  return rows.map((r) => ({ ...r, content: undefined, kind_label: (KINDS[r.kind] || {}).label || r.kind }));
}

module.exports = { KINDS, canonical, hashOf, policyFor, relaxPending, createRequest, revise, vote, tally, withdraw, resolveConflict, markExecuted, get, list, ownersCount };
