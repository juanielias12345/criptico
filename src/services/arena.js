'use strict';

// Duelos, torneos y amigos. Reglas y puntaje: docs/ARENA.md.
// Las rondas son partidas normales (modos 'duel' y 'tournament'): el servidor mide el
// tiempo desde que entrega el críptico, igual que en el resto del juego.
// Los totales se guardan ya sumados (duels, tournament_entries) para que listar un
// duelo o un ranking lea pocas filas: la base remota cobra por fila leída.

const { publicClue, solutionView } = require('./clues');
const { getSetting } = require('./settings');
const { uuid, now, parseJson, HttpError, randomToken } = require('./util');

const DAY = 86400000;
const ONLINE_MS = 10 * 60000;          // «conectado»: actividad en los últimos 10 minutos
const DUEL_HOURS = 72;                 // tiempo para jugar un duelo
const MIN_VALID_MS = 3000;             // menos que esto no suma bonus de velocidad
const SPEED_FULL_MS = 10000;           // bonus completo hasta 10 s
const SPEED_ZERO_MS = 180000;          // sin bonus desde 3 min
const WEEKLY_DAYS = 7;
const WEEKLY_DIFFICULTY = [2, 2, 3, 3, 3, 4, 4];
const ARENA_MODES = ['duel', 'tournament'];

const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const nameOf = (u) => (u && (u.public_name || u.username)) || null;

// ── Puntaje ──
// Resuelto: 100 de base, −20 por pista y −10 por intento errado (mínimo 20),
// más hasta 100 de velocidad (completo hasta 10 s, cero desde 3 min).
// Revelado, abandonado o vencido: 0.
function scoreOf({ result, attempts, hints, ms }) {
  if (result !== 'solved') return { points: 0, base: 0, speed: 0 };
  const base = Math.max(20, 100 - 20 * (hints || 0) - 10 * Math.max(0, (attempts || 1) - 1));
  let speed = 0;
  if (Number.isFinite(ms) && ms >= MIN_VALID_MS) {
    speed = Math.round(100 * Math.min(1, Math.max(0, (SPEED_ZERO_MS - ms) / (SPEED_ZERO_MS - SPEED_FULL_MS))));
  }
  return { points: base + speed, base, speed };
}

// ── Sorteo de crípticos ──
// Para torneos y duelos: publicados, generales (sin variante regional) y, si hay,
// de los ya auditados o escritos por el equipo. Lee una fila por críptico.
async function pickClues(db, lang, difficulties) {
  const out = [];
  for (const d of difficulties) {
    let row = null;
    for (const audited of [true, false]) {
      for (const withDiff of d ? [true, false] : [false]) {
        const start = Math.floor(Math.random() * 1e9);
        const where = ["status = 'published'", 'language_code = ?', 'variant_code IS NULL'];
        const args = [lang];
        if (withDiff) { where.push('difficulty = ?'); args.push(d); }
        if (audited) where.push("(origin <> 'generated' OR audit_status = 'ok')");
        if (out.length) { where.push(`id NOT IN (${out.map(() => '?').join(',')})`); args.push(...out); }
        row = await db.get(`SELECT id FROM clues WHERE ${where.join(' AND ')} AND shuffle >= ? ORDER BY shuffle LIMIT 1`, [...args, start])
          || await db.get(`SELECT id FROM clues WHERE ${where.join(' AND ')} ORDER BY shuffle LIMIT 1`, args);
        if (row) break;
      }
      if (row) break;
    }
    if (!row) throw new HttpError(409, 'not_enough_clues', 'Todavía no hay crípticos suficientes para armar esta partida.');
    out.push(row.id);
  }
  return out;
}

// ── Jugador de la cuenta ──
// Las rondas se juegan con el identificador de jugador de la cuenta (el de este navegador si ya es suyo).
async function playerFor(db, user, playerId) {
  if (playerId) {
    const p = await db.get('SELECT id FROM players WHERE id = ? AND user_id = ?', [playerId, user.id]);
    if (p) return p.id;
  }
  const own = await db.get('SELECT id FROM players WHERE user_id = ? AND retired_at IS NULL ORDER BY last_seen_at DESC LIMIT 1', [user.id]);
  if (own) return own.id;
  const id = uuid();
  await db.run('INSERT INTO players(id, user_id) VALUES (?,?)', [id, user.id]);
  return id;
}

