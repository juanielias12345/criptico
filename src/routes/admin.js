'use strict';

// API del panel privado. Cada ruta comprueba sesión y permiso en el servidor;
// cada acción que modifica datos queda en el registro de auditoría.

const express = require('express');
const { can, createUser } = require('../services/auth');
const clues = require('../services/clues');
const subs = require('../services/submissions');
const importer = require('../services/importer');
const { dashboard } = require('../services/stats');
const { getAllSettings, setSetting, validateSetting } = require('../services/settings');
const { runJob } = require('../services/jobs');
const { audit } = require('../services/audit');
const { HttpError, uuid, now, parseJson } = require('../services/util');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function need(perm) {
  return (req, res, next) => {
    if (!req.user) return next(new HttpError(401, 'login_required'));
    if (!can(req.user, perm)) return next(new HttpError(403, 'forbidden', 'Tu rol no tiene permiso para esta acción.'));
    next();
  };
}

const log = (req, action, targetKind, targetId, details) =>
  audit(req.app.locals.db, { actorId: req.user.id, action, targetKind, targetId, details, ipHash: req.ipHash });

function paging(q, per = 50) {
  const page = Math.max(1, Math.min(10000, Number(q.page) || 1));
  return { page, per, offset: (page - 1) * per };
}

const SOURCE_FIELDS = ['name', 'url', 'country_code', 'language_code', 'variant_code', 'content_type', 'access_method', 'access_authorized',
  'license_id', 'reuse_terms', 'attribution_required', 'attribution_text', 'republish_allowed', 'frequency_minutes', 'auth_env_var'];

function cleanSource(b, partial) {
  const out = {};
  for (const f of SOURCE_FIELDS) if (b[f] !== undefined) out[f] = b[f];
  for (const f of ['access_authorized', 'attribution_required', 'republish_allowed']) if (out[f] !== undefined) out[f] = out[f] ? 1 : 0;
  if (out.url !== undefined) {
    let u; try { u = new URL(out.url); } catch { throw new HttpError(400, 'invalid_url'); }
    if (!['https:', 'http:'].includes(u.protocol)) throw new HttpError(400, 'invalid_url');
  }
  if (out.auth_env_var !== undefined && out.auth_env_var && !/^[A-Z][A-Z0-9_]{2,60}$/.test(out.auth_env_var)) throw new HttpError(400, 'invalid_env_var');
  if (out.frequency_minutes !== undefined) out.frequency_minutes = Math.max(15, Number(out.frequency_minutes) || 1440);
  if (!partial) for (const f of ['name', 'url', 'language_code', 'access_method']) if (!out[f]) throw new HttpError(400, 'missing_' + f);
  return out;
}

