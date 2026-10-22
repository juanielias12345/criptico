'use strict';

// Indicadores del panel. Todo sale de la base: si no hay datos, se devuelve 0 o null
// (la interfaz muestra «Sin información»), nunca valores de relleno.
// Las definiciones de cada métrica están en docs/PANEL.md y en METRIC_DEFS.

const { getSetting } = require('./settings');
const { classifyStale } = require('./tracking');
const { HttpError, now } = require('./util');

const DAY = 86400000;
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const startOfDay = (t) => Date.parse(dayStr(t) + 'T00:00:00.000Z');

// ── Períodos ──
const PERIODS = ['today', '24h', '7d', '30d', '90d', 'this_month', 'last_month', 'custom'];

function parsePeriod(q = {}, at = Date.now()) {
  const period = PERIODS.includes(q.period) ? q.period : '30d';
  let from; let to;
  const today0 = startOfDay(at);
  if (period === 'today') { from = today0; to = today0 + DAY; }
  else if (period === '24h') { to = at; from = at - DAY; }
  else if (['7d', '30d', '90d'].includes(period)) { const n = parseInt(period, 10); to = today0 + DAY; from = to - n * DAY; }
  else if (period === 'this_month') { const d = new Date(today0); from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); to = today0 + DAY; }
  else if (period === 'last_month') { const d = new Date(today0); from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1); to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
  else {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(q.from || '') || !re.test(q.to || '')) throw new HttpError(400, 'invalid_range', 'Elegí fecha de inicio y de fin.');
    from = Date.parse(q.from + 'T00:00:00.000Z'); to = Date.parse(q.to + 'T00:00:00.000Z') + DAY;
    if (!(to > from)) throw new HttpError(400, 'invalid_range', 'La fecha de fin debe ser posterior a la de inicio.');
    if (to - from > 3 * 366 * DAY) throw new HttpError(400, 'range_too_long', 'El intervalo máximo es de tres años.');
  }
  // Período anterior equivalente (misma duración, inmediatamente antes).
  const len = to - from;
  const iso = (t) => new Date(t).toISOString();
  return { period, from: iso(from), to: iso(to), prevFrom: iso(from - len), prevTo: iso(from), days: Math.max(1, Math.round(len / DAY)),
    dayAligned: from % DAY === 0 && to % DAY === 0 };
}

function readFilters(q = {}) {
  const f = {};
  if (/^[A-Z]{2}$/.test(q.country || '')) f.country = q.country;
  if (/^[a-z]{2}$/.test(q.lang || '')) f.lang = q.lang;
  if (/^[a-z]{2}-[A-Z]{2}$/.test(q.variant || '')) f.variant = q.variant;
  return f;
}

function gameWhere(from, to, f, alias = 'g') {
  const w = [`${alias}.started_at >= ?`, `${alias}.started_at < ?`]; const args = [from, to];
  if (f.country) { w.push(`${alias}.country_code = ?`); args.push(f.country); }
  if (f.variant) { w.push(`${alias}.play_variant = ?`); args.push(f.variant); }
  if (f.lang) { w.push('c.language_code = ?'); args.push(f.lang); }
  return { sql: w.join(' AND '), args };
}

// Columnas agregadas comunes (desde «games»).
const AGG = `COUNT(*) AS started,
  SUM(CASE WHEN g.status IN ('solved','revealed') THEN 1 ELSE 0 END) AS completed,
  SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved,
  SUM(CASE WHEN g.status = 'revealed' THEN 1 ELSE 0 END) AS revealed,
  SUM(CASE WHEN g.status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
  SUM(CASE WHEN g.status = 'expired' THEN 1 ELSE 0 END) AS expired,
  SUM(CASE WHEN g.status = 'error' THEN 1 ELSE 0 END) AS errored,
  SUM(g.wrong_attempts) AS wrong, SUM(g.hints_used) AS hints, SUM(g.active_ms) AS active_ms,
  SUM(CASE WHEN g.status = 'solved' THEN g.duration_ms ELSE 0 END) AS solve_ms_sum`;
const SUMS = ['started', 'completed', 'solved', 'revealed', 'abandoned', 'expired', 'errored', 'wrong', 'hints', 'active_ms', 'solve_ms_sum'];

// ── Resumen diario (tabla stats_daily) ──
async function rollupDays(db, days) {
  for (const day of days) {
    const from = day + 'T00:00:00.000Z'; const to = dayStr(Date.parse(from) + DAY) + 'T00:00:00.000Z';
    await db.tx(async (t) => {
      await t.run('DELETE FROM stats_daily WHERE day = ?', [day]);
      await t.run(`INSERT INTO stats_daily(day, language_code, country_code, play_variant, mode, ${SUMS.join(', ')}, players, computed_at)
        SELECT ?, c.language_code, COALESCE(g.country_code, ''), COALESCE(g.play_variant, ''), g.mode, ${AGG}, COUNT(DISTINCT g.player_id), ?
        FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.started_at >= ? AND g.started_at < ?
        GROUP BY c.language_code, COALESCE(g.country_code, ''), COALESCE(g.play_variant, ''), g.mode`, [day, now(), from, to]);
    });
  }
}

