'use strict';

// Centro de operaciones de la empresa: agentes, tareas, riesgos, costos,
// integraciones, matriz legal, documentos legales versionados y piezas de
// contenido con aprobación obligatoria. Todo lo que muestra sale de la base.

const { uuid, now, parseJson, HttpError } = require('./util');
const { audit } = require('./audit');
const gov = require('./governance');
const SEED = require('../db/company-seed');

const J = (v) => JSON.stringify(v);
// El hash de una versión legal es el del contenido que se aprueba (documento, versión, idioma y texto).
const legalHash = (doc, version, language, body) => gov.hashOf({ doc, version: Number(version), language, body });

// ── Datos iniciales (idempotente) ──
async function seedCompany(db) {
  for (const a of SEED.AGENTS) {
    const [n, id, dept, name, mission, resp, tools, limits, kpis, autonomy, runtime] = a;
    await db.run(`INSERT OR IGNORE INTO agents(id, number, department, name, mission, responsibilities, tools, limits, kpis, autonomy_max, runtime)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [id, n, dept, name, mission, J(resp), J(tools), J(limits), J(kpis), autonomy, runtime]);
  }
  for (const t of SEED.TASKS) {
    const [id, title, area, category, agent, expected, risk, level, status, blocked] = t;
    await db.run(`INSERT OR IGNORE INTO ops_tasks(id, title, area, category, agent_id, expected, risk, approval_level, status, blocked_reason, objective)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [id, title, area, category, agent, expected, risk, level, status, blocked, 'Surge de la auditoría inicial del ' + SEED.AUDIT_DATE]);
  }
  for (const r of SEED.RISKS) {
    const [id, area, title, desc, sev, lik, jur, mit, lawyer] = r;
    await db.run(`INSERT OR IGNORE INTO risks(id, area, title, description, severity, likelihood, jurisdiction, mitigation, needs_lawyer, owner_label)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, area, title, desc, sev, lik, jur, mit, lawyer, 'CEO']);
  }
  for (const i of SEED.INTEGRATIONS) {
    await db.run(`INSERT OR IGNORE INTO integrations(id, name, category, status, provides, permissions, data, cost, actions, limitations, ceo_action, evidence, checked_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, i);
  }
  for (const [code, name] of SEED.JURISDICTIONS) {
    await db.run('INSERT OR IGNORE INTO legal_jurisdictions(code, name, pending_action) VALUES (?,?,?)', [code, name, 'Decidir si es mercado prioritario (T-010)']);
  }
  for (const [id, name, route] of SEED.LEGAL_DOCS) {
    await db.run('INSERT OR IGNORE INTO legal_documents(id, name, public_route) VALUES (?,?,?)', [id, name, route]);
  }
  // Versión 1 de los textos que ya están publicados en el sitio, tal cual (registro, no aprobación nueva).
  const CONTENT = require('../views/content');
  for (const [doc, key] of [['terms', 'terms'], ['privacy', 'privacy']]) {
    for (const lang of ['es', 'en']) {
      const body = CONTENT[lang] && CONTENT[lang][key];
      if (!body) continue;
      await db.run(`INSERT OR IGNORE INTO legal_document_versions(doc_id, version, language, body, content_hash, status, source_note, created_by)
        VALUES (?,1,?,?,?,'published','baseline','sistema')`, [doc, lang, body.trim(), legalHash(doc, 1, lang, body.trim())]);
    }
  }
  await gov.relaxPending(db);
}

// ── Agentes: estado real según cómo se ejecutan ──
async function agents(db) {
  const rows = await db.all('SELECT * FROM agents ORDER BY number');
  const runs = await db.all(`SELECT agent_id, MAX(started_at) AS last_at, SUM(status = 'error') AS errors, COUNT(*) AS n,
      SUM(COALESCE(cost_amount, 0)) AS cost FROM agent_runs GROUP BY agent_id`);
  const jobs = await db.all(`SELECT job_name, MAX(started_at) AS last_at,
      (SELECT status FROM job_runs r2 WHERE r2.job_name = r.job_name ORDER BY started_at DESC LIMIT 1) AS last_status FROM job_runs r GROUP BY job_name`);
  const bank = await db.get("SELECT MAX(started_at) AS last_at, (SELECT status FROM generation_batches ORDER BY started_at DESC LIMIT 1) AS last_status FROM generation_batches");
  const tasks = await db.all("SELECT agent_id, COUNT(*) AS n, SUM(status = 'blocked') AS blocked FROM ops_tasks WHERE status NOT IN ('done','cancelled') GROUP BY agent_id");
  return rows.map((a) => {
    const r = runs.find((x) => x.agent_id === a.id) || {};
    const t = tasks.find((x) => x.agent_id === a.id) || {};
    let state = 'Sin proceso activo'; let last = r.last_at || null; let lastResult = null;
    if (!a.enabled) state = 'Desactivado';
    else if (a.runtime === 'on_demand') state = 'A pedido de un CEO';
    else if (a.runtime.startsWith('job:')) {
      const j = jobs.find((x) => x.job_name === a.runtime.slice(4));
      state = 'Tarea programada del servidor'; last = j ? j.last_at : last; lastResult = j ? j.last_status : null;
    } else if (a.runtime === 'workflow:bank.yml') {
      state = 'Flujo programado (GitHub Actions, cada 6 h)'; last = bank && bank.last_at ? bank.last_at : last; lastResult = bank ? bank.last_status : null;
    } else if (a.runtime.startsWith('workflow:')) {
      state = 'Flujo de GitHub Actions en cada cambio (resultado en GitHub)';
    }
    return { ...a, responsibilities: parseJson(a.responsibilities, []), tools: parseJson(a.tools, []), limits: parseJson(a.limits, []), kpis: parseJson(a.kpis, []),
      state, last_run_at: last, last_result: lastResult, runs: r.n || 0, errors: r.errors || 0, cost: r.cost || 0, open_tasks: t.n || 0, blocked_tasks: t.blocked || 0 };
  });
}

async function recordAgentRun(db, { agentId, status, summary, evidence, startedAt, costAmount, error }) {
  await db.run(`INSERT INTO agent_runs(agent_id, started_at, finished_at, status, summary, evidence, cost_amount, cost_currency, error)
    VALUES (?,?,?,?,?,?,?,?,?)`, [agentId, startedAt || now(), now(), status, summary || null, evidence || null, costAmount ?? null, costAmount != null ? 'USD' : null, error || null]);
  await audit(db, { actorKind: 'agent', actorLabel: agentId, action: 'agent.run', targetKind: 'agent', targetId: agentId,
    details: { status, summary, evidence }, outcome: status === 'ok' ? 'ok' : 'error', costAmount });
}

// ── Tareas ──
const TASK_FIELDS = ['title', 'objective', 'area', 'category', 'agent_id', 'owner_user_id', 'input', 'expected', 'status', 'blocked_reason', 'due_at',
  'cost_estimate', 'cost_actual', 'risk', 'permissions', 'approval_level', 'evidence'];

async function listTasks(db, { status, area, category } = {}) {
  const where = []; const args = [];
  if (status === 'open') where.push("t.status NOT IN ('done','cancelled')");
  else if (status) { where.push('t.status = ?'); args.push(status); }
  if (area) { where.push('t.area = ?'); args.push(area); }
  if (category) { where.push('t.category = ?'); args.push(category); }
  return db.all(`SELECT t.*, a.name AS agent_name, u.username AS owner_username FROM ops_tasks t LEFT JOIN agents a ON a.id = t.agent_id
    LEFT JOIN users u ON u.id = t.owner_user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE t.category WHEN 'critical' THEN 0 WHEN 'human_decision' THEN 1 WHEN 'important' THEN 2 ELSE 3 END, t.id`, args);
}

async function saveTask(db, id, input, actor) {
  const b = {};
  for (const f of TASK_FIELDS) if (input[f] !== undefined) b[f] = input[f] === '' ? null : input[f];
  if (id) {
    const t = await db.get('SELECT * FROM ops_tasks WHERE id = ?', [id]);
    if (!t) throw new HttpError(404, 'not_found');
    if (b.status === 'done' && !String(b.evidence || t.evidence || '').trim()) throw new HttpError(400, 'evidence_required', 'Para completar la tarea, indicá la evidencia.');
    // Las tareas de nivel 3 o 4 se completan solo con una aprobación vigente.
    if (b.status === 'done' && t.approval_level >= 3) {
      const ap = t.approval_id && await db.get("SELECT status FROM approval_items WHERE id = ? AND status IN ('approved','executed')", [t.approval_id]);
      if (!ap) throw new HttpError(409, 'approval_required', 'Esta tarea necesita una aprobación de CEO antes de completarse.');
    }
    if (b.status === 'done') b.done_at = now();
    const keys = Object.keys(b);
    if (!keys.length) return db.get('SELECT * FROM ops_tasks WHERE id = ?', [id]);
    await db.run(`UPDATE ops_tasks SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => b[k]), now(), id]);
    await audit(db, { actorId: actor.id, action: 'task.update', targetKind: 'ops_task', targetId: id, details: b });
    return db.get('SELECT * FROM ops_tasks WHERE id = ?', [id]);
  }
  if (!b.title || !b.area || !b.category) throw new HttpError(400, 'missing_fields', 'Título, área y categoría son obligatorios.');
  const n = (await db.get("SELECT COUNT(*) AS n FROM ops_tasks")).n + 1;
  let newId = 'T-' + String(n).padStart(3, '0');
  while (await db.get('SELECT 1 FROM ops_tasks WHERE id = ?', [newId])) newId = 'T-' + String(Number(newId.slice(2)) + 1).padStart(3, '0');
  if (b.status === 'done') throw new HttpError(400, 'invalid_status');
  const keys = Object.keys(b);
  await db.run(`INSERT INTO ops_tasks(id, ${keys.join(', ')}) VALUES (?${', ?'.repeat(keys.length)})`, [newId, ...keys.map((k) => b[k])]);
  await audit(db, { actorId: actor.id, action: 'task.create', targetKind: 'ops_task', targetId: newId, details: b });
  return db.get('SELECT * FROM ops_tasks WHERE id = ?', [newId]);
}

// Pedir la aprobación de una tarea (decisiones, cambios de producción, gastos…).
async function requestTaskApproval(db, id, { kind, amount, note }, actor) {
  const t = await db.get('SELECT * FROM ops_tasks WHERE id = ?', [id]);
  if (!t) throw new HttpError(404, 'not_found');
  const item = await gov.createRequest(db, { kind: kind || (t.category === 'human_decision' ? 'decision' : 'production_change'), title: t.title,
    summary: note || t.expected, content: { task: t.id, title: t.title, expected: t.expected, note: note || null, amount: amount ?? null },
    amount, targetKind: 'ops_task', targetId: t.id }, actor);
  await db.run("UPDATE ops_tasks SET approval_id = ?, status = 'in_review', updated_at = ? WHERE id = ?", [item.id, now(), t.id]);
  return item;
}

// ── Riesgos, costos, integraciones, jurisdicciones ──
async function saveRisk(db, id, b, actor) {
  const f = ['area', 'title', 'description', 'severity', 'likelihood', 'jurisdiction', 'status', 'mitigation', 'needs_lawyer', 'owner_label'];
  const v = {}; for (const k of f) if (b[k] !== undefined) v[k] = k === 'needs_lawyer' ? (b[k] ? 1 : 0) : b[k];
  if (id) {
    const keys = Object.keys(v);
    if (!keys.length) throw new HttpError(400, 'nothing_to_update');
    const r = await db.run(`UPDATE risks SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => v[k]), now(), id]);
    if (!r.changes) throw new HttpError(404, 'not_found');
  } else {
    if (!v.title || !v.area || !v.severity || !v.likelihood) throw new HttpError(400, 'missing_fields');
    const n = (await db.get('SELECT COUNT(*) AS n FROM risks')).n + 1;
    id = 'R-' + String(n).padStart(3, '0');
    const keys = Object.keys(v);
    await db.run(`INSERT INTO risks(id, ${keys.join(', ')}) VALUES (?${', ?'.repeat(keys.length)})`, [id, ...keys.map((k) => v[k])]);
  }
  await audit(db, { actorId: actor.id, action: 'risk.save', targetKind: 'risk', targetId: id, details: v });
  return db.get('SELECT * FROM risks WHERE id = ?', [id]);
}

