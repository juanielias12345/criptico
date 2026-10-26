'use strict';

// Perfil personal del jugador. Todo se calcula a partir de las partidas y sus
// eventos reales; si no hay datos suficientes para una conclusión, se dice.
// Unidad de cálculo: la cuenta (todos sus identificadores de jugador) o, sin cuenta,
// el identificador seudónimo de este navegador.
// Definiciones y reglas: docs/PERFIL.md.

const { publicClue, solutionView } = require('./clues');
const { HttpError, now, uuid, parseJson, randomToken } = require('./util');

const DAY = 86400000;
const r1 = (x) => Math.round(x * 10) / 10;
const marks = (ids) => ids.map(() => '?').join(',');
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
// Las partidas del modo práctica no cuentan para estadísticas, logros ni récords.
const COUNTED = "g.mode <> 'practice'";
// Muestras mínimas para afirmar algo.
const MIN_MASTERY = 8;      // partidas cerradas de un mecanismo para estimar su dominio
const MIN_TREND = 5;        // partidas por lado para hablar de una tendencia
const MIN_RATE = 10;        // partidas cerradas por período para comparar porcentajes
const MIN_MEDIAN = 5;       // resueltas por período para comparar medianas
const SESSION_GAP = 30 * 60000;

// ── Unidad ──
async function unitFor(db, { user, playerId }) {
  if (user) {
    const ids = (await db.all('SELECT id FROM players WHERE user_id = ?', [user.id])).map((r) => r.id);
    return { ids, owner: 'u:' + user.id, userId: user.id };
  }
  if (playerId && /^[0-9a-f-]{36}$/.test(playerId)) {
    const p = await db.get('SELECT id, user_id FROM players WHERE id = ? AND retired_at IS NULL', [playerId]);
    if (p && !p.user_id) return { ids: [p.id], owner: 'p:' + p.id, userId: null };
  }
  return { ids: [], owner: null, userId: null };
}

async function ownerOfPlayer(db, playerId) {
  const p = await db.get('SELECT user_id FROM players WHERE id = ?', [playerId]);
  if (p && p.user_id) {
    const ids = (await db.all('SELECT id FROM players WHERE user_id = ?', [p.user_id])).map((r) => r.id);
    return { ids, owner: 'u:' + p.user_id, userId: p.user_id };
  }
  return { ids: [playerId], owner: 'p:' + playerId, userId: null };
}

async function medianOf(db, sql, args) {
  const n = (await db.get(`SELECT COUNT(*) AS n FROM (${sql})`, args)).n;
  if (!n) return null;
  const rows = await db.all(`SELECT v FROM (${sql}) ORDER BY v LIMIT ? OFFSET ?`, [...args, n % 2 ? 1 : 2, Math.floor((n - 1) / 2)]);
  return Math.round(rows.reduce((s, r) => s + Number(r.v), 0) / rows.length);
}
const medianJs = (arr) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y); const m = Math.floor(a.length / 2);
  return Math.round(a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2);
};

// ── Rachas ──
function dayStreaks(days) {
  // days: lista ordenada de 'AAAA-MM-DD' (UTC) con al menos una partida.
  let best = 0; let run = 0; let prev = null;
  for (const d of days) {
    run = prev && Date.parse(d) - Date.parse(prev) === DAY ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  }
  const last = days[days.length - 1];
  const today = dayStr(Date.now()); const yesterday = dayStr(Date.now() - DAY);
  // La racha actual sigue viva si jugó hoy o ayer: descansar un día no la «rompe» hasta mañana.
  const current = last === today || last === yesterday ? run : 0;
  return { current, best };
}

async function playDays(db, ids) {
  if (!ids.length) return [];
  return (await db.all(`SELECT day, SUM(games) AS games, SUM(solved) AS solved FROM player_days WHERE player_id IN (${marks(ids)}) GROUP BY day ORDER BY day`, ids));
}

// Mayor cantidad de resoluciones seguidas: se corta con una revelada, abandonada, expirada o con error.
async function consecutiveSolves(db, ids, lang) {
  if (!ids.length) return { best: 0, current: 0 };
  const rows = await db.all(`SELECT g.status FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${marks(ids)}) AND ${COUNTED}
    AND g.finished_at IS NOT NULL ${lang ? 'AND c.language_code = ?' : ''} ORDER BY g.finished_at`, lang ? [...ids, lang] : ids);
  let run = 0; let best = 0;
  for (const r of rows) { if (r.status === 'solved') { run++; best = Math.max(best, run); } else run = 0; }
  return { best, current: run };
}

// ── Hechos base (alimentan logros, niveles y resumen) ──
async function facts(db, ids) {
  if (!ids.length) return null;
  const p = marks(ids);
  const a = await db.get(`SELECT COUNT(*) AS games,
      SUM(CASE WHEN g.status IN ('solved','revealed') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved_games,
      SUM(CASE WHEN g.status = 'revealed' THEN 1 ELSE 0 END) AS revealed,
      SUM(CASE WHEN g.status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
      SUM(CASE WHEN g.status = 'expired' THEN 1 ELSE 0 END) AS expired,
      SUM(CASE WHEN g.status IN ('started','in_progress') THEN 1 ELSE 0 END) AS open,
      COUNT(DISTINCT g.clue_id) AS unique_attempted,
      COUNT(DISTINCT CASE WHEN g.status = 'solved' THEN g.clue_id END) AS unique_solved,
      COUNT(DISTINCT CASE WHEN g.status = 'solved' AND c.difficulty >= 4 THEN g.clue_id END) AS expert_solved,
      COUNT(DISTINCT CASE WHEN g.status = 'solved' AND g.hints_used = 0 THEN g.clue_id END) AS no_hint_solved,
      COALESCE(SUM(g.hints_used), 0) AS hints, COALESCE(SUM(g.active_ms), 0) AS active_ms,
      AVG(CASE WHEN g.status = 'solved' THEN g.duration_ms END) AS avg_solve_ms,
      MIN(CASE WHEN g.status = 'solved' THEN g.duration_ms END) AS best_solve_ms,
      COUNT(DISTINCT c.language_code) AS languages,
      COUNT(DISTINCT CASE WHEN g.status = 'solved' THEN c.language_code END) AS languages_solved,
      COUNT(DISTINCT CASE WHEN g.status = 'solved' THEN COALESCE(g.play_variant, c.language_code) END) AS variants_solved,
      COUNT(DISTINCT c.category) AS categories,
      COUNT(DISTINCT CASE WHEN g.status = 'solved' THEN c.category END) AS categories_solved,
      COUNT(DISTINCT c.mechanism) AS mechanisms_tried,
      COUNT(DISTINCT CASE WHEN g.status = 'solved' THEN c.mechanism END) AS mechanisms_solved,
      MIN(g.started_at) AS first_game_at, MAX(g.started_at) AS last_game_at
    FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${p}) AND ${COUNTED}`, ids);
  const f = {};
  for (const [k, v] of Object.entries(a)) f[k] = typeof v === 'string' || v === null ? v : Number(v || 0);
  // Experiencia por críptico único: solo la primera resolución de cada uno cuenta.
  const xpRow = await db.get(`SELECT COALESCE(SUM(10 + 5 * d), 0) AS xp FROM (SELECT g.clue_id, MAX(c.difficulty) AS d FROM games g JOIN clues c ON c.id = g.clue_id
    WHERE g.player_id IN (${p}) AND ${COUNTED} AND g.status = 'solved' GROUP BY g.clue_id)`, ids);
  const studied = await db.get(`SELECT COUNT(*) AS n FROM (SELECT g.clue_id FROM games g WHERE g.player_id IN (${p}) AND ${COUNTED}
    GROUP BY g.clue_id HAVING SUM(g.status = 'revealed') > 0 AND SUM(g.status = 'solved') = 0)`, ids);
  const days = await playDays(db, ids);
  const s = dayStreaks(days.map((d) => d.day));
  f.days_played = days.length; f.days_with_solve = days.filter((d) => d.solved > 0).length;
  f.day_streak = s.current; f.day_streak_best = s.best;
  // Volver después de 30 días o más sin jugar.
  f.comeback = 0;
  for (let i = 1; i < days.length; i++) if (Date.parse(days[i].day) - Date.parse(days[i - 1].day) >= 30 * DAY) { f.comeback = 1; break; }
  const cons = await consecutiveSolves(db, ids);
  f.consecutive_best = cons.best; f.consecutive_current = cons.current;
  // Categorías completas: todas las publicadas de una categoría (con al menos 5) resueltas.
  const comp = await db.get(`SELECT COUNT(*) AS n FROM (SELECT c.category, COUNT(*) AS total,
      (SELECT COUNT(DISTINCT g.clue_id) FROM games g JOIN clues c2 ON c2.id = g.clue_id WHERE g.player_id IN (${p}) AND g.status = 'solved' AND c2.category = c.category AND c2.status = 'published') AS mine
    FROM clues c WHERE c.status = 'published' GROUP BY c.category HAVING total >= 5 AND mine >= total)`, ids);
  f.categories_complete = comp.n;
  f.xp_clues = Number(xpRow.xp); f.studied_only = studied.n;
  f.solve_rate = f.games - f.open > 0 ? r1((f.solved_games / (f.games - f.open)) * 100) : null;
  return f;
}