// Empieza (o retoma) una ronda. Una ronda empezada no se puede volver a empezar:
// el reloj sigue corriendo aunque se cierre la pestaña.
async function startRound(db, { kind, refId, user, playerId, round, clueId }) {
  const game = require('./game');
  const prev = await db.get('SELECT a.game_id, a.points, a.result, g.finished_at FROM arena_games a JOIN games g ON g.id = a.game_id WHERE a.kind = ? AND a.ref_id = ? AND a.user_id = ? AND a.round = ?',
    [kind, refId, user.id, round]);
  const clue = await db.get('SELECT * FROM clues WHERE id = ?', [clueId]);
  if (!clue) throw new HttpError(404, 'clue_not_found');
  const maxHints = await getSetting(db, 'game.max_hints');
  if (prev) {
    if (prev.finished_at) return { game_id: prev.game_id, finished: true, points: prev.points, result: prev.result, clue: publicClue(clue), solution: solutionView(clue) };
    return { game_id: prev.game_id, resumed: true, clue: publicClue(clue), max_hints: maxHints };
  }
  const pid = await playerFor(db, user, playerId);
  const gameId = await game.insertGame(db, { playerId: pid, clueId, mode: kind, variant: 'es' });
  try {
    await db.run('INSERT INTO arena_games(game_id, kind, ref_id, user_id, round) VALUES (?,?,?,?,?)', [gameId, kind, refId, user.id, round]);
  } catch (e) {
    // Dos pedidos simultáneos: gana el primero y esta partida se descarta.
    await db.run('DELETE FROM games WHERE id = ?', [gameId]);
    return startRound(db, { kind, refId, user, playerId, round, clueId });
  }
  await db.run('UPDATE users SET last_active_at = ? WHERE id = ?', [now(), user.id]);
  return { game_id: gameId, clue: publicClue(clue), max_hints: maxHints };
}

// Lo llama el motor de partidas al cerrar una partida de duelo o torneo (una sola vez).
async function onGameClosed(db, gameId) {
  const a = await db.get('SELECT * FROM arena_games WHERE game_id = ?', [gameId]);
  if (!a || a.points !== null) return null;
  const g = await db.get('SELECT result, attempts, hints_used, duration_ms FROM games WHERE id = ?', [gameId]);
  const s = scoreOf({ result: g.result, attempts: g.attempts, hints: g.hints_used, ms: g.duration_ms });
  const ms = g.result === 'solved' ? g.duration_ms || 0 : 0;
  const r = await db.run('UPDATE arena_games SET points = ?, result = ?, ms = ? WHERE game_id = ? AND points IS NULL', [s.points, g.result, ms, gameId]);
  if (!r.changes) return null;
  if (a.kind === 'tournament') {
    await db.run(`UPDATE tournament_entries SET points = points + ?, solved = solved + ?, time_ms = time_ms + ?, rounds_played = rounds_played + 1
      WHERE tournament_id = ? AND user_id = ?`, [s.points, g.result === 'solved' ? 1 : 0, ms, a.ref_id, a.user_id]);
  } else {
    const d = await db.get('SELECT * FROM duels WHERE id = ?', [a.ref_id]);
    if (d) {
      const side = d.challenger_id === a.user_id ? 'challenger' : 'opponent';
      await db.run(`UPDATE duels SET ${side}_points = ${side}_points + ?, ${side}_done = ${side}_done + 1, ${side}_ms = ${side}_ms + ? WHERE id = ?`, [s.points, ms, d.id]);
      await settleDuel(db, d.id);
    }
  }
  return { ...s, result: g.result };
}

// ═════════════ Amigos ═════════════

const pair = (x, y) => (x < y ? [x, y] : [y, x]);

async function findPlayerUser(db, username) {
  const u = await db.get("SELECT id, username, public_name, last_active_at FROM users WHERE username = ? AND role = 'player' AND disabled = 0 AND deleted_at IS NULL",
    [String(username || '').trim().replace(/^@/, '').slice(0, 40)]);
  if (!u) throw new HttpError(404, 'user_not_found', 'No encontramos a nadie con ese usuario.');
  return u;
}