async function addCost(db, b, actor) {
  if (!b.area || !b.vendor || !['estimate', 'actual', 'budget'].includes(b.kind) || !(Number(b.amount) >= 0)) throw new HttpError(400, 'missing_fields');
  if (b.kind === 'actual' && !String(b.evidence || '').trim()) throw new HttpError(400, 'evidence_required', 'Un gasto real necesita la factura o el comprobante.');
  const r = await db.run('INSERT INTO costs(area, vendor, description, kind, amount, currency, period, evidence, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
    [b.area, String(b.vendor).slice(0, 100), b.description || null, b.kind, Number(b.amount), (b.currency || 'USD').slice(0, 3).toUpperCase(), b.period || null, b.evidence || null, actor.id]);
  await audit(db, { actorId: actor.id, action: 'cost.add', targetKind: 'cost', targetId: String(r.lastInsertRowid), details: b,
    costAmount: b.kind === 'actual' ? Number(b.amount) : null, costCurrency: b.currency });
  return { id: r.lastInsertRowid };
}

async function saveIntegration(db, id, b, actor) {
  const i = await db.get('SELECT * FROM integrations WHERE id = ?', [id]);
  if (!i) throw new HttpError(404, 'not_found');
  const status = b.status || i.status;
  if (!['verified', 'configured_unverified', 'missing', 'not_needed'].includes(status)) throw new HttpError(400, 'invalid_status');
  if (status === 'verified' && !String(b.evidence || '').trim()) throw new HttpError(400, 'evidence_required', 'Para marcarla verificada, contá cómo se comprobó.');
  await db.run('UPDATE integrations SET status = ?, evidence = ?, checked_at = ?, ceo_action = COALESCE(?, ceo_action), updated_at = ? WHERE id = ?',
    [status, b.evidence || i.evidence, status === 'verified' ? now() : i.checked_at, b.ceo_action || null, now(), id]);
  await audit(db, { actorId: actor.id, action: 'integration.update', targetKind: 'integration', targetId: id, details: { status, evidence: b.evidence || null } });
  return db.get('SELECT * FROM integrations WHERE id = ?', [id]);
}