// ── Logros ──
// Cada familia tiene niveles; el código es familia_umbral. La condición se describe
// en la interfaz con el mismo umbral. Se otorgan una sola vez (clave primaria).
const ACHIEVEMENTS = [
  { family: 'solved', group: 'first_steps', metric: 'unique_solved', tiers: [1, 10, 50, 100, 500] },
  { family: 'day_streak', group: 'consistency', metric: 'day_streak_best', tiers: [3, 7, 30] },
  { family: 'consecutive', group: 'precision', metric: 'consecutive_best', tiers: [5, 10, 25] },
  { family: 'expert', group: 'precision', metric: 'expert_solved', tiers: [1, 10] },
  { family: 'no_hints', group: 'precision', metric: 'no_hint_solved', tiers: [10, 50] },
  { family: 'mechanisms', group: 'mastery', metric: 'mechanisms_solved', tiers: [3, 6, 9] },
  { family: 'languages', group: 'mastery', metric: 'languages_solved', tiers: [2, 3] },
  { family: 'days_played', group: 'consistency', metric: 'days_played', tiers: [7, 30, 100] },
  { family: 'completed', group: 'consistency', metric: 'completed', tiers: [50, 200] },
  { family: 'comeback', group: 'consistency', metric: 'comeback', tiers: [1] },
  { family: 'categories', group: 'exploration', metric: 'categories_solved', tiers: [5, 10] },
  { family: 'category_complete', group: 'exploration', metric: 'categories_complete', tiers: [1] },
];
const ACH_CODES = ACHIEVEMENTS.flatMap((a) => a.tiers.map((t) => `${a.family}_${t}`));

async function evaluateAchievements(db, unit, gameId) {
  if (!unit.owner || !unit.ids.length) return [];
  const f = await facts(db, unit.ids);
  const earned = new Set((await db.all('SELECT code FROM achievements_earned WHERE owner = ?', [unit.owner])).map((r) => r.code));
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    for (const t of a.tiers) {
      const code = `${a.family}_${t}`;
      if (earned.has(code) || (f[a.metric] || 0) < t) continue;
      const r = await db.run('INSERT OR IGNORE INTO achievements_earned(owner, code, game_id, earned_at) VALUES (?,?,?,?)', [unit.owner, code, gameId || null, now()]);
      if (r.changes) fresh.push(code);
    }
  }
  return fresh;
}

// Llamado al cerrar una partida. Un fallo acá nunca afecta el resultado de la partida.
async function onGameFinished(db, playerId, gameId) {
  try {
    const unit = await ownerOfPlayer(db, playerId);
    return await evaluateAchievements(db, unit, gameId);
  } catch (e) {
    try { await db.run('INSERT INTO error_log(scope, message) VALUES (?,?)', ['achievements', String(e.message).slice(0, 500)]); } catch { /* sin registro */ }
    return [];
  }
}

async function achievementList(db, unit) {
  const f = unit.ids.length ? await facts(db, unit.ids) : null;
  const earned = unit.owner ? new Map((await db.all('SELECT code, earned_at FROM achievements_earned WHERE owner = ?', [unit.owner])).map((r) => [r.code, r.earned_at])) : new Map();
  return ACHIEVEMENTS.map((a) => {
    const value = f ? f[a.metric] || 0 : 0;
    const next = a.tiers.find((t) => !earned.has(`${a.family}_${t}`));
    return { family: a.family, group: a.group, value,
      tiers: a.tiers.map((t) => ({ code: `${a.family}_${t}`, threshold: t, earned_at: earned.get(`${a.family}_${t}`) || null })),
      next: next ? { threshold: next, progress: Math.min(1, value / next) } : null };
  });
}

// ── Experiencia y niveles ──
// Reglas (docs/PERFIL.md): resolver un críptico por primera vez da 10 + 5 × dificultad;
// repetirlo no suma. Estudiar uno revelado (sin haberlo resuelto) da 2. Primer críptico
// resuelto de un mecanismo nuevo: 25; de un idioma nuevo: 50; de una variante nueva: 20.
// Cada día con al menos una resolución: 5. Cada logro: 20. El tiempo no influye.
const LEVELS = 12;
function levelFor(xp) {
  let level = 1;
  while (level < LEVELS && xp >= 50 * level * (level + 1)) level++;
  const floor = level === 1 ? 0 : 50 * (level - 1) * level;
  const next = level < LEVELS ? 50 * level * (level + 1) : null;
  return { level, xp, floor, next, progress: next ? (xp - floor) / (next - floor) : 1 };
}
function xpOf(f, achievements) {
  if (!f) return 0;
  return f.xp_clues + 2 * f.studied_only + 25 * f.mechanisms_solved + 50 * f.languages_solved
    + 20 * Math.max(0, f.variants_solved - f.languages_solved) + 5 * f.days_with_solve + 20 * achievements;
}

// ── Resumen ──
async function summary(db, unit, user) {
  const f = await facts(db, unit.ids);
  const achN = unit.owner ? (await db.get('SELECT COUNT(*) AS n FROM achievements_earned WHERE owner = ?', [unit.owner])).n : 0;
  const recent = unit.owner ? await db.all('SELECT code, earned_at FROM achievements_earned WHERE owner = ? ORDER BY earned_at DESC LIMIT 4', [unit.owner]) : [];
  let median = null; let mastered = 0;
  if (f && f.solved_games) {
    median = await medianOf(db, `SELECT g.duration_ms AS v FROM games g WHERE g.player_id IN (${marks(unit.ids)}) AND ${COUNTED} AND g.status = 'solved'`, unit.ids);
  }
  if (f) mastered = (await strengths(db, unit)).items.filter((m) => m.level === 'mastered').length;
  const xp = xpOf(f, achN);
  let account = null;
  if (user) {
    const u = await db.get('SELECT username, created_at, country_code, play_variant, ui_language, public_profile, public_name, avatar, profile_prefs, profile_share, leaderboard_opt_in FROM users WHERE id = ?', [user.id]);
    account = { username: u.username, joined_at: u.created_at, country: u.country_code, choice: u.play_variant, ui_language: u.ui_language,
      public_profile: !!u.public_profile, public_name: u.public_name, avatar: u.avatar, prefs: prefsOf(u), share: parseJson(u.profile_share, {}), leaderboard_opt_in: !!u.leaderboard_opt_in };
  }
  return {
    account, has_data: !!(f && f.games),
    stats: f ? {
      unique_solved: f.unique_solved, unique_attempted: f.unique_attempted, games: f.games, completed: f.completed, solved_games: f.solved_games,
      abandoned: f.abandoned, expired: f.expired, revealed: f.revealed, open: f.open, solve_rate: f.solve_rate,
      avg_solve_ms: f.avg_solve_ms ? Math.round(f.avg_solve_ms) : null, median_solve_ms: median, best_solve_ms: f.best_solve_ms || null,
      active_ms: f.active_ms, day_streak: f.day_streak, day_streak_best: f.day_streak_best, hints: f.hints, languages: f.languages,
      categories: f.categories, mechanisms_tried: f.mechanisms_tried, mechanisms_mastered: mastered, first_game_at: f.first_game_at, last_game_at: f.last_game_at,
      consecutive_best: f.consecutive_best,
    } : null,
    level: levelFor(xp), achievements: { earned: achN, total: ACH_CODES.length, recent },
  };
}