async function requestFriend(db, user, username) {
  const other = await findPlayerUser(db, username);
  if (other.id === user.id) throw new HttpError(400, 'self', 'No podés agregarte a vos.');
  const [a, b] = pair(user.id, other.id);
  const cur = await db.get('SELECT * FROM friendships WHERE a_id = ? AND b_id = ?', [a, b]);
  if (cur && cur.status === 'accepted') return { status: 'accepted', username: other.username };
  if (cur && cur.requested_by !== user.id) {
    // La otra persona ya lo había pedido: queda aceptado.
    await db.run("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE a_id = ? AND b_id = ?", [now(), a, b]);
    return { status: 'accepted', username: other.username };
  }
  if (!cur) await db.run('INSERT INTO friendships(a_id, b_id, requested_by) VALUES (?,?,?)', [a, b, user.id]);
  return { status: 'pending', username: other.username };
}

async function respondFriend(db, user, username, accept) {
  const other = await findPlayerUser(db, username);
  const [a, b] = pair(user.id, other.id);
  const cur = await db.get('SELECT * FROM friendships WHERE a_id = ? AND b_id = ?', [a, b]);
  if (!cur) throw new HttpError(404, 'not_found');
  if (!accept) { await db.run('DELETE FROM friendships WHERE a_id = ? AND b_id = ?', [a, b]); return { ok: true }; }
  if (cur.requested_by === user.id) throw new HttpError(409, 'own_request', 'Esperá a que la otra persona acepte.');
  await db.run("UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE a_id = ? AND b_id = ? AND status = 'pending'", [now(), a, b]);
  return { ok: true, status: 'accepted' };
}

async function friends(db, user) {
  const rows = await db.all(`SELECT f.status, f.requested_by, u.username, u.public_name, u.last_active_at FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.a_id = ? THEN f.b_id ELSE f.a_id END
    WHERE (f.a_id = ? OR f.b_id = ?) AND u.deleted_at IS NULL AND u.disabled = 0 ORDER BY u.last_active_at DESC LIMIT 300`, [user.id, user.id, user.id]);
  const t = Date.now();
  const view = (r) => ({ username: r.username, name: nameOf(r), online: !!r.last_active_at && t - Date.parse(r.last_active_at) < ONLINE_MS });
  return {
    friends: rows.filter((r) => r.status === 'accepted').map(view),
    incoming: rows.filter((r) => r.status === 'pending' && r.requested_by !== user.id).map(view),
    outgoing: rows.filter((r) => r.status === 'pending' && r.requested_by === user.id).map(view),
  };
}

// ═════════════ Duelos ═════════════

