'use strict';

// Centro de alertas. Cada regla tiene un umbral configurable (alerts.*) y una muestra
// mínima: una variación normal de actividad no genera alertas.
// Una alerta se identifica por dedupe_key; si la condición persiste, se actualiza
// (last_seen_at, occurrences) en lugar de duplicarse.

const { getSetting } = require('./settings');
const { now } = require('./util');

const HOUR = 3600000; const DAY = 86400000;
const iso = (t) => new Date(t).toISOString();

async function raise(db, { key, kind, severity, title, details }) {
  const at = now();
  const prev = await db.get('SELECT id, status, resolved_at FROM alerts WHERE dedupe_key = ?', [key]);
  if (!prev) {
    await db.run(`INSERT INTO alerts(dedupe_key, kind, severity, title, details, first_seen_at, last_seen_at) VALUES (?,?,?,?,?,?,?)`,
      [key, kind, severity, title, JSON.stringify(details || {}), at, at]);
    return 'created';
  }
  // Resuelta hace más de un día y el problema sigue: se reabre.
  const reopen = prev.status === 'resolved' && prev.resolved_at && Date.parse(prev.resolved_at) < Date.now() - DAY;
  if (prev.status === 'resolved' && !reopen) return 'ignored';
  await db.run(`UPDATE alerts SET last_seen_at = ?, occurrences = occurrences + 1, severity = ?, title = ?, details = ?,
    status = CASE WHEN ? THEN 'open' ELSE status END, resolved_at = CASE WHEN ? THEN NULL ELSE resolved_at END WHERE id = ?`,
  [at, severity, title, JSON.stringify(details || {}), reopen ? 1 : 0, reopen ? 1 : 0, prev.id]);
  return reopen ? 'reopened' : 'updated';
}