const PREF_DEFAULTS = { recommendations: true, achievement_notifications: true, xp: true };
function prefsOf(u) { return { ...PREF_DEFAULTS, ...parseJson(u && u.profile_prefs, {}) }; }

// ── Historial ──
const RESULTS = { solved: "g.status = 'solved'", revealed: "g.status = 'revealed'", abandoned: "g.status = 'abandoned'", expired: "g.status = 'expired'",
  open: "g.status IN ('started','in_progress')", error: "g.status = 'error'" };
const HISTORY_SORTS = { recent: 'g.started_at DESC', oldest: 'g.started_at ASC', fastest: "CASE WHEN g.status = 'solved' THEN g.duration_ms END ASC NULLS LAST, g.started_at DESC",
  slowest: "CASE WHEN g.status = 'solved' THEN g.duration_ms END DESC NULLS LAST, g.started_at DESC", hints: 'g.hints_used DESC, g.started_at DESC', difficulty: 'c.difficulty DESC, g.started_at DESC' };

async function history(db, unit, q) {
  const per = Math.min(50, Math.max(10, Number(q.per) || 20)); const page = Math.max(1, Math.min(10000, Number(q.page) || 1));
  if (!unit.ids.length) return { total: 0, page, per_page: per, items: [] };
  const w = [`g.player_id IN (${marks(unit.ids)})`]; const args = [...unit.ids];
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { w.push('g.started_at >= ?'); args.push(q.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { w.push('g.started_at < ?'); args.push(dayStr(Date.parse(q.to) + DAY)); }
  if (/^[a-z]{2}$/.test(q.lang || '')) { w.push('c.language_code = ?'); args.push(q.lang); }
  if (/^[1-5]$/.test(q.difficulty || '')) { w.push('c.difficulty = ?'); args.push(Number(q.difficulty)); }
  if (/^[a-z_]{2,40}$/.test(q.category || '')) { w.push('c.category = ?'); args.push(q.category); }
  if (/^[a-z_]{2,40}$/.test(q.mechanism || '')) { w.push('c.mechanism = ?'); args.push(q.mechanism); }
  if (/^[a-z_]{3,20}$/.test(q.mode || '')) { w.push('g.mode = ?'); args.push(q.mode); }
  if (RESULTS[q.result]) w.push(RESULTS[q.result]);
  if (q.hints === 'none') w.push('g.hints_used = 0'); else if (q.hints === 'used') w.push('g.hints_used > 0');
  if (q.time === 'under1') w.push("g.status = 'solved' AND g.duration_ms < 60000");
  else if (q.time === '1to5') w.push("g.status = 'solved' AND g.duration_ms >= 60000 AND g.duration_ms < 300000");
  else if (q.time === 'over5') w.push("g.status = 'solved' AND g.duration_ms >= 300000");
  if (q.q) { w.push('c.clue_text LIKE ?'); args.push('%' + String(q.q).slice(0, 60) + '%'); }
  const from = `FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${w.join(' AND ')}`;
  const total = (await db.get(`SELECT COUNT(*) AS n ${from}`, args)).n;
  const sort = HISTORY_SORTS[q.sort] || HISTORY_SORTS.recent;
  const rows = await db.all(`SELECT g.id, g.started_at, g.finished_at, g.mode, g.play_variant, g.status, g.end_reason, g.duration_ms, g.active_ms, g.attempts,
      g.hints_used, g.daily_date, c.id AS clue_id, c.slug, c.clue_text, c.enumeration, c.language_code, c.variant_code, c.difficulty, c.mechanism, c.category,
      (g.status = 'solved' AND g.mode <> 'practice' AND NOT EXISTS (SELECT 1 FROM games g2 WHERE g2.player_id IN (${marks(unit.ids)}) AND g2.clue_id = g.clue_id
        AND g2.status = 'solved' AND g2.mode <> 'practice' AND g2.finished_at < g.finished_at)) AS first_solve
    ${from} ORDER BY ${sort} LIMIT ? OFFSET ?`, [...unit.ids, ...args, per, (page - 1) * per]);
  return { total, page, per_page: per, items: rows.map((r) => ({ ...r, first_solve: !!r.first_solve, xp: r.first_solve ? 10 + 5 * r.difficulty : 0 })) };
}

// ── Detalle de una partida (solo eventos realmente registrados) ──
async function gameDetail(db, unit, id) {
  if (!unit.ids.length) throw new HttpError(404, 'not_found');
  const g = await db.get(`SELECT g.*, c.slug, c.clue_text, c.enumeration, c.language_code, c.variant_code, c.difficulty, c.mechanism, c.category, c.origin,
      c.author_name, c.attribution, c.source_url, c.answer, c.definition, c.explanation, c.note, c.status AS clue_status, s.name AS source_name
    FROM games g JOIN clues c ON c.id = g.clue_id LEFT JOIN sources s ON s.id = c.source_id WHERE g.id = ? AND g.player_id IN (${marks(unit.ids)})`, [id, ...unit.ids]);
  if (!g) throw new HttpError(404, 'not_found');
  const events = await db.all('SELECT kind, data, created_at FROM game_events WHERE game_id = ? ORDER BY id', [id]);
  const t0 = Date.parse(g.started_at);
  const at = (e) => Math.max(0, Date.parse(e.created_at) - t0);
  const firstGuess = events.find((e) => e.kind.startsWith('guess_'));
  const attempts = events.filter((e) => ['guess_wrong', 'guess_repeat', 'guess_correct'].includes(e.kind)).map((e) => {
    const d = parseJson(e.data, {}) || {};
    return { t_ms: at(e), correct: e.kind === 'guess_correct', repeated: e.kind === 'guess_repeat', answer: d.answer || null };
  });
  const hints = events.filter((e) => e.kind === 'hint').map((e) => {
    const d = parseJson(e.data, {}) || {};
    return { level: d.level || null, kind: d.kind || null, t_ms: at(e), before_first_attempt: !firstGuess || Date.parse(e.created_at) <= Date.parse(firstGuess.created_at) };
  });
  const closed = !['started', 'in_progress'].includes(g.status);
  const share = await db.get('SELECT token, show_time, show_answer FROM game_shares WHERE game_id = ?', [id]);
  const source = g.origin === 'external' ? { name: g.source_name, url: g.source_url, attribution: g.attribution }
    : g.origin === 'community' ? { author: g.author_name } : { origin: g.origin };
  return {
    game: { id: g.id, started_at: g.started_at, finished_at: g.finished_at, status: g.status, end_reason: g.end_reason, mode: g.mode, play_variant: g.play_variant,
      daily_date: g.daily_date, attempts: g.attempts, wrong_attempts: g.wrong_attempts, hints_used: g.hints_used,
      elapsed_ms: Math.max(0, Date.parse(g.finished_at || g.last_activity_at || g.started_at) - t0), active_ms: g.active_ms,
      solve_ms: g.status === 'solved' ? g.duration_ms : null },
    clue: { id: g.clue_id, slug: g.slug, clue: g.clue_text, enumeration: g.enumeration, language: g.language_code, variant: g.variant_code,
      difficulty: g.difficulty, mechanism: g.mechanism, category: g.category, available: g.clue_status === 'published', source },
    // La respuesta y la explicación se entregan solo para partidas cerradas.
    solution: closed ? solutionView(g) : null,
    events_recorded: events.length > 0, attempts, hints,
    reveal_ms: (() => { const e = events.find((x) => x.kind === 'reveal'); return e ? at(e) : null; })(),
    solved_after_hint: g.status === 'solved' && hints.length > 0,
    timeline: events.map((e) => ({ kind: e.kind, t_ms: at(e), data: e.kind === 'abandon' || e.kind === 'restart' || e.kind === 'error' ? null : parseJson(e.data, null) })),
    share: share ? { token: share.token, show_time: !!share.show_time, show_answer: !!share.show_answer } : null,
  };
}

// ── Evolución ──
function bucketKey(iso, unit) {
  const d = new Date(iso);
  if (unit === 'month') return iso.slice(0, 7);
  if (unit === 'week') { const dow = (d.getUTCDay() + 6) % 7; return dayStr(Date.parse(iso.slice(0, 10)) - dow * DAY); }
  return iso.slice(0, 10);
}
function* bucketRange(from, to, unit) {
  if (unit === 'month') {
    const d = new Date(from); let y = d.getUTCFullYear(); let m = d.getUTCMonth();
    for (;;) { const k = `${y}-${String(m + 1).padStart(2, '0')}`; if (Date.UTC(y, m, 1) >= to) return; yield k; m++; if (m > 11) { m = 0; y++; } }
  }
  let t = Date.parse(bucketKey(new Date(from).toISOString(), unit));
  const step = unit === 'week' ? 7 * DAY : DAY;
  for (; t < to; t += step) yield dayStr(t);
}
function aggregate(rows) {
  const closed = rows.filter((r) => !['started', 'in_progress'].includes(r.status));
  const solved = rows.filter((r) => r.status === 'solved');
  return { games: rows.length, closed: closed.length, solved: solved.length,
    solve_rate: closed.length ? r1((solved.length / closed.length) * 100) : null,
    median_solve_ms: medianJs(solved.map((r) => r.duration_ms).filter((x) => x !== null)),
    hints_per_game: rows.length ? r1(rows.reduce((s, r) => s + r.hints_used, 0) / rows.length) : null,
    revealed: rows.filter((r) => r.status === 'revealed').length };
}
function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) { const k = r[key] ?? ''; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}

async function evolution(db, unit, q) {
  const today0 = Date.parse(dayStr(Date.now()));
  let to = today0 + DAY; let from = to - 90 * DAY;
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { from = Date.parse(q.from); to = Date.parse(q.to) + DAY; }
  else if (['30', '90', '180', '365'].includes(String(q.days))) from = to - Number(q.days) * DAY;
  if (!(to > from) || to - from > 3 * 366 * DAY) throw new HttpError(400, 'invalid_range');
  const len = to - from; const pFrom = from - len;
  const unitName = ['day', 'week', 'month'].includes(q.unit) ? q.unit : len <= 45 * DAY ? 'day' : len <= 200 * DAY ? 'week' : 'month';
  const empty = { from: dayStr(from), to: dayStr(to - DAY), unit: unitName, series: [], current: aggregate([]), previous: aggregate([]),
    by_difficulty: [], by_mechanism: [], by_language: [], insights: [{ kind: 'no_data' }] };
  if (!unit.ids.length) return empty;
  const rows = await db.all(`SELECT g.started_at, g.status, g.duration_ms, g.hints_used, c.difficulty, c.mechanism, c.language_code
    FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${marks(unit.ids)}) AND ${COUNTED} AND g.started_at >= ? AND g.started_at < ?
    ORDER BY g.started_at`, [...unit.ids, new Date(pFrom).toISOString(), new Date(to).toISOString()]);
  const fromIso = new Date(from).toISOString();
  const cur = rows.filter((r) => r.started_at >= fromIso); const prev = rows.filter((r) => r.started_at < fromIso);
  const byBucket = groupBy(cur.map((r) => ({ ...r, b: bucketKey(r.started_at, unitName) })), 'b');
  const days = new Set((await playDays(db, unit.ids)).map((d) => d.day));
  const series = [...bucketRange(from, to, unitName)].map((k) => {
    const a = aggregate(byBucket.get(k) || []);
    let daysPlayed = 0;
    if (unitName === 'day') daysPlayed = days.has(k) ? 1 : 0;
    else for (const d of days) if (bucketKey(d + 'T00:00:00.000Z', unitName) === k && d >= dayStr(from) && d < dayStr(to)) daysPlayed++;
    return { t: k, ...a, days_played: daysPlayed };
  });
  const dims = (key, list) => [...groupBy(list, key).entries()].map(([k, v]) => ({ key: k, ...aggregate(v) }));
  const prevByDiff = new Map(dims('difficulty', prev).map((x) => [x.key, x]));
  const prevByMech = new Map(dims('mechanism', prev).map((x) => [x.key, x]));
  const byDifficulty = dims('difficulty', cur).sort((a, b) => a.key - b.key).map((x) => ({ ...x, previous: prevByDiff.get(x.key) || null }));
  const byMechanism = dims('mechanism', cur).sort((a, b) => b.games - a.games).map((x) => ({ ...x, previous: prevByMech.get(x.key) || null }));
  const out = { ...empty, series, current: aggregate(cur), previous: aggregate(prev), by_difficulty: byDifficulty, by_mechanism: byMechanism,
    by_language: dims('language_code', cur).sort((a, b) => b.games - a.games) };
  out.insights = insights(out, await strengths(db, unit));
  return out;
}

// Mensajes solo cuando los datos los respaldan; si no, se dice que faltan datos.
function insights(ev, str) {
  const out = []; const c = ev.current; const p = ev.previous;
  if (c.closed >= MIN_RATE && p.closed >= MIN_RATE && c.solve_rate !== null && p.solve_rate !== null) {
    const d = r1(c.solve_rate - p.solve_rate);
    if (Math.abs(d) >= 10) out.push({ kind: d > 0 ? 'solve_rate_up' : 'solve_rate_down', from: p.solve_rate, to: c.solve_rate });
  }
  for (const x of ev.by_difficulty) {
    if (!x.previous || x.solved < MIN_MEDIAN || x.previous.solved < MIN_MEDIAN) continue;
    const ratio = x.median_solve_ms / x.previous.median_solve_ms;
    if (ratio <= 0.85) out.push({ kind: 'faster_at_difficulty', difficulty: x.key, from: x.previous.median_solve_ms, to: x.median_solve_ms });
    if (ratio >= 1.25) out.push({ kind: 'slower_at_difficulty', difficulty: x.key, from: x.previous.median_solve_ms, to: x.median_solve_ms });
  }
  if (c.games >= MIN_RATE && p.games >= MIN_RATE && c.hints_per_game !== null && p.hints_per_game !== null && p.hints_per_game - c.hints_per_game >= 0.5) {
    out.push({ kind: 'fewer_hints', from: p.hints_per_game, to: c.hints_per_game });
  }
  const rated = str.items.filter((m) => m.level && m.level !== 'insufficient');
  if (rated.length >= 2) {
    const best = [...rated].sort((a, b) => b.solve_rate - a.solve_rate)[0];
    const slow = [...rated].filter((m) => m.median_solve_ms).sort((a, b) => b.median_solve_ms - a.median_solve_ms)[0];
    if (best && ['mastered', 'solid'].includes(best.level)) out.push({ kind: 'strong_mechanism', mechanism: best.mechanism, solve_rate: best.solve_rate });
    if (slow && slow.mechanism !== best.mechanism) out.push({ kind: 'slow_mechanism', mechanism: slow.mechanism, median_solve_ms: slow.median_solve_ms });
  }
  if (!out.length) out.push({ kind: c.games ? 'not_enough' : 'no_data' });
  return out;
}

// ── Fortalezas por mecanismo ──
const MASTERY = (m) => {
  if (m.closed < MIN_MASTERY) return 'insufficient';
  if (m.solve_rate >= 80 && m.hints_per_game <= 1) return 'mastered';
  if (m.solve_rate >= 60) return 'solid';
  if (m.solve_rate >= 40) return 'developing';
  return 'practice';
};

async function strengths(db, unit) {
  const catalog = await db.all("SELECT mechanism, COUNT(*) AS n FROM clues WHERE status = 'published' GROUP BY mechanism ORDER BY mechanism");
  if (!unit.ids.length) return { min_games: MIN_MASTERY, items: catalog.map((c) => ({ mechanism: c.mechanism, available: c.n, games: 0, level: 'insufficient' })) };
  const rows = await db.all(`SELECT c.mechanism, g.status, g.duration_ms, g.hints_used, g.finished_at FROM games g JOIN clues c ON c.id = g.clue_id
    WHERE g.player_id IN (${marks(unit.ids)}) AND ${COUNTED} AND g.finished_at IS NOT NULL ORDER BY g.finished_at`, unit.ids);
  const by = groupBy(rows, 'mechanism');
  const names = new Set([...catalog.map((c) => c.mechanism), ...by.keys()]);
  const avail = new Map(catalog.map((c) => [c.mechanism, c.n]));
  const items = [...names].map((mech) => {
    const list = by.get(mech) || [];
    const a = aggregate(list);
    const m = { mechanism: mech, available: avail.get(mech) || 0, games: list.length, closed: a.closed, solved: a.solved, solve_rate: a.solve_rate,
      median_solve_ms: a.median_solve_ms, hints: list.reduce((s, r) => s + r.hints_used, 0), hints_per_game: a.hints_per_game };
    m.level = MASTERY(m);
    // Evolución reciente: últimas 10 partidas contra las anteriores (si hay muestra en ambos lados).
    if (list.length >= 2 * MIN_TREND) {
      const recent = aggregate(list.slice(-10)); const before = aggregate(list.slice(0, -10));
      if (before.closed >= MIN_TREND) m.trend = { recent: recent.solve_rate, before: before.solve_rate, delta: r1(recent.solve_rate - before.solve_rate) };
    }
    return m;
  });
  const order = { mastered: 0, solid: 1, developing: 2, practice: 3, insufficient: 4 };
  items.sort((x, y) => order[x.level] - order[y.level] || y.games - x.games);
  return { min_games: MIN_MASTERY, items };
}

// ── Récords personales ──
async function records(db, unit, q) {
  const lang = /^[a-z]{2}$/.test(q.lang || '') ? q.lang : null;
  if (!unit.ids.length) return { lang, empty: true };
  const p = marks(unit.ids);
  const lw = lang ? 'AND c.language_code = ?' : ''; const la = lang ? [lang] : [];
  const base = `FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${p}) AND ${COUNTED} ${lw}`;
  // Los tiempos se comparan solo entre resoluciones sin pistas, dentro de la misma dificultad o mecanismo.
  const clean = "g.status = 'solved' AND g.hints_used = 0 AND g.duration_ms IS NOT NULL";
  const bestBy = (col) => db.all(`SELECT ${col} AS k, g.duration_ms AS ms, g.id AS game_id, g.finished_at, c.clue_text FROM games g JOIN clues c ON c.id = g.clue_id
    WHERE g.player_id IN (${p}) AND ${COUNTED} ${lw} AND ${clean} AND g.duration_ms = (SELECT MIN(g2.duration_ms) FROM games g2 JOIN clues c2 ON c2.id = g2.clue_id
      WHERE g2.player_id IN (${p}) AND g2.mode <> 'practice' ${lang ? 'AND c2.language_code = ?' : ''} AND g2.status = 'solved' AND g2.hints_used = 0 AND c2.${col.split('.')[1]} = ${col})
    GROUP BY ${col} ORDER BY ${col}`, [...unit.ids, ...la, ...unit.ids, ...la]);
  const byDifficulty = await bestBy('c.difficulty');
  const byMechanism = await bestBy('c.mechanism');
  const cons = await consecutiveSolves(db, unit.ids, lang);
  // Sesión: partidas separadas por menos de 30 minutos.
  const times = await db.all(`SELECT g.started_at, g.status ${base} ORDER BY g.started_at`, [...unit.ids, ...la]);
  let bestSession = { solved: 0, start: null }; let cur = { solved: 0, start: null }; let last = 0;
  for (const r of times) {
    const t = Date.parse(r.started_at);
    if (!cur.start || t - last > SESSION_GAP) cur = { solved: 0, start: r.started_at };
    if (r.status === 'solved') cur.solved++;
    if (cur.solved > bestSession.solved) bestSession = { ...cur };
    last = t;
  }
  // Mejor porcentaje semanal con al menos 10 partidas cerradas.
  const weeks = await db.all(`SELECT date(g.started_at, 'weekday 1', '-7 days') AS week, COUNT(*) AS closed, SUM(g.status = 'solved') AS solved
    ${base} AND g.finished_at IS NOT NULL GROUP BY week HAVING closed >= ${MIN_RATE} ORDER BY 1.0 * solved / closed DESC, closed DESC LIMIT 1`, [...unit.ids, ...la]);
  const mechs = await db.get(`SELECT COUNT(DISTINCT c.mechanism) AS n ${base} AND g.status = 'solved'`, [...unit.ids, ...la]);
  const days = lang ? null : dayStreaks((await playDays(db, unit.ids)).map((d) => d.day));
  return { lang, empty: false, by_difficulty: byDifficulty, by_mechanism: byMechanism, consecutive_best: cons.best,
    day_streak_best: days ? days.best : null, best_session: bestSession.solved ? bestSession : null,
    best_week: weeks[0] ? { week: weeks[0].week, closed: weeks[0].closed, solved: weeks[0].solved, solve_rate: r1((weeks[0].solved / weeks[0].closed) * 100) } : null,
    mechanisms_solved: mechs.n };
}

// ── Calendario ──
async function calendar(db, unit, q) {
  const days = Math.min(730, Math.max(28, Number(q.days) || 365));
  const since = dayStr(Date.now() - (days - 1) * DAY);
  if (!unit.ids.length) return { since, days, items: [] };
  const items = await db.all(`SELECT day, SUM(games) AS games, SUM(solved) AS solved FROM player_days WHERE player_id IN (${marks(unit.ids)}) AND day >= ?
    GROUP BY day ORDER BY day`, [...unit.ids, since]);
  return { since, days, items };
}

// ── Recomendaciones (cada una apunta a crípticos que existen) ──
async function recommendations(db, unit, { choice } = {}) {
  const lang = (choice || 'es').slice(0, 2);
  const solvedIds = unit.ids.length ? `SELECT g.clue_id FROM games g WHERE g.player_id IN (${marks(unit.ids)}) AND g.status = 'solved'` : "SELECT ''";
  const available = async (where, args) => (await db.get(`SELECT COUNT(*) AS n FROM clues c WHERE c.status = 'published' AND c.language_code = ? AND ${where}
    AND c.id NOT IN (${solvedIds})`, [lang, ...args, ...unit.ids])).n;
  const out = [];
  const str = await strengths(db, unit);
  const rated = str.items.filter((m) => m.level !== 'insufficient');
  // 1) El mecanismo que más cuesta, solo con muestra suficiente.
  const weak = rated.filter((m) => ['practice', 'developing'].includes(m.level)).sort((a, b) => a.solve_rate - b.solve_rate)[0];
  if (weak) { const n = await available('c.mechanism = ?', [weak.mechanism]); if (n) out.push({ kind: 'practice_mechanism', mechanism: weak.mechanism, solve_rate: weak.solve_rate, available: n, params: { mechanism: weak.mechanism } }); }
  // 2) Un mecanismo que todavía no probó.
  const tried = new Set(str.items.filter((m) => m.games > 0).map((m) => m.mechanism));
  for (const m of str.items) {
    if (tried.has(m.mechanism)) continue;
    const n = await available('c.mechanism = ?', [m.mechanism]);
    if (n) { out.push({ kind: 'discover_mechanism', mechanism: m.mechanism, available: n, params: { mechanism: m.mechanism } }); break; }
  }
  // 3) Subir un nivel de dificultad cuando el actual ya sale bien.
  if (unit.ids.length) {
    const diff = await db.all(`SELECT c.difficulty AS d, COUNT(*) AS closed, SUM(g.status = 'solved') AS solved FROM games g JOIN clues c ON c.id = g.clue_id
      WHERE g.player_id IN (${marks(unit.ids)}) AND ${COUNTED} AND g.finished_at IS NOT NULL AND c.language_code = ? GROUP BY c.difficulty`, [...unit.ids, lang]);
    const ok = diff.filter((x) => x.closed >= MIN_MASTERY && x.solved / x.closed >= 0.75).map((x) => x.d).sort((a, b) => b - a)[0];
    if (ok && ok < 5) { const n = await available('c.difficulty = ?', [ok + 1]); if (n) out.push({ kind: 'step_up', difficulty: ok + 1, available: n, params: { difficulty: ok + 1 } }); }
    // 4) Resolver sin pistas, si suele pedirlas.
    const h = await db.get(`SELECT COUNT(*) AS n, AVG(g.hints_used) AS avg FROM games g WHERE g.player_id IN (${marks(unit.ids)}) AND ${COUNTED} AND g.finished_at IS NOT NULL`, unit.ids);
    if (h.n >= MIN_RATE && h.avg >= 1) { const n = await available('1 = 1', []); if (n >= 3) out.push({ kind: 'no_hints', count: 3, hints_per_game: r1(h.avg), available: n, params: {} }); }
  }
  // 5) Una variante regional con crípticos propios que no jugó.
  const played = unit.ids.length ? await db.all(`SELECT DISTINCT c.variant_code AS v FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${marks(unit.ids)}) AND c.variant_code IS NOT NULL`, unit.ids) : [];
  const playedV = new Set(played.map((x) => x.v));
  const variants = await db.all(`SELECT v.code, COUNT(c.id) AS n FROM language_variants v JOIN languages l ON l.code = v.language_code AND l.enabled = 1
    JOIN clues c ON c.variant_code = v.code AND c.status = 'published' WHERE v.enabled = 1 GROUP BY v.code HAVING n >= 3 ORDER BY n DESC`);
  const v = variants.find((x) => !playedV.has(x.code));
  if (v) out.push({ kind: 'explore_variant', variant: v.code, available: v.n, params: { choice: v.code } });
  return { items: out.slice(0, 5), enough_data: rated.length > 0 };
}

// ── Objetivos ──
const GOAL_KINDS = ['solve', 'games', 'mechanism', 'no_hints', 'median_time', 'language'];
function windowOf(period, at = Date.now()) {
  const d0 = Date.parse(dayStr(at));
  if (period === 'day') return [d0, d0 + DAY];
  if (period === 'week') { const dow = (new Date(d0).getUTCDay() + 6) % 7; return [d0 - dow * DAY, d0 - dow * DAY + 7 * DAY]; }
  const d = new Date(d0); return [Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)];
}
async function goalProgress(db, unit, goal) {
  const [a, b] = windowOf(goal.period);
  const w = [`g.player_id IN (${marks(unit.ids.length ? unit.ids : [''])})`, COUNTED, 'g.started_at >= ?', 'g.started_at < ?'];
  const args = [...(unit.ids.length ? unit.ids : ['']), new Date(a).toISOString(), new Date(b).toISOString()];
  const q = (extra, xargs = [], sel = 'COUNT(*)') => db.get(`SELECT ${sel} AS n FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${[...w, extra].join(' AND ')}`, [...args, ...xargs]);
  let value; let done;
  if (goal.kind === 'solve') value = (await q("g.status = 'solved'")).n;
  else if (goal.kind === 'games') value = (await q("g.status IN ('solved','revealed')")).n;
  else if (goal.kind === 'mechanism') value = (await q("g.status = 'solved' AND c.mechanism = ?", [goal.param])).n;
  else if (goal.kind === 'no_hints') value = (await q("g.status = 'solved' AND g.hints_used = 0")).n;
  else if (goal.kind === 'language') value = (await q('c.language_code = ?', [goal.param])).n;
  if (goal.kind === 'median_time') {
    value = await medianOf(db, `SELECT g.duration_ms AS v FROM games g WHERE ${w.join(' AND ')} AND g.status = 'solved'`, args);
    done = value !== null && value <= goal.target * 1000;
  } else done = value >= goal.target;
  return { value, done, window: { from: dayStr(a), to: dayStr(b - DAY) } };
}
async function listGoals(db, unit) {
  const goals = await db.all('SELECT * FROM user_goals WHERE user_id = ? ORDER BY created_at', [unit.userId]);
  const out = [];
  for (const g of goals) out.push({ ...g, progress: await goalProgress(db, unit, g) });
  return { items: out };
}
async function validGoal(db, b) {
  if (!GOAL_KINDS.includes(b.kind)) throw new HttpError(400, 'invalid_goal');
  if (!['day', 'week', 'month'].includes(b.period)) throw new HttpError(400, 'invalid_period');
  const target = Math.round(Number(b.target));
  const max = b.kind === 'median_time' ? 3600 : 500;
  if (!(target >= 1 && target <= max)) throw new HttpError(400, 'invalid_target');
  let param = null;
  if (b.kind === 'mechanism') {
    if (!(await db.get("SELECT 1 FROM clues WHERE status = 'published' AND mechanism = ? LIMIT 1", [String(b.param || '')]))) throw new HttpError(400, 'invalid_param');
    param = String(b.param);
  }
  if (b.kind === 'language') {
    if (!(await db.get('SELECT 1 FROM languages WHERE code = ? AND enabled = 1', [String(b.param || '')]))) throw new HttpError(400, 'invalid_param');
    param = String(b.param);
  }
  return { kind: b.kind, period: b.period, target, param };
}
async function createGoal(db, userId, b) {
  const n = (await db.get('SELECT COUNT(*) AS n FROM user_goals WHERE user_id = ?', [userId])).n;
  if (n >= 10) throw new HttpError(400, 'too_many_goals', 'Podés tener hasta 10 objetivos.');
  const g = await validGoal(db, b); const id = uuid();
  await db.run('INSERT INTO user_goals(id, user_id, kind, target, period, param) VALUES (?,?,?,?,?,?)', [id, userId, g.kind, g.target, g.period, g.param]);
  return { id };
}
async function updateGoal(db, userId, id, b) {
  const g = await validGoal(db, b);
  const r = await db.run('UPDATE user_goals SET kind = ?, target = ?, period = ?, param = ?, updated_at = ? WHERE id = ? AND user_id = ?', [g.kind, g.target, g.period, g.param, now(), id, userId]);
  if (!r.changes) throw new HttpError(404, 'not_found');
  return { ok: true };
}

