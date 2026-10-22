'use strict';

// Tareas programadas. En Vercel las dispara Vercel Cron llamando a
// /api/cron/tick; en un servidor propio, un temporizador interno.
// Cada tarea toma un "lease" en la base para que dos ejecuciones simultáneas
// no hagan el mismo trabajo, y las ejecuciones colgadas se recuperan.

const { runSource } = require('./importer');
const { ensureDaily, today } = require('./game');
const { buildClue, insertClue } = require('./clues');
const { findDuplicates } = require('./dedupe');
const { getSetting } = require('./settings');
const { cleanupRateLimits } = require('./ratelimit');
const { logError } = require('./audit');
const { generate } = require('../lib/generator');
const { now } = require('./util');
const analytics = require('./analytics');
const alerts = require('./alerts');

const LEASE_MINUTES = 10;

const HANDLERS = {
  async import_sources(db, ctx) {
    const due = await db.all(`SELECT id FROM sources WHERE status IN ('active','error') AND admin_approved_by IS NOT NULL
      AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY next_run_at LIMIT 5`, [now()]);
    const results = [];
    for (const s of due) results.push(await runSource(db, s.id, ctx.fetchOptions || {}));
    return { sources: results.length, results };
  },
  async daily_challenge(db) {
    const langs = await db.all('SELECT code FROM languages WHERE enabled = 1');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const made = [];
    for (const { code } of langs) {
      for (const d of [today(), tomorrow]) if (await ensureDaily(db, code, d)) made.push(`${code}:${d}`);
    }
    return { ensured: made };
  },
  async generate_clues(db) {
    const autopublish = await getSetting(db, 'publishing.generated_autopublish');
    const langs = await db.all('SELECT code FROM languages WHERE enabled = 1');
    const seed = Math.floor(Date.now() / 86400000);
    let created = 0;
    for (const { code } of langs) {
      for (const c of generate(code, { seed, limit: 40 })) {
        const { row } = await buildClue(db, { ...c, clue_text: c.clue, language_code: code });
        if (row.validation_errors) continue;
        const dup = await findDuplicates(db, row, 0.6);
        if (dup.matches.length) continue;
        await insertClue(db, { ...row, origin: 'generated', status: autopublish ? 'published' : 'review', author_name: null }, { actorKind: 'generator' });
        created++;
        if (created >= 20) return { created };
      }
    }
    return { created };
  },
  async cleanup(db) {
    const gamesDays = await getSetting(db, 'retention.games_days');
    const auditDays = await getSetting(db, 'retention.audit_days');
    const cut = (d) => new Date(Date.now() - d * 86400000).toISOString();
    await db.run('DELETE FROM sessions WHERE expires_at < ?', [now()]);
    await db.run('DELETE FROM games WHERE started_at < ?', [cut(gamesDays)]);
    // La auditoría no se borra (es inalterable): al vencer el plazo solo se quita el hash de IP.
    await db.run('UPDATE audit_log SET ip_hash = NULL WHERE created_at < ? AND ip_hash IS NOT NULL', [cut(auditDays)]);
    await db.run('DELETE FROM error_log WHERE created_at < ?', [cut(90)]);
    await db.run('DELETE FROM job_runs WHERE started_at < ?', [cut(30)]);
    await db.run('DELETE FROM players WHERE user_id IS NULL AND last_seen_at < ? AND id NOT IN (SELECT player_id FROM games)', [cut(gamesDays)]);
    await db.run('DELETE FROM game_events WHERE created_at < ?', [cut(await getSetting(db, 'retention.game_events_days'))]);
    await db.run('DELETE FROM traffic_daily WHERE day < ?', [cut(await getSetting(db, 'retention.traffic_days')).slice(0, 10)]);
    await db.run('DELETE FROM player_days WHERE day < ?', [cut(gamesDays).slice(0, 10)]);
    await db.run("DELETE FROM alerts WHERE status = 'resolved' AND resolved_at < ?", [cut(180)]);
    // Las sesiones guardan un hash de IP solo para seguridad; tras 30 días se borra.
    await db.run('UPDATE sessions SET ip_hash = NULL WHERE created_at < ?', [cut(30)]);
    await cleanupRateLimits(db);
    return { ok: true };
  },
  async analytics_rollup(db) {
    return analytics.refresh(db, { force: true });
  },
  async social_schedule(db) {
    return require('./social').scheduleApproved(db);
  },
  async alerts_scan(db) {
    return alerts.scan(db);
  },
  async recover_stuck(db) {
    // Ejecuciones que quedaron "running" por una caída del proceso.
    const stale = new Date(Date.now() - LEASE_MINUTES * 60000).toISOString();
    const r1 = await db.run("UPDATE job_runs SET status = 'abandoned', finished_at = ? WHERE status = 'running' AND started_at < ?", [now(), stale]);
    const r2 = await db.run("UPDATE import_runs SET status = 'failed', finished_at = ?, error = 'interrumpida' WHERE status = 'running' AND started_at < ?", [now(), stale]);
    await db.run('UPDATE jobs SET lease_until = NULL WHERE lease_until < ?', [now()]);
    return { abandoned_jobs: r1.changes, abandoned_imports: r2.changes };
  },
};