// Recalcula los días recientes (y todo el historial la primera vez). La tarea
// programada lo hace cada hora; el panel lo pide si el último cálculo tiene más de 10 minutos.
async function refresh(db, { force = false } = {}) {
  const job = await db.get("SELECT last_run_at FROM jobs WHERE name = 'analytics_rollup'");
  const last = job && job.last_run_at ? Date.parse(job.last_run_at) : 0;
  if (!force && Date.now() - last < 10 * 60000) return { skipped: true, computed_at: job.last_run_at };
  const classified = await classifyStale(db);
  const days = new Set([dayStr(Date.now()), dayStr(Date.now() - DAY)]);
  const lastDone = await db.get('SELECT MAX(day) AS d FROM stats_daily');
  const firstGame = await db.get('SELECT MIN(started_at) AS d FROM games');
  // Días sin calcular todavía (primera vez o tras una pausa larga) y días con partidas re-clasificadas.
  let startT = lastDone && lastDone.d ? Date.parse(lastDone.d) : (firstGame && firstGame.d ? startOfDay(Date.parse(firstGame.d)) : Date.now());
  for (let t = startT; t <= Date.now(); t += DAY) days.add(dayStr(t));
  if (classified) {
    const changed = await db.all(`SELECT DISTINCT substr(g.started_at, 1, 10) AS d FROM game_events e JOIN games g ON g.id = e.game_id
      WHERE e.kind IN ('abandon','resume') AND e.created_at >= ?`, [new Date(last || 0).toISOString()]);
    for (const r of changed) days.add(r.d);
  }
  const list = [...days].sort().slice(-800);
  await rollupDays(db, list);
  await db.run("UPDATE jobs SET last_run_at = ?, last_status = 'success' WHERE name = 'analytics_rollup'", [now()]);
  return { days: list.length, classified };
}

async function computedAt(db) {
  const r = await db.get('SELECT MIN(computed_at) AS oldest, MAX(computed_at) AS newest FROM stats_daily WHERE day >= ?', [dayStr(Date.now() - DAY)]);
  return r && r.newest;
}

// Agregado de partidas en un intervalo: desde stats_daily si el intervalo es de días
// completos; si no (últimas 24 h), directamente desde games.
async function gameTotals(db, from, to, f, dayAligned) {
  if (dayAligned) {
    const w = ['day >= ?', 'day < ?']; const args = [from.slice(0, 10), to.slice(0, 10)];
    if (f.country) { w.push('country_code = ?'); args.push(f.country); }
    if (f.variant) { w.push('play_variant = ?'); args.push(f.variant); }
    if (f.lang) { w.push('language_code = ?'); args.push(f.lang); }
    const r = await db.get(`SELECT ${SUMS.map((s) => `SUM(${s}) AS ${s}`).join(', ')} FROM stats_daily WHERE ${w.join(' AND ')}`, args);
    return norm(r);
  }
  const gw = gameWhere(from, to, f);
  return norm(await db.get(`SELECT ${AGG} FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${gw.sql}`, gw.args));
}

function norm(r) {
  const o = {};
  for (const k of SUMS) o[k] = Number((r && r[k]) || 0);
  o.in_progress = Math.max(0, o.started - o.completed - o.abandoned - o.expired - o.errored);
  const closed = o.started - o.in_progress;
  o.solve_rate = o.started ? round1((o.solved / o.started) * 100) : null;
  o.abandon_rate = closed ? round1((o.abandoned / closed) * 100) : null;
  o.avg_solve_ms = o.solved ? Math.round(o.solve_ms_sum / o.solved) : null;
  o.hints_per_game = o.started ? round1(o.hints / o.started) : null;
  return o;
}
const round1 = (x) => Math.round(x * 10) / 10;

async function medianOf(db, expr, from, to, f, extraWhere) {
  const gw = gameWhere(from, to, f);
  const where = `${gw.sql} AND ${extraWhere}`;
  const n = (await db.get(`SELECT COUNT(*) AS n FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${where}`, gw.args)).n;
  if (!n) return null;
  const rows = await db.all(`SELECT ${expr} AS v FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${where} ORDER BY v LIMIT ? OFFSET ?`,
    [...gw.args, n % 2 ? 1 : 2, Math.floor((n - 1) / 2)]);
  return Math.round(rows.reduce((s, r) => s + Number(r.v), 0) / rows.length);
}

async function activePlayers(db, from, to, f) {
  const gw = gameWhere(from, to, f);
  return (await db.get(`SELECT COUNT(DISTINCT g.player_id) AS n FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${gw.sql}`, gw.args)).n;
}

async function registeredActive(db, from, to, f) {
  const gw = gameWhere(from, to, f);
  return (await db.get(`SELECT COUNT(DISTINCT p.user_id) AS n FROM games g JOIN clues c ON c.id = g.clue_id JOIN players p ON p.id = g.player_id
    WHERE ${gw.sql} AND p.user_id IS NOT NULL`, gw.args)).n;
}