// ── Biblioteca (referencias; el texto se muestra solo si el críptico sigue publicado) ──
async function library(db, unit, q) {
  const per = 24; const page = Math.max(1, Math.min(1000, Number(q.page) || 1));
  const tab = String(q.tab || 'favorites');
  const w = []; const args = [];
  let from;
  if (tab === 'favorites') { from = 'favorites x JOIN clues c ON c.id = x.clue_id WHERE x.user_id = ?'; args.push(unit.userId); }
  else if (tab === 'retry') { from = 'retry_list x JOIN clues c ON c.id = x.clue_id WHERE x.user_id = ?'; args.push(unit.userId); }
  else if (tab === 'solved') {
    if (!unit.ids.length) return { tab, total: 0, page, per_page: per, items: [] };
    from = `(SELECT g.clue_id, MAX(g.finished_at) AS created_at FROM games g WHERE g.player_id IN (${marks(unit.ids)}) AND g.status = 'solved' GROUP BY g.clue_id) x
      JOIN clues c ON c.id = x.clue_id WHERE 1 = 1`; args.push(...unit.ids);
  } else if (tab.startsWith('collection:')) {
    const col = await db.get('SELECT id FROM collections WHERE id = ? AND user_id = ?', [tab.slice(11), unit.userId]);
    if (!col) throw new HttpError(404, 'not_found');
    from = 'collection_items x JOIN clues c ON c.id = x.clue_id WHERE x.collection_id = ?'; args.push(col.id);
  } else throw new HttpError(400, 'invalid_tab');
  if (/^[a-z]{2}$/.test(q.lang || '')) { w.push('c.language_code = ?'); args.push(q.lang); }
  if (/^[1-5]$/.test(q.difficulty || '')) { w.push('c.difficulty = ?'); args.push(Number(q.difficulty)); }
  if (/^[a-z_]{2,40}$/.test(q.category || '')) { w.push('c.category = ?'); args.push(q.category); }
  if (/^[a-z_]{2,40}$/.test(q.mechanism || '')) { w.push('c.mechanism = ?'); args.push(q.mechanism); }
  const where = `${from} ${w.length ? 'AND ' + w.join(' AND ') : ''}`;
  const total = (await db.get(`SELECT COUNT(*) AS n FROM ${where}`, args)).n;
  const timeCol = tab === 'solved' ? 'x.created_at' : tab.startsWith('collection:') ? 'x.added_at' : 'x.created_at';
  const rows = await db.all(`SELECT c.*, ${timeCol} AS saved_at FROM ${where} ORDER BY ${timeCol} DESC LIMIT ? OFFSET ?`, [...args, per, (page - 1) * per]);
  const solved = unit.ids.length && rows.length ? new Set((await db.all(`SELECT DISTINCT clue_id FROM games WHERE player_id IN (${marks(unit.ids)}) AND status IN ('solved','revealed')
    AND clue_id IN (${marks(rows)})`, [...unit.ids, ...rows.map((r) => r.id)])).map((r) => r.clue_id)) : new Set();
  return { tab, total, page, per_page: per, items: rows.map((c) => (c.status === 'published'
    // La explicación solo para crípticos que la persona ya resolvió o reveló.
    ? { ...publicClue(c), saved_at: c.saved_at, available: true, solution: solved.has(c.id) ? solutionView(c) : null }
    : { id: c.id, saved_at: c.saved_at, available: false })) };
}

