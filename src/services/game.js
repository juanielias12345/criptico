'use strict';

// Motor de partidas. Las partidas son ilimitadas: no hay tope diario.
// El servidor nunca envía la respuesta antes de que el jugador acierte o la revele.

const N = require('../lib/normalize');
const { publicClue, solutionView } = require('./clues');
const { getSetting } = require('./settings');
const { uuid, now, parseJson, HttpError, sha256 } = require('./util');

const MODES = {
  quick: {}, infinite: {}, practice: { noStats: true }, streak: {}, shared: {}, archive: {},
  beginner: { maxDifficulty: 2 }, intermediate: { minDifficulty: 2, maxDifficulty: 3 }, expert: { minDifficulty: 3 },
  guided: { maxDifficulty: 3 }, timed: {}, themed: { needsCategory: true }, daily: {},
};

async function ensurePlayer(db, playerId, { country, variant } = {}) {
  if (playerId && /^[0-9a-f-]{36}$/.test(playerId)) {
    const p = await db.get('SELECT * FROM players WHERE id = ?', [playerId]);
    if (p) {
      await db.run('UPDATE players SET last_seen_at = ?, country_code = COALESCE(?, country_code), play_variant = COALESCE(?, play_variant) WHERE id = ?',
        [now(), country || null, variant || null, playerId]);
      return { ...p, isNew: false };
    }
  }
  const id = uuid();
  await db.run('INSERT INTO players(id, country_code, play_variant) VALUES (?,?,?)', [id, country || null, variant || null]);
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

function poolFilter({ lang, variant, mode, category, difficulty }) {
  const where = ["c.status = 'published'", 'c.language_code = ?'];
  const args = [lang];
  if (variant) { where.push('(c.variant_code IS NULL OR c.variant_code = ?)'); args.push(variant); }
  const m = MODES[mode] || {};
  if (m.minDifficulty) { where.push('c.difficulty >= ?'); args.push(m.minDifficulty); }
  if (m.maxDifficulty) { where.push('c.difficulty <= ?'); args.push(m.maxDifficulty); }
  if (difficulty) { where.push('c.difficulty = ?'); args.push(Number(difficulty)); }
  if (category) { where.push('c.category = ?'); args.push(category); }
  return { where: where.join(' AND '), args };
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

async function startGame(db, { playerId, choice, mode = 'infinite', category, difficulty, country, clueSlug }) {
  if (!MODES[mode]) throw new HttpError(400, 'invalid_mode');
  const enabled = await getSetting(db, 'modes.enabled');
  if (!enabled.includes(mode)) throw new HttpError(403, 'mode_disabled', 'Este modo de juego no está disponible.');
  if (MODES[mode].needsCategory && !category) throw new HttpError(400, 'category_required');
  const sel = await resolveVariant(db, choice || 'es');
  if (!sel.enabled) {
    return { clue: null, notice: { kind: 'language_unavailable', language: sel.lang } };
  }
  const player = await ensurePlayer(db, playerId, { country, variant: choice });

  let clue = null; let recycled = false;
  const filter = poolFilter({ lang: sel.lang, variant: sel.variant, mode, category, difficulty });
  const poolRow = await db.get(`SELECT COUNT(*) AS n FROM clues c WHERE ${filter.where}`, filter.args);
  const notice = await contentNotice(db, sel, poolRow.n);

  if (clueSlug) {
    clue = await db.get("SELECT * FROM clues WHERE slug = ? AND status = 'published'", [clueSlug]);
    if (!clue) throw new HttpError(404, 'clue_not_found');
  } else if (poolRow.n > 0) {
    const windowSize = await getSetting(db, 'game.recent_window');
    // Primero, uno que este jugador no haya visto en sus últimas partidas.
    clue = await db.get(
      `SELECT c.* FROM clues c WHERE ${filter.where}
       AND c.id NOT IN (SELECT g.clue_id FROM games g WHERE g.player_id = ? ORDER BY g.started_at DESC LIMIT ?)
       ORDER BY random() LIMIT 1`, [...filter.args, player.id, windowSize]);
    if (!clue) {
      // Ya vio todo el conjunto: se repite el que vio hace más tiempo.
      recycled = true;
      clue = await db.get(
        `SELECT c.* FROM clues c LEFT JOIN (SELECT clue_id, MAX(started_at) AS last FROM games WHERE player_id = ? GROUP BY clue_id) g
         ON g.clue_id = c.id WHERE ${filter.where} ORDER BY g.last ASC, random() LIMIT 1`, [player.id, ...filter.args]);
    }
  }
  if (!clue) return { player_id: player.id, clue: null, notice: notice || { kind: 'empty', alternatives: [] } };

  const gameId = uuid();
  await db.run('INSERT INTO games(id, player_id, clue_id, mode, play_variant, country_code) VALUES (?,?,?,?,?,?)',
    [gameId, player.id, clue.id, mode, choice || null, country || null]);
  return {
    player_id: player.id, game_id: gameId, clue: publicClue(clue), notice, recycled,
    max_hints: await getSetting(db, 'game.max_hints'),
    timed_seconds: mode === 'timed' ? await getSetting(db, 'game.timed_seconds') : null,
  };
}

async function loadGame(db, gameId, playerId) {
  const g = await db.get('SELECT * FROM games WHERE id = ?', [gameId]);
  if (!g || g.player_id !== playerId) throw new HttpError(404, 'game_not_found');
  const clue = await db.get('SELECT * FROM clues WHERE id = ?', [g.clue_id]);
  return { g, clue };
}

async function finish(db, g, result) {
  const duration = Date.now() - Date.parse(g.started_at);
  await db.run('UPDATE games SET finished_at = ?, result = ?, duration_ms = ? WHERE id = ? AND finished_at IS NULL',
    [now(), result, duration, g.id]);
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
  const attempts = g.attempts + 1;
  await db.run('UPDATE games SET attempts = ? WHERE id = ?', [attempts, g.id]);
  if (accepted.includes(key)) {
    await finish(db, g, 'solved');
    return { correct: true, attempts, hints_used: g.hints_used, solution: solutionView(clue), daily: g.daily_date ? await dailySummary(db, g.daily_date, lang) : null };
  }
  const feedback = [];
  if (key.length !== clue.answer_key.length) feedback.push({ code: 'length', expected: clue.answer_key.length, got: key.length });
  else if (key.replace(/Ñ/g, 'N') === clue.answer_key.replace(/Ñ/g, 'N')) feedback.push({ code: 'enye' });
  return { correct: false, attempts, feedback };
}

async function hint(db, { gameId, playerId }) {
  const { g, clue } = await loadGame(db, gameId, playerId);
  const max = await getSetting(db, 'game.max_hints');
  const level = Math.min(g.hints_used + 1, max);
  if (!g.finished_at && g.hints_used < max) await db.run('UPDATE games SET hints_used = ? WHERE id = ?', [level, g.id]);
  return { hints: buildHints(clue, level), hints_used: level, max_hints: max };
}

function buildHints(clue, level) {
  const mech = clue.mechanism;
  const wordplay = parseJson(clue.wordplay, null);
  const out = [{ kind: 'mechanism', mechanism: mech }];
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
  if (!g.finished_at) await finish(db, g, 'revealed');
  return { solution: solutionView(clue), daily: g.daily_date ? await dailySummary(db, g.daily_date, clue.language_code) : null };
}

async function skip(db, { gameId, playerId, reason }) {
  const { g } = await loadGame(db, gameId, playerId);
  if (!g.finished_at) await finish(db, g, reason === 'timeout' ? 'timeout' : 'skipped');
  return { ok: true };
}

// Reinicia una partida no resuelta: mismos datos, contadores a cero.
async function restart(db, { gameId, playerId }) {
  const { g, clue } = await loadGame(db, gameId, playerId);
  if (g.result === 'solved') throw new HttpError(409, 'already_solved');
  const id = uuid();
  await db.run('INSERT INTO games(id, player_id, clue_id, mode, play_variant, country_code, daily_date) VALUES (?,?,?,?,?,?,?)',
    [id, playerId, g.clue_id, g.mode, g.play_variant, g.country_code, g.daily_date]);
  return { game_id: id, clue: publicClue(clue) };
}

// ── Desafío diario (opcional y compartido; no limita el modo infinito) ──

function today() { return new Date().toISOString().slice(0, 10); }

async function ensureDaily(db, lang, date = today()) {
  const existing = await db.get('SELECT clue_id FROM daily_challenges WHERE date = ? AND language_code = ?', [date, lang]);
  if (existing) return existing.clue_id;
  const candidates = await db.all(
    `SELECT id FROM clues WHERE status = 'published' AND language_code = ? AND variant_code IS NULL AND daily_eligible = 1
     AND id NOT IN (SELECT clue_id FROM daily_challenges WHERE language_code = ?) ORDER BY id`, [lang, lang]);
  let pick = candidates;
  if (!pick.length) {
    pick = await db.all("SELECT id FROM clues WHERE status = 'published' AND language_code = ? AND variant_code IS NULL ORDER BY id", [lang]);
  }
  if (!pick.length) return null;
  const idx = parseInt(sha256(`${date}:${lang}`).slice(0, 8), 16) % pick.length;
  await db.run('INSERT OR IGNORE INTO daily_challenges(date, language_code, clue_id) VALUES (?,?,?)', [date, lang, pick[idx].id]);
  return (await db.get('SELECT clue_id FROM daily_challenges WHERE date = ? AND language_code = ?', [date, lang])).clue_id;
}

async function startDaily(db, { playerId, choice, country }) {
  const enabled = await getSetting(db, 'modes.enabled');
  if (!enabled.includes('daily')) throw new HttpError(403, 'mode_disabled');
  const sel = await resolveVariant(db, choice || 'es');
  if (!sel.enabled) return { clue: null, notice: { kind: 'language_unavailable', language: sel.lang } };
  const player = await ensurePlayer(db, playerId, { country, variant: choice });
  const date = today();
  const clueId = await ensureDaily(db, sel.lang, date);
  if (!clueId) return { player_id: player.id, clue: null, notice: { kind: 'empty', alternatives: [] } };
  // Si ya lo jugó hoy, se retoma la misma partida.
  const prev = await db.get('SELECT * FROM games WHERE player_id = ? AND daily_date = ? AND clue_id = ? ORDER BY started_at DESC LIMIT 1',
    [player.id, date, clueId]);
  const clue = await db.get('SELECT * FROM clues WHERE id = ?', [clueId]);
  let gameId = prev && prev.id;
  if (!prev) {
    gameId = uuid();
    await db.run('INSERT INTO games(id, player_id, clue_id, mode, play_variant, country_code, daily_date) VALUES (?,?,?,?,?,?,?)',
      [gameId, player.id, clueId, 'daily', choice || null, country || null, date]);
  }
  return {
    player_id: player.id, game_id: gameId, date, clue: publicClue(clue), max_hints: await getSetting(db, 'game.max_hints'),
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

module.exports = { startGame, guess, hint, reveal, skip, restart, startDaily, ensureDaily, dailySummary, playerStats, ensurePlayer, resolveVariant, buildHints, MODES, today };
