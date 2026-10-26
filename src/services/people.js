'use strict';

// Usuarios registrados, partidas y datos personales para el panel.
// Nunca se devuelven contraseñas, tokens de sesión ni hashes. El correo solo se
// incluye cuando quien consulta tiene el permiso «players.pii».

const { playerStats } = require('./game');
const { HttpError, now, uuid, parseJson } = require('./util');

const round1 = (x) => Math.round(x * 10) / 10;
const statusOf = (u) => (u.deleted_at ? 'deleted' : u.disabled ? 'suspended' : 'active');

// Agregados de partidas por cuenta (a través de sus identificadores de jugador).
const USER_GAMES = `SELECT p.user_id, COUNT(g.id) AS games, SUM(CASE WHEN g.status IN ('solved','revealed') THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved, SUM(CASE WHEN g.status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
    SUM(CASE WHEN g.status = 'revealed' THEN 1 ELSE 0 END) AS revealed, SUM(g.wrong_attempts) AS wrong, SUM(g.hints_used) AS hints,
    SUM(g.active_ms) AS active_ms, AVG(CASE WHEN g.status = 'solved' THEN g.duration_ms END) AS avg_solve_ms, MAX(g.started_at) AS last_game_at
  FROM players p JOIN games g ON g.player_id = p.id WHERE p.user_id IS NOT NULL GROUP BY p.user_id`;

const USER_SORTS = { created: 'u.created_at DESC', active: 'u.last_active_at DESC NULLS LAST', games: 'games DESC', solve_rate: 'solve_rate DESC NULLS LAST',
  name: 'u.username COLLATE NOCASE ASC', last_game: 'x.last_game_at DESC NULLS LAST' };

function publicRow(u, pii) {
  const o = { id: u.id, username: u.username, display_name: u.display_name, status: statusOf(u), role: u.role,
    email_verified: !!u.email_verified_at, has_email: !!u.email, created_at: u.created_at, last_login_at: u.last_login_at,
    last_active_at: u.last_active_at, ui_language: u.ui_language, country_code: u.country_code, play_variant: u.play_variant, timezone: u.timezone,
    origin_source: u.origin_source || null, origin_medium: u.origin_medium || null, origin_campaign: u.origin_campaign || null,
    origin_referrer: u.origin_referrer || null, origin_landing: u.origin_landing || null };
  if (pii) o.email = u.email || null;
  return o;
}