async function saveJurisdiction(db, code, b, actor) {
  const j = await db.get('SELECT * FROM legal_jurisdictions WHERE code = ?', [code]);
  const f = ['name', 'target_market', 'priority', 'requirements', 'official_sources', 'verified_at', 'reviewed_at', 'next_review_at', 'owner_label', 'status',
    'affected_docs', 'risk', 'pending_action', 'needs_lawyer', 'notes'];
  const v = {}; for (const k of f) if (b[k] !== undefined) v[k] = ['target_market', 'needs_lawyer'].includes(k) ? (b[k] ? 1 : 0) : b[k];
  const merged = { ...(j || {}), ...v };
  // Requisitos o cumplimiento solo con fuente oficial y fecha de verificación.
  if ((merged.requirements || merged.status === 'compliant') && (!merged.official_sources || !merged.verified_at)) {
    throw new HttpError(400, 'source_required', 'Los requisitos y el estado «cumple» necesitan fuente oficial y fecha de verificación.');
  }
  if (j) {
    const keys = Object.keys(v);
    if (keys.length) await db.run(`UPDATE legal_jurisdictions SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE code = ?`, [...keys.map((k) => v[k]), now(), code]);
  } else {
    if (!/^[A-Z]{2,3}$/.test(code) || !v.name) throw new HttpError(400, 'invalid_jurisdiction');
    const keys = Object.keys(v);
    await db.run(`INSERT INTO legal_jurisdictions(code, ${keys.join(', ')}) VALUES (?${', ?'.repeat(keys.length)})`, [code, ...keys.map((k) => v[k])]);
  }
  await audit(db, { actorId: actor.id, action: 'legal.jurisdiction', targetKind: 'jurisdiction', targetId: code, details: v });
  return db.get('SELECT * FROM legal_jurisdictions WHERE code = ?', [code]);
}

