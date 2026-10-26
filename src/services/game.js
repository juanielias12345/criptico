'use strict';

// Motor de partidas. Las partidas son ilimitadas: no hay tope diario.
// El servidor nunca envía la respuesta antes de que el jugador acierte o la revele.

const N = require('../lib/normalize');
const { walk } = require('../lib/validator/wordplay');
const { publicClue, solutionView } = require('./clues');
const { getSetting } = require('./settings');
const { uuid, now, parseJson, HttpError, sha256 } = require('./util');
const track = require('./tracking');
const profile = require('./profile');

const MODES = {
  quick: {}, infinite: {}, practice: { noStats: true }, streak: {}, shared: {}, archive: {},
  beginner: { maxDifficulty: 2 }, intermediate: { minDifficulty: 2, maxDifficulty: 3 }, expert: { minDifficulty: 3 },
  guided: { maxDifficulty: 3 }, timed: {}, themed: { needsCategory: true }, daily: {},
};

// Modos de duelos y torneos: sus partidas las crea services/arena.js, no startGame.
const ARENA_MODES = ['duel', 'tournament'];

async function ensurePlayer(db, playerId, { country, variant, origin } = {}) {
  if (playerId && /^[0-9a-f-]{36}$/.test(playerId)) {
    const p = await db.get('SELECT * FROM players WHERE id = ?', [playerId]);
    if (p) {
      await db.run('UPDATE players SET last_seen_at = ?, country_code = COALESCE(?, country_code), play_variant = COALESCE(?, play_variant) WHERE id = ?',
        [now(), country || null, variant || null, playerId]);
      return { ...p, isNew: false };
    }
  }
  const id = uuid();
  const o = origin || {};
  await db.run(`INSERT INTO players(id, country_code, play_variant, origin_source, origin_medium, origin_campaign, origin_referrer, origin_landing)
    VALUES (?,?,?,?,?,?,?,?)`, [id, country || null, variant || null, o.source || null, o.medium || null, o.campaign || null, o.referrer || null, o.landing || null]);
  return { id, isNew: true };
}

// Interpreta la elección de juego: 'es' = todas las variantes; 'es-AR' = general + rioplatense.
async function resolveVariant(db, choice) {
  const lang = N.baseLang(choice);
  const language = await db.get('SELECT code, enabled FROM languages WHERE code = ?', [lang]);
  if (!language || !language.enabled) return { lang, variant: null, enabled: false };
  if (choice && choice.includes('-')) {
    const v = await db.get('SELECT code, enabled, min_clues FROM language_variants WHERE code = ?', [choice]);
    if (v && v.enabled) return { lang, variant: v.code, minClues: v.min_clues, enabled: true };
  }
  return { lang, variant: null, enabled: true };
}

function poolFilter({ lang, variant, mode, category, difficulty, mechanism }) {
  const where = ["c.status = 'published'", 'c.language_code = ?'];
  const args = [lang];
  if (variant) { where.push('(c.variant_code IS NULL OR c.variant_code = ?)'); args.push(variant); }
  const m = MODES[mode] || {};
  if (m.minDifficulty) { where.push('c.difficulty >= ?'); args.push(m.minDifficulty); }
  if (m.maxDifficulty) { where.push('c.difficulty <= ?'); args.push(m.maxDifficulty); }
  if (difficulty) { where.push('c.difficulty = ?'); args.push(Number(difficulty)); }
  if (category) { where.push('c.category = ?'); args.push(category); }
  if (mechanism) { where.push('c.mechanism = ?'); args.push(mechanism); }
  return { where: where.join(' AND '), args };
}

