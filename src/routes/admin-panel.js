'use strict';

// API del centro de control: indicadores, usuarios, partidas, regiones, embudo,
// retención, rendimiento de crípticos, alertas, privacidad y exportaciones.
// Cada ruta exige un permiso verificado aquí, en el servidor.

const express = require('express');
const { can, ROLE_LABELS, PERMISSIONS } = require('../services/auth');
const analytics = require('../services/analytics');
const people = require('../services/people');
const alerts = require('../services/alerts');
const { HttpError, now, parseJson } = require('../services/util');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// CSV con protección contra inyección de fórmulas en hojas de cálculo.
function csv(rows, cols) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

const MAX_EXPORT = 50000;

module.exports = function panel({ need, log }) {
  const r = express.Router();

  r.get('/panel/meta', need('dashboard'), a(async (req, res) => {
    res.json({ roles: ROLE_LABELS, role_permissions: PERMISSIONS, definitions: analytics.METRIC_DEFS, periods: analytics.PERIODS,
      clue_sorts: Object.keys(analytics.CLUE_SORTS), game_statuses: people.GAME_STATUSES });
  }));

  // ── Indicadores ──
  r.get('/analytics/overview', need('analytics.read'), a(async (req, res) => res.json(await analytics.overview(req.app.locals.db, req.query))));
  r.get('/analytics/geo', need('analytics.read'), a(async (req, res) => res.json(await analytics.geo(req.app.locals.db, req.query))));
  r.get('/analytics/origins', need('analytics.read'), a(async (req, res) => res.json(await analytics.origins(req.app.locals.db, req.query))));
  r.get('/analytics/funnel', need('analytics.read'), a(async (req, res) => res.json(await analytics.funnel(req.app.locals.db, req.query))));
  r.get('/analytics/retention', need('analytics.read'), a(async (req, res) => res.json(await analytics.retention(req.app.locals.db, req.query))));
  r.get('/analytics/clues', need('analytics.read'), a(async (req, res) => res.json(await analytics.clueStats(req.app.locals.db, req.query))));
  r.get('/analytics/catalog', need('catalog.read'), a(async (req, res) => res.json(await analytics.catalogStats(req.app.locals.db))));
  r.get('/analytics/imports', need('sources.read'), a(async (req, res) => res.json(await analytics.importStats(req.app.locals.db))));
  r.post('/analytics/refresh', need('analytics.read'), a(async (req, res) => res.json(await analytics.refresh(req.app.locals.db, { force: true }))));

  // ── Usuarios registrados ──
  const pii = (req) => can(req.user, 'players.pii');
  r.get('/players', need('players.read'), a(async (req, res) => {
    if (req.query.q && String(req.query.q).includes('@') && !pii(req)) throw new HttpError(403, 'forbidden', 'Tu rol no puede buscar por correo electrónico.');
    res.json(await people.listUsers(req.app.locals.db, req.query, { pii: pii(req) }));
  }));
  r.get('/players/:id', need('players.read'), a(async (req, res) => {
    const out = await people.userDetail(req.app.locals.db, req.params.id, { pii: pii(req) });
    if (pii(req)) await log(req, 'user.view_pii', 'user', req.params.id);
    res.json(out);
  }));
  r.get('/players/:id/games', need('games.read'), a(async (req, res) => res.json(await people.listGames(req.app.locals.db, req.query, { userId: req.params.id }))));
  r.get('/players/:id/performance', need('players.read'), a(async (req, res) => res.json(await people.userPerformance(req.app.locals.db, req.params.id))));
  r.get('/players/:id/contributions', need('players.read'), a(async (req, res) => res.json(await people.userContributions(req.app.locals.db, req.params.id))));
  r.get('/players/:id/timeline', need('players.read'), a(async (req, res) => res.json(await people.userTimeline(req.app.locals.db, req.params.id))));
  r.get('/players/:id/admin-history', need('players.read'), a(async (req, res) => res.json(await people.adminHistory(req.app.locals.db, req.params.id))));
  r.post('/players/:id/suspend', need('players.manage'), a(async (req, res) => {
    const out = await people.setSuspended(req.app.locals.db, req.params.id, true);
    await log(req, 'user.suspend', 'user', req.params.id, { reason: String((req.body || {}).reason || '').slice(0, 300) || null });
    res.json(out);
  }));
  r.post('/players/:id/reactivate', need('players.manage'), a(async (req, res) => {
    const out = await people.setSuspended(req.app.locals.db, req.params.id, false);
    await log(req, 'user.reactivate', 'user', req.params.id);
    res.json(out);
  }));
  r.post('/players/:id/anonymize', need('privacy.manage'), a(async (req, res) => {
    if ((req.body || {}).confirm !== 'ELIMINAR') throw new HttpError(400, 'confirmation_required', 'Escribí ELIMINAR para confirmar.');
    const out = await people.anonymizeUser(req.app.locals.db, req.params.id);
    await log(req, 'user.anonymize', 'user', req.params.id);
    res.json(out);
  }));

  // ── Partidas ──
  r.get('/games', need('games.read'), a(async (req, res) => res.json(await people.listGames(req.app.locals.db, req.query, { showUser: can(req.user, 'players.read') }))));
  r.get('/games/:id', need('games.read'), a(async (req, res) => res.json(await people.gameDetail(req.app.locals.db, req.params.id, { showUser: can(req.user, 'players.read') }))));

  // ── Alertas ──
  r.get('/alerts', need('alerts.read'), a(async (req, res) => {
    const db = req.app.locals.db; const w = []; const args = [];
    if (['open', 'acknowledged', 'resolved'].includes(req.query.status)) { w.push('status = ?'); args.push(req.query.status); } else w.push("status <> 'resolved'");
    if (['info', 'warning', 'critical'].includes(req.query.severity)) { w.push('severity = ?'); args.push(req.query.severity); }
    const items = await db.all(`SELECT * FROM alerts WHERE ${w.join(' AND ')} ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      last_seen_at DESC LIMIT 200`, args);
    const counts = await db.all('SELECT status, severity, COUNT(*) AS n FROM alerts GROUP BY status, severity');
    const job = await db.get("SELECT last_run_at, last_status FROM jobs WHERE name = 'alerts_scan'");
    res.json({ items: items.map((x) => ({ ...x, details: parseJson(x.details, {}) })), counts, last_scan: job });
  }));
  r.post('/alerts/scan', need('alerts.manage'), a(async (req, res) => {
    const out = await alerts.scan(req.app.locals.db);
    await log(req, 'alerts.scan', 'alerts', null, out);
    res.json(out);
  }));
  r.post('/alerts/:id', need('alerts.manage'), a(async (req, res) => {
    const status = (req.body || {}).status;
    if (!['open', 'acknowledged', 'resolved'].includes(status)) throw new HttpError(400, 'invalid_status');
    const db = req.app.locals.db;
    const r2 = await db.run('UPDATE alerts SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?',
      [status, status === 'resolved' ? now() : null, status === 'resolved' ? req.user.id : null, Number(req.params.id)]);
    if (!r2.changes) throw new HttpError(404, 'not_found');
    await log(req, 'alert.' + status, 'alert', req.params.id);
    res.json({ ok: true });
  }));

  // ── Privacidad: solicitudes de acceso, corrección y eliminación ──
  r.get('/privacy/requests', need('privacy.manage'), a(async (req, res) => {
    const db = req.app.locals.db;
    const st = ['open', 'in_progress', 'done', 'rejected'].includes(req.query.status) ? req.query.status : null;
    const items = await db.all(`SELECT d.*, u.username, u.email, u.deleted_at, x.username AS resolved_by_name FROM data_requests d
      LEFT JOIN users u ON u.id = d.user_id LEFT JOIN users x ON x.id = d.resolved_by ${st ? 'WHERE d.status = ?' : ''}
      ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, d.created_at DESC LIMIT 200`, st ? [st] : []);
    res.json({ items });
  }));
  r.post('/privacy/requests/:id', need('privacy.manage'), a(async (req, res) => {
    const db = req.app.locals.db; const b = req.body || {};
    const d = await db.get('SELECT * FROM data_requests WHERE id = ?', [req.params.id]);
    if (!d) throw new HttpError(404, 'not_found');
    if (!['in_progress', 'done', 'rejected'].includes(b.status)) throw new HttpError(400, 'invalid_status');
    // Completar una solicitud de eliminación anonimiza la cuenta.
    if (d.kind === 'deletion' && b.status === 'done' && d.user_id) await people.anonymizeUser(db, d.user_id);
    await db.run('UPDATE data_requests SET status = ?, resolution_note = ?, resolved_at = ?, resolved_by = ? WHERE id = ?',
      [b.status, b.note ? String(b.note).slice(0, 2000) : null, ['done', 'rejected'].includes(b.status) ? now() : null, req.user.id, d.id]);
    await log(req, 'privacy.' + d.kind + '.' + b.status, 'user', d.user_id, { request: d.id });
    res.json({ ok: true });
  }));

  // ── Exportaciones CSV ──
  const EXPORTS = {
    bank: { perm: 'bank.read', async rows(db, q) {
      const m = await require('../services/bank').matrix(db, q);
      return { rows: m.cells, cols: ['lang', 'difficulty', 'target', 'generated', 'validated', 'published', 'published_original', 'published_external',
        'published_community', 'pending', 'rejected', 'duplicates', 'unverified', 'percent', 'missing', 'last_run', 'status', 'batches'] };
    } },
    catalog: { perm: 'catalog.read', async rows(db, q) {
      const f = require('../services/bank').clueFilter({ lang: q.lang, difficulty: q.difficulty, origin: q.origin, author: q.author,
        source: q.source, license: q.license, status: q.status, mechanism: q.mechanism });
      const rows = await db.all(`SELECT c.id, c.slug, c.language_code, c.variant_code, c.difficulty, c.mechanism, c.mechanisms_secondary, c.category,
          c.clue_text, c.answer, c.answer_length, c.definition, c.explanation, c.origin, c.status, c.validation_status, c.rights_status,
          COALESCE(c.author_name, 'desconocido') AS author, c.source_id, c.source_url, c.license_id, c.attribution, c.batch_id,
          c.generator_version, c.dedup_key, c.audit_status, c.created_at, c.published_at
        FROM clues c WHERE ${f.where} ORDER BY c.language_code, c.difficulty, c.created_at LIMIT ?`, [...f.args, MAX_EXPORT]);
      return { rows, cols: ['id', 'slug', 'language_code', 'variant_code', 'difficulty', 'mechanism', 'mechanisms_secondary', 'category', 'clue_text', 'answer',
        'answer_length', 'definition', 'explanation', 'origin', 'status', 'validation_status', 'rights_status', 'author', 'source_id', 'source_url', 'license_id',
        'attribution', 'batch_id', 'generator_version', 'dedup_key', 'audit_status', 'created_at', 'published_at'] };
    } },
    users: { perm: 'players.read', async rows(db, q, req) {
      const withEmail = can(req.user, 'export.pii') && q.include_email === '1';
      const out = []; let page = 1;
      while (out.length < MAX_EXPORT) {
        const r2 = await people.listUsers(db, { ...q, per: 100, page }, { pii: withEmail });
        out.push(...r2.items); if (r2.items.length < 100) break; page++;
      }
      const cols = ['id', 'username', 'display_name', ...(withEmail ? ['email'] : []), 'email_verified', 'status', 'created_at', 'last_login_at', 'last_active_at',
        'country_code', 'play_variant', 'ui_language', 'games', 'completed', 'solved', 'abandoned', 'revealed', 'wrong', 'hints', 'solve_rate', 'avg_solve_ms', 'active_ms', 'last_game_at'];
      return { rows: out, cols, pii: withEmail };
    } },
    games: { perm: 'games.read', async rows(db, q) {
      const out = []; let page = 1;
      while (out.length < MAX_EXPORT) {
        const r2 = await people.listGames(db, { ...q, per: 100, page }, {}); out.push(...r2.items);
        if (r2.items.length < 100) break; page++;
      }
      return { rows: out, cols: ['id', 'player_id', 'registered', 'clue_id', 'clue_text', 'language_code', 'difficulty', 'mechanism', 'mode', 'play_variant', 'country_code',
        'started_at', 'last_activity_at', 'finished_at', 'status', 'end_reason', 'attempts', 'wrong_attempts', 'hints_used', 'elapsed_ms', 'active_ms'] };
    } },
    daily: { perm: 'analytics.read', async rows(db, q) {
      const p = analytics.parsePeriod(q); const f = analytics.readFilters(q);
      await analytics.refresh(db);
      const w = ['day >= ?', 'day < ?']; const args = [p.from.slice(0, 10), p.to.slice(0, 10)];
      if (f.country) { w.push('country_code = ?'); args.push(f.country); }
      if (f.lang) { w.push('language_code = ?'); args.push(f.lang); }
      if (f.variant) { w.push('play_variant = ?'); args.push(f.variant); }
      const rows = await db.all(`SELECT day, language_code, country_code, play_variant, mode, started, completed, solved, revealed, abandoned, expired, errored,
        wrong, hints, active_ms, solve_ms_sum, players FROM stats_daily WHERE ${w.join(' AND ')} ORDER BY day`, args);
      return { rows, cols: ['day', 'language_code', 'country_code', 'play_variant', 'mode', 'started', 'completed', 'solved', 'revealed', 'abandoned', 'expired', 'errored', 'wrong', 'hints', 'active_ms', 'solve_ms_sum', 'players'] };
    } },
    countries: { perm: 'analytics.read', async rows(db, q) {
      const g = await analytics.geo(db, q);
      return { rows: g.countries, cols: ['country', 'players', 'games', 'solved', 'solve_rate', 'active_ms', 'users', 'new_users', 'active_users'] };
    } },
    languages: { perm: 'analytics.read', async rows(db, q) {
      const g = await analytics.geo(db, q);
      return { rows: [...g.languages.map((l) => ({ kind: 'language', key: l.lang, games: l.games, players: l.players })),
        ...g.variants.map((v) => ({ kind: 'variant', key: v.variant, games: v.games, players: v.players }))], cols: ['kind', 'key', 'games', 'players'] };
    } },
    clues: { perm: 'analytics.read', async rows(db, q) {
      const out = []; let page = 1;
      while (out.length < MAX_EXPORT) {
        const r2 = await analytics.clueStats(db, { ...q, per: 100, page }); out.push(...r2.items);
        if (r2.items.length < 100) break; page++;
      }
      return { rows: out, cols: ['id', 'clue_text', 'answer', 'language_code', 'variant_code', 'difficulty', 'mechanism', 'origin', 'status', 'plays', 'solved', 'wrong',
        'abandoned', 'revealed', 'solve_rate', 'abandon_rate', 'reveal_rate', 'avg_solve_ms', 'median_solve_ms', 'hints_avg', 'reports_open', 'review'] };
    } },
    retention: { perm: 'analytics.read', async rows(db, q) {
      const r2 = await analytics.retention(db, q);
      return { rows: r2.cohorts, cols: ['week', 'size', 'd1', 'd7', 'd30', 'returned'] };
    } },
    imports: { perm: 'sources.read', async rows(db) {
      const r2 = await analytics.importStats(db);
      return { rows: r2.sources, cols: ['id', 'name', 'url', 'country_code', 'language_code', 'access_method', 'license_name', 'status', 'last_success_at', 'items',
        'auto_published', 'published_manual', 'discarded', 'duplicates', 'errors', 'review', 'consecutive_failures', 'last_error'] };
    } },
    submissions: { perm: 'submissions.read', async rows(db, q) {
      const st = ['pending', 'in_review', 'needs_changes', 'approved', 'published', 'rejected'].includes(q.status) ? q.status : null;
      const rows = await db.all(`SELECT id, created_at, updated_at, status, clue_text, answer, language_code, variant_code, category, difficulty, public_name,
        (SELECT COUNT(*) FROM submission_events e WHERE e.submission_id = s.id) AS events FROM submissions s ${st ? 'WHERE status = ?' : ''}
        ORDER BY created_at LIMIT ?`, st ? [st, MAX_EXPORT] : [MAX_EXPORT]);
      return { rows, cols: ['id', 'created_at', 'updated_at', 'status', 'clue_text', 'answer', 'language_code', 'variant_code', 'category', 'difficulty', 'public_name', 'events'] };
    } },
  };

  r.get('/export/:report', need('export.data'), a(async (req, res) => {
    const name = String(req.params.report).replace(/\.csv$/, '');
    const def = EXPORTS[name];
    if (!def) throw new HttpError(404, 'not_found');
    if (!can(req.user, def.perm)) throw new HttpError(403, 'forbidden', 'Tu rol no puede exportar este informe.');
    const { rows, cols, pii: hasPii } = await def.rows(req.app.locals.db, req.query, req);
    const filters = { ...req.query }; delete filters.include_email;
    await log(req, 'export.' + name, 'export', name, { rows: rows.length, filters, personal_data: !!hasPii });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}-${now().slice(0, 10)}.csv"`);
    res.send(csv(rows, cols));
  }));

  return r;
};

module.exports.csv = csv;