// ── Documentos legales ──
async function legalDocs(db) {
  const docs = await db.all('SELECT * FROM legal_documents ORDER BY rowid');
  const vers = await db.all('SELECT doc_id, version, language, status, source_note, approval_id, effective_at, created_at, length(body) AS chars FROM legal_document_versions ORDER BY version');
  return docs.map((d) => ({ ...d, versions: vers.filter((v) => v.doc_id === d.id) }));
}

async function legalVersion(db, docId, version, language) {
  const v = await db.get('SELECT * FROM legal_document_versions WHERE doc_id = ? AND version = ? AND language = ?', [docId, Number(version), language]);
  if (!v) throw new HttpError(404, 'not_found');
  return v;
}

async function newLegalDraft(db, docId, { language = 'es', body, note }, actor) {
  if (!(await db.get('SELECT 1 FROM legal_documents WHERE id = ?', [docId]))) throw new HttpError(404, 'not_found');
  if (!String(body || '').trim()) throw new HttpError(400, 'body_required');
  const lang = ['es', 'en'].includes(language) ? language : 'es';
  const v = ((await db.get('SELECT MAX(version) AS v FROM legal_document_versions WHERE doc_id = ? AND language = ?', [docId, lang])).v || 0) + 1;
  const text = String(body).trim();
  await db.run(`INSERT INTO legal_document_versions(doc_id, version, language, body, content_hash, status, source_note, created_by) VALUES (?,?,?,?,?,'draft',?,?)`,
    [docId, v, lang, text, legalHash(docId, v, lang, text), note ? String(note).slice(0, 300) : null, actor.id]);
  await audit(db, { actorId: actor.id, action: 'legal.draft', targetKind: 'legal_version', targetId: `${docId}:${v}:${lang}` });
  return legalVersion(db, docId, v, lang);
}