module.exports = function admin() {
  const r = express.Router();
  r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  r.get('/me', need('dashboard'), (req, res) => res.json({ user: req.user, permissions: require('../services/auth').PERMISSIONS[req.user.role] }));
  r.get('/dashboard', need('dashboard'), a(async (req, res) => res.json(await dashboard(req.app.locals.db))));

  // ── Catálogo ──
  r.get('/clues', need('catalog.read'), a(async (req, res) => {
    const db = req.app.locals.db; const q = req.query; const { page, per, offset } = paging(q);
    const where = ['1=1']; const args = [];
    if (q.q) { where.push('(clue_text LIKE ? OR answer LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
    for (const f of ['status', 'origin', 'language_code', 'validation_status', 'mechanism', 'category']) {
      if (q[f]) { where.push(`${f} = ?`); args.push(String(q[f])); }
    }
    if (q.variant_code) { where.push(q.variant_code === 'general' ? 'variant_code IS NULL' : 'variant_code = ?'); if (q.variant_code !== 'general') args.push(q.variant_code); }
    const total = (await db.get(`SELECT COUNT(*) AS n FROM clues WHERE ${where.join(' AND ')}`, args)).n;
    const items = await db.all(`SELECT id, slug, clue_text, answer, language_code, variant_code, category, difficulty, mechanism, origin, status,
      validation_status, validation_errors, source_id, license_id, created_at, published_at FROM clues WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...args, per, offset]);
    res.json({ total, page, per_page: per, items });
  }));

  r.get('/clues/:id', need('catalog.read'), a(async (req, res) => {
    const db = req.app.locals.db;
    const c = await db.get('SELECT * FROM clues WHERE id = ?', [req.params.id]);
    if (!c) throw new HttpError(404, 'not_found');
    const events = await db.all('SELECT * FROM clue_events WHERE clue_id = ? ORDER BY id DESC LIMIT 100', [c.id]);
    const duplicates = await db.all("SELECT * FROM duplicate_flags WHERE (subject_kind = 'clue' AND subject_id = ?) OR clue_id = ? ORDER BY id DESC", [c.id, c.id]);
    const source = c.source_id ? await db.get('SELECT id, name, url, license_id FROM sources WHERE id = ?', [c.source_id]) : null;
    const reports = await db.all('SELECT * FROM clue_reports WHERE clue_id = ? ORDER BY created_at DESC', [c.id]);
    const stats = await db.get("SELECT COUNT(*) AS played, SUM(CASE WHEN result = 'solved' THEN 1 ELSE 0 END) AS solved FROM games WHERE clue_id = ?", [c.id]);
    res.json({ clue: { ...c, wordplay: parseJson(c.wordplay, null), explanation: parseJson(c.explanation, []), validation: parseJson(c.validation, {}), alt_answers: parseJson(c.alt_answers, []) },
      events, duplicates, source, reports, stats });
  }));

  r.post('/clues/validate', need('catalog.write'), a(async (req, res) => {
    const { row, report } = await clues.buildClue(req.app.locals.db, req.body || {});
    res.json({ report, explanation: parseJson(row.explanation, []), enumeration: row.enumeration });
  }));

  r.post('/clues', need('catalog.write'), a(async (req, res) => {
    const db = req.app.locals.db; const b = req.body || {};
    const { row, report } = await clues.buildClue(db, b);
    const { findDuplicates } = require('../services/dedupe');
    const dup = await findDuplicates(db, row);
    if (dup.matches.some((m) => m.kind === 'exact')) throw new HttpError(409, 'duplicate', 'Ya existe un críptico idéntico.');
    const wantPublish = b.publish === true && report.errors === 0;
    const c = await clues.insertClue(db, { ...row, origin: 'original', status: wantPublish ? 'published' : 'draft', author_name: b.author_name || null },
      { actorKind: 'admin', actorId: req.user.id });
    await log(req, 'clue.create', 'clue', c.id, { status: c.status });
    res.status(201).json({ id: c.id, status: c.status, report });
  }));

  r.patch('/clues/:id', need('catalog.write'), a(async (req, res) => {
    const out = await clues.updateClue(req.app.locals.db, req.params.id, req.body || {}, { actorId: req.user.id });
    await log(req, 'clue.edit', 'clue', req.params.id, { status: out.status, errors: out.report.errors });
    res.json(out);
  }));

  r.post('/clues/:id/status', need('catalog.write'), a(async (req, res) => {
    const status = (req.body || {}).status;
    if (!['draft', 'review', 'published', 'disabled'].includes(status)) throw new HttpError(400, 'invalid_status');
    const db = req.app.locals.db;
    const c = await db.get('SELECT origin, submission_id FROM clues WHERE id = ?', [req.params.id]);
    if (!c) throw new HttpError(404, 'not_found');
    await clues.setClueStatus(db, req.params.id, status, { actorKind: 'admin', actorId: req.user.id });
    await log(req, 'clue.status', 'clue', req.params.id, { status });
    res.json({ ok: true, status });
  }));

  r.delete('/clues/:id', need('catalog.delete'), a(async (req, res) => {
    const db = req.app.locals.db;
    const c = await db.get('SELECT id, clue_text, answer FROM clues WHERE id = ?', [req.params.id]);
    if (!c) throw new HttpError(404, 'not_found');
    await db.run('UPDATE submissions SET clue_id = NULL WHERE clue_id = ?', [c.id]);
    await db.run('UPDATE import_items SET clue_id = NULL WHERE clue_id = ?', [c.id]);
    await db.run('DELETE FROM clues WHERE id = ?', [c.id]);
    await log(req, 'clue.delete', 'clue', c.id, { clue_text: c.clue_text, answer: c.answer });
    res.json({ ok: true });
  }));

  // ── Propuestas de usuarios (circuito manual) ──
  r.get('/submissions', need('submissions.read'), a(async (req, res) => {
    const db = req.app.locals.db; const { page, per, offset } = paging(req.query);
    const status = subs.STATUSES.includes(req.query.status) ? req.query.status : null;
    const where = status ? 'WHERE s.status = ?' : ''; const args = status ? [status] : [];
    const counts = await db.all('SELECT status, COUNT(*) AS n FROM submissions GROUP BY status');
    const items = await db.all(`SELECT s.id, s.clue_text, s.answer, s.language_code, s.variant_code, s.category, s.difficulty, s.status,
      s.public_name, s.created_at, s.updated_at, s.checks, u.username AS author_username FROM submissions s LEFT JOIN users u ON u.id = s.user_id
      ${where} ORDER BY s.created_at ASC LIMIT ? OFFSET ?`, [...args, per, offset]);
    res.json({ counts, page, items: items.map((s) => {
      const checks = parseJson(s.checks, []);
      return { ...s, checks: undefined, errors: checks.filter((c) => c.level === 'error').length, warnings: checks.filter((c) => c.level === 'warning').length };
    }) });
  }));

  r.get('/submissions/:id', need('submissions.read'), a(async (req, res) => {
    const db = req.app.locals.db;
    const s = await db.get(`SELECT s.*, u.username AS author_username, u.email AS author_email FROM submissions s
      LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`, [req.params.id]);
    if (!s) throw new HttpError(404, 'not_found');
    const events = await db.all(`SELECT e.*, u.username AS actor FROM submission_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.submission_id = ? ORDER BY e.id`, [s.id]);
    delete s.tracking_token; delete s.ip_hash;
    res.json({ submission: { ...s, checks: parseJson(s.checks, []), wordplay: parseJson(s.wordplay, null) }, events });
  }));

  r.post('/submissions/:id/moderate', need('submissions.moderate'), a(async (req, res) => {
    const out = await subs.moderate(req.app.locals.db, req.params.id, req.body || {}, req.user);
    await log(req, 'submission.' + (req.body || {}).action, 'submission', req.params.id, { result: out.status, published: out.published || false });
    res.json(out);
  }));

  // ── Fuentes externas ──
  r.get('/licenses', need('sources.read'), a(async (req, res) => res.json({ items: await req.app.locals.db.all('SELECT * FROM licenses ORDER BY name') })));

  r.get('/sources', need('sources.read'), a(async (req, res) => {
    const items = await req.app.locals.db.all(`SELECT s.*, l.name AS license_name, l.allows_republish, u.username AS approved_by_name
      FROM sources s LEFT JOIN licenses l ON l.id = s.license_id LEFT JOIN users u ON u.id = s.admin_approved_by ORDER BY s.name`);
    res.json({ items });
  }));

  r.post('/sources', need('sources.write'), a(async (req, res) => {
    const db = req.app.locals.db; const s = cleanSource(req.body || {}, false);
    const id = uuid();
    const cols = Object.keys(s);
    // Toda fuente nueva queda pendiente de revisión: no se sincroniza ni publica hasta que se apruebe.
    await db.run(`INSERT INTO sources(id, ${cols.join(',')}, status) VALUES (?, ${cols.map(() => '?').join(',')}, 'pending_review')`, [id, ...cols.map((c) => s[c])]);
    await log(req, 'source.create', 'source', id, s);
    res.status(201).json({ id });
  }));

  r.patch('/sources/:id', need('sources.write'), a(async (req, res) => {
    const db = req.app.locals.db; const s = cleanSource(req.body || {}, true);
    const cols = Object.keys(s);
    if (!cols.length) throw new HttpError(400, 'nothing_to_update');
    // Cambiar permisos, licencia o URL obliga a una nueva aprobación.
    const sensitive = cols.some((c) => ['url', 'license_id', 'republish_allowed', 'access_method', 'access_authorized', 'content_type'].includes(c));
    await db.run(`UPDATE sources SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?${sensitive ? ", admin_approved_by = NULL, admin_approved_at = NULL, status = 'pending_review'" : ''} WHERE id = ?`,
      [...cols.map((c) => s[c]), now(), req.params.id]);
    await log(req, 'source.edit', 'source', req.params.id, { ...s, reapproval_required: sensitive });
    res.json({ ok: true, reapproval_required: sensitive });
  }));

  r.post('/sources/:id/:action', need('sources.write'), a(async (req, res, next) => {
    const db = req.app.locals.db; const { action } = req.params;
    if (action === 'run' || action === 'upload') return next();
    if (!['approve', 'pause', 'disable', 'resume'].includes(action)) throw new HttpError(404, 'not_found');
    const s = await db.get('SELECT * FROM sources WHERE id = ?', [req.params.id]);
    if (!s) throw new HttpError(404, 'not_found');
    if (action === 'approve') {
      const lic = s.license_id ? await db.get('SELECT * FROM licenses WHERE id = ?', [s.license_id]) : null;
      const problems = [];
      if (!s.access_authorized) problems.push('Confirmá que el método de acceso está autorizado por el proveedor.');
      if (s.content_type === 'clues' && (!lic || !lic.allows_republish || !s.republish_allowed)) {
        problems.push('Sin licencia o permiso de republicación: la fuente solo puede usarse como referencia (tipo «metadata_only»).');
      }
      if ((s.attribution_required || (lic && lic.requires_attribution)) && !s.attribution_text) problems.push('Falta el texto de atribución.');
      if (problems.length) throw new HttpError(422, 'source_not_approvable', problems.join(' '), { problems });
      await db.run("UPDATE sources SET admin_approved_by = ?, admin_approved_at = ?, status = 'active', next_run_at = ?, updated_at = ? WHERE id = ?",
        [req.user.id, now(), now(), now(), s.id]);
    } else {
      const status = { pause: 'paused', disable: 'disabled', resume: s.admin_approved_by ? 'active' : 'pending_review' }[action];
      await db.run('UPDATE sources SET status = ?, updated_at = ? WHERE id = ?', [status, now(), s.id]);
    }
    await log(req, 'source.' + action, 'source', s.id);
    res.json({ ok: true });
  }));

  r.post('/sources/:id/run', need('sources.write'), a(async (req, res) => {
    const out = await importer.runSource(req.app.locals.db, req.params.id);
    await log(req, 'source.run', 'source', req.params.id, { status: out.status });
    res.json(out);
  }));

  r.post('/sources/:id/upload', need('sources.write'), a(async (req, res) => {
    const db = req.app.locals.db; const b = req.body || {};
    const s = await db.get('SELECT * FROM sources WHERE id = ?', [req.params.id]);
    if (!s) throw new HttpError(404, 'not_found');
    if (s.access_method !== 'manual_upload') throw new HttpError(400, 'not_manual_source');
    if (!['json_feed', 'csv', 'rss'].includes(b.format) || typeof b.content !== 'string') throw new HttpError(400, 'invalid_upload');
    const out = await importer.runSource(db, s.id, { text: b.content, format: b.format });
    await log(req, 'source.upload', 'source', s.id, { status: out.status });
    res.json(out);
  }));

  r.get('/imports/runs', need('sources.read'), a(async (req, res) => {
    const db = req.app.locals.db; const args = []; let where = '';
    if (req.query.source_id) { where = 'WHERE r.source_id = ?'; args.push(req.query.source_id); }
    res.json({ items: await db.all(`SELECT r.*, s.name AS source_name FROM import_runs r JOIN sources s ON s.id = r.source_id ${where}
      ORDER BY r.started_at DESC LIMIT 100`, args) });
  }));

  r.get('/imports/items', need('sources.read'), a(async (req, res) => {
    const db = req.app.locals.db; const { page, per, offset } = paging(req.query);
    const statuses = ['auto_published', 'review', 'published', 'discarded', 'duplicate', 'error'];
    const where = []; const args = [];
    if (statuses.includes(req.query.status)) { where.push('i.status = ?'); args.push(req.query.status); }
    if (req.query.source_id) { where.push('i.source_id = ?'); args.push(req.query.source_id); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const counts = await db.all('SELECT status, COUNT(*) AS n FROM import_items GROUP BY status');
    const items = await db.all(`SELECT i.*, s.name AS source_name FROM import_items i JOIN sources s ON s.id = i.source_id ${w}
      ORDER BY i.imported_at DESC LIMIT ? OFFSET ?`, [...args, per, offset]);
    res.json({ counts, page, items: items.map((i) => ({ ...i, payload: parseJson(i.payload, {}), checks: parseJson(i.checks, []) })) });
  }));

  r.post('/imports/items/:id/publish', need('imports.review'), a(async (req, res) => {
    const out = await importer.publishImportItem(req.app.locals.db, req.params.id, req.user, (req.body || {}).overrides || {});
    await log(req, 'import_item.publish', 'import_item', req.params.id, out);
    res.json(out);
  }));
  r.post('/imports/items/:id/discard', need('imports.review'), a(async (req, res) => {
    await importer.discardImportItem(req.app.locals.db, req.params.id, req.user);
    await log(req, 'import_item.discard', 'import_item', req.params.id);
    res.json({ ok: true });
  }));

  // ── Reportes de jugadores y duplicados ──
  r.get('/reports', need('reports.manage'), a(async (req, res) => {
    res.json({ items: await req.app.locals.db.all(`SELECT r.*, c.clue_text, c.answer, c.slug FROM clue_reports r JOIN clues c ON c.id = r.clue_id
      WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200`, [req.query.status || 'open']) });
  }));
  r.post('/reports/:id', need('reports.manage'), a(async (req, res) => {
    const status = (req.body || {}).status;
    if (!['open', 'resolved', 'dismissed'].includes(status)) throw new HttpError(400, 'invalid_status');
    await req.app.locals.db.run('UPDATE clue_reports SET status = ? WHERE id = ?', [status, req.params.id]);
    await log(req, 'report.' + status, 'report', req.params.id);
    res.json({ ok: true });
  }));
  r.get('/duplicates', need('catalog.read'), a(async (req, res) => {
    res.json({ items: await req.app.locals.db.all(`SELECT d.*, c.clue_text AS existing_clue, c.answer AS existing_answer FROM duplicate_flags d
      JOIN clues c ON c.id = d.clue_id WHERE d.resolved = 0 ORDER BY d.id DESC LIMIT 200`) });
  }));
  r.post('/duplicates/:id/resolve', need('catalog.write'), a(async (req, res) => {
    await req.app.locals.db.run('UPDATE duplicate_flags SET resolved = 1 WHERE id = ?', [req.params.id]);
    await log(req, 'duplicate.resolve', 'duplicate', req.params.id);
    res.json({ ok: true });
  }));

  // ── Idiomas, categorías y configuración ──
  r.get('/languages', need('dashboard'), a(async (req, res) => {
    const db = req.app.locals.db;
    res.json({ languages: await db.all(`SELECT l.*, (SELECT COUNT(*) FROM clues c WHERE c.language_code = l.code AND c.status = 'published') AS clues
      FROM languages l ORDER BY sort_order`),
    variants: await db.all(`SELECT v.*, (SELECT COUNT(*) FROM clues c WHERE c.variant_code = v.code AND c.status = 'published') AS clues
      FROM language_variants v ORDER BY code`) });
  }));
  r.patch('/languages/:code', need('languages.write'), a(async (req, res) => {
    const enabled = (req.body || {}).enabled ? 1 : 0;
    await req.app.locals.db.run('UPDATE languages SET enabled = ? WHERE code = ?', [enabled, req.params.code]);
    await log(req, 'language.toggle', 'language', req.params.code, { enabled });
    res.json({ ok: true });
  }));
  r.patch('/variants/:code', need('languages.write'), a(async (req, res) => {
    const b = req.body || {}; const db = req.app.locals.db;
    const v = await db.get('SELECT * FROM language_variants WHERE code = ?', [req.params.code]);
    if (!v) throw new HttpError(404, 'not_found');
    await db.run('UPDATE language_variants SET enabled = ?, min_clues = ? WHERE code = ?',
      [b.enabled !== undefined ? (b.enabled ? 1 : 0) : v.enabled, b.min_clues !== undefined ? Math.max(0, Number(b.min_clues) || 0) : v.min_clues, v.code]);
    await log(req, 'variant.edit', 'variant', v.code, b);
    res.json({ ok: true });
  }));

  r.get('/categories', need('dashboard'), a(async (req, res) => res.json({ items: await req.app.locals.db.all('SELECT * FROM categories ORDER BY slug') })));
  r.post('/categories', need('settings.write'), a(async (req, res) => {
    const b = req.body || {};
    if (!/^[a-z_]{2,40}$/.test(b.slug || '') || !b.name_es || !b.name_en) throw new HttpError(400, 'invalid_category');
    await req.app.locals.db.run(`INSERT INTO categories(slug, name_es, name_en, enabled) VALUES (?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET name_es = excluded.name_es, name_en = excluded.name_en, enabled = excluded.enabled`,
    [b.slug, String(b.name_es).slice(0, 60), String(b.name_en).slice(0, 60), b.enabled === false ? 0 : 1]);
    await log(req, 'category.save', 'category', b.slug, b);
    res.json({ ok: true });
  }));

  r.get('/settings', need('dashboard'), a(async (req, res) => res.json({ settings: await getAllSettings(req.app.locals.db) })));
  r.put('/settings/:key', need('settings.write'), a(async (req, res) => {
    const value = (req.body || {}).value;
    const problem = validateSetting(req.params.key, value);
    if (problem) throw new HttpError(400, problem);
    await setSetting(req.app.locals.db, req.params.key, value, req.user.id);
    await log(req, 'setting.update', 'setting', req.params.key, { value });
    res.json({ ok: true });
  }));

  // ── Equipo, auditoría y tareas ──
  r.get('/users', need('users.manage'), a(async (req, res) => {
    res.json({ items: await req.app.locals.db.all(`SELECT id, username, email, role, disabled, created_at, last_login_at FROM users
      WHERE role <> 'player' ORDER BY created_at`), players: (await req.app.locals.db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'player'")).n });
  }));
  r.post('/users', need('users.manage'), a(async (req, res) => {
    const b = req.body || {};
    if (!['moderator', 'editor', 'owner'].includes(b.role)) throw new HttpError(400, 'invalid_role');
    const u = await createUser(req.app.locals.db, { username: b.username, password: b.password, email: b.email, role: b.role });
    await log(req, 'user.create', 'user', u.id, { role: b.role });
    res.status(201).json(u);
  }));
  r.patch('/users/:id', need('users.manage'), a(async (req, res) => {
    const b = req.body || {}; const db = req.app.locals.db;
    if (req.params.id === req.user.id) throw new HttpError(400, 'cannot_edit_self', 'No podés cambiar tu propio rol ni desactivarte.');
    const u = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) throw new HttpError(404, 'not_found');
    const role = b.role !== undefined ? b.role : u.role;
    if (!['player', 'moderator', 'editor', 'owner'].includes(role)) throw new HttpError(400, 'invalid_role');
    await db.run('UPDATE users SET role = ?, disabled = ? WHERE id = ?', [role, b.disabled !== undefined ? (b.disabled ? 1 : 0) : u.disabled, u.id]);
    if (b.disabled) await db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
    await log(req, 'user.edit', 'user', u.id, b);
    res.json({ ok: true });
  }));
  r.get('/audit', need('audit.read'), a(async (req, res) => {
    const { per, offset, page } = paging(req.query, 100);
    res.json({ page, items: await req.app.locals.db.all(`SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.id DESC LIMIT ? OFFSET ?`, [per, offset]) });
  }));
  r.get('/jobs', need('dashboard'), a(async (req, res) => {
    const db = req.app.locals.db;
    res.json({ jobs: await db.all('SELECT * FROM jobs ORDER BY name'), runs: await db.all('SELECT * FROM job_runs ORDER BY id DESC LIMIT 50') });
  }));
  r.post('/jobs/:name/run', need('jobs.run'), a(async (req, res) => {
    const out = await runJob(req.app.locals.db, req.params.name);
    await log(req, 'job.run', 'job', req.params.name, { status: out.status });
    res.json(out);
  }));
  r.get('/errors', need('dashboard'), a(async (req, res) => {
    res.json({ items: await req.app.locals.db.all('SELECT * FROM error_log ORDER BY id DESC LIMIT 200') });
  }));

  return r;
};