async function listUsers(db, q, { pii }) {
  const w = ["u.role = 'player'"]; const args = [];
  const st = q.status;
  if (st === 'active') w.push('u.deleted_at IS NULL AND u.disabled = 0');
  else if (st === 'suspended') w.push('u.deleted_at IS NULL AND u.disabled = 1');
  else if (st === 'deleted') w.push('u.deleted_at IS NOT NULL');
  if (q.q) {
    const term = String(q.q).trim().slice(0, 80);
    const parts = ['u.id = ?', 'u.username LIKE ?', 'u.display_name LIKE ?']; args.push(term, `%${term}%`, `%${term}%`);
    if (pii) { parts.push('u.email LIKE ?'); args.push(`%${term}%`); }
    w.push(`(${parts.join(' OR ')})`);
  }
  if (/^[A-Z]{2}$/.test(q.country || '')) { w.push('u.country_code = ?'); args.push(q.country); }
  if (/^[a-z]{2}$/.test(q.lang || '')) { w.push('(u.play_variant = ? OR u.play_variant LIKE ? OR u.ui_language = ?)'); args.push(q.lang, q.lang + '-%', q.lang); }
  if (/^[a-z]{2}-[A-Z]{2}$/.test(q.variant || '')) { w.push('u.play_variant = ?'); args.push(q.variant); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { w.push('u.created_at >= ?'); args.push(q.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { w.push('u.created_at < ?'); args.push(q.to + 'T99'); }
  if (q.verified === '1') w.push('u.email_verified_at IS NOT NULL');
  const per = Math.min(100, Math.max(10, Number(q.per) || 25)); const page = Math.max(1, Number(q.page) || 1);
  const sort = USER_SORTS[q.sort] || USER_SORTS.created;
  const from = `FROM users u LEFT JOIN (${USER_GAMES}) x ON x.user_id = u.id WHERE ${w.join(' AND ')}`;
  const total = (await db.get(`SELECT COUNT(*) AS n ${from}`, args)).n;
  const rows = await db.all(`SELECT u.*, COALESCE(x.games, 0) AS games, COALESCE(x.completed, 0) AS completed, COALESCE(x.solved, 0) AS solved,
    COALESCE(x.abandoned, 0) AS abandoned, COALESCE(x.revealed, 0) AS revealed, COALESCE(x.wrong, 0) AS wrong, COALESCE(x.hints, 0) AS hints,
    COALESCE(x.active_ms, 0) AS active_ms, x.avg_solve_ms, x.last_game_at,
    CASE WHEN x.games > 0 THEN 100.0 * x.solved / x.games END AS solve_rate ${from} ORDER BY ${sort} LIMIT ? OFFSET ?`, [...args, per, (page - 1) * per]);
  return { total, page, per_page: per, items: rows.map((u) => ({ ...publicRow(u, pii), games: u.games, completed: u.completed, solved: u.solved,
    abandoned: u.abandoned, revealed: u.revealed, wrong: u.wrong, hints: u.hints, active_ms: u.active_ms,
    avg_solve_ms: u.avg_solve_ms ? Math.round(u.avg_solve_ms) : null, solve_rate: u.solve_rate === null ? null : round1(u.solve_rate), last_game_at: u.last_game_at })) };
}

async function getUserOr404(db, id) {
  const u = await db.get("SELECT * FROM users WHERE id = ? AND role = 'player'", [id]);
  if (!u) throw new HttpError(404, 'not_found');
  return u;
}

async function playerIdsOf(db, userId) {
  return (await db.all('SELECT id FROM players WHERE user_id = ?', [userId])).map((r) => r.id);
}

async function userDetail(db, id, { pii }) {
  const u = await getUserOr404(db, id);
  const ids = await playerIdsOf(db, id);
  const ph = ids.map(() => '?').join(',') || "''";
  const agg = ids.length ? await db.get(`SELECT COUNT(*) AS games, SUM(CASE WHEN status IN ('solved','revealed') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) AS solved, SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
      SUM(CASE WHEN status = 'revealed' THEN 1 ELSE 0 END) AS revealed, SUM(CASE WHEN status IN ('started','in_progress') THEN 1 ELSE 0 END) AS in_progress,
      SUM(wrong_attempts) AS wrong, SUM(hints_used) AS hints, SUM(active_ms) AS active_ms, SUM(duration_ms) AS elapsed_ms,
      AVG(CASE WHEN status = 'solved' THEN duration_ms END) AS avg_solve_ms, MAX(started_at) AS last_game_at
    FROM games WHERE player_id IN (${ph})`, ids) : {};
  let median = null;
  if (agg.solved) {
    const n = agg.solved;
    const rows = await db.all(`SELECT duration_ms AS v FROM games WHERE player_id IN (${ph}) AND status = 'solved' ORDER BY v LIMIT ? OFFSET ?`,
      [...ids, n % 2 ? 1 : 2, Math.floor((n - 1) / 2)]);
    median = Math.round(rows.reduce((s, r) => s + r.v, 0) / rows.length);
  }
  const prefs = ids.length ? {
    languages: await db.all(`SELECT c.language_code AS k, COUNT(*) AS n FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${ph}) GROUP BY k ORDER BY n DESC`, ids),
    difficulties: await db.all(`SELECT c.difficulty AS k, COUNT(*) AS n FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${ph}) GROUP BY k ORDER BY n DESC`, ids),
    categories: await db.all(`SELECT COALESCE(c.category, '') AS k, COUNT(*) AS n FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${ph}) GROUP BY k ORDER BY n DESC LIMIT 8`, ids),
    modes: await db.all(`SELECT mode AS k, COUNT(*) AS n FROM games WHERE player_id IN (${ph}) GROUP BY k ORDER BY n DESC`, ids),
    countries: await db.all(`SELECT COALESCE(country_code, '') AS k, COUNT(*) AS n FROM games WHERE player_id IN (${ph}) GROUP BY k ORDER BY n DESC`, ids),
  } : { languages: [], difficulties: [], categories: [], modes: [], countries: [] };
  const streaks = await playerStats(db, { playerIds: ids });
  const games = Number(agg.games || 0);
  return {
    user: publicRow(u, pii), pseudonymous_ids: ids.length,
    stats: { games, completed: agg.completed || 0, solved: agg.solved || 0, abandoned: agg.abandoned || 0, revealed: agg.revealed || 0,
      in_progress: agg.in_progress || 0, wrong: agg.wrong || 0, hints: agg.hints || 0, active_ms: agg.active_ms || 0, elapsed_ms: agg.elapsed_ms || 0,
      solve_rate: games ? round1((agg.solved / games) * 100) : null, avg_solve_ms: agg.avg_solve_ms ? Math.round(agg.avg_solve_ms) : null,
      median_solve_ms: median, last_game_at: agg.last_game_at || null, current_streak: streaks.current_streak, best_streak: streaks.best_streak },
    preferences: prefs,
  };
}

const GAME_STATUSES = ['started', 'in_progress', 'solved', 'revealed', 'abandoned', 'expired', 'error'];

function gameFilters(q) {
  const w = []; const args = [];
  if (q.id) { w.push('g.id = ?'); args.push(String(q.id)); }
  if (q.player) { w.push('g.player_id = ?'); args.push(String(q.player)); }
  if (q.clue) { w.push('(g.clue_id = ? OR c.slug = ?)'); args.push(String(q.clue), String(q.clue)); }
  if (GAME_STATUSES.includes(q.status)) { w.push('g.status = ?'); args.push(q.status); }
  if (/^[a-z_]{3,20}$/.test(q.mode || '')) { w.push('g.mode = ?'); args.push(q.mode); }
  if (/^[a-z]{2}$/.test(q.lang || '')) { w.push('c.language_code = ?'); args.push(q.lang); }
  if (/^[a-z]{2}-[A-Z]{2}$/.test(q.variant || '')) { w.push('g.play_variant = ?'); args.push(q.variant); }
  if (/^[A-Z]{2}$/.test(q.country || '')) { w.push('g.country_code = ?'); args.push(q.country); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { w.push('g.started_at >= ?'); args.push(q.from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { w.push('g.started_at < ?'); args.push(q.to + 'T99'); }
  if (q.registered === '1') w.push('p.user_id IS NOT NULL');
  if (q.registered === '0') w.push('p.user_id IS NULL');
  return { w, args };
}

const GAME_COLS = `g.id, g.player_id, g.clue_id, g.mode, g.play_variant, g.country_code, g.daily_date, g.started_at, g.last_activity_at, g.finished_at,
  g.status, g.end_reason, g.result, g.attempts, g.wrong_attempts, g.hints_used, g.duration_ms, g.active_ms, g.error_count,
  c.slug, c.clue_text, c.language_code, c.difficulty, c.mechanism`;

async function listGames(db, q, { userId, showUser } = {}) {
  const { w, args } = gameFilters(q);
  if (userId) { w.push('p.user_id = ?'); args.push(userId); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const per = Math.min(100, Math.max(10, Number(q.per) || 50)); const page = Math.max(1, Number(q.page) || 1);
  const from = `FROM games g JOIN clues c ON c.id = g.clue_id JOIN players p ON p.id = g.player_id ${showUser ? 'LEFT JOIN users u ON u.id = p.user_id' : ''} ${where}`;
  const total = (await db.get(`SELECT COUNT(*) AS n ${from}`, args)).n;
  const items = await db.all(`SELECT ${GAME_COLS}, p.user_id IS NOT NULL AS registered ${showUser ? ', u.username, p.user_id' : ''} ${from}
    ORDER BY g.started_at DESC LIMIT ? OFFSET ?`, [...args, per, (page - 1) * per]);
  return { total, page, per_page: per, items: items.map((g) => ({ ...g, elapsed_ms: elapsed(g) })) };
}

// Tiempo transcurrido: hasta el cierre o, si sigue abierta, hasta la última actividad.
function elapsed(g) {
  const end = Date.parse(g.finished_at || g.last_activity_at || g.started_at);
  return Math.max(0, end - Date.parse(g.started_at));
}

async function gameDetail(db, id, { showUser }) {
  const g = await db.get(`SELECT ${GAME_COLS}, c.answer, c.variant_code, c.origin, p.user_id ${showUser ? ', u.username' : ''}
    FROM games g JOIN clues c ON c.id = g.clue_id JOIN players p ON p.id = g.player_id ${showUser ? 'LEFT JOIN users u ON u.id = p.user_id' : ''} WHERE g.id = ?`, [id]);
  if (!g) throw new HttpError(404, 'not_found');
  if (!showUser) delete g.user_id;
  const events = await db.all('SELECT id, kind, data, created_at FROM game_events WHERE game_id = ? ORDER BY id', [id]);
  return { game: { ...g, elapsed_ms: elapsed(g) }, events: events.map((e) => ({ ...e, data: parseJson(e.data, null) })) };
}

// Evolución semanal de una cuenta.
async function userPerformance(db, id) {
  await getUserOr404(db, id);
  const ids = await playerIdsOf(db, id);
  if (!ids.length) return { weeks: [] };
  const ph = ids.map(() => '?').join(',');
  const rows = await db.all(`SELECT date(g.started_at, 'weekday 1', '-7 days') AS week, COUNT(*) AS games,
      SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved, SUM(CASE WHEN g.status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
      SUM(CASE WHEN g.status = 'revealed' THEN 1 ELSE 0 END) AS revealed, SUM(g.hints_used) AS hints,
      AVG(CASE WHEN g.status = 'solved' THEN g.duration_ms END) AS avg_solve_ms, AVG(c.difficulty) AS avg_difficulty
    FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${ph}) GROUP BY week ORDER BY week DESC LIMIT 26`, ids);
  return { weeks: rows.reverse().map((r) => ({ ...r, solve_rate: r.games ? round1((r.solved / r.games) * 100) : null,
    avg_solve_ms: r.avg_solve_ms ? Math.round(r.avg_solve_ms) : null, avg_difficulty: r.avg_difficulty ? round1(r.avg_difficulty) : null })) };
}

async function userContributions(db, id) {
  await getUserOr404(db, id);
  const subs = await db.all(`SELECT id, clue_text, answer, language_code, variant_code, status, moderator_note, created_at, updated_at, clue_id
    FROM submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`, [id]);
  const ev = subs.length ? await db.all(`SELECT e.submission_id, e.from_status, e.to_status, e.note, e.created_at, u.username AS actor
    FROM submission_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.submission_id IN (${subs.map(() => '?').join(',')}) ORDER BY e.id`, subs.map((s) => s.id)) : [];
  return { items: subs.map((s) => ({ ...s, events: ev.filter((e) => e.submission_id === s.id) })) };
}

// Cronología de hechos relevantes (no registra cada movimiento en pantalla).
async function userTimeline(db, id) {
  const u = await getUserOr404(db, id);
  const ids = await playerIdsOf(db, id);
  const items = [{ at: u.created_at, kind: 'account_created' }];
  if (u.last_login_at) items.push({ at: u.last_login_at, kind: 'last_login' });
  if (ids.length) {
    const games = await db.all(`SELECT g.id, g.started_at, g.status, c.clue_text FROM games g JOIN clues c ON c.id = g.clue_id
      WHERE g.player_id IN (${ids.map(() => '?').join(',')}) ORDER BY g.started_at DESC LIMIT 40`, ids);
    for (const g of games) items.push({ at: g.started_at, kind: 'game', status: g.status, game_id: g.id, clue: g.clue_text });
  }
  for (const s of await db.all('SELECT e.to_status, e.created_at, s.clue_text FROM submission_events e JOIN submissions s ON s.id = e.submission_id WHERE s.user_id = ? ORDER BY e.id DESC LIMIT 40', [id])) {
    items.push({ at: s.created_at, kind: 'submission', status: s.to_status, clue: s.clue_text });
  }
  for (const a of await db.all("SELECT a.action, a.created_at, x.username AS actor FROM audit_log a LEFT JOIN users x ON x.id = a.actor_id WHERE a.target_kind = 'user' AND a.target_id = ? ORDER BY a.id DESC LIMIT 40", [id])) {
    items.push({ at: a.created_at, kind: 'admin_action', action: a.action, actor: a.actor });
  }
  for (const r of await db.all('SELECT kind, status, created_at FROM data_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [id])) {
    items.push({ at: r.created_at, kind: 'data_request', request: r.kind, status: r.status });
  }
  return { items: items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 120) };
}

async function adminHistory(db, id) {
  return { items: await db.all(`SELECT a.id, a.action, a.details, a.created_at, x.username AS actor FROM audit_log a LEFT JOIN users x ON x.id = a.actor_id
    WHERE a.target_kind = 'user' AND a.target_id = ? ORDER BY a.id DESC LIMIT 100`, [id]) };
}

async function setSuspended(db, id, suspended) {
  const u = await getUserOr404(db, id);
  if (u.deleted_at) throw new HttpError(409, 'deleted', 'La cuenta ya fue eliminada.');
  await db.run('UPDATE users SET disabled = ? WHERE id = ?', [suspended ? 1 : 0, id]);
  if (suspended) await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
  return { ok: true, status: suspended ? 'suspended' : 'active' };
}

// Eliminación de datos personales: la cuenta se anonimiza. Las partidas quedan
// asociadas solo a identificadores seudónimos, para que las estadísticas agregadas sigan.
async function anonymizeUser(db, id) {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!u) throw new HttpError(404, 'not_found');
  if (u.role !== 'player') throw new HttpError(400, 'staff_account', 'Las cuentas del equipo se desactivan desde «Equipo».');
  if (u.deleted_at) return { ok: true, already: true };
  const playerIds = (await db.all('SELECT id FROM players WHERE user_id = ?', [id])).map((r) => r.id);
  await db.tx(async (t) => {
    // Perfil: logros, objetivos, biblioteca, colecciones y enlaces compartidos.
    await require('./profile').forgetProfile(t, id, playerIds);
    // Duelos, torneos y amigos.
    await require('./arena').forgetUser(t, id);
    const subs = await t.all('SELECT id FROM submissions WHERE user_id = ?', [id]);
    for (const s of subs) await t.run('UPDATE clues SET author_name = NULL WHERE submission_id = ?', [s.id]);
    await t.run('UPDATE submissions SET user_id = NULL, public_name = NULL WHERE user_id = ?', [id]);
    await t.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    await t.run('DELETE FROM favorites WHERE user_id = ?', [id]);
    await t.run('DELETE FROM notifications WHERE user_id = ?', [id]);
    await t.run('UPDATE players SET user_id = NULL, retired_at = ? WHERE user_id = ?', [now(), id]);
    await t.run(`UPDATE users SET username = ?, email = NULL, email_verified_at = NULL, display_name = NULL, password_hash = '!', disabled = 1,
      country_code = NULL, play_variant = NULL, ui_language = NULL, timezone = NULL, failed_logins = 0, locked_until = NULL, deleted_at = ?,
      public_profile = 0, public_name = NULL, avatar = NULL, profile_share = '{}', profile_prefs = '{}', leaderboard_opt_in = 0 WHERE id = ?`,
    ['eliminado-' + id.slice(0, 8), now(), id]);
  });
  return { ok: true };
}

// Copia de los datos de una persona (derecho de acceso). Sin secretos.
async function exportOwnData(db, userId, playerIds) {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  const ids = [...new Set([...(await playerIdsOf(db, userId)), ...playerIds])];
  const ph = ids.map(() => '?').join(',') || "''";
  return {
    generated_at: now(),
    account: u ? { username: u.username, display_name: u.display_name, email: u.email, email_verified: !!u.email_verified_at, created_at: u.created_at,
      last_login_at: u.last_login_at, country_code: u.country_code, play_variant: u.play_variant, ui_language: u.ui_language, timezone: u.timezone } : null,
    games: await db.all(`SELECT g.id, g.started_at, g.finished_at, g.status, g.mode, g.attempts, g.hints_used, g.duration_ms, g.active_ms, g.country_code,
      g.play_variant, c.clue_text FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.player_id IN (${ph}) ORDER BY g.started_at`, ids),
    submissions: await db.all('SELECT id, clue_text, answer, explanation, status, created_at FROM submissions WHERE user_id = ?', [userId]),
    favorites: await db.all('SELECT clue_id, created_at FROM favorites WHERE user_id = ?', [userId]),
    data_requests: await db.all('SELECT kind, status, created_at, resolved_at FROM data_requests WHERE user_id = ?', [userId]),
    game_events: await db.all(`SELECT e.game_id, e.kind, e.data, e.created_at FROM game_events e JOIN games g ON g.id = e.game_id WHERE g.player_id IN (${ph}) ORDER BY e.id`, ids),
    profile: u ? { public_profile: !!u.public_profile, public_name: u.public_name, avatar: u.avatar, share: parseJson(u.profile_share, {}),
      prefs: parseJson(u.profile_prefs, {}), leaderboard_opt_in: !!u.leaderboard_opt_in } : null,
    achievements: await db.all('SELECT code, earned_at FROM achievements_earned WHERE owner = ?', ['u:' + userId]),
    goals: await db.all('SELECT kind, target, period, param, created_at FROM user_goals WHERE user_id = ?', [userId]),
    retry_list: await db.all('SELECT clue_id, created_at FROM retry_list WHERE user_id = ?', [userId]),
    collections: await db.all(`SELECT k.name, i.clue_id, i.added_at FROM collections k LEFT JOIN collection_items i ON i.collection_id = k.id WHERE k.user_id = ?`, [userId]),
  };
}

async function createDataRequest(db, userId, { kind, message }) {
  if (!['access', 'rectification', 'deletion'].includes(kind)) throw new HttpError(400, 'invalid_kind');
  const open = await db.get("SELECT id FROM data_requests WHERE user_id = ? AND kind = ? AND status IN ('open','in_progress')", [userId, kind]);
  if (open) return { id: open.id, existing: true };
  const id = uuid();
  await db.run('INSERT INTO data_requests(id, user_id, kind, message) VALUES (?,?,?,?)', [id, userId, kind, message ? String(message).slice(0, 2000) : null]);
  return { id };
}

module.exports = { listUsers, userDetail, listGames, gameDetail, userPerformance, userContributions, userTimeline, adminHistory, setSuspended,
  anonymizeUser, exportOwnData, createDataRequest, GAME_STATUSES, statusOf };