// Enviar a aprobación: el voto queda atado al hash exacto del texto.
async function submitLegal(db, docId, version, language, actor) {
  const v = await legalVersion(db, docId, version, language);
  if (!['draft', 'in_review', 'lawyer_review'].includes(v.status)) throw new HttpError(409, 'invalid_status');
  const doc = await db.get('SELECT name FROM legal_documents WHERE id = ?', [docId]);
  const item = await gov.createRequest(db, { kind: 'legal_doc', title: `${doc.name} · versión ${v.version} (${v.language})`,
    summary: 'Borrador legal preparado por agentes de investigación. No es asesoramiento jurídico: requiere revisión profesional cuando el riesgo lo exige.',
    content: { doc: docId, version: v.version, language: v.language, body: v.body }, targetKind: 'legal_version', targetId: `${docId}:${v.version}:${v.language}` }, actor);
  await db.run("UPDATE legal_document_versions SET status = 'in_review' WHERE doc_id = ? AND version = ? AND language = ?", [docId, v.version, v.language]);
  return item;
}

// Publicar exige la aprobación vigente y la evidencia (commit o despliegue que cambia el texto público).
async function markLegalPublished(db, docId, version, language, evidence, actor) {
  const v = await legalVersion(db, docId, version, language);
  if (v.status !== 'approved') throw new HttpError(409, 'not_approved', 'Solo se publica una versión aprobada.');
  if (!String(evidence || '').trim()) throw new HttpError(400, 'evidence_required');
  await db.run("UPDATE legal_document_versions SET status = 'superseded' WHERE doc_id = ? AND language = ? AND status = 'published'", [docId, language]);
  await db.run("UPDATE legal_document_versions SET status = 'published', effective_at = ? WHERE doc_id = ? AND version = ? AND language = ?", [now(), docId, v.version, language]);
  await gov.markExecuted(db, v.approval_id, evidence, actor);
  await audit(db, { actorId: actor.id, action: 'legal.published', targetKind: 'legal_version', targetId: `${docId}:${v.version}:${language}`, details: { evidence } });
  return legalVersion(db, docId, v.version, language);
}