async function traffic(db, from, to, f) {
  // Los contadores son diarios: un intervalo que termina a mitad de día incluye ese día.
  const toDay = Date.parse(to) % DAY === 0 ? to.slice(0, 10) : dayStr(Date.parse(to) + DAY);
  const w = ['day >= ?', 'day < ?']; const args = [from.slice(0, 10), toDay];
  if (f.country) { w.push('country = ?'); args.push(f.country); }
  const rows = await db.all(`SELECT kind, SUM(n) AS n FROM traffic_daily WHERE ${w.join(' AND ')} GROUP BY kind`, args);
  const o = { pageview: 0, new_visitor: 0 };
  for (const r of rows) o[r.kind] = Number(r.n || 0);
  return o;
}

function usersWhere(f) {
  const w = ["role = 'player'", 'deleted_at IS NULL']; const args = [];
  if (f.country) { w.push('country_code = ?'); args.push(f.country); }
  if (f.variant) { w.push('play_variant = ?'); args.push(f.variant); }
  if (f.lang) { w.push("(play_variant = ? OR play_variant LIKE ? OR (play_variant IS NULL AND ui_language = ?))"); args.push(f.lang, f.lang + '-%', f.lang); }
  return { sql: w.join(' AND '), args };
}

async function periodBlock(db, from, to, f, dayAligned) {
  const uw = usersWhere(f);
  const [games, players, regActive, newUsers, visits, medianSolve, medianActive, errors] = await Promise.all([
    gameTotals(db, from, to, f, dayAligned),
    activePlayers(db, from, to, f),
    registeredActive(db, from, to, f),
    db.get(`SELECT COUNT(*) AS n FROM users WHERE ${uw.sql} AND created_at >= ? AND created_at < ?`, [...uw.args, from, to]),
    traffic(db, from, to, f),
    medianOf(db, 'g.duration_ms', from, to, f, "g.status = 'solved'"),
    medianOf(db, 'g.active_ms', from, to, f, "g.status = 'solved'"),
    db.get('SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ? AND created_at < ?', [from, to]),
  ]);
  return { games, active_players: players, active_registered: regActive, new_users: newUsers.n, visits,
    median_solve_ms: medianSolve, median_active_solve_ms: medianActive, errors: errors.n };
}