async function scan(db) {
  const S = async (k) => getSetting(db, k);
  const t = Date.now(); const out = [];
  const push = async (a) => out.push([a.key, await raise(db, a)]);

  // 1) Errores técnicos en la última hora.
  const errs = await db.get('SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ?', [iso(t - HOUR)]);
  const maxErr = await S('alerts.errors_per_hour');
  if (errs.n >= maxErr) {
    await push({ key: 'errors:' + iso(t).slice(0, 13), kind: 'errors', severity: errs.n >= maxErr * 3 ? 'critical' : 'warning',
      title: `${errs.n} errores técnicos en la última hora`, details: { count: errs.n, threshold: maxErr } });
  }
  // 2) Base de datos: errores del controlador en las últimas 24 h.
  const dbErr = await db.get("SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ? AND (message LIKE '%SQLITE%' OR message LIKE '%libsql%' OR scope = 'db')", [iso(t - DAY)]);
  if (dbErr.n > 0) await push({ key: 'db:' + iso(t).slice(0, 10), kind: 'database', severity: 'critical', title: `${dbErr.n} fallos de base de datos en 24 h`, details: { count: dbErr.n } });
  // 3) Tareas programadas que fallan.
  for (const j of await db.all('SELECT name, consecutive_failures, last_error FROM jobs WHERE consecutive_failures >= 2')) {
    await push({ key: 'job:' + j.name, kind: 'job', severity: j.consecutive_failures >= 5 ? 'critical' : 'warning',
      title: `La tarea «${j.name}» falló ${j.consecutive_failures} veces seguidas`, details: { error: j.last_error } });
  }
  // 4) Fuentes externas que dejaron de funcionar.
  const maxFail = await S('alerts.source_failures');
  for (const s of await db.all("SELECT id, name, consecutive_failures, last_error, last_success_at FROM sources WHERE status <> 'disabled' AND (consecutive_failures >= ? OR status = 'error')", [maxFail])) {
    await push({ key: 'source:' + s.id, kind: 'source', severity: 'warning', title: `La fuente «${s.name}» no responde (${s.consecutive_failures} fallos)`,
      details: { source_id: s.id, error: s.last_error, last_success_at: s.last_success_at } });
  }
  // 5 y 6) Caída de la tasa de resolución / aumento de abandonos: últimos 7 días contra los 28 anteriores.
  const minSample = await S('alerts.min_sample');
  const win = async (from, to) => db.get(`SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) AS solved,
    SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned, SUM(CASE WHEN status NOT IN ('started','in_progress') THEN 1 ELSE 0 END) AS closed
    FROM games WHERE started_at >= ? AND started_at < ? AND mode <> 'practice'`, [iso(from), iso(to)]);
  const recent = await win(t - 7 * DAY, t); const base = await win(t - 35 * DAY, t - 7 * DAY);
  if (recent.n >= minSample && base.n >= minSample) {
    const r1 = (recent.solved / recent.n) * 100; const r0 = (base.solved / base.n) * 100;
    const drop = await S('alerts.solve_rate_drop_points');
    if (r0 - r1 >= drop) {
      await push({ key: 'solve_drop:' + iso(t).slice(0, 10), kind: 'solve_rate', severity: 'warning',
        title: `La tasa de resolución bajó de ${r0.toFixed(1)} % a ${r1.toFixed(1)} %`, details: { recent: recent.n, baseline: base.n } });
    }
    if (recent.closed && base.closed) {
      const a1 = (recent.abandoned / recent.closed) * 100; const a0 = (base.abandoned / base.closed) * 100;
      const rise = await S('alerts.abandon_rate_rise_points');
      if (a1 - a0 >= rise) {
        await push({ key: 'abandon_rise:' + iso(t).slice(0, 10), kind: 'abandon_rate', severity: 'warning',
          title: `Los abandonos subieron de ${a0.toFixed(1)} % a ${a1.toFixed(1)} %`, details: { recent: recent.closed, baseline: base.closed } });
      }
    }
  }
  // 7) Crípticos con posible respuesta o explicación incorrecta (se señalan para revisión, no se retiran solos).
  const minPlays = await S('alerts.clue_min_plays'); const minRate = await S('alerts.clue_solve_rate_min');
  const reportsMin = await S('alerts.clue_wrong_answer_reports');
  const suspects = await db.all(`SELECT c.id, c.clue_text, c.answer, x.plays, x.solved,
      (SELECT COUNT(*) FROM clue_reports r WHERE r.clue_id = c.id AND r.status = 'open' AND r.reason IN ('wrong_answer','bad_explanation')) AS reports
    FROM clues c LEFT JOIN (SELECT clue_id, COUNT(*) AS plays, SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) AS solved
      FROM games WHERE status NOT IN ('started','in_progress') GROUP BY clue_id) x ON x.clue_id = c.id
    WHERE c.status = 'published' AND ((x.plays >= ? AND 100.0 * x.solved / x.plays < ?) OR
      (SELECT COUNT(*) FROM clue_reports r WHERE r.clue_id = c.id AND r.status = 'open' AND r.reason IN ('wrong_answer','bad_explanation')) >= ?) LIMIT 50`,
  [minPlays, minRate, reportsMin]);
  for (const c of suspects) {
    const rate = c.plays ? Math.round((c.solved / c.plays) * 1000) / 10 : null;
    await push({ key: 'clue:' + c.id, kind: 'clue', severity: c.reports >= reportsMin ? 'warning' : 'info',
      title: `Revisar «${c.clue_text}»`, details: { clue_id: c.id, plays: c.plays || 0, solve_rate: rate, reports: c.reports,
        note: 'Puede ser solo difícil: revisá respuesta y explicación antes de decidir.' } });
  }
  // 8) Propuestas acumuladas.
  const maxPending = await S('alerts.pending_submissions_max'); const days = await S('alerts.pending_submission_days');
  const pending = await db.get("SELECT COUNT(*) AS n, SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END) AS old FROM submissions WHERE status IN ('pending','in_review')", [iso(t - days * DAY)]);
  if (pending.n >= maxPending || (pending.old || 0) > 0) {
    await push({ key: 'submissions_backlog', kind: 'submissions', severity: 'info',
      title: `${pending.n} propuestas esperan revisión${pending.old ? ` (${pending.old} con más de ${days} días)` : ''}`, details: { pending: pending.n, old: pending.old || 0 } });
  }
  // 9) Intentos de acceso sospechosos al panel.
  const maxLogin = await S('alerts.failed_admin_logins_per_hour');
  const failed = await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.login_failed' AND created_at >= ?", [iso(t - HOUR)]);
  if (failed.n >= maxLogin) {
    await push({ key: 'admin_login:' + iso(t).slice(0, 13), kind: 'security', severity: 'critical',
      title: `${failed.n} intentos fallidos de acceso al panel en una hora`, details: { count: failed.n } });
  }
  // Las alertas por hora o día que no se repitieron en una semana se cierran solas.
  await db.run("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE status <> 'resolved' AND kind IN ('errors','database','security','solve_rate','abandon_rate') AND last_seen_at < ?",
    [now(), iso(t - 7 * DAY)]);
  return { checked: true, alerts: out.length };
}

module.exports = { scan, raise };