// ── Piezas de contenido ──
const PIECE_MATERIAL = ['title', 'campaign', 'objective', 'audience', 'country', 'language', 'platform', 'format', 'idea', 'script', 'body', 'cta', 'hashtags',
  'link', 'alt_text', 'assets', 'rights', 'metric'];
const PIECE_FREE_STATES = ['idea', 'research', 'production', 'editing', 'rights_review', 'paused', 'rejected', 'changes_requested', 'publish_error'];

function pieceMaterial(p) {
  const o = {};
  for (const k of PIECE_MATERIAL) o[k] = k === 'assets' ? parseJson(p.assets, []) : (p[k] ?? null);
  return o;
}
const pieceHash = (p) => gov.hashOf(pieceMaterial(p));

async function listPieces(db, { status } = {}) {
  return db.all(`SELECT * FROM content_pieces ${status ? 'WHERE status = ?' : ''} ORDER BY COALESCE(scheduled_at, created_at)`, status ? [status] : []);
}

async function savePiece(db, id, b, actor) {
  const v = {};
  for (const k of [...PIECE_MATERIAL, 'scheduled_at']) if (b[k] !== undefined) v[k] = k === 'assets' ? J(Array.isArray(b[k]) ? b[k] : []) : (b[k] === '' ? null : b[k]);
  if (id) {
    const p = await db.get('SELECT * FROM content_pieces WHERE id = ?', [id]);
    if (!p) throw new HttpError(404, 'not_found');
    if (p.status === 'published') throw new HttpError(409, 'published', 'Una pieza publicada no se edita: creá una nueva.');
    const next = { ...p, ...v };
    const materialChanged = pieceHash(next) !== pieceHash(p);
    const keys = Object.keys(v);
    if (keys.length) await db.run(`UPDATE content_pieces SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`, [...keys.map((k) => v[k]), now(), id]);
    // Cualquier cambio material invalida la aprobación y vuelve a revisión.
    if (materialChanged) {
      await db.run('UPDATE content_pieces SET version = version + 1 WHERE id = ?', [id]);
      if (p.approval_id || ['pending_approval', 'approved', 'scheduled'].includes(p.status)) {
        await db.run("UPDATE content_pieces SET approved_hash = NULL, status = 'pending_approval' WHERE id = ?", [id]);
        const fresh = await db.get('SELECT * FROM content_pieces WHERE id = ?', [id]);
        if (p.approval_id) {
          await gov.revise(db, p.approval_id, { content: pieceMaterial(fresh) }, actor);
        }
      }
    }
    await audit(db, { actorId: actor.id, action: 'content.update', targetKind: 'content_piece', targetId: id, details: { fields: keys, material_changed: materialChanged } });
    return getPiece(db, id);
  }
  if (!v.title || !v.platform || !v.format) throw new HttpError(400, 'missing_fields', 'Título, plataforma y formato son obligatorios.');
  const newId = uuid();
  const keys = Object.keys(v);
  await db.run(`INSERT INTO content_pieces(id, created_by, ${keys.join(', ')}) VALUES (?, ?${', ?'.repeat(keys.length)})`, [newId, actor.id, ...keys.map((k) => v[k])]);
  await audit(db, { actorId: actor.id, action: 'content.create', targetKind: 'content_piece', targetId: newId });
  return getPiece(db, newId);
}

async function getPiece(db, id) {
  const p = await db.get('SELECT * FROM content_pieces WHERE id = ?', [id]);
  if (!p) throw new HttpError(404, 'not_found');
  return { ...p, assets: parseJson(p.assets, []), current_hash: pieceHash(p), approval_valid: !!p.approved_hash && p.approved_hash === pieceHash(p) };
}