async function overview(db, q) {
  await refresh(db);
  const p = parsePeriod(q); const f = readFilters(q);
  const uw = usersWhere(f);
  const end = Math.min(Date.parse(p.to), Date.now());
  const iso = (t) => new Date(t).toISOString();
  const [cur, prev, registered, dau, wau, mau] = await Promise.all([
    periodBlock(db, p.from, p.to, f, p.dayAligned),
    periodBlock(db, p.prevFrom, p.prevTo, f, p.dayAligned),
    db.get(`SELECT COUNT(*) AS n FROM users WHERE ${uw.sql} AND created_at < ?`, [...uw.args, p.to]),
    activePlayers(db, iso(end - DAY), iso(end), f),
    activePlayers(db, iso(end - 7 * DAY), iso(end), f),
    activePlayers(db, iso(end - 30 * DAY), iso(end), f),
  ]);
  const catalog = await db.all("SELECT language_code AS lang, COUNT(*) AS n FROM clues WHERE status = 'published' GROUP BY language_code");
  const origin = await db.all("SELECT origin, COUNT(*) AS n FROM clues WHERE status = 'published' GROUP BY origin");
  const autoImported = await db.get("SELECT COUNT(*) AS n FROM import_items WHERE status = 'auto_published' AND imported_at >= ? AND imported_at < ?", [p.from, p.to]);
  const pending = await db.get("SELECT COUNT(*) AS n FROM submissions WHERE status IN ('pending','in_review')");
  const top = await breakdowns(db, p, f);
  const jobs = await db.all('SELECT name, enabled, last_status, last_error, last_run_at, next_run_at, consecutive_failures FROM jobs ORDER BY name');
  const sources = await db.get(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
    COALESCE(SUM(CASE WHEN status = 'error' OR consecutive_failures > 0 THEN 1 ELSE 0 END), 0) AS failing, MAX(last_success_at) AS last_success FROM sources`);
  const openAlerts = await db.all("SELECT severity, COUNT(*) AS n FROM alerts WHERE status = 'open' GROUP BY severity");
  return {
    period: p, filters: f, computed_at: await computedAt(db),
    current: cur, previous: prev.games.started || prev.active_players || prev.new_users ? prev : null,
    registered_total: registered.n, dau, wau, mau,
    catalog: { published: catalog.reduce((s, r) => s + r.n, 0), by_language: catalog, by_origin: origin, auto_imported: autoImported.n },
    pending_submissions: pending.n, top, series: await series(db, p, f), jobs, sources, open_alerts: openAlerts,
  };
}

async function breakdowns(db, p, f) {
  const gw = gameWhere(p.from, p.to, f);
  const by = (expr) => db.all(`SELECT ${expr} AS k, COUNT(*) AS games, COUNT(DISTINCT g.player_id) AS players,
    SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved FROM games g JOIN clues c ON c.id = g.clue_id
    WHERE ${gw.sql} GROUP BY k ORDER BY games DESC LIMIT 12`, gw.args);
  return { languages: await by('c.language_code'), variants: await by("COALESCE(g.play_variant, '')"), countries: await by("COALESCE(g.country_code, '')") };
}

// Serie por día (o por hora en «hoy» y «24 h»).
async function series(db, p, f) {
  const hourly = p.days <= 1;
  const gw = gameWhere(p.from, p.to, f);
  const bucket = hourly ? 'substr(g.started_at, 1, 13)' : 'substr(g.started_at, 1, 10)';
  const rows = await db.all(`SELECT ${bucket} AS t, COUNT(*) AS started, SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved,
    SUM(CASE WHEN g.status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned, COUNT(DISTINCT g.player_id) AS players
    FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${gw.sql} GROUP BY t ORDER BY t`, gw.args);
  const map = new Map(rows.map((r) => [r.t, r]));
  const out = [];
  const step = hourly ? 3600000 : DAY;
  for (let t = Date.parse(p.from); t < Date.parse(p.to) && out.length < 1200; t += step) {
    const key = new Date(t).toISOString().slice(0, hourly ? 13 : 10);
    const r = map.get(key) || {};
    out.push({ t: key, started: r.started || 0, solved: r.solved || 0, abandoned: r.abandoned || 0, players: r.players || 0 });
  }
  return { unit: hourly ? 'hour' : 'day', points: out };
}

// ── Regiones e idiomas ──
async function geo(db, q) {
  await refresh(db);
  const p = parsePeriod(q); const f = readFilters(q);
  const gw = gameWhere(p.from, p.to, f);
  const countries = await db.all(`SELECT COALESCE(g.country_code, '') AS country, COUNT(DISTINCT g.player_id) AS players, COUNT(*) AS games,
    SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved, SUM(g.active_ms) AS active_ms
    FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${gw.sql} GROUP BY country ORDER BY games DESC LIMIT 100`, gw.args);
  const uw = usersWhere({ lang: f.lang, variant: f.variant });
  const regByCountry = await db.all(`SELECT COALESCE(country_code, '') AS country, COUNT(*) AS users,
    SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS new_users FROM users WHERE ${uw.sql} GROUP BY country ORDER BY users DESC LIMIT 100`,
  [p.from, p.to, ...uw.args]);
  const activeReg = await db.all(`SELECT COALESCE(u.country_code, '') AS country, COUNT(DISTINCT u.id) AS active_users FROM games g
    JOIN clues c ON c.id = g.clue_id JOIN players pl ON pl.id = g.player_id JOIN users u ON u.id = pl.user_id
    WHERE ${gw.sql} GROUP BY country`, gw.args);
  const languages = await db.all(`SELECT c.language_code AS lang, COUNT(*) AS games, COUNT(DISTINCT g.player_id) AS players,
    SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${gw.sql}
    GROUP BY lang ORDER BY games DESC`, gw.args);
  const variants = await db.all(`SELECT COALESCE(g.play_variant, '') AS variant, COUNT(*) AS games, COUNT(DISTINCT g.player_id) AS players
    FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${gw.sql} GROUP BY variant ORDER BY games DESC`, gw.args);
  const userLangs = await db.all(`SELECT COALESCE(play_variant, ui_language, '') AS choice, COUNT(*) AS users FROM users
    WHERE role = 'player' AND deleted_at IS NULL GROUP BY choice ORDER BY users DESC`);
  // Evolución de los 5 países con más partidas.
  const top5 = countries.slice(0, 5).map((c) => c.country);
  let evolution = [];
  if (top5.length) {
    const rows = await db.all(`SELECT substr(g.started_at, 1, 10) AS day, COALESCE(g.country_code, '') AS country, COUNT(*) AS games,
      COUNT(DISTINCT g.player_id) AS players FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${gw.sql}
      AND COALESCE(g.country_code, '') IN (${top5.map(() => '?').join(',')}) GROUP BY day, country ORDER BY day`, [...gw.args, ...top5]);
    evolution = top5.map((c) => ({ country: c, points: rows.filter((r) => r.country === c).map((r) => ({ t: r.day, games: r.games, players: r.players })) }));
  }
  const reg = new Map(regByCountry.map((r) => [r.country, r]));
  const act = new Map(activeReg.map((r) => [r.country, r.active_users]));
  return {
    period: p, filters: f,
    countries: countries.map((c) => ({ ...c, solve_rate: c.games ? round1((c.solved / c.games) * 100) : null, users: (reg.get(c.country) || {}).users || 0,
      new_users: (reg.get(c.country) || {}).new_users || 0, active_users: act.get(c.country) || 0 })),
    registrations: regByCountry, languages, variants, user_languages: userLangs, evolution,
    inferred_location: null, // no se infiere ubicación técnica: solo el país elegido por la persona
  };
}

// ── Embudo ──
async function funnel(db, q) {
  const p = parsePeriod(q); const f = readFilters(q);
  const visits = await traffic(db, p.from, p.to, f);
  const w = ['p.created_at >= ?', 'p.created_at < ?']; const args = [p.from, p.to];
  if (f.country) { w.push('p.country_code = ?'); args.push(f.country); }
  if (f.variant) { w.push('p.play_variant = ?'); args.push(f.variant); }
  if (f.lang) { w.push('(p.play_variant = ? OR p.play_variant LIKE ?)'); args.push(f.lang, f.lang + '-%'); }
  const r = await db.get(`SELECT COUNT(*) AS players,
      SUM(CASE WHEN x.games > 0 THEN 1 ELSE 0 END) AS started,
      SUM(CASE WHEN x.attempted > 0 THEN 1 ELSE 0 END) AS attempted,
      SUM(CASE WHEN x.hinted > 0 THEN 1 ELSE 0 END) AS hinted,
      SUM(CASE WHEN x.done > 0 THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN x.games > 1 THEN 1 ELSE 0 END) AS another,
      SUM(CASE WHEN x.days > 1 THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END) AS registered
    FROM players p JOIN (SELECT g.player_id, COUNT(*) AS games,
      SUM(CASE WHEN g.attempts > 0 THEN 1 ELSE 0 END) AS attempted, SUM(CASE WHEN g.hints_used > 0 THEN 1 ELSE 0 END) AS hinted,
      SUM(CASE WHEN g.status IN ('solved','revealed') THEN 1 ELSE 0 END) AS done,
      (SELECT COUNT(*) FROM player_days d WHERE d.player_id = g.player_id) AS days
      FROM games g GROUP BY g.player_id) x ON x.player_id = p.id WHERE ${w.join(' AND ')}`, args);
  const steps = [
    ['visit', visits.new_visitor], ['start', r.started || 0], ['attempt', r.attempted || 0], ['hint', r.hinted || 0],
    ['complete', r.done || 0], ['another', r.another || 0], ['return', r.returned || 0], ['register', r.registered || 0],
  ];
  return { period: p, filters: f, steps: steps.map(([key, n], i) => ({ key, n, of_previous: i && steps[i - 1][1] ? round1((n / steps[i - 1][1]) * 100) : null,
    of_start: i && steps[1][1] ? round1((n / steps[1][1]) * 100) : null })) };
}

// ── Retención por cohortes ──
// Unidad: identificador seudónimo de jugador («all») o cuenta registrada («registered»).
async function retention(db, q) {
  const segment = q.segment === 'registered' ? 'registered' : 'all';
  const weeks = Math.min(26, Math.max(4, Number(q.weeks) || 12));
  const unit = segment === 'registered' ? 'pl.user_id' : 'd.player_id';
  const join = segment === 'registered' ? 'JOIN players pl ON pl.id = d.player_id AND pl.user_id IS NOT NULL' : '';
  const sinceT = startOfDay(Date.now()) - weeks * 7 * DAY;
  const since = dayStr(sinceT);
  const rows = await db.all(`WITH act AS (SELECT DISTINCT ${unit} AS u, d.day FROM player_days d ${join}),
    first AS (SELECT u, MIN(day) AS d0 FROM act GROUP BY u)
    SELECT f.d0,
      EXISTS(SELECT 1 FROM act a WHERE a.u = f.u AND a.day = date(f.d0, '+1 day')) AS d1,
      EXISTS(SELECT 1 FROM act a WHERE a.u = f.u AND a.day > f.d0 AND a.day <= date(f.d0, '+7 day')) AS d7,
      EXISTS(SELECT 1 FROM act a WHERE a.u = f.u AND a.day > f.d0 AND a.day <= date(f.d0, '+30 day')) AS d30,
      EXISTS(SELECT 1 FROM act a WHERE a.u = f.u AND a.day > f.d0) AS ever
    FROM first f WHERE f.d0 >= ?`, [since]);
  const today = dayStr(Date.now());
  const cohorts = new Map();
  for (const r of rows) {
    const d = new Date(r.d0 + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
    const wk = dayStr(d.getTime() - dow * DAY);
    if (!cohorts.has(wk)) cohorts.set(wk, { week: wk, size: 0, d1: 0, d7: 0, d30: 0, d1_n: 0, d7_n: 0, d30_n: 0, ever: 0 });
    const c = cohorts.get(wk); c.size++; c.ever += r.ever ? 1 : 0;
    // Solo cuenta quien ya tuvo tiempo de volver (ventana cumplida).
    const age = (Date.parse(today) - Date.parse(r.d0)) / DAY;
    if (age >= 1) { c.d1_n++; c.d1 += r.d1 ? 1 : 0; }
    if (age >= 7) { c.d7_n++; c.d7 += r.d7 ? 1 : 0; }
    if (age >= 30) { c.d30_n++; c.d30 += r.d30 ? 1 : 0; }
  }
  const pct = (a, b) => (b ? round1((a / b) * 100) : null);
  const list = [...cohorts.values()].sort((a, b) => a.week.localeCompare(b.week)).map((c) => ({
    week: c.week, size: c.size, d1: pct(c.d1, c.d1_n), d7: pct(c.d7, c.d7_n), d30: pct(c.d30, c.d30_n), returned: pct(c.ever, c.size) }));
  const tot = (k) => { const a = [...cohorts.values()]; return pct(a.reduce((s, c) => s + c[k], 0), a.reduce((s, c) => s + c[k + '_n'], 0)); };
  const sessions = await sessionStats(db, parsePeriod(q), readFilters(q), segment);
  return { segment, weeks, cohorts: list, overall: { d1: tot('d1'), d7: tot('d7'), d30: tot('d30') }, sessions };
}

// Sesión = partidas del mismo jugador separadas por menos de 30 minutos.
async function sessionStats(db, p, f, segment) {
  const gw = gameWhere(p.from, p.to, f);
  const unit = segment === 'registered' ? 'pl.user_id' : 'g.player_id';
  const join = segment === 'registered' ? 'JOIN players pl ON pl.id = g.player_id AND pl.user_id IS NOT NULL' : '';
  const r = await db.get(`WITH s AS (SELECT ${unit} AS u, g.started_at,
      LAG(g.started_at) OVER (PARTITION BY ${unit} ORDER BY g.started_at) AS prev
      FROM games g JOIN clues c ON c.id = g.clue_id ${join} WHERE ${gw.sql})
    SELECT COUNT(DISTINCT u) AS units, COUNT(*) AS games,
      SUM(CASE WHEN prev IS NULL OR (julianday(started_at) - julianday(prev)) * 1440 > 30 THEN 1 ELSE 0 END) AS sessions,
      AVG(CASE WHEN prev IS NOT NULL AND (julianday(started_at) - julianday(prev)) * 1440 > 30 THEN (julianday(started_at) - julianday(prev)) * 24 END) AS gap_hours
    FROM s`, gw.args);
  const multi = await db.get(`SELECT COUNT(*) AS n FROM (SELECT ${unit} AS u FROM games g JOIN clues c ON c.id = g.clue_id ${join}
    WHERE ${gw.sql} GROUP BY u HAVING COUNT(*) > 1)`, gw.args);
  const units = r.units || 0;
  return { units, sessions: r.sessions || 0, games: r.games || 0,
    sessions_per_unit: units ? round1(r.sessions / units) : null, games_per_session: r.sessions ? round1(r.games / r.sessions) : null,
    avg_hours_between_sessions: r.gap_hours ? round1(r.gap_hours) : null, multi_game_pct: units ? round1((multi.n / units) * 100) : null };
}

// ── Rendimiento por críptico ──
const CLUE_SORTS = {
  abandon: 'abandon_rate DESC', solve: 'solve_rate ASC', time: 'avg_solve_ms DESC', hints: 'hints_avg DESC',
  flags: 'flag_score DESC', plays: 'plays DESC', reveals: 'reveal_rate DESC',
};

async function clueStats(db, q) {
  const p = q.period ? parsePeriod(q) : null; const f = readFilters(q);
  const minPlays = Math.max(0, Number(q.min_plays) || 0);
  const cfg = { minPlays: await getSetting(db, 'alerts.clue_min_plays'), minRate: await getSetting(db, 'alerts.clue_solve_rate_min'),
    reports: await getSetting(db, 'alerts.clue_wrong_answer_reports') };
  const gw = []; const gargs = [];
  if (p) { gw.push('g.started_at >= ? AND g.started_at < ?'); gargs.push(p.from, p.to); }
  if (f.country) { gw.push('g.country_code = ?'); gargs.push(f.country); }
  const cw = []; const cargs = [];
  if (f.lang) { cw.push('c.language_code = ?'); cargs.push(f.lang); }
  if (q.variant) { cw.push(q.variant === 'general' ? 'c.variant_code IS NULL' : 'c.variant_code = ?'); if (q.variant !== 'general') cargs.push(q.variant); }
  for (const k of ['mechanism', 'origin', 'status']) if (q[k] && /^[a-z_]{2,30}$/.test(q[k])) { cw.push(`c.${k} = ?`); cargs.push(q[k]); }
  if (q.difficulty && /^[1-5]$/.test(q.difficulty)) { cw.push('c.difficulty = ?'); cargs.push(Number(q.difficulty)); }
  if (q.q) { cw.push('(c.clue_text LIKE ? OR c.answer LIKE ? OR c.id = ?)'); cargs.push(`%${q.q}%`, `%${q.q}%`, q.q); }
  const per = Math.min(100, Math.max(10, Number(q.per) || 50)); const page = Math.max(1, Number(q.page) || 1);
  const sort = CLUE_SORTS[q.sort] || CLUE_SORTS.plays;
  const base = `SELECT c.id, c.slug, c.clue_text, c.answer, c.language_code, c.variant_code, c.difficulty, c.mechanism, c.origin, c.status,
      COALESCE(s.plays, 0) AS plays, COALESCE(s.solved, 0) AS solved, COALESCE(s.wrong, 0) AS wrong, COALESCE(s.abandoned, 0) AS abandoned,
      COALESCE(s.revealed, 0) AS revealed, s.avg_solve_ms, s.hints_avg,
      CASE WHEN s.plays > 0 THEN 100.0 * s.solved / s.plays END AS solve_rate,
      CASE WHEN s.closed > 0 THEN 100.0 * s.abandoned / s.closed END AS abandon_rate,
      CASE WHEN s.plays > 0 THEN 100.0 * s.revealed / s.plays END AS reveal_rate,
      (SELECT COUNT(*) FROM clue_reports r WHERE r.clue_id = c.id AND r.status = 'open') AS reports_open,
      (SELECT COUNT(*) FROM clue_reports r WHERE r.clue_id = c.id AND r.status = 'open' AND r.reason IN ('wrong_answer','bad_explanation')) AS answer_reports
    FROM clues c LEFT JOIN (SELECT g.clue_id, COUNT(*) AS plays, SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved,
      SUM(g.wrong_attempts) AS wrong, SUM(CASE WHEN g.status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
      SUM(CASE WHEN g.status = 'revealed' THEN 1 ELSE 0 END) AS revealed,
      SUM(CASE WHEN g.status NOT IN ('started','in_progress') THEN 1 ELSE 0 END) AS closed,
      AVG(CASE WHEN g.status = 'solved' THEN g.duration_ms END) AS avg_solve_ms, AVG(g.hints_used) AS hints_avg
      FROM games g ${gw.length ? 'WHERE ' + gw.join(' AND ') : ''} GROUP BY g.clue_id) s ON s.clue_id = c.id
    ${cw.length ? 'WHERE ' + cw.join(' AND ') : ''}`;
  // Puntaje para «posibles errores»: reportes de respuesta/explicación y resolución inusualmente baja con muestra suficiente.
  const wrapped = `SELECT *, (answer_reports * 10 + CASE WHEN plays >= ${Number(cfg.minPlays)} AND solve_rate < ${Number(cfg.minRate)} THEN 5 ELSE 0 END
      + CASE WHEN plays >= ${Number(cfg.minPlays)} THEN COALESCE(reveal_rate, 0) / 20 ELSE 0 END) AS flag_score FROM (${base}) WHERE plays >= ?`;
  const args = [...gargs, ...cargs, minPlays];
  const total = (await db.get(`SELECT COUNT(*) AS n FROM (${wrapped})`, args)).n;
  const items = await db.all(`${wrapped} ORDER BY ${sort} NULLS LAST, plays DESC LIMIT ? OFFSET ?`, [...args, per, (page - 1) * per]);
  for (const it of items) {
    for (const k of ['solve_rate', 'abandon_rate', 'reveal_rate', 'hints_avg']) if (it[k] !== null && it[k] !== undefined) it[k] = round1(it[k]);
    if (it.avg_solve_ms) it.avg_solve_ms = Math.round(it.avg_solve_ms);
    it.median_solve_ms = it.solved ? await clueMedian(db, it.id, gw, gargs) : null;
    it.review = (it.answer_reports >= cfg.reports) || (it.plays >= cfg.minPlays && it.solve_rate !== null && it.solve_rate < cfg.minRate);
  }
  return { total, page, per_page: per, items, thresholds: cfg };
}

async function clueMedian(db, clueId, gw, gargs) {
  const where = ["g.clue_id = ?", "g.status = 'solved'", ...gw].join(' AND ');
  const args = [clueId, ...gargs];
  const n = (await db.get(`SELECT COUNT(*) AS n FROM games g WHERE ${where}`, args)).n;
  if (!n) return null;
  const rows = await db.all(`SELECT g.duration_ms AS v FROM games g WHERE ${where} ORDER BY v LIMIT ? OFFSET ?`, [...args, n % 2 ? 1 : 2, Math.floor((n - 1) / 2)]);
  return Math.round(rows.reduce((s, r) => s + Number(r.v), 0) / rows.length);
}

// ── Catálogo ──
async function catalogStats(db) {
  const g = (sql) => db.all(sql);
  const [total, byLang, byVariant, byDiff, byMech, byOrigin, byStatus, dupes, failed, reports] = await Promise.all([
    db.get('SELECT COUNT(*) AS n FROM clues'),
    g('SELECT language_code AS k, COUNT(*) AS n FROM clues GROUP BY k ORDER BY n DESC'),
    g("SELECT COALESCE(variant_code, 'general') AS k, COUNT(*) AS n FROM clues GROUP BY k ORDER BY n DESC"),
    g('SELECT difficulty AS k, COUNT(*) AS n FROM clues GROUP BY k ORDER BY k'),
    g('SELECT mechanism AS k, COUNT(*) AS n FROM clues GROUP BY k ORDER BY n DESC'),
    g('SELECT origin AS k, COUNT(*) AS n FROM clues GROUP BY k ORDER BY n DESC'),
    g('SELECT status AS k, COUNT(*) AS n FROM clues GROUP BY k ORDER BY n DESC'),
    db.get('SELECT COUNT(*) AS n FROM duplicate_flags WHERE resolved = 0'),
    db.get("SELECT COUNT(*) AS n FROM clues WHERE validation_errors > 0 OR validation_status = 'failed'"),
    db.get("SELECT COUNT(*) AS n FROM clue_reports WHERE status = 'open'"),
  ]);
  return { total: total.n, by_language: byLang, by_variant: byVariant, by_difficulty: byDiff, by_mechanism: byMech, by_origin: byOrigin,
    by_status: byStatus, duplicates_open: dupes.n, validation_failed: failed.n, reports_open: reports.n };
}

async function importStats(db) {
  const sources = await db.all(`SELECT s.id, s.name, s.url, s.country_code, s.language_code, s.access_method, s.status, s.license_id, l.name AS license_name,
      s.republish_allowed, s.access_authorized, s.last_success_at, s.last_checked_at, s.next_run_at, s.consecutive_failures, s.last_error,
      SUM(CASE WHEN i.status IS NOT NULL THEN 1 ELSE 0 END) AS items, SUM(CASE WHEN i.status = 'auto_published' THEN 1 ELSE 0 END) AS auto_published,
      SUM(CASE WHEN i.status = 'published' THEN 1 ELSE 0 END) AS published_manual, SUM(CASE WHEN i.status = 'discarded' THEN 1 ELSE 0 END) AS discarded,
      SUM(CASE WHEN i.status = 'duplicate' THEN 1 ELSE 0 END) AS duplicates, SUM(CASE WHEN i.status = 'error' THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN i.status = 'review' THEN 1 ELSE 0 END) AS review
    FROM sources s LEFT JOIN licenses l ON l.id = s.license_id LEFT JOIN import_items i ON i.source_id = s.id GROUP BY s.id ORDER BY s.name`);
  const job = await db.get("SELECT * FROM jobs WHERE name = 'import_sources'");
  return { sources, job };
}

const METRIC_DEFS = {
  registered: 'Cuentas de jugador creadas hasta el fin del período, sin contar las eliminadas.',
  new_users: 'Cuentas de jugador creadas dentro del período.',
  dau: 'Identificadores de jugador distintos con al menos una partida en las últimas 24 h del período.',
  wau: 'Ídem, en los últimos 7 días del período.',
  mau: 'Ídem, en los últimos 30 días del período.',
  active_players: 'Identificadores de jugador distintos con al menos una partida iniciada en el período. Un identificador es un navegador: una persona en dos dispositivos cuenta dos veces si no inició sesión.',
  active_registered: 'Cuentas registradas distintas que jugaron en el período.',
  visits: 'Visitas contadas de forma agregada (sin identificadores). «Navegadores nuevos» es la primera visita registrada desde ese navegador.',
  started: 'Partidas iniciadas: se mostró un críptico.',
  completed: 'Partidas completadas: terminaron con la respuesta correcta o revelando la respuesta.',
  solved: 'Partidas resueltas correctamente (sin revelar).',
  solve_rate: 'Resueltas ÷ iniciadas.',
  abandon_rate: 'Abandonadas ÷ partidas cerradas (se excluyen las que siguen en curso). Abandonada = la persona pasó a otra (saltar) o no hubo actividad durante el plazo configurado.',
  median_solve: 'Mediana del tiempo transcurrido entre el inicio y la respuesta correcta.',
  median_active: 'Mediana del tiempo activo estimado de las partidas resueltas (pausas largas excluidas).',
  avg_solve: 'Promedio del tiempo transcurrido hasta resolver.',
  errors: 'Errores técnicos registrados por el servidor en el período.',
};

// ── Origen: de dónde llegan las visitas, los jugadores nuevos y las cuentas ──
async function origins(db, q) {
  const p = parsePeriod(q);
  const toDay = Date.parse(p.to) % DAY === 0 ? p.to.slice(0, 10) : dayStr(Date.parse(p.to) + DAY);
  const visits = await db.all(`SELECT source, medium, SUM(CASE WHEN kind = 'entry' THEN n ELSE 0 END) AS entries,
    SUM(CASE WHEN kind = 'new_visitor' THEN n ELSE 0 END) AS new_visitors FROM traffic_sources_daily
    WHERE day >= ? AND day < ? GROUP BY source, medium ORDER BY entries DESC LIMIT 100`, [p.from.slice(0, 10), toDay]);
  const campaigns = await db.all(`SELECT campaign, source, SUM(CASE WHEN kind = 'entry' THEN n ELSE 0 END) AS entries FROM traffic_sources_daily
    WHERE day >= ? AND day < ? AND campaign <> '' GROUP BY campaign, source ORDER BY entries DESC LIMIT 50`, [p.from.slice(0, 10), toDay]);
  const players = await db.all(`SELECT COALESCE(pl.origin_source, '') AS source, COALESCE(pl.origin_medium, '') AS medium, COUNT(*) AS players,
    SUM(CASE WHEN pl.user_id IS NOT NULL THEN 1 ELSE 0 END) AS with_account,
    SUM((SELECT COUNT(*) FROM games g WHERE g.player_id = pl.id)) AS games
    FROM players pl WHERE pl.created_at >= ? AND pl.created_at < ? GROUP BY source, medium ORDER BY players DESC LIMIT 100`, [p.from, p.to]);
  const accounts = await db.all(`SELECT COALESCE(origin_source, '') AS source, COALESCE(origin_medium, '') AS medium, COUNT(*) AS users
    FROM users WHERE role = 'player' AND deleted_at IS NULL AND created_at >= ? AND created_at < ? GROUP BY source, medium ORDER BY users DESC LIMIT 100`, [p.from, p.to]);
  const recent = await db.all(`SELECT id, username, created_at, origin_source, origin_medium, origin_campaign, origin_referrer, origin_landing
    FROM users WHERE role = 'player' AND deleted_at IS NULL AND created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 50`, [p.from, p.to]);
  return { period: p, visits, campaigns, players, accounts, recent, storing: await require('./settings').getSetting(db, 'privacy.store_origin') };
}

module.exports = { origins, parsePeriod, readFilters, refresh, rollupDays, overview, geo, funnel, retention, clueStats, catalogStats, importStats,
  periodBlock, gameTotals, METRIC_DEFS, PERIODS, CLUE_SORTS, dayStr };
