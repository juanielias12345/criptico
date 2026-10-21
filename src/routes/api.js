'use strict';

const express = require('express');
const game = require('../services/game');
const subs = require('../services/submissions');
const auth = require('../services/auth');
const { publicClue } = require('../services/clues');
const { getSetting } = require('../services/settings');
const { hit } = require('../services/ratelimit');
const { tick } = require('../services/jobs');
const { audit } = require('../services/audit');
const { HttpError, uuid, parseJson } = require('../services/util');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function cookie(res, config, name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (config.cookieSecure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  res.append('Set-Cookie', parts.join('; '));
}

const COUNTRY_RE = /^[A-Z]{2}$/;
const CHOICE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

module.exports = function api() {
  const r = express.Router();

  r.get('/health', a(async (req, res) => {
    await req.app.locals.db.get('SELECT 1 AS ok');
    res.json({ ok: true, time: new Date().toISOString() });
  }));

  r.get('/meta', a(async (req, res) => {
    const db = req.app.locals.db;
    const languages = await db.all('SELECT code, name_native, enabled FROM languages ORDER BY sort_order');
    const variants = await db.all(`SELECT v.code, v.language_code, v.name_native, v.enabled,
      (SELECT COUNT(*) FROM clues c WHERE c.status = 'published' AND c.variant_code = v.code) AS own,
      (SELECT COUNT(*) FROM clues c WHERE c.status = 'published' AND c.language_code = v.language_code AND c.variant_code IS NULL) AS general
      FROM language_variants v ORDER BY v.code`);
    const totals = await db.all("SELECT language_code AS code, COUNT(*) AS n FROM clues WHERE status = 'published' GROUP BY language_code");
    const categories = await db.all('SELECT slug, name_es, name_en FROM categories WHERE enabled = 1 ORDER BY slug');
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ languages, variants, totals, categories, modes: await getSetting(db, 'modes.enabled'), max_hints: await getSetting(db, 'game.max_hints') });
  }));

  // ── Partidas ──
  function readStart(req) {
    const b = req.body || {};
    const choice = CHOICE_RE.test(b.choice || '') ? b.choice : 'es';
    const country = COUNTRY_RE.test(b.country || '') ? b.country : null;
    return { choice, country, mode: String(b.mode || 'infinite'), category: b.category ? String(b.category).slice(0, 40) : null,
      difficulty: b.difficulty ? Number(b.difficulty) : null, clueSlug: b.slug ? String(b.slug).slice(0, 80) : null };
  }

  async function linkPlayer(req, res, playerId) {
    const db = req.app.locals.db;
    if (playerId && playerId !== req.playerId) cookie(res, req.app.locals.config, 'pid', playerId, { maxAge: 400 * 86400 });
    if (req.user && playerId) await db.run('UPDATE players SET user_id = ? WHERE id = ? AND user_id IS NULL', [req.user.id, playerId]);
  }

  r.post('/game/start', a(async (req, res) => {
    const out = await game.startGame(req.app.locals.db, { playerId: req.playerId, ...readStart(req) });
    await linkPlayer(req, res, out.player_id);
    delete out.player_id;
    res.json(out);
  }));

  r.post('/daily/start', a(async (req, res) => {
    const out = await game.startDaily(req.app.locals.db, { playerId: req.playerId, ...readStart(req) });
    await linkPlayer(req, res, out.player_id);
    delete out.player_id;
    res.json(out);
  }));

  const needPlayer = (req) => { if (!req.playerId) throw new HttpError(404, 'game_not_found'); return req.playerId; };
  r.post('/game/:id/guess', a(async (req, res) => {
    res.json(await game.guess(req.app.locals.db, { gameId: req.params.id, playerId: needPlayer(req), answer: String((req.body || {}).answer || '').slice(0, 80) }));
  }));
  r.post('/game/:id/hint', a(async (req, res) => res.json(await game.hint(req.app.locals.db, { gameId: req.params.id, playerId: needPlayer(req) }))));
  r.post('/game/:id/reveal', a(async (req, res) => res.json(await game.reveal(req.app.locals.db, { gameId: req.params.id, playerId: needPlayer(req) }))));
  r.post('/game/:id/skip', a(async (req, res) => res.json(await game.skip(req.app.locals.db, { gameId: req.params.id, playerId: needPlayer(req), reason: (req.body || {}).reason }))));
  r.post('/game/:id/restart', a(async (req, res) => res.json(await game.restart(req.app.locals.db, { gameId: req.params.id, playerId: needPlayer(req) }))));

  // ── Archivo ──
  r.get('/clues', a(async (req, res) => {
    const db = req.app.locals.db;
    const q = req.query;
    const where = ["status = 'published'"]; const args = [];
    if (/^[a-z]{2}$/.test(q.lang || '')) { where.push('language_code = ?'); args.push(q.lang); }
    if (CHOICE_RE.test(q.variant || '') && q.variant.includes('-')) { where.push('(variant_code IS NULL OR variant_code = ?)'); args.push(q.variant); }
    if (/^[1-5]$/.test(q.difficulty || '')) { where.push('difficulty = ?'); args.push(Number(q.difficulty)); }
    if (/^[a-z_]{2,40}$/.test(q.category || '')) { where.push('category = ?'); args.push(q.category); }
    if (/^[a-z_]{2,40}$/.test(q.mechanism || '')) { where.push('mechanism = ?'); args.push(q.mechanism); }
    const page = Math.max(1, Math.min(1000, Number(q.page) || 1)); const per = 24;
    const total = (await db.get(`SELECT COUNT(*) AS n FROM clues WHERE ${where.join(' AND ')}`, args)).n;
    const rows = await db.all(`SELECT * FROM clues WHERE ${where.join(' AND ')} ORDER BY published_at DESC, id LIMIT ? OFFSET ?`, [...args, per, (page - 1) * per]);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ total, page, per_page: per, items: rows.map(publicClue) });
  }));

  r.get('/daily/archive', a(async (req, res) => {
    const db = req.app.locals.db;
    const lang = /^[a-z]{2}$/.test(req.query.lang || '') ? req.query.lang : 'es';
    const rows = await db.all(`SELECT d.date, c.* FROM daily_challenges d JOIN clues c ON c.id = d.clue_id
      WHERE d.language_code = ? AND d.date < ? AND c.status = 'published' ORDER BY d.date DESC LIMIT 60`, [lang, game.today()]);
    res.json({ items: rows.map((c) => ({ date: c.date, ...publicClue(c) })) });
  }));

  r.post('/clues/:id/report', a(async (req, res) => {
    const db = req.app.locals.db;
    const limit = await getSetting(db, 'antispam.reports_per_hour');
    if (!(await hit(db, 'report:' + req.ipHash, limit, 'hour')).allowed) throw new HttpError(429, 'rate_limited');
    const b = req.body || {};
    const reasons = ['wrong_answer', 'bad_explanation', 'typo', 'offensive', 'rights', 'other'];
    if (!reasons.includes(b.reason)) throw new HttpError(400, 'invalid_reason');
    const clue = await db.get("SELECT id FROM clues WHERE id = ? AND status = 'published'", [req.params.id]);
    if (!clue) throw new HttpError(404, 'not_found');
    await db.run('INSERT INTO clue_reports(id, clue_id, player_id, reason, message) VALUES (?,?,?,?,?)',
      [uuid(), clue.id, req.playerId, b.reason, b.message ? String(b.message).slice(0, 1000) : null]);
    res.json({ ok: true });
  }));

  // ── Propuestas ──
  r.post('/submissions', a(async (req, res) => {
    const db = req.app.locals.db;
    const b = req.body || {};
    // Anti‑spam: campo trampa invisible, tiempo mínimo de llenado y límite por día.
    if (b.website) throw new HttpError(400, 'spam_detected');
    const minSec = await getSetting(db, 'antispam.min_form_seconds');
    if (!b.form_started_at || Date.now() - Number(b.form_started_at) < minSec * 1000) throw new HttpError(400, 'too_fast', 'Tomate unos segundos para revisar el envío.');
    const perDay = await getSetting(db, 'antispam.submissions_per_day');
    const bucket = req.user ? 'sub:u:' + req.user.id : 'sub:ip:' + req.ipHash;
    if (!(await hit(db, bucket, perDay, 'day')).allowed) throw new HttpError(429, 'rate_limited', 'Alcanzaste el límite de envíos por hoy.');
    res.status(201).json(await subs.createSubmission(db, b, { userId: req.user && req.user.id, ipHash: req.ipHash }));
  }));
  r.get('/submissions/status', a(async (req, res) => res.json(await subs.getByTracking(req.app.locals.db, req.query.code))));
  r.post('/submissions/resubmit', a(async (req, res) => {
    const b = req.body || {};
    res.json(await subs.resubmit(req.app.locals.db, b.code, b));
  }));

  // ── Cuentas opcionales ──
  r.post('/auth/register', a(async (req, res) => {
    const db = req.app.locals.db;
    if (!(await hit(db, 'register:' + req.ipHash, 10, 'day')).allowed) throw new HttpError(429, 'rate_limited');
    const b = req.body || {};
    await auth.createUser(db, { username: b.username, password: b.password, email: b.email || null, role: 'player' });
    const s = await auth.login(db, { username: b.username, password: b.password, ipHash: req.ipHash, userAgent: req.headers['user-agent'] });
    cookie(res, req.app.locals.config, 'sid', s.token, { maxAge: 30 * 86400 });
    if (req.playerId) await db.run('UPDATE players SET user_id = ? WHERE id = ? AND user_id IS NULL', [s.user.id, req.playerId]);
    res.status(201).json({ user: s.user, csrf: s.csrf });
  }));
  r.post('/auth/login', a(async (req, res) => {
    const db = req.app.locals.db;
    if (!(await hit(db, 'login:' + req.ipHash, 20, 'hour')).allowed) throw new HttpError(429, 'rate_limited');
    const b = req.body || {};
    const s = await auth.login(db, { username: b.username, password: b.password, ipHash: req.ipHash, userAgent: req.headers['user-agent'], adminOnly: b.admin === true });
    const hours = s.user.role === 'player' ? 30 * 24 : 12;
    cookie(res, req.app.locals.config, 'sid', s.token, { maxAge: hours * 3600 });
    if (req.playerId) await db.run('UPDATE players SET user_id = ? WHERE id = ? AND user_id IS NULL', [s.user.id, req.playerId]);
    if (s.user.role !== 'player') await audit(db, { actorId: s.user.id, action: 'admin.login', ipHash: req.ipHash });
    res.json({ user: s.user, csrf: s.csrf });
  }));
  r.post('/auth/logout', a(async (req, res) => {
    await auth.logout(req.app.locals.db, req.cookies.sid);
    cookie(res, req.app.locals.config, 'sid', '', { maxAge: 0 });
    res.json({ ok: true });
  }));
  r.get('/auth/me', a(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: req.user, csrf: req.session ? req.session.csrf : null });
  }));

  const needUser = (req) => { if (!req.user) throw new HttpError(401, 'login_required'); return req.user; };

  r.get('/me/stats', a(async (req, res) => {
    const db = req.app.locals.db;
    let ids = req.playerId ? [req.playerId] : [];
    if (req.user) ids = [...new Set([...ids, ...(await db.all('SELECT id FROM players WHERE user_id = ?', [req.user.id])).map((p) => p.id)])];
    res.set('Cache-Control', 'no-store');
    res.json(await game.playerStats(db, { playerIds: ids }));
  }));
  r.put('/me/prefs', a(async (req, res) => {
    const u = needUser(req); const b = req.body || {};
    await req.app.locals.db.run('UPDATE users SET country_code = ?, play_variant = ?, ui_language = ? WHERE id = ?',
      [COUNTRY_RE.test(b.country || '') ? b.country : null, CHOICE_RE.test(b.choice || '') ? b.choice : null, ['es', 'en'].includes(b.ui) ? b.ui : null, u.id]);
    res.json({ ok: true });
  }));
  r.get('/me/favorites', a(async (req, res) => {
    const u = needUser(req);
    const rows = await req.app.locals.db.all(`SELECT c.* FROM favorites f JOIN clues c ON c.id = f.clue_id
      WHERE f.user_id = ? AND c.status = 'published' ORDER BY f.created_at DESC LIMIT 200`, [u.id]);
    res.json({ items: rows.map(publicClue) });
  }));
  r.post('/me/favorites/:clueId', a(async (req, res) => {
    const u = needUser(req); const db = req.app.locals.db;
    if (!(await db.get("SELECT 1 FROM clues WHERE id = ? AND status = 'published'", [req.params.clueId]))) throw new HttpError(404, 'not_found');
    await db.run('INSERT OR IGNORE INTO favorites(user_id, clue_id) VALUES (?,?)', [u.id, req.params.clueId]);
    res.json({ ok: true });
  }));
  r.delete('/me/favorites/:clueId', a(async (req, res) => {
    const u = needUser(req);
    await req.app.locals.db.run('DELETE FROM favorites WHERE user_id = ? AND clue_id = ?', [u.id, req.params.clueId]);
    res.json({ ok: true });
  }));
  r.get('/me/submissions', a(async (req, res) => {
    const u = needUser(req);
    const rows = await req.app.locals.db.all(`SELECT id, clue_text, answer, status, moderator_note, created_at, updated_at
      FROM submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`, [u.id]);
    res.json({ items: rows.map((s) => ({ ...s, moderator_note: ['needs_changes', 'rejected'].includes(s.status) ? s.moderator_note : null })) });
  }));
  r.get('/me/notifications', a(async (req, res) => {
    const u = needUser(req); const db = req.app.locals.db;
    const rows = await db.all('SELECT id, kind, payload, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', [u.id]);
    await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [new Date().toISOString(), u.id]);
    res.json({ items: rows.map((n) => ({ ...n, payload: parseJson(n.payload, {}) })) });
  }));
  // Borrado de cuenta a pedido de la persona (derecho de supresión).
  r.delete('/me/account', a(async (req, res) => {
    const u = needUser(req); const db = req.app.locals.db;
    if (u.role !== 'player') throw new HttpError(400, 'staff_account', 'Las cuentas de administración se eliminan desde el panel.');
    await db.run('UPDATE submissions SET user_id = NULL WHERE user_id = ?', [u.id]);
    await db.run('DELETE FROM users WHERE id = ?', [u.id]);
    cookie(res, req.app.locals.config, 'sid', '', { maxAge: 0 });
    res.json({ ok: true });
  }));

  // ── Tareas programadas (Vercel Cron) ──
  const cron = a(async (req, res) => {
    const { config, db } = req.app.locals;
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!config.cronSecret || given !== config.cronSecret) throw new HttpError(401, 'unauthorized');
    res.json({ ran: await tick(db) });
  });
  r.get('/cron/tick', cron);
  r.post('/cron/tick', cron);

  return r;
};