async function setPieceStatus(db, id, { status, published_url, scheduled_at }, actor) {
  const p = await db.get('SELECT * FROM content_pieces WHERE id = ?', [id]);
  if (!p) throw new HttpError(404, 'not_found');
  if (status === 'pending_approval') {
    // Se envía a la bandeja con la versión exacta.
    const content = pieceMaterial(p);
    let item;
    if (p.approval_id) item = await gov.revise(db, p.approval_id, { content }, actor);
    else {
      item = await gov.createRequest(db, { kind: p.format === 'article' || p.format === 'pdf' || p.format === 'newsletter' ? 'article' : 'post',
        title: p.title, summary: `${p.platform} · ${p.format}${p.country ? ' · ' + p.country : ''}${p.scheduled_at ? ' · sugerida ' + p.scheduled_at : ''}`,
        content, targetKind: 'content_piece', targetId: p.id }, actor);
    }
    await db.run("UPDATE content_pieces SET status = 'pending_approval', approval_id = ?, approved_hash = NULL, updated_at = ? WHERE id = ?", [item.id, now(), id]);
  } else if (status === 'scheduled') {
    if (!p.approved_hash || pieceHash(p) !== p.approved_hash) throw new HttpError(409, 'approval_required', 'Solo se programa la versión aprobada.');
    await db.run("UPDATE content_pieces SET status = 'scheduled', scheduled_at = COALESCE(?, scheduled_at), updated_at = ? WHERE id = ?", [scheduled_at || null, now(), id]);
  } else if (status === 'published') {
    // Sin integración conectada, la publicación la hace una persona y deja el enlace como evidencia.
    if (!/^https:\/\/\S+$/.test(String(published_url || ''))) throw new HttpError(400, 'evidence_required', 'Pegá el enlace a la publicación real.');
    if (pieceHash(p) !== p.approved_hash) throw new HttpError(409, 'approval_required', 'La versión actual no es la aprobada.');
    await db.run("UPDATE content_pieces SET status = 'published', published_url = ?, published_at = ?, updated_at = ? WHERE id = ?", [published_url, now(), now(), id]);
    const ap = await db.get('SELECT status FROM approval_items WHERE id = ?', [p.approval_id]);
    if (ap && ap.status === 'approved') await gov.markExecuted(db, p.approval_id, published_url, actor);
  } else if (PIECE_FREE_STATES.includes(status)) {
    await db.run('UPDATE content_pieces SET status = ?, updated_at = ? WHERE id = ?', [status, now(), id]);
  } else {
    throw new HttpError(400, 'invalid_status');
  }
  await audit(db, { actorId: actor.id, action: 'content.status', targetKind: 'content_piece', targetId: id, details: { from: p.status, to: status, published_url: published_url || null } });
  return getPiece(db, id);
}