// Sorteo rápido: cada críptico tiene una clave aleatoria fija (shuffle) indexada.
// Se parte de un punto al azar y se toman los siguientes, salteando los que el
// jugador vio hace poco. Lee unas decenas de filas aunque haya cien mil.
async function pickUnseen(db, filter, playerId, windowSize) {
  const recent = new Set((await db.all('SELECT clue_id FROM games WHERE player_id = ? ORDER BY started_at DESC LIMIT ?', [playerId, windowSize])).map((r) => r.clue_id));
  const start = Math.floor(Math.random() * 1e9);
  for (const wrap of [false, true]) {
    let cursor = wrap ? -1 : start - 1;
    for (let page = 0; page < 5; page++) {
      const rows = await db.all(`SELECT c.* FROM clues c WHERE ${filter.where} AND c.shuffle > ? ${wrap ? 'AND c.shuffle < ?' : ''}
        ORDER BY c.shuffle LIMIT 60`, wrap ? [...filter.args, cursor, start] : [...filter.args, cursor]);
      const fresh = rows.find((r) => !recent.has(r.id));
      if (fresh) return fresh;
      if (rows.length < 60) break;
      cursor = rows[rows.length - 1].shuffle;
    }
  }
  return null;
}

async function contentNotice(db, sel, pool) {
  if (pool === 0) {
    const others = await db.all(
      `SELECT c.language_code AS lang, c.variant_code AS variant, COUNT(*) AS n FROM clues c
       JOIN languages l ON l.code = c.language_code AND l.enabled = 1
       WHERE c.status = 'published' GROUP BY c.language_code, c.variant_code ORDER BY n DESC LIMIT 6`);
    return { kind: 'empty', alternatives: others };
  }
  if (sel.variant) {
    const own = await db.get("SELECT COUNT(*) AS n FROM clues WHERE status = 'published' AND variant_code = ?", [sel.variant]);
    if (own.n < (sel.minClues || 10)) return { kind: 'few_regional', regional: own.n, total: pool };
  }
  return null;
}

