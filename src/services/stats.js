'use strict';

// Métricas del panel. Todas salen de consultas agregadas: no se guarda
// información personal adicional para calcularlas.

async function dashboard(db) {
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const one = async (sql, args = []) => (await db.get(sql, args)) || {};
  const users = await one("SELECT COUNT(*) AS n FROM users WHERE role = 'player'");
  const games = await one(`SELECT COUNT(*) AS started, SUM(CASE WHEN finished_at IS NOT NULL THEN 1 ELSE 0 END) AS finished,
    SUM(CASE WHEN result = 'solved' THEN 1 ELSE 0 END) AS solved FROM games`);
  const games7 = await one("SELECT COUNT(*) AS n FROM games WHERE started_at >= ?", [d7]);
  const languages = await db.all(`SELECT c.language_code AS lang, COUNT(*) AS games FROM games g JOIN clues c ON c.id = g.clue_id
    GROUP BY c.language_code ORDER BY games DESC`);
  const variants = await db.all("SELECT COALESCE(play_variant, '—') AS variant, COUNT(*) AS games FROM games GROUP BY play_variant ORDER BY games DESC LIMIT 10");
  const countries = await db.all("SELECT COALESCE(country_code, '—') AS country, COUNT(*) AS games FROM games GROUP BY country_code ORDER BY games DESC LIMIT 10");
  const clues = await db.all(`SELECT language_code AS lang, status, COUNT(*) AS n FROM clues GROUP BY language_code, status`);
  const newClues = await one('SELECT COUNT(*) AS n FROM clues WHERE created_at >= ?', [d7]);
  const byOrigin = await db.all("SELECT origin, COUNT(*) AS n FROM clues WHERE status = 'published' GROUP BY origin");
  const pending = await one("SELECT COUNT(*) AS n FROM submissions WHERE status IN ('pending','in_review')");
  const importReview = await one("SELECT COUNT(*) AS n FROM import_items WHERE status = 'review'");
  const sourceErrors = await one("SELECT COUNT(*) AS n FROM sources WHERE status = 'error' OR consecutive_failures > 0");
  const duplicates = await one('SELECT COUNT(*) AS n FROM duplicate_flags WHERE resolved = 0');
  const reports = await one("SELECT COUNT(*) AS n FROM clue_reports WHERE status = 'open'");
  const errors = await one('SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ?', [d7]);
  const lastErrors = await db.all('SELECT scope, message, created_at FROM error_log ORDER BY id DESC LIMIT 10');
  // Retención: jugadores activos en 30 días que jugaron en al menos dos días distintos.
  const active = await one('SELECT COUNT(DISTINCT player_id) AS n FROM games WHERE started_at >= ?', [d30]);
  const returning = await one(`SELECT COUNT(*) AS n FROM (SELECT player_id FROM games WHERE started_at >= ?
    GROUP BY player_id HAVING COUNT(DISTINCT substr(started_at, 1, 10)) >= 2)`, [d30]);
  const daily = await db.all(`SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS games, COUNT(DISTINCT player_id) AS players
    FROM games WHERE started_at >= ? GROUP BY day ORDER BY day`, [d30]);
  const jobs = await db.all('SELECT name, last_status, last_error, last_run_at, next_run_at, consecutive_failures FROM jobs ORDER BY name');
  return {
    users: users.n || 0,
    games: { started: games.started || 0, finished: games.finished || 0, solved: games.solved || 0, last7: games7.n || 0,
      solve_rate: games.started ? Math.round(((games.solved || 0) / games.started) * 100) : 0 },
    languages, variants, countries, clues, new_clues_7d: newClues.n || 0, published_by_origin: byOrigin,
    pending_submissions: pending.n || 0, import_review: importReview.n || 0, sources_with_errors: sourceErrors.n || 0,
    duplicates_open: duplicates.n || 0, reports_open: reports.n || 0, errors_7d: errors.n || 0, last_errors: lastErrors,
    retention: { active_30d: active.n || 0, returning_30d: returning.n || 0,
      rate: active.n ? Math.round(((returning.n || 0) / active.n) * 100) : 0 },
    activity: daily, jobs,
  };
}

module.exports = { dashboard };