// ── Resumen del centro de operaciones ──
async function overview(db, { config } = {}) {
  const t = now();
  const count = async (sql, args = []) => (await db.get(sql, args)).n;
  const tasks = await db.all('SELECT status, category, COUNT(*) AS n FROM ops_tasks GROUP BY status, category');
  const overdue = await db.all("SELECT id, title, due_at, status FROM ops_tasks WHERE due_at IS NOT NULL AND due_at < ? AND status NOT IN ('done','cancelled') ORDER BY due_at", [t]);
  const blocked = await db.all("SELECT t.id, t.title, t.blocked_reason, t.area, a.name AS agent_name FROM ops_tasks t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.status = 'blocked' ORDER BY t.id");
  const decisions = await db.all("SELECT id, title, status FROM ops_tasks WHERE category = 'human_decision' AND status NOT IN ('done','cancelled') ORDER BY id");
  const approvals = await db.all("SELECT status, policy, COUNT(*) AS n FROM approval_items GROUP BY status, policy");
  const conflicts = await db.all("SELECT * FROM ceo_conflicts WHERE status = 'open' ORDER BY created_at");
  const risks = await db.all("SELECT * FROM risks WHERE status <> 'closed' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id");
  const costs = await db.all("SELECT kind, currency, area, SUM(amount) AS total, COUNT(*) AS n FROM costs GROUP BY kind, currency, area");
  const integrations = await db.all('SELECT * FROM integrations ORDER BY category, name');
  const ceos = await db.all("SELECT id, username, display_name, title, mfa_enabled_at IS NOT NULL AS mfa, last_login_at, disabled FROM users WHERE role = 'owner' AND deleted_at IS NULL ORDER BY created_at");
  const errors24 = await count('SELECT COUNT(*) AS n FROM error_log WHERE created_at > ?', [new Date(Date.now() - 86400000).toISOString()]);
  const recentErrors = await db.all('SELECT scope, message, created_at FROM error_log ORDER BY id DESC LIMIT 10');
  const jobsFailed = await db.all("SELECT job_name, started_at, output FROM job_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT 10");
  const securityAlerts = await db.all("SELECT id, title, severity, last_seen_at FROM alerts WHERE kind = 'security' AND status = 'open' ORDER BY last_seen_at DESC LIMIT 20");
  const openAlerts = await count("SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'");
  const pieces = await db.all('SELECT status, COUNT(*) AS n FROM content_pieces GROUP BY status');
  const calendar = await db.all("SELECT id, title, platform, format, status, scheduled_at FROM content_pieces WHERE scheduled_at IS NOT NULL AND status NOT IN ('rejected','published') ORDER BY scheduled_at LIMIT 30");
  const published = await db.all("SELECT id, title, platform, published_url, published_at FROM content_pieces WHERE status = 'published' ORDER BY published_at DESC LIMIT 20");
  const jurisdictions = await db.all('SELECT * FROM legal_jurisdictions ORDER BY COALESCE(priority, 999), code');
  const docs = await legalDocs(db);
  const community = {
    submissions_pending: await count("SELECT COUNT(*) AS n FROM submissions WHERE status IN ('pending','in_review')"),
    reports_open: await count("SELECT COUNT(*) AS n FROM clue_reports WHERE status = 'open'"),
    data_requests_open: await count("SELECT COUNT(*) AS n FROM data_requests WHERE status IN ('open','in_progress')"),
    channels: integrations.filter((i) => i.category === 'Redes sociales'),
  };
  const bank = await db.get("SELECT COALESCE(SUM(target), 0) AS target, (SELECT COUNT(*) FROM clues WHERE status = 'published') AS published FROM bank_targets");
  const auditRecent = await db.all(`SELECT a.id, a.created_at, a.action, a.actor_kind, a.actor_label, a.target_kind, a.target_id, a.outcome, a.cost_amount, u.username
    FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.action LIKE 'approval.%' OR a.action LIKE 'team.%' OR a.action LIKE 'security.%' OR a.action LIKE 'user.%' OR a.action LIKE 'legal.%'
       OR a.action LIKE 'content.%' OR a.action LIKE 'cost.%' OR a.action LIKE 'conflict.%' OR a.action LIKE 'agent.%' OR a.action LIKE 'setting.%'
    ORDER BY a.id DESC LIMIT 40`);
  return {
    generated_at: t,
    version: { commit: (config && config.commit) || null, message: (config && config.commitMessage) || null },
    ceos,
    direction: { tasks, overdue, blocked, decisions, approvals, conflicts, risks: risks.filter((r) => ['critical', 'high'].includes(r.severity)), costs },
    agents: await agents(db),
    tech: { errors24, recentErrors, jobsFailed, securityAlerts, openAlerts, tasks: await listTasks(db, { status: 'open', area: 'tech' }),
      security_tasks: await listTasks(db, { status: 'open', area: 'security' }), bank },
    marketing: { pieces, calendar, published, approvals: await gov.list(db, { area: 'marketing', status: 'open' }),
      channels: integrations.filter((i) => i.category === 'Redes sociales') },
    legal: { docs, jurisdictions, risks: risks.filter((r) => r.area === 'legal'), approvals: await gov.list(db, { area: 'legal', status: 'open' }) },
    community,
    apps: { exists: false, note: 'No hay aplicaciones móviles. El sitio es instalable como aplicación web (manifiesto).',
      tasks: await listTasks(db, { area: 'apps' }), stores: integrations.filter((i) => i.category === 'Aplicaciones') },
    integrations,
    risks,
    audit: auditRecent,
  };
}

module.exports = { seedCompany, agents, recordAgentRun, listTasks, saveTask, requestTaskApproval, saveRisk, addCost, saveIntegration, saveJurisdiction,
  legalDocs, legalVersion, newLegalDraft, submitLegal, markLegalPublished, listPieces, savePiece, getPiece, setPieceStatus, pieceHash, pieceMaterial, overview };
