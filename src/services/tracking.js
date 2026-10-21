'use strict';

// Seguimiento de partidas: eventos, tiempo activo estimado y estados.
// Reglas (documentadas en docs/PANEL.md):
//  - Cada acción suma al tiempo activo el lapso desde la acción anterior, con un tope
//    (analytics.active_gap_seconds): una pausa larga no cuenta como atención.
//  - Una partida sin actividad durante analytics.abandon_minutes pasa a «abandonada»
//    (o «interrumpida por error» si tuvo errores del servidor). Si la persona vuelve y
//    sigue jugando, se retoma y vuelve a «en curso».
//  - No se guarda el texto que la persona escribe: solo el tipo de evento.

const { getSetting } = require('./settings');
const { now } = require('./util');

const EVENT_KINDS = new Set(['start', 'resume', 'guess_wrong', 'guess_repeat', 'guess_correct', 'hint', 'reveal', 'skip', 'timeout', 'abandon', 'error', 'restart']);

async function event(db, gameId, kind, data) {
  if (!EVENT_KINDS.has(kind)) throw new Error('unknown_event ' + kind);
  await db.run('INSERT INTO game_events(game_id, kind, data) VALUES (?,?,?)', [gameId, kind, data ? JSON.stringify(data) : null]);
}

// Milisegundos activos a sumar desde la última actividad registrada.
async function activeDelta(db, g, at = Date.now()) {
  const cap = (await getSetting(db, 'analytics.active_gap_seconds')) * 1000;
  const last = Date.parse(g.last_activity_at || g.started_at);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, Math.min(at - last, cap));
}

// Si la partida había sido clasificada como abandonada por inactividad y la persona
// vuelve, se retoma: vuelve a «en curso» y queda un evento «resume».
async function resumeIfAbandoned(db, g) {
  if (g.finished_at || !['abandoned', 'error'].includes(g.status)) return g;
  const r = await db.run("UPDATE games SET status = 'in_progress', end_reason = NULL WHERE id = ? AND finished_at IS NULL AND status IN ('abandoned','error')", [g.id]);
  if (r.changes) await event(db, g.id, 'resume', { after: g.end_reason });
  return { ...g, status: 'in_progress', end_reason: null };
}

async function bumpPlayerDay(db, playerId, { games = 0, solved = 0 } = {}, at = now()) {
  await db.run(`INSERT INTO player_days(player_id, day, games, solved) VALUES (?,?,?,?)
    ON CONFLICT(player_id, day) DO UPDATE SET games = games + excluded.games, solved = solved + excluded.solved`,
  [playerId, at.slice(0, 10), games, solved]);
}

// Latido del navegador mientras la pestaña está visible y la persona interactúa.
async function ping(db, g) {
  if (g.finished_at) return { ok: true, finished: true };
  const at = Date.now();
  const last = Date.parse(g.last_activity_at || g.started_at);
  if (at - last < 10000) return { ok: true };
  const delta = await activeDelta(db, g, at);
  await db.run('UPDATE games SET active_ms = active_ms + ?, last_activity_at = ? WHERE id = ? AND finished_at IS NULL', [delta, new Date(at).toISOString(), g.id]);
  if (['abandoned', 'error'].includes(g.status)) await resumeIfAbandoned(db, g);
  return { ok: true };
}

async function markError(db, gameId, scope) {
  try {
    const g = await db.get('SELECT id, finished_at FROM games WHERE id = ?', [gameId]);
    if (!g) return;
    await db.run('UPDATE games SET error_count = error_count + 1 WHERE id = ?', [gameId]);
    await event(db, gameId, 'error', { scope });
  } catch { /* nunca romper la respuesta por el registro */ }
}

// Clasifica las partidas sin actividad. Devuelve cuántas cambió.
async function classifyStale(db) {
  const minutes = await getSetting(db, 'analytics.abandon_minutes');
  const cut = new Date(Date.now() - minutes * 60000).toISOString();
  const stale = await db.all(`SELECT id, error_count FROM games WHERE finished_at IS NULL AND status IN ('started','in_progress')
    AND COALESCE(last_activity_at, started_at) < ? LIMIT 2000`, [cut]);
  for (const g of stale) {
    const errored = g.error_count > 0;
    const r = await db.run(`UPDATE games SET status = ?, end_reason = ? WHERE id = ? AND finished_at IS NULL AND status IN ('started','in_progress')`,
      [errored ? 'error' : 'abandoned', errored ? 'server_error' : 'inactivity', g.id]);
    if (r.changes) await event(db, g.id, 'abandon', { reason: errored ? 'server_error' : 'inactivity', minutes });
  }
  return stale.length;
}

module.exports = { event, activeDelta, resumeIfAbandoned, bumpPlayerDay, ping, markError, classifyStale, EVENT_KINDS };