async function acquire(db, name) {
  const lease = new Date(Date.now() + LEASE_MINUTES * 60000).toISOString();
  const r = await db.run(`UPDATE jobs SET lease_until = ? WHERE name = ? AND enabled = 1
    AND (lease_until IS NULL OR lease_until < ?)`, [lease, name, now()]);
  return r.changes === 1;
}

async function runJob(db, name, ctx = {}) {
  if (!HANDLERS[name]) throw new Error('unknown_job');
  if (!(await acquire(db, name))) return { name, skipped: 'locked' };
  const started = now();
  const run = await db.run("INSERT INTO job_runs(job_name, started_at, status) VALUES (?,?,'running')", [name, started]);
  const job = await db.get('SELECT * FROM jobs WHERE name = ?', [name]);
  try {
    const output = await HANDLERS[name](db, ctx);
    await db.run("UPDATE job_runs SET status = 'success', finished_at = ?, output = ? WHERE id = ?", [now(), JSON.stringify(output).slice(0, 4000), run.lastInsertRowid]);
    await db.run(`UPDATE jobs SET lease_until = NULL, last_status = 'success', last_error = NULL, last_run_at = ?, consecutive_failures = 0,
      next_run_at = ? WHERE name = ?`, [started, new Date(Date.now() + job.interval_minutes * 60000).toISOString(), name]);
    return { name, status: 'success', output };
  } catch (e) {
    const failures = job.consecutive_failures + 1;
    // Reintento con espera creciente, sin superar el intervalo normal.
    const retryMin = Math.min(job.interval_minutes, 2 ** failures);
    await db.run("UPDATE job_runs SET status = 'failed', finished_at = ?, output = ? WHERE id = ?", [now(), String(e.message).slice(0, 1000), run.lastInsertRowid]);
    await db.run(`UPDATE jobs SET lease_until = NULL, last_status = 'failed', last_error = ?, last_run_at = ?, consecutive_failures = ?,
      next_run_at = ? WHERE name = ?`, [String(e.message).slice(0, 500), started, failures, new Date(Date.now() + retryMin * 60000).toISOString(), name]);
    await logError(db, 'job:' + name, e);
    return { name, status: 'failed', error: e.message };
  }
}

// Ejecuta las tareas vencidas. Lo llama el cron o el temporizador interno.
async function tick(db, ctx = {}) {
  const due = await db.all('SELECT name FROM jobs WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at', [now()]);
  const out = [];
  for (const { name } of due) out.push(await runJob(db, name, ctx));
  return out;
}

module.exports = { tick, runJob, HANDLERS };