// ── Perfil público ──
const AVATAR_GLYPHS = ['A', 'C', 'E', 'K', 'M', 'Ñ', 'Q', 'R', 'S', 'X', 'Z', '?', '&', '§'];
const AVATAR_TONES = 8;
// Avatares exclusivos de Plus (ver services/plus.js): se pueden elegir solo siendo Plus.
const PLUS_GLYPHS = ['★', '♛', '◆', '✦', '∞', 'Ω'];
const isPlusRow = (u) => !!(u && u.plus_until && Date.parse(u.plus_until) > Date.now());
const validAvatar = (a, plus = false) => { const m = /^(.+)-([0-7])$/.exec(a || ''); return !!(m && (AVATAR_GLYPHS.includes(m[1]) || (plus && PLUS_GLYPHS.includes(m[1]))) && Number(m[2]) < AVATAR_TONES); };
const SHARE_KEYS = ['level', 'solved', 'streaks', 'languages', 'country', 'badges'];

async function updateProfile(db, userId, b) {
  const cur = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  const set = {};
  if (b.public_profile !== undefined) set.public_profile = b.public_profile ? 1 : 0;
  if (b.public_name !== undefined) {
    const n = b.public_name === null ? '' : String(b.public_name).trim();
    if (n && (n.length > 30 || /[@<>]/.test(n) || /[\u0000-\u001f]/.test(n))) throw new HttpError(400, 'invalid_name', 'El nombre público admite hasta 30 caracteres, sin @.');
    set.public_name = n || null;
  }
  if (b.avatar !== undefined) {
    if (b.avatar !== null && !validAvatar(b.avatar, isPlusRow(cur))) throw new HttpError(400, 'invalid_avatar', /^(.+)-/.test(b.avatar || '') && PLUS_GLYPHS.includes(/^(.+)-/.exec(b.avatar)[1]) ? 'Ese avatar es exclusivo de Plus.' : undefined);
    set.avatar = b.avatar;
  }
  if (b.share !== undefined) {
    const s = {};
    for (const k of SHARE_KEYS) if (b.share && b.share[k] === true) s[k] = true;
    if (b.share && Array.isArray(b.share.achievements)) s.achievements = b.share.achievements.filter((c) => ACH_CODES.includes(c)).slice(0, 24);
    set.profile_share = JSON.stringify(s);
  }
  if (b.prefs !== undefined) {
    const p = {};
    for (const k of Object.keys(PREF_DEFAULTS)) if (b.prefs && typeof b.prefs[k] === 'boolean') p[k] = b.prefs[k];
    set.profile_prefs = JSON.stringify({ ...parseJson(cur.profile_prefs, {}), ...p });
  }
  if (b.leaderboard_opt_in !== undefined) set.leaderboard_opt_in = b.leaderboard_opt_in ? 1 : 0;
  const keys = Object.keys(set);
  if (keys.length) await db.run(`UPDATE users SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, [...keys.map((k) => set[k]), userId]);
  return { ok: true };
}

// Solo lo que la persona eligió mostrar. Nunca correo, historial, respuestas, tiempos ni pistas.
async function publicProfile(db, username) {
  const u = await db.get("SELECT * FROM users WHERE username = ? AND role = 'player' AND public_profile = 1 AND deleted_at IS NULL AND disabled = 0", [String(username || '')]);
  if (!u) return null;
  const share = parseJson(u.profile_share, {});
  const unit = { ids: (await db.all('SELECT id FROM players WHERE user_id = ?', [u.id])).map((r) => r.id), owner: 'u:' + u.id, userId: u.id };
  const f = unit.ids.length ? await facts(db, unit.ids) : null;
  const out = { name: u.public_name || u.username, username: u.username, avatar: u.avatar || null, plus: isPlusRow(u) };
  if (share.level) { const achN = (await db.get('SELECT COUNT(*) AS n FROM achievements_earned WHERE owner = ?', [unit.owner])).n; out.level = levelFor(xpOf(f, achN)).level; }
  if (share.solved) out.unique_solved = f ? f.unique_solved : 0;
  if (share.streaks) out.streaks = { current: f ? f.day_streak : 0, best: f ? f.day_streak_best : 0 };
  if (share.languages && unit.ids.length) out.languages = (await db.all(`SELECT DISTINCT c.language_code AS l FROM games g JOIN clues c ON c.id = g.clue_id
    WHERE g.player_id IN (${marks(unit.ids)}) AND g.status = 'solved' ORDER BY l`, unit.ids)).map((r) => r.l);
  if (share.country && u.country_code) out.country = u.country_code;
  if (share.badges && Array.isArray(share.achievements) && share.achievements.length) {
    out.badges = await db.all(`SELECT code, earned_at FROM achievements_earned WHERE owner = ? AND code IN (${marks(share.achievements)}) ORDER BY earned_at`, [unit.owner, ...share.achievements]);
    out.badges = out.badges.map((b) => ({ code: b.code, earned_on: b.earned_at.slice(0, 10) }));
  }
  return out;
}

// ── Compartir un resultado ──
async function shareGame(db, unit, gameId, b) {
  const d = await gameDetail(db, unit, gameId);
  if (['started', 'in_progress'].includes(d.game.status)) throw new HttpError(409, 'game_open', 'Terminá la partida antes de compartirla.');
  const showAnswer = b.show_answer === true && ['solved', 'revealed'].includes(d.game.status) ? 1 : 0;
  const showTime = b.show_time === true ? 1 : 0;
  const prev = await db.get('SELECT token FROM game_shares WHERE game_id = ?', [gameId]);
  const token = prev ? prev.token : randomToken(16);
  if (prev) await db.run('UPDATE game_shares SET show_time = ?, show_answer = ? WHERE token = ?', [showTime, showAnswer, token]);
  else await db.run('INSERT INTO game_shares(token, game_id, show_time, show_answer) VALUES (?,?,?,?)', [token, gameId, showTime, showAnswer]);
  return { token };
}
async function sharedCard(db, token) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token || '')) return null;
  const s = await db.get(`SELECT s.show_time, s.show_answer, g.status, g.duration_ms, g.hints_used, g.attempts, c.clue_text, c.enumeration, c.slug, c.difficulty,
      c.language_code, c.variant_code, c.answer, c.status AS clue_status FROM game_shares s JOIN games g ON g.id = s.game_id JOIN clues c ON c.id = g.clue_id WHERE s.token = ?`, [token]);
  if (!s || s.clue_status !== 'published') return null;
  return { clue: s.clue_text, enumeration: s.enumeration, slug: s.slug, difficulty: s.difficulty, language: s.language_code, variant: s.variant_code,
    result: s.status, attempts: s.attempts, no_hints: s.status === 'solved' && s.hints_used === 0,
    time_ms: s.show_time && s.status === 'solved' ? s.duration_ms : null, answer: s.show_answer ? s.answer : null };
}

// ── Rankings voluntarios ──
// Diario: una entrada por cuenta (su primera partida del desafío, sin reinicios), en dos
// tablas separadas: «sin ayudas» (sin pistas ni revelar) y «con pistas». Menos de 3 s se
// considera no válido. Semanal: crípticos únicos resueltos en la semana, por idioma.
const MIN_VALID_MS = 3000;
async function leaderboard(db, q, user) {
  const lang = /^[a-z]{2}$/.test(q.lang || '') ? q.lang : 'es';
  const nameOf = (r) => r.public_name || r.username;
  if (q.board === 'weekly') {
    const [a, b] = windowOf('week');
    const rows = await db.all(`SELECT u.id, u.username, u.public_name, u.plus_until, COUNT(DISTINCT g.clue_id) AS solved FROM games g JOIN players p ON p.id = g.player_id
      JOIN users u ON u.id = p.user_id JOIN clues c ON c.id = g.clue_id WHERE u.leaderboard_opt_in = 1 AND u.deleted_at IS NULL AND u.disabled = 0
      AND g.status = 'solved' AND g.mode <> 'practice' AND g.duration_ms >= ${MIN_VALID_MS} AND c.language_code = ? AND g.finished_at >= ? AND g.finished_at < ?
      GROUP BY u.id ORDER BY solved DESC, MIN(g.finished_at) ASC LIMIT 100`, [lang, new Date(a).toISOString(), new Date(b).toISOString()]);
    return { board: 'weekly', lang, from: dayStr(a), to: dayStr(b - DAY), items: rows.slice(0, 50).map((r, i) => ({ rank: i + 1, name: nameOf(r), plus: isPlusRow(r), solved: r.solved, me: !!(user && user.id === r.id) })),
      me: user ? (rows.findIndex((r) => r.id === user.id) + 1 || null) : null };
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : dayStr(Date.now());
  const clean = q.board !== 'assisted';
  const rows = await db.all(`WITH first AS (
      SELECT u.id AS uid, u.username, u.public_name, u.plus_until, g.*, ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY g.started_at) AS n
      FROM games g JOIN players p ON p.id = g.player_id JOIN users u ON u.id = p.user_id JOIN clues c ON c.id = g.clue_id
      WHERE g.daily_date = ? AND g.mode = 'daily' AND c.language_code = ? AND u.leaderboard_opt_in = 1 AND u.deleted_at IS NULL AND u.disabled = 0)
    SELECT * FROM first WHERE n = 1 AND status = 'solved' AND duration_ms >= ${MIN_VALID_MS} AND ${clean ? 'hints_used = 0' : 'hints_used > 0'}
    ORDER BY ${clean ? 'attempts ASC, duration_ms ASC' : 'hints_used ASC, attempts ASC, duration_ms ASC'} LIMIT 100`, [date, lang]);
  return { board: clean ? 'clean' : 'assisted', lang, date,
    items: rows.slice(0, 50).map((r, i) => ({ rank: i + 1, name: nameOf(r), plus: isPlusRow(r), attempts: r.attempts, hints: r.hints_used, time_ms: r.duration_ms, me: !!(user && user.id === r.uid) })),
    me: user ? (rows.findIndex((r) => r.uid === user.id) + 1 || null) : null };
}

// ── Vincular partidas jugadas sin cuenta (solo con autorización expresa) ──
async function linkAnonymous(db, user, playerId) {
  const p = playerId && await db.get('SELECT id, user_id FROM players WHERE id = ? AND retired_at IS NULL', [playerId]);
  if (!p || p.user_id) throw new HttpError(409, 'nothing_to_link');
  await db.tx(async (t) => {
    const r = await t.run('UPDATE players SET user_id = ? WHERE id = ? AND user_id IS NULL AND retired_at IS NULL', [user.id, p.id]);
    if (!r.changes) throw new HttpError(409, 'nothing_to_link');
    await t.run(`INSERT OR IGNORE INTO achievements_earned(owner, code, game_id, earned_at) SELECT ?, code, game_id, earned_at FROM achievements_earned WHERE owner = ?`, ['u:' + user.id, 'p:' + p.id]);
    await t.run('DELETE FROM achievements_earned WHERE owner = ?', ['p:' + p.id]);
  });
  const unit = await ownerOfPlayer(db, p.id);
  await evaluateAchievements(db, unit, null);
  return { ok: true, games: (await db.get('SELECT COUNT(*) AS n FROM games WHERE player_id = ?', [p.id])).n };
}

// Borra lo propio del perfil al eliminar la cuenta.
async function forgetProfile(t, userId, playerIds) {
  await t.run('DELETE FROM achievements_earned WHERE owner = ?', ['u:' + userId]);
  await t.run('DELETE FROM user_goals WHERE user_id = ?', [userId]);
  await t.run('DELETE FROM retry_list WHERE user_id = ?', [userId]);
  await t.run('DELETE FROM collections WHERE user_id = ?', [userId]);
  if (playerIds.length) await t.run(`DELETE FROM game_shares WHERE game_id IN (SELECT id FROM games WHERE player_id IN (${marks(playerIds)}))`, playerIds);
}

module.exports = {
  unitFor, ownerOfPlayer, facts, summary, history, gameDetail, evolution, strengths, records, calendar, recommendations,
  achievementList, evaluateAchievements, onGameFinished, levelFor, xpOf, listGoals, createGoal, updateGoal, library, updateProfile,
  publicProfile, shareGame, sharedCard, leaderboard, linkAnonymous, forgetProfile, prefsOf,
  ACHIEVEMENTS, ACH_CODES, AVATAR_GLYPHS, PLUS_GLYPHS, AVATAR_TONES, GOAL_KINDS, MIN_MASTERY, dayStreaks,
};
