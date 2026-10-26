'use strict';

// API de duelos, torneos y amigos. Jugar exige una cuenta; ver un torneo o un desafío, no.

const express = require('express');
const A = require('../services/arena');
const { HttpError } = require('../services/util');
const { hit } = require('../services/ratelimit');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function arenaApi() {
  const r = express.Router();
  const db = (req) => req.app.locals.db;
  const needUser = (req) => {
    if (!req.user) throw new HttpError(401, 'login_required', 'Entrá o creá una cuenta gratis para jugar duelos y torneos.');
    if (req.user.role !== 'player') throw new HttpError(403, 'players_only', 'Los duelos y torneos son para cuentas de jugador.');
    return req.user;
  };
  const json = (fn) => a(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await fn(req, res)); });
  const limit = async (req, key, n, per) => {
    if (!(await hit(db(req), `${key}:${req.user ? req.user.id : req.ipHash}`, n, per)).allowed) throw new HttpError(429, 'rate_limited', 'Probá de nuevo más tarde.');
  };

  // ── Resumen para la portada y el juego ──
  r.get('/arena/pending', json(async (req) => (req.user && req.user.role === 'player' ? A.pending(db(req), req.user) : { tournament: null, duels: 0 })));

  // ── Amigos ──
  r.get('/friends', json(async (req) => A.friends(db(req), needUser(req))));
  r.post('/friends', json(async (req) => {
    const u = needUser(req); await limit(req, 'friend', 40, 'day');
    return A.requestFriend(db(req), u, (req.body || {}).username);
  }));
  r.post('/friends/:username/accept', json(async (req) => A.respondFriend(db(req), needUser(req), req.params.username, true)));
  r.delete('/friends/:username', json(async (req) => A.respondFriend(db(req), needUser(req), req.params.username, false)));

  // ── Duelos ──
  r.get('/duels', json(async (req) => A.listDuels(db(req), needUser(req))));
  r.post('/duels', json(async (req) => {
    const u = needUser(req); await limit(req, 'duel', 30, 'day');
    const b = req.body || {};
    return A.createDuel(db(req), u, { opponent: b.opponent ? String(b.opponent) : null, rounds: b.rounds, difficulty: b.difficulty });
  }));
  // Un desafío se puede ver sin cuenta (por ejemplo, desde el enlace compartido).
  r.get('/duels/:id', json(async (req) => A.getDuel(db(req), req.user, req.params.id)));
  r.post('/duels/:id/accept', json(async (req) => A.answerDuel(db(req), needUser(req), req.params.id, true)));
  r.post('/duels/:id/decline', json(async (req) => A.answerDuel(db(req), needUser(req), req.params.id, false)));
  r.post('/duels/:id/rematch', json(async (req) => {
    const u = needUser(req); await limit(req, 'duel', 30, 'day');
    return A.rematch(db(req), u, req.params.id);
  }));
  r.post('/duels/:id/rounds/:n/start', json(async (req) => A.startDuelRound(db(req), needUser(req), req.playerId, req.params.id, req.params.n)));

  // ── Torneos ──
  r.get('/tournaments', json(async (req) => A.currentTournaments(db(req), req.user)));
  r.get('/tournaments/:slug', json(async (req) => {
    const t = await A.tournamentBySlug(db(req), req.params.slug, req.user, { limit: 50 });
    if (!t) throw new HttpError(404, 'not_found');
    return t;
  }));
  r.post('/tournaments/:id/register', json(async (req) => A.register(db(req), needUser(req), req.params.id)));
  r.post('/tournaments/:id/rounds/:n/start', json(async (req) => A.startTournamentRound(db(req), needUser(req), req.playerId, req.params.id, req.params.n)));

  return r;
};