async function createDuel(db, user, { opponent, rounds, difficulty, rematchOf } = {}) {
  const n = [3, 5].includes(Number(rounds)) ? Number(rounds) : 3;
  const diff = /^[1-5]$/.test(String(difficulty || '')) ? Number(difficulty) : null;
  let opp = null;
  if (opponent) {
    opp = await findPlayerUser(db, opponent);
    if (opp.id === user.id) throw new HttpError(400, 'self', 'No podés desafiarte a vos.');
  }
  const diffs = diff ? Array(n).fill(diff) : (n === 3 ? [2, 3, 4] : [2, 2, 3, 3, 4]);
  const clueIds = await pickClues(db, 'es', diffs);
  const id = uuid();
  const token = randomToken(12);
  const expires = new Date(Date.now() + DUEL_HOURS * 3600000).toISOString();
  await db.run(`INSERT INTO duels(id, token, challenger_id, opponent_id, rounds, difficulty, clue_ids, status, expires_at, rematch_of)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, token, user.id, opp ? opp.id : null, n, diff, JSON.stringify(clueIds), opp ? 'pending' : 'open', expires, rematchOf || null]);
  return { id, token };
}

async function rematch(db, user, duelId) {
  const d = await db.get('SELECT * FROM duels WHERE id = ?', [duelId]);
  if (!d || (d.challenger_id !== user.id && d.opponent_id !== user.id) || !d.opponent_id) throw new HttpError(404, 'not_found');
  if (d.status !== 'finished') throw new HttpError(409, 'duel_open', 'El duelo todavía no terminó.');
  const otherId = d.challenger_id === user.id ? d.opponent_id : d.challenger_id;
  const other = await db.get('SELECT username FROM users WHERE id = ? AND deleted_at IS NULL AND disabled = 0', [otherId]);
  if (!other) throw new HttpError(404, 'user_not_found');
  return createDuel(db, user, { opponent: other.username, rounds: d.rounds, difficulty: d.difficulty, rematchOf: d.id });
}

// Cierra el duelo cuando los dos jugaron todas las rondas, o cuando vence.
// Si vence, las rondas sin jugar valen 0; si el rival nunca entró, el duelo vence sin ganador.
async function settleDuel(db, id) {
  const d = await db.get('SELECT * FROM duels WHERE id = ?', [id]);
  if (!d || ['finished', 'declined', 'expired', 'cancelled'].includes(d.status)) return d;
  const expired = Date.parse(d.expires_at) <= Date.now();
  const allDone = d.opponent_id && d.challenger_done >= d.rounds && d.opponent_done >= d.rounds;
  if (!allDone && !expired) return d;
  if (expired && (!d.opponent_id || d.status !== 'active')) {
    await db.run("UPDATE duels SET status = 'expired', finished_at = ? WHERE id = ? AND status IN ('open','pending')", [now(), id]);
    return db.get('SELECT * FROM duels WHERE id = ?', [id]);
  }
  let winner = null;
  if (d.challenger_points !== d.opponent_points) winner = d.challenger_points > d.opponent_points ? d.challenger_id : d.opponent_id;
  else if (d.challenger_ms !== d.opponent_ms && d.challenger_points > 0) winner = d.challenger_ms < d.opponent_ms ? d.challenger_id : d.opponent_id;
  await db.run("UPDATE duels SET status = 'finished', winner_id = ?, finished_at = ? WHERE id = ? AND status = 'active'", [winner, now(), id]);
  return db.get('SELECT * FROM duels WHERE id = ?', [id]);
}

async function duelView(db, d, user) {
  const ids = [d.challenger_id, d.opponent_id].filter(Boolean);
  const users = await db.all(`SELECT id, username, public_name, last_active_at FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const by = Object.fromEntries(users.map((u) => [u.id, u]));
  const me = user ? (d.challenger_id === user.id ? 'challenger' : d.opponent_id === user.id ? 'opponent' : null) : null;
  const person = (uid) => (uid && by[uid] ? { username: by[uid].username, name: nameOf(by[uid]),
    online: !!by[uid].last_active_at && Date.now() - Date.parse(by[uid].last_active_at) < ONLINE_MS } : null);
  const out = {
    id: d.id, token: d.token, status: d.status, rounds: d.rounds, difficulty: d.difficulty, created_at: d.created_at, expires_at: d.expires_at, finished_at: d.finished_at,
    challenger: { ...person(d.challenger_id), points: d.challenger_points, done: d.challenger_done },
    opponent: d.opponent_id ? { ...person(d.opponent_id), points: d.opponent_points, done: d.opponent_done } : null,
    me, winner: d.winner_id ? (d.winner_id === d.challenger_id ? 'challenger' : 'opponent') : null,
  };
  // Mientras el duelo sigue, nadie ve los puntos del rival ronda por ronda: solo cuántas jugó.
  if (me) {
    const mine = await db.all("SELECT round, points, result FROM arena_games WHERE kind = 'duel' AND ref_id = ? AND user_id = ? ORDER BY round", [d.id, user.id]);
    out.my_rounds = mine;
  }
  if (d.status !== 'finished' && me) {
    const other = me === 'challenger' ? 'opponent' : 'challenger';
    if (out[other]) out[other].points = null;
  }
  return out;
}

async function getDuel(db, user, idOrToken) {
  let d = await db.get('SELECT * FROM duels WHERE id = ? OR token = ?', [String(idOrToken), String(idOrToken)]);
  if (!d) throw new HttpError(404, 'not_found');
  d = await settleDuel(db, d.id);
  return duelView(db, d, user);
}

async function listDuels(db, user) {
  const rows = await db.all(`SELECT * FROM duels WHERE challenger_id = ? OR opponent_id = ? ORDER BY created_at DESC LIMIT 30`, [user.id, user.id]);
  const out = [];
  for (let d of rows) {
    if (!['finished', 'declined', 'expired', 'cancelled'].includes(d.status) && Date.parse(d.expires_at) <= Date.now()) d = await settleDuel(db, d.id);
    out.push(await duelView(db, d, user));
  }
  const rec = await db.get(`SELECT SUM(CASE WHEN winner_id = ? THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN winner_id IS NOT NULL AND winner_id <> ? THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END) AS tied
    FROM duels WHERE status = 'finished' AND (challenger_id = ? OR opponent_id = ?)`, [user.id, user.id, user.id, user.id]);
  return { items: out, record: { won: rec.won || 0, lost: rec.lost || 0, tied: rec.tied || 0 } };
}

async function answerDuel(db, user, idOrToken, accept) {
  const d0 = await db.get('SELECT * FROM duels WHERE id = ? OR token = ?', [String(idOrToken), String(idOrToken)]);
  if (!d0) throw new HttpError(404, 'not_found');
  const d = await settleDuel(db, d0.id);
  if (d.challenger_id === user.id) {
    if (accept) throw new HttpError(409, 'own_duel', 'Este desafío es tuyo: compartí el enlace con quien quieras desafiar.');
    if (['open', 'pending'].includes(d.status)) await db.run("UPDATE duels SET status = 'cancelled', finished_at = ? WHERE id = ?", [now(), d.id]);
    return getDuel(db, user, d.id);
  }
  if (d.status === 'open') {
    if (!accept) return getDuel(db, user, d.id);
    const r = await db.run("UPDATE duels SET opponent_id = ?, status = 'active', accepted_at = ? WHERE id = ? AND status = 'open' AND opponent_id IS NULL", [user.id, now(), d.id]);
    if (!r.changes) throw new HttpError(409, 'taken', 'Otra persona ya tomó este desafío.');
  } else if (d.status === 'pending' && d.opponent_id === user.id) {
    await db.run(`UPDATE duels SET status = ?, accepted_at = ?, finished_at = ? WHERE id = ? AND status = 'pending'`,
      [accept ? 'active' : 'declined', accept ? now() : null, accept ? null : now(), d.id]);
  } else if (d.opponent_id !== user.id) {
    throw new HttpError(409, 'taken', 'Este desafío es para otra persona.');
  }
  const after = await settleDuel(db, d.id);
  return duelView(db, after, user);
}

async function startDuelRound(db, user, playerId, duelId, round) {
  const found = await db.get('SELECT id FROM duels WHERE id = ?', [String(duelId)]);
  if (!found) throw new HttpError(404, 'not_found');
  const d = await settleDuel(db, found.id);
  const side = d.challenger_id === user.id ? 'challenger' : d.opponent_id === user.id ? 'opponent' : null;
  if (!side) throw new HttpError(404, 'not_found');
  // Quien desafía puede jugar enseguida; quien recibe, después de aceptar.
  const playable = side === 'challenger' ? ['open', 'pending', 'active'] : ['active'];
  if (!playable.includes(d.status)) throw new HttpError(409, 'duel_closed', d.status === 'pending' ? 'Primero aceptá el desafío.' : 'Este duelo ya terminó.');
  const n = Number(round);
  if (!Number.isInteger(n) || n < 0 || n >= d.rounds) throw new HttpError(400, 'invalid_round');
  // Las rondas se juegan en orden.
  if (n > d[side + '_done']) {
    const open = await db.get("SELECT 1 FROM arena_games WHERE kind = 'duel' AND ref_id = ? AND user_id = ? AND round = ?", [d.id, user.id, n]);
    if (!open) throw new HttpError(409, 'round_locked', 'Terminá la ronda anterior primero.');
  }
  return startRound(db, { kind: 'duel', refId: d.id, user, playerId, round: n, clueId: parseJson(d.clue_ids, [])[n] });
}

// ═════════════ Torneos ═════════════

// Lunes (UTC) de la semana de una fecha.
function mondayOf(t = Date.now()) {
  const d = new Date(dayStr(t) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return dayStr(d.getTime());
}

const fmtDay = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);

// El torneo semanal se arma solo la primera vez que alguien lo pide esa semana.
async function ensureWeekly(db, lang = 'es', at = Date.now()) {
  const start = mondayOf(at);
  const slug = `semanal-${start}`;
  const cur = await db.get('SELECT * FROM tournaments WHERE slug = ?', [slug]);
  if (cur) return cur;
  let clueIds;
  try { clueIds = await pickClues(db, lang, WEEKLY_DIFFICULTY); } catch (e) { if (e.code === 'not_enough_clues') return null; throw e; }
  const end = dayStr(Date.parse(start + 'T00:00:00Z') + (WEEKLY_DAYS - 1) * DAY);
  await db.run(`INSERT OR IGNORE INTO tournaments(id, slug, title, kind, language_code, starts_on, days, clue_ids) VALUES (?,?,?,?,?,?,?,?)`,
    [uuid(), slug, `Torneo semanal ${fmtDay(start)} al ${fmtDay(end)}`, 'weekly', lang, start, WEEKLY_DAYS, JSON.stringify(clueIds)]);
  return db.get('SELECT * FROM tournaments WHERE slug = ?', [slug]);
}

// Cada ronda se abre en su día (00:00 UTC) y se puede jugar ese día y el siguiente,
// sin pasar del final del torneo.
function roundWindow(t, i) {
  const s = Date.parse(t.starts_on + 'T00:00:00Z');
  const end = s + t.days * DAY;
  return { opens: s + i * DAY, closes: Math.min(s + (i + 2) * DAY, end) };
}
function tournamentState(t, at = Date.now()) {
  const s = Date.parse(t.starts_on + 'T00:00:00Z');
  if (t.status === 'cancelled') return 'cancelled';
  if (at < s) return 'upcoming';
  if (at >= s + t.days * DAY) return 'finished';
  return 'live';
}

async function standings(db, t, { limit = 20, user } = {}) {
  const rows = await db.all(`SELECT e.user_id, e.points, e.solved, e.time_ms, e.rounds_played, u.username, u.public_name FROM tournament_entries e
    JOIN users u ON u.id = e.user_id WHERE e.tournament_id = ? AND u.deleted_at IS NULL AND u.disabled = 0
    ORDER BY e.points DESC, e.time_ms ASC, e.registered_at ASC LIMIT ?`, [t.id, limit]);
  const players = (await db.get('SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ?', [t.id])).n;
  let me = null;
  if (user) {
    const e = await db.get('SELECT * FROM tournament_entries WHERE tournament_id = ? AND user_id = ?', [t.id, user.id]);
    if (e) {
      const ahead = (await db.get(`SELECT COUNT(*) AS n FROM tournament_entries WHERE tournament_id = ? AND (points > ? OR (points = ? AND time_ms < ?)
        OR (points = ? AND time_ms = ? AND registered_at < ?))`, [t.id, e.points, e.points, e.time_ms, e.points, e.time_ms, e.registered_at])).n;
      me = { rank: ahead + 1, points: e.points, solved: e.solved, rounds_played: e.rounds_played, time_ms: e.time_ms };
    }
  }
  return { players, me, items: rows.map((r, i) => ({ rank: i + 1, name: nameOf(r), username: r.username, points: r.points, solved: r.solved, me: !!(user && user.id === r.user_id) })) };
}

async function tournamentView(db, t, user, { limit = 20 } = {}) {
  const at = Date.now();
  const st = await standings(db, t, { limit, user });
  const mine = user && st.me ? Object.fromEntries((await db.all("SELECT round, points, result FROM arena_games WHERE kind = 'tournament' AND ref_id = ? AND user_id = ?", [t.id, user.id]))
    .map((r) => [r.round, r])) : {};
  const rounds = [...Array(t.days)].map((_, i) => {
    const w = roundWindow(t, i);
    const played = mine[i];
    const state = played ? (played.points === null ? 'playing' : 'played') : at < w.opens ? 'locked' : at >= w.closes ? 'missed' : 'open';
    return { round: i, day: dayStr(w.opens), opens_at: new Date(w.opens).toISOString(), closes_at: new Date(w.closes).toISOString(), state,
      points: played ? played.points : null, result: played ? played.result : null };
  });
  return { id: t.id, slug: t.slug, title: t.title, kind: t.kind, starts_on: t.starts_on, days: t.days,
    ends_on: dayStr(Date.parse(t.starts_on + 'T00:00:00Z') + (t.days - 1) * DAY), state: tournamentState(t, at),
    registered: !!st.me, rounds, standings: { players: st.players, items: st.items, me: st.me } };
}

async function currentTournaments(db, user) {
  const cur = await ensureWeekly(db, 'es');
  const prev = await db.get("SELECT * FROM tournaments WHERE language_code = 'es' AND starts_on < ? ORDER BY starts_on DESC LIMIT 1", [cur ? cur.starts_on : mondayOf()]);
  return {
    current: cur ? await tournamentView(db, cur, user) : null,
    previous: prev ? { slug: prev.slug, title: prev.title, podium: (await standings(db, prev, { limit: 3 })).items } : null,
  };
}

async function tournamentBySlug(db, slug, user, opts) {
  const t = await db.get('SELECT * FROM tournaments WHERE slug = ?', [String(slug || '').slice(0, 60)]);
  if (!t) return null;
  return tournamentView(db, t, user, opts);
}

async function register(db, user, tournamentId) {
  const t = await db.get('SELECT * FROM tournaments WHERE id = ? OR slug = ?', [String(tournamentId), String(tournamentId)]);
  if (!t) throw new HttpError(404, 'not_found');
  const st = tournamentState(t);
  if (st === 'finished' || st === 'cancelled') throw new HttpError(409, 'tournament_closed', 'Este torneo ya terminó. Anotate en el de esta semana.');
  await db.run('INSERT OR IGNORE INTO tournament_entries(tournament_id, user_id) VALUES (?,?)', [t.id, user.id]);
  return tournamentView(db, t, user);
}

async function startTournamentRound(db, user, playerId, tournamentId, round) {
  const t = await db.get('SELECT * FROM tournaments WHERE id = ?', [String(tournamentId)]);
  if (!t) throw new HttpError(404, 'not_found');
  if (!(await db.get('SELECT 1 FROM tournament_entries WHERE tournament_id = ? AND user_id = ?', [t.id, user.id]))) {
    throw new HttpError(403, 'not_registered', 'Inscribite en el torneo para jugarlo.');
  }
  const n = Number(round);
  if (!Number.isInteger(n) || n < 0 || n >= t.days) throw new HttpError(400, 'invalid_round');
  const w = roundWindow(t, n);
  const existing = await db.get("SELECT 1 FROM arena_games WHERE kind = 'tournament' AND ref_id = ? AND user_id = ? AND round = ?", [t.id, user.id, n]);
  if (!existing) {
    if (Date.now() < w.opens) throw new HttpError(409, 'round_locked', 'Esta ronda todavía no se abrió.');
    if (Date.now() >= w.closes) throw new HttpError(409, 'round_closed', 'Esta ronda ya cerró.');
  }
  return startRound(db, { kind: 'tournament', refId: t.id, user, playerId, round: n, clueId: parseJson(t.clue_ids, [])[n] });
}

// Resumen para el aviso de la portada y del juego: ¿hay una ronda esperándote hoy?
async function pending(db, user) {
  const t = await ensureWeekly(db, 'es');
  if (!t) return { tournament: null, duels: 0 };
  const v = await tournamentView(db, t, user, { limit: 3 });
  const duels = (await db.get(`SELECT COUNT(*) AS n FROM duels WHERE expires_at > ? AND ((opponent_id = ? AND status = 'pending')
    OR (status = 'active' AND ((challenger_id = ? AND challenger_done < rounds) OR (opponent_id = ? AND opponent_done < rounds))))`, [now(), user.id, user.id, user.id])).n;
  return { tournament: { slug: v.slug, title: v.title, registered: v.registered, open_rounds: v.rounds.filter((r) => r.state === 'open').length, me: v.standings.me }, duels };
}

// Al eliminar una cuenta: fuera de amistades y rankings; sus desafíos abiertos se cancelan.
async function forgetUser(t, userId) {
  await t.run('DELETE FROM friendships WHERE a_id = ? OR b_id = ?', [userId, userId]);
  await t.run('DELETE FROM tournament_entries WHERE user_id = ?', [userId]);
  await t.run("UPDATE duels SET status = 'cancelled', finished_at = ? WHERE (challenger_id = ? OR opponent_id = ?) AND status IN ('open','pending','active')", [now(), userId, userId]);
}

module.exports = {
  ARENA_MODES, scoreOf, pickClues, onGameClosed, requestFriend, respondFriend, friends,
  createDuel, rematch, getDuel, listDuels, answerDuel, startDuelRound, settleDuel,
  ensureWeekly, currentTournaments, tournamentBySlug, register, startTournamentRound, pending, forgetUser, mondayOf, roundWindow,
};
