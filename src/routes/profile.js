'use strict';

// API del perfil personal. Todo lo que empieza con /me/ responde solo con datos de la
// cuenta con sesión o, sin cuenta, del identificador seudónimo de este navegador.

const express = require('express');
const P = require('../services/profile');
const { HttpError, uuid } = require('../services/util');
const { hit } = require('../services/ratelimit');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function profileApi() {
  const r = express.Router();
  const db = (req) => req.app.locals.db;
  const unit = (req) => P.unitFor(db(req), { user: req.user, playerId: req.playerId });
  const needUser = (req) => { if (!req.user) throw new HttpError(401, 'login_required'); return req.user; };
  const json = (fn) => a(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await fn(req, res)); });

  r.get('/me/profile', json(async (req) => ({ ...(await P.summary(db(req), await unit(req), req.user)),
    link_offer: req.user && req.anonPlayer ? { games: req.anonPlayer.games } : null })));
  r.get('/me/history', json(async (req) => P.history(db(req), await unit(req), req.query)));
  r.get('/me/games/:id', json(async (req) => P.gameDetail(db(req), await unit(req), req.params.id)));
  r.post('/me/games/:id/share', json(async (req) => {
    if (!(await hit(db(req), 'share:' + req.ipHash, 60, 'hour')).allowed) throw new HttpError(429, 'rate_limited');
    return P.shareGame(db(req), await unit(req), req.params.id, req.body || {});
  }));
  r.delete('/me/games/:id/share', json(async (req) => {
    const u = await unit(req);
    await P.gameDetail(db(req), u, req.params.id); // comprueba que la partida es propia
    await db(req).run('DELETE FROM game_shares WHERE game_id = ?', [req.params.id]);
    return { ok: true };
  }));
  r.get('/me/evolution', json(async (req) => P.evolution(db(req), await unit(req), req.query)));
  r.get('/me/strengths', json(async (req) => P.strengths(db(req), await unit(req))));
  r.get('/me/records', json(async (req) => P.records(db(req), await unit(req), req.query)));
  r.get('/me/calendar', json(async (req) => P.calendar(db(req), await unit(req), req.query)));
  r.get('/me/achievements', json(async (req) => ({ items: await P.achievementList(db(req), await unit(req)) })));
  r.get('/me/recommendations', json(async (req) => {
    if (req.user) {
      const u = await db(req).get('SELECT profile_prefs, play_variant FROM users WHERE id = ?', [req.user.id]);
      if (!P.prefsOf(u).recommendations) return { disabled: true, items: [] };
    }
    const choice = /^[a-z]{2}(-[A-Z]{2})?$/.test(req.query.choice || '') ? req.query.choice : 'es';
    return P.recommendations(db(req), await unit(req), { choice });
  }));

  // Unir las partidas jugadas sin cuenta en este navegador: solo con confirmación expresa.
  r.post('/me/link-anonymous', json(async (req) => {
    const user = needUser(req);
    if ((req.body || {}).confirm !== true) throw new HttpError(400, 'confirmation_required');
    if (!req.anonPlayer) throw new HttpError(409, 'nothing_to_link');
    return P.linkAnonymous(db(req), user, req.anonPlayer.id);
  }));

  r.put('/me/profile', json(async (req) => P.updateProfile(db(req), needUser(req).id, req.body || {})));

  // ── Objetivos ──
  r.get('/me/goals', json(async (req) => { needUser(req); return P.listGoals(db(req), await unit(req)); }));
  r.post('/me/goals', json(async (req) => P.createGoal(db(req), needUser(req).id, req.body || {})));
  r.put('/me/goals/:id', json(async (req) => P.updateGoal(db(req), needUser(req).id, req.params.id, req.body || {})));
  r.delete('/me/goals/:id', json(async (req) => {
    await db(req).run('DELETE FROM user_goals WHERE id = ? AND user_id = ?', [req.params.id, needUser(req).id]);
    return { ok: true };
  }));

  // ── Biblioteca ──
  const published = async (req, clueId) => {
    if (!(await db(req).get("SELECT 1 FROM clues WHERE id = ? AND status = 'published'", [String(clueId || '')]))) throw new HttpError(404, 'not_found');
  };
  r.get('/me/library', json(async (req) => { needUser(req); return P.library(db(req), await unit(req), req.query); }));
  r.post('/me/retry/:clueId', json(async (req) => {
    const u = needUser(req); await published(req, req.params.clueId);
    await db(req).run('INSERT OR IGNORE INTO retry_list(user_id, clue_id) VALUES (?,?)', [u.id, req.params.clueId]);
    return { ok: true };
  }));
  r.delete('/me/retry/:clueId', json(async (req) => {
    await db(req).run('DELETE FROM retry_list WHERE user_id = ? AND clue_id = ?', [needUser(req).id, req.params.clueId]);
    return { ok: true };
  }));
  r.get('/me/collections', json(async (req) => ({ items: await db(req).all(`SELECT k.id, k.name, k.created_at, (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = k.id) AS items
    FROM collections k WHERE k.user_id = ? ORDER BY k.created_at`, [needUser(req).id]) })));
  const colName = (b) => {
    const n = String((b || {}).name || '').trim();
    if (!n || n.length > 60) throw new HttpError(400, 'invalid_name', 'El nombre debe tener entre 1 y 60 caracteres.');
    return n;
  };
  r.post('/me/collections', json(async (req) => {
    const u = needUser(req); const name = colName(req.body);
    if ((await db(req).get('SELECT COUNT(*) AS n FROM collections WHERE user_id = ?', [u.id])).n >= 50) throw new HttpError(400, 'too_many', 'Podés tener hasta 50 colecciones.');
    const id = uuid();
    await db(req).run('INSERT INTO collections(id, user_id, name) VALUES (?,?,?)', [id, u.id, name]);
    return { id };
  }));
  const ownCollection = async (req) => {
    const c = await db(req).get('SELECT id FROM collections WHERE id = ? AND user_id = ?', [req.params.id, needUser(req).id]);
    if (!c) throw new HttpError(404, 'not_found');
    return c;
  };
  r.patch('/me/collections/:id', json(async (req) => {
    const c = await ownCollection(req);
    await db(req).run('UPDATE collections SET name = ? WHERE id = ?', [colName(req.body), c.id]);
    return { ok: true };
  }));
  r.delete('/me/collections/:id', json(async (req) => {
    const c = await ownCollection(req);
    await db(req).run('DELETE FROM collections WHERE id = ?', [c.id]);
    return { ok: true };
  }));
  r.post('/me/collections/:id/items', json(async (req) => {
    const c = await ownCollection(req); const clueId = String((req.body || {}).clue_id || '');
    await published(req, clueId);
    if ((await db(req).get('SELECT COUNT(*) AS n FROM collection_items WHERE collection_id = ?', [c.id])).n >= 500) throw new HttpError(400, 'too_many');
    await db(req).run('INSERT OR IGNORE INTO collection_items(collection_id, clue_id) VALUES (?,?)', [c.id, clueId]);
    return { ok: true };
  }));
  r.delete('/me/collections/:id/items/:clueId', json(async (req) => {
    const c = await ownCollection(req);
    await db(req).run('DELETE FROM collection_items WHERE collection_id = ? AND clue_id = ?', [c.id, req.params.clueId]);
    return { ok: true };
  }));

  // ── Públicos ──
  r.get('/leaderboard', a(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await P.leaderboard(db(req), req.query, req.user));
  }));
  r.get('/u/:username', a(async (req, res) => {
    const p = await P.publicProfile(db(req), req.params.username);
    if (!p) throw new HttpError(404, 'not_found');
    res.set('Cache-Control', 'no-store');
    res.json(p);
  }));
  r.get('/share/:token.svg', a(async (req, res) => {
    const c = await P.sharedCard(db(req), req.params.token);
    if (!c) throw new HttpError(404, 'not_found');
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(require('../views/share-card').svg(c, req.query.lang === 'en' ? 'en' : 'es', req.app.locals.config));
  }));
  r.get('/share/:token', a(async (req, res) => {
    const c = await P.sharedCard(db(req), req.params.token);
    if (!c) throw new HttpError(404, 'not_found');
    res.set('Cache-Control', 'no-store');
    res.json(c);
  }));

  return r;
};