async function startGame(db, { playerId, choice, mode = 'infinite', category, difficulty, mechanism, country, clueSlug, origin }) {
  if (!MODES[mode]) throw new HttpError(400, 'invalid_mode');
  const enabled = await getSetting(db, 'modes.enabled');
  if (!enabled.includes(mode)) throw new HttpError(403, 'mode_disabled', 'Este modo de juego no está disponible.');
  if (MODES[mode].needsCategory && !category) throw new HttpError(400, 'category_required');
  const sel = await resolveVariant(db, choice || 'es');
  if (!sel.enabled) {
    return { clue: null, notice: { kind: 'language_unavailable', language: sel.lang } };
  }
  const player = await ensurePlayer(db, playerId, { country, variant: choice, origin });

  let clue = null; let recycled = false;
  const filter = poolFilter({ lang: sel.lang, variant: sel.variant, mode, category, difficulty, mechanism });
  // Conteo acotado: con decenas de miles de crípticos solo importa si hay o no.
  const poolRow = await db.get(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM clues c WHERE ${filter.where} LIMIT 1000)`, filter.args);
  const notice = await contentNotice(db, sel, poolRow.n);

  if (clueSlug) {
    clue = await db.get("SELECT * FROM clues WHERE slug = ? AND status = 'published'", [clueSlug]);
    if (!clue) throw new HttpError(404, 'clue_not_found');
  } else if (poolRow.n > 0) {
    clue = await pickUnseen(db, filter, player.id, await getSetting(db, 'game.recent_window'));
    if (!clue) {
      // Ya vio todo el conjunto: se repite el que vio hace más tiempo.
      recycled = true;
      clue = await db.get(
        `SELECT c.* FROM clues c LEFT JOIN (SELECT clue_id, MAX(started_at) AS last FROM games WHERE player_id = ? GROUP BY clue_id) g
         ON g.clue_id = c.id WHERE ${filter.where} ORDER BY g.last ASC, random() LIMIT 1`, [player.id, ...filter.args]);
    }
  }
  if (!clue) return { player_id: player.id, clue: null, notice: notice || { kind: 'empty', alternatives: [] } };

  const gameId = await insertGame(db, { playerId: player.id, clueId: clue.id, mode, variant: choice, country });
  return {
    player_id: player.id, game_id: gameId, clue: publicClue(clue), notice, recycled,
    max_hints: await getSetting(db, 'game.max_hints'),
    timed_seconds: mode === 'timed' ? await getSetting(db, 'game.timed_seconds') : null,
  };
}

async function insertGame(db, { playerId, clueId, mode, variant, country, dailyDate, restartOf }) {
  const id = uuid(); const at = now();
  await db.run(`INSERT INTO games(id, player_id, clue_id, mode, play_variant, country_code, daily_date, started_at, last_activity_at, status)
    VALUES (?,?,?,?,?,?,?,?,?, 'started')`, [id, playerId, clueId, mode, variant || null, country || null, dailyDate || null, at, at]);
  await track.event(db, id, 'start', restartOf ? { restart_of: restartOf } : null);
  await track.bumpPlayerDay(db, playerId, { games: 1 }, at);
  return id;
}

async function loadGame(db, gameId, playerId) {
  const g = await db.get('SELECT * FROM games WHERE id = ?', [gameId]);
  if (!g || g.player_id !== playerId) throw new HttpError(404, 'game_not_found');
  const clue = await db.get('SELECT * FROM clues WHERE id = ?', [g.clue_id]);
  return { g, clue };
}

const FINAL = { solved: ['solved', 'solved'], revealed: ['revealed', 'revealed'], skipped: ['abandoned', 'skipped'], timeout: ['expired', 'timeout'] };

// Cierra la partida una sola vez (la condición finished_at IS NULL evita dobles cierres).
async function finish(db, g, result, extra = {}) {
  const at = Date.now();
  const duration = at - Date.parse(g.started_at);
  const delta = await track.activeDelta(db, g, at);
  const [status, reason] = FINAL[result];
  const r = await db.run(`UPDATE games SET finished_at = ?, result = ?, duration_ms = ?, status = ?, end_reason = ?, last_activity_at = ?,
    active_ms = active_ms + ?, attempts = attempts + ? WHERE id = ? AND finished_at IS NULL`,
  [new Date(at).toISOString(), result, duration, status, reason, new Date(at).toISOString(), delta, extra.attempt ? 1 : 0, g.id]);
  if (!r.changes) return false;
  await track.event(db, g.id, { solved: 'guess_correct', revealed: 'reveal', skipped: 'skip', timeout: 'timeout' }[result], extra.data || null);
  if (result === 'solved') await track.bumpPlayerDay(db, g.player_id, { solved: 1 });
  // Duelos y torneos: los puntos de la ronda se suman al cerrar la partida.
  if (ARENA_MODES.includes(g.mode)) await require('./arena').onGameClosed(db, g.id);
  return true;
}

// Comparación de respuestas: se ignoran mayúsculas, espacios, signos y tildes
// que no cambian la letra. Variantes ortográficas aceptadas solo si el críptico las declara.
async function guess(db, { gameId, playerId, answer }) {
  const { g, clue } = await loadGame(db, gameId, playerId);
  const lang = clue.language_code;
  const key = N.answerKey(answer, lang);
  if (!key) return { correct: false, empty: true, attempts: g.attempts };
  if (g.finished_at) {
    // Partida ya cerrada: no se penaliza ni se vuelve a contar.
    return { correct: key === clue.answer_key, finished: true, result: g.result, solution: solutionView(clue) };
  }
  const accepted = [clue.answer_key, ...parseJson(clue.alt_answers, [])];
  const cur = await track.resumeIfAbandoned(db, g);
  if (accepted.includes(key)) {
    const closed = await finish(db, cur, 'solved', { attempt: true, data: { answer: key } });
    const attempts = (await db.get('SELECT attempts FROM games WHERE id = ?', [g.id])).attempts;
    const achievements = closed && g.mode !== 'practice' ? await profile.onGameFinished(db, g.player_id, g.id) : [];
    return { correct: true, attempts, hints_used: g.hints_used, solution: solutionView(clue), daily: g.daily_date ? await dailySummary(db, g.daily_date, lang) : null, achievements };
  }
  const feedback = [];
  if (key.length !== clue.answer_key.length) feedback.push({ code: 'length', expected: clue.answer_key.length, got: key.length });
  else if (key.replace(/Ñ/g, 'N') === clue.answer_key.replace(/Ñ/g, 'N')) feedback.push({ code: 'enye' });
  // El mismo intento repetido (por ejemplo, un reenvío tras un corte de conexión) no se cuenta dos veces.
  const delta = await track.activeDelta(db, cur);
  const r = await db.run(`UPDATE games SET attempts = attempts + 1, wrong_attempts = wrong_attempts + 1, last_wrong_key = ?, status = 'in_progress',
    active_ms = active_ms + ?, last_activity_at = ? WHERE id = ? AND finished_at IS NULL AND (last_wrong_key IS NULL OR last_wrong_key <> ?)`,
  [key, delta, now(), g.id, key]);
  // Se guarda la respuesta normalizada (mayúsculas, sin espacios): es lo que la persona ve en su historial.
  await track.event(db, g.id, r.changes ? 'guess_wrong' : 'guess_repeat', { answer: key, length: key.length });
  const attempts = (await db.get('SELECT attempts FROM games WHERE id = ?', [g.id])).attempts;
  return { correct: false, attempts, feedback, repeated: !r.changes };
}

// «level» es la pista que el navegador pide (1, 2…). Si ya se entregó, se devuelve
// sin sumar: un reenvío por un corte de conexión o un doble clic no cuenta dos veces.
async function hint(db, { gameId, playerId, level: wanted }) {
  const { g, clue } = await loadGame(db, gameId, playerId);
  const max = await getSetting(db, 'game.max_hints');
  if (Number.isInteger(wanted) && wanted >= 1 && wanted <= g.hints_used) {
    return { hints: buildHints(clue, g.hints_used), hints_used: g.hints_used, max_hints: max, repeated: true };
  }
  const level = Math.min(g.hints_used + 1, max);
  if (!g.finished_at && g.hints_used < max) {
    const cur = await track.resumeIfAbandoned(db, g);
    const delta = await track.activeDelta(db, cur);
    // Condición sobre el valor leído: dos pedidos simultáneos no suman dos pistas.
    const r = await db.run(`UPDATE games SET hints_used = ?, status = 'in_progress', active_ms = active_ms + ?, last_activity_at = ?
      WHERE id = ? AND hints_used = ? AND finished_at IS NULL`, [level, delta, now(), g.id, g.hints_used]);
    if (r.changes) await track.event(db, g.id, 'hint', { level, kind: (buildHints(clue, level)[level - 1] || {}).kind || null });
  }
  return { hints: buildHints(clue, level), hints_used: level, max_hints: max };
}

function buildHints(clue, level) {
  const mech = clue.mechanism;
  const wordplay = parseJson(clue.wordplay, null);
  // El indicador (la palabra que avisa el tipo de juego) acompaña a la primera pista.
  let indicator = null;
  const stored = parseJson(clue.hints, null);
  if (Array.isArray(stored)) indicator = (stored.find((h) => h.kind === 'indicator') || {}).text || null;
  else if (wordplay) walk(wordplay, (n) => { if (!indicator && n.indicator) indicator = n.indicator; });
  const out = [{ kind: 'mechanism', mechanism: mech, indicator }];
  if (level >= 2) {
    const def = clue.definition || (wordplay && wordplay.op === 'double' ? wordplay.definitions[0] : null);
    out.push(def ? { kind: 'definition', text: def } : { kind: 'definition', text: null });
  }
  if (level >= 3) out.push({ kind: 'first_letter', letter: clue.answer_key[0] });
  if (level >= 4) {
    const pattern = [...clue.answer_key].map((ch, i) => (i % 2 === 0 ? ch : '_')).join('');
    out.push({ kind: 'pattern', pattern });
  }
  return out;
}

async function reveal(db, { gameId, playerId }) {
  const { g, clue } = await loadGame(db, gameId, playerId);
  const closed = !g.finished_at && await finish(db, g, 'revealed');
  const achievements = closed && g.mode !== 'practice' ? await profile.onGameFinished(db, g.player_id, g.id) : [];
  return { solution: solutionView(clue), daily: g.daily_date ? await dailySummary(db, g.daily_date, clue.language_code) : null, achievements };
}

async function skip(db, { gameId, playerId, reason }) {
  const { g } = await loadGame(db, gameId, playerId);
  const closed = !g.finished_at && await finish(db, g, reason === 'timeout' ? 'timeout' : 'skipped');
  // Abandonar también puede completar logros de constancia (por ejemplo, días jugados).
  const achievements = closed && g.mode !== 'practice' ? await profile.onGameFinished(db, g.player_id, g.id) : [];
  return { ok: true, achievements };
}

// Reinicia una partida no resuelta: mismos datos, contadores a cero.
async function restart(db, { gameId, playerId }) {
  const { g, clue } = await loadGame(db, gameId, playerId);
  if (g.result === 'solved') throw new HttpError(409, 'already_solved');
  // Una ronda de duelo o torneo se juega una sola vez.
  if (ARENA_MODES.includes(g.mode)) throw new HttpError(409, 'arena_round', 'Las rondas de duelos y torneos no se pueden reiniciar.');
  if (!g.finished_at) await finish(db, g, 'skipped', { data: { restarted: true } });
  const id = await insertGame(db, { playerId, clueId: g.clue_id, mode: g.mode, variant: g.play_variant, country: g.country_code, dailyDate: g.daily_date, restartOf: g.id });
  return { game_id: id, clue: publicClue(clue) };
}

// ── Desafío diario (opcional y compartido; no limita el modo infinito) ──

function today() { return new Date().toISOString().slice(0, 10); }

async function ensureDaily(db, lang, date = today()) {
  const existing = await db.get('SELECT clue_id FROM daily_challenges WHERE date = ? AND language_code = ?', [date, lang]);
  if (existing) return existing.clue_id;
  // Primero los escritos por el equipo, los externos y los generados que ya pasaron
  // la auditoría humana; si no queda ninguno, cualquier publicado.
  const base = `SELECT id FROM clues WHERE status = 'published' AND language_code = ? AND variant_code IS NULL AND daily_eligible = 1
     AND id NOT IN (SELECT clue_id FROM daily_challenges WHERE language_code = ?)`;
  let pick = await db.all(`${base} AND (origin <> 'generated' OR audit_status = 'ok') ORDER BY id`, [lang, lang]);
  if (!pick.length) pick = await db.all(`${base} ORDER BY id`, [lang, lang]);
  if (!pick.length) {
    pick = await db.all("SELECT id FROM clues WHERE status = 'published' AND language_code = ? AND variant_code IS NULL ORDER BY id", [lang]);
  }
  if (!pick.length) return null;
  const idx = parseInt(sha256(`${date}:${lang}`).slice(0, 8), 16) % pick.length;
  await db.run('INSERT OR IGNORE INTO daily_challenges(date, language_code, clue_id) VALUES (?,?,?)', [date, lang, pick[idx].id]);
  return (await db.get('SELECT clue_id FROM daily_challenges WHERE date = ? AND language_code = ?', [date, lang])).clue_id;
}

async function startDaily(db, { playerId, choice, country, origin }) {
  const enabled = await getSetting(db, 'modes.enabled');
  if (!enabled.includes('daily')) throw new HttpError(403, 'mode_disabled');
  const sel = await resolveVariant(db, choice || 'es');
  if (!sel.enabled) return { clue: null, notice: { kind: 'language_unavailable', language: sel.lang } };
  const player = await ensurePlayer(db, playerId, { country, variant: choice, origin });
  const date = today();
  const clueId = await ensureDaily(db, sel.lang, date);
  if (!clueId) return { player_id: player.id, clue: null, notice: { kind: 'empty', alternatives: [] } };
  // Si ya lo jugó hoy, se retoma la misma partida.
  const prev = await db.get('SELECT * FROM games WHERE player_id = ? AND daily_date = ? AND clue_id = ? ORDER BY started_at DESC LIMIT 1',
    [player.id, date, clueId]);
  const clue = await db.get('SELECT * FROM clues WHERE id = ?', [clueId]);
  let gameId = prev && prev.id;
  if (!prev) {
    gameId = await insertGame(db, { playerId: player.id, clueId, mode: 'daily', variant: choice, country, dailyDate: date });
  } else if (!prev.finished_at) {
    await track.resumeIfAbandoned(db, prev);
  }
  return {
    player_id: player.id, game_id: gameId, date, clue: publicClue(clue), max_hints: await getSetting(db, 'game.max_hints'),
    finished: prev && prev.finished_at ? { result: prev.result, attempts: prev.attempts, hints_used: prev.hints_used, solution: solutionView(clue) } : null,
  };
}

// ── Crípticos Plus del día (solo cuentas Plus; ver services/plus.js) ──
// Una tanda de PLUS_DAILY_COUNT por día e idioma, de los difíciles (4 y 5; si faltan, 3), distintos de
// los diarios comunes y de tandas anteriores. Se arma una vez por día con la clave aleatoria
// indexada: lee unas decenas de filas, no todo el banco.
const PLUS_DAILY_COUNT = 10;
async function ensurePlusDaily(db, lang, date = today()) {
  const have = () => db.all('SELECT slot, clue_id FROM plus_daily_set WHERE date = ? AND language_code = ? ORDER BY slot', [date, lang]);
  let rows = await have();
  if (rows.length >= PLUS_DAILY_COUNT) return rows.map((r) => r.clue_id);
  const seed = parseInt(sha256(`plus:${date}:${lang}`).slice(0, 8), 16) % 1e9;
  const chosen = new Set(rows.map((r) => r.clue_id));
  for (const min of [4, 3]) {
    const need = PLUS_DAILY_COUNT - chosen.size;
    if (need <= 0) break;
    const base = `SELECT id FROM clues WHERE status = 'published' AND language_code = ? AND variant_code IS NULL AND difficulty >= ${min}
      AND id NOT IN (SELECT clue_id FROM plus_daily_set WHERE language_code = ?) AND id NOT IN (SELECT clue_id FROM plus_daily_challenges WHERE language_code = ?)
      AND id NOT IN (SELECT clue_id FROM daily_challenges WHERE language_code = ?)`;
    const args = [lang, lang, lang, lang];
    // Se piden de más para descartar los que ya están elegidos (los de 4 y 5 vuelven a salir al buscar desde 3).
    const lim = need + chosen.size;
    const picks = (await db.all(`${base} AND (origin <> 'generated' OR audit_status = 'ok') AND shuffle > ? ORDER BY shuffle LIMIT ${lim}`, [...args, seed]))
      .concat(await db.all(`${base} ORDER BY shuffle LIMIT ${lim}`, args));
    for (const p of picks) { if (chosen.size >= PLUS_DAILY_COUNT) break; chosen.add(p.id); }
  }
  let slot = rows.length;
  for (const id of chosen) {
    if (rows.some((r) => r.clue_id === id)) continue;
    await db.run('INSERT OR IGNORE INTO plus_daily_set(date, language_code, slot, clue_id) VALUES (?,?,?,?)', [date, lang, slot++, id]);
  }
  rows = await have();
  return rows.map((r) => r.clue_id);
}

// Abre el primer críptico de la tanda que la persona todavía no terminó (o retoma el que dejó a medias).
async function startPlusDaily(db, { playerId, choice, country, origin }) {
  const sel = await resolveVariant(db, choice || 'es');
  if (!sel.enabled) return { clue: null, notice: { kind: 'language_unavailable', language: sel.lang } };
  const player = await ensurePlayer(db, playerId, { country, variant: choice, origin });
  const date = today();
  const ids = await ensurePlusDaily(db, sel.lang, date);
  if (!ids.length) return { player_id: player.id, clue: null, notice: { kind: 'empty', alternatives: [] } };
  // Las partidas del Plus no llevan daily_date: así no se mezclan con el diario común ni con su racha.
  const games = await db.all(`SELECT * FROM games WHERE player_id = ? AND mode = 'plus_daily' AND clue_id IN (${ids.map(() => '?').join(',')}) ORDER BY started_at DESC`, [player.id, ...ids]);
  const latest = new Map();
  for (const g of games) if (!latest.has(g.clue_id)) latest.set(g.clue_id, g);
  const done = ids.filter((id) => latest.get(id) && latest.get(id).finished_at).length;
  const clueId = ids.find((id) => !(latest.get(id) && latest.get(id).finished_at)) || ids[ids.length - 1];
  const prev = latest.get(clueId) || null;
  const clue = await db.get('SELECT * FROM clues WHERE id = ?', [clueId]);
  let gameId = prev && prev.id;
  if (!prev) gameId = await insertGame(db, { playerId: player.id, clueId, mode: 'plus_daily', variant: choice, country });
  else if (!prev.finished_at) await track.resumeIfAbandoned(db, prev);
  return {
    player_id: player.id, game_id: gameId, date, clue: publicClue(clue), max_hints: await getSetting(db, 'game.max_hints'),
    plus: { done, total: ids.length, number: Math.min(done + 1, ids.length) },
    finished: prev && prev.finished_at ? { result: prev.result, attempts: prev.attempts, hints_used: prev.hints_used, solution: solutionView(clue) } : null,
  };
}

async function dailySummary(db, date, lang) {
  const row = await db.get(
    `SELECT COUNT(*) AS players, SUM(CASE WHEN g.result = 'solved' THEN 1 ELSE 0 END) AS solved,
            AVG(CASE WHEN g.result = 'solved' THEN g.attempts END) AS avg_attempts
     FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.daily_date = ? AND c.language_code = ? AND g.finished_at IS NOT NULL`, [date, lang]);
  return { date, players: row.players, solved: row.solved || 0, avg_attempts: row.avg_attempts ? Math.round(row.avg_attempts * 10) / 10 : null };
}

// ── Estadísticas personales, rachas y logros ──

async function playerStats(db, { playerIds }) {
  if (!playerIds.length) return emptyStats();
  const ph = playerIds.map(() => '?').join(',');
  const games = await db.all(
    `SELECT g.result, g.attempts, g.hints_used, g.daily_date, g.mode, g.finished_at, c.mechanism, c.language_code
     FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${ph}) AND g.finished_at IS NOT NULL
     AND g.mode <> 'practice' ORDER BY g.finished_at ASC`, playerIds);
  const s = emptyStats();
  let run = 0;
  const mechs = new Set(); const langs = new Set(); const dailyDays = new Set();
  for (const g of games) {
    s.played++;
    if (g.result === 'solved') {
      s.solved++; run++; s.best_streak = Math.max(s.best_streak, run);
      mechs.add(g.mechanism); langs.add(g.language_code);
      if (g.hints_used === 0 && g.attempts === 1) s.first_try++;
      if (g.daily_date) dailyDays.add(g.daily_date);
    } else if (g.result === 'revealed' || g.result === 'timeout') run = 0;
  }
  s.current_streak = run;
  s.solve_rate = s.played ? Math.round((s.solved / s.played) * 100) : 0;
  s.mechanisms_solved = [...mechs];
  s.languages = [...langs];
  s.daily_streak = dayStreak(dailyDays);
  s.achievements = achievements(s, langs);
  return s;
}

function emptyStats() {
  return { played: 0, solved: 0, solve_rate: 0, current_streak: 0, best_streak: 0, first_try: 0, daily_streak: 0, mechanisms_solved: [], achievements: [] };
}

function dayStreak(days) {
  let streak = 0;
  const d = new Date(today() + 'T00:00:00Z');
  if (!days.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }
  return streak;
}

function achievements(s, langs) {
  const a = [];
  if (s.solved >= 1) a.push('first_solve');
  if (s.solved >= 10) a.push('ten_solved');
  if (s.solved >= 50) a.push('fifty_solved');
  if (s.best_streak >= 5) a.push('streak_5');
  if (s.first_try >= 5) a.push('sharp_5');
  if (s.mechanisms_solved.length >= 5) a.push('versatile');
  if (langs.size >= 2) a.push('polyglot');
  if (s.daily_streak >= 3) a.push('daily_3');
  return a;
}

async function pingGame(db, { gameId, playerId }) {
  const { g } = await loadGame(db, gameId, playerId);
  return track.ping(db, g);
}

module.exports = { insertGame, ARENA_MODES, startPlusDaily, ensurePlusDaily, pingGame, startGame, guess, hint, reveal, skip, restart, startDaily, ensureDaily, dailySummary, playerStats, ensurePlayer, resolveVariant, buildHints, MODES, today };
