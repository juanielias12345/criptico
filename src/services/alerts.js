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
  const intStreak = await S('hq.integration_failure_streak');
  for (const j of await db.all('SELECT name, consecutive_failures, last_error FROM jobs WHERE consecutive_failures >= 2')) {
    await push({ key: 'job:' + j.name, kind: 'job', severity: j.consecutive_failures >= Math.min(5, intStreak) ? 'critical' : 'warning',
      title: `La tarea «${j.name}» falló ${j.consecutive_failures} veces seguidas`, details: { error: j.last_error, cause: j.last_error,
        impact: 'La automatización no está haciendo su trabajo.', owner: 'DevOps y confiabilidad', action: 'Revisar el error en «Tareas y errores» y reintentar desde HQ.' } });
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
  await hqRules(db, push, t);
  // Las alertas por hora o día que no se repitieron en una semana se cierran solas.
  await db.run("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE status <> 'resolved' AND kind IN ('errors','database','security','solve_rate','abandon_rate') AND last_seen_at < ?",
    [now(), iso(t - 7 * DAY)]);
  return { checked: true, alerts: out.length };
}

// Alertas inmediatas de AI Company HQ: cada una dice gravedad, causa, impacto,
// responsable y acción recomendada. Se agrupan por clave para no repetirse.
async function hqRules(db, push, t) {
  const S = async (k) => getSetting(db, k);
  const hq = require('./hq');
  // Agentes con un patrón de fallos.
  for (const a of await db.all("SELECT DISTINCT r.agent_id, g.name FROM agent_runs r JOIN agents g ON g.id = r.agent_id WHERE r.status = 'error' AND r.started_at >= ?", [iso(t - 7 * DAY)])) {
    const p = await hq.detectPattern(db, a.agent_id, t);
    if (!p) continue;
    await push({ key: 'agent:' + a.agent_id, kind: 'agent', severity: 'warning', title: `${a.name}: ${p.pattern}`,
      details: { agent: a.agent_id, cause: p.cause_label, impact: 'El trabajo de este agente no se está completando.', owner: 'Supervisión: los dos CEO',
        action: p.proposal, evidence: p.evidence.slice(0, 5), penalizes: p.penalizes } });
  }
  // Informe de 48 h atrasado: el planificador no está corriendo.
  const rep = await db.get("SELECT next_run_at, enabled FROM jobs WHERE name = 'exec_report'");
  if (rep && rep.enabled && Date.parse(rep.next_run_at) < t - 3 * HOUR) {
    await push({ key: 'hq_report_overdue', kind: 'hq_report', severity: 'critical', title: 'El informe ejecutivo de 48 h está atrasado',
      details: { cause: `Debía generarse a partir de ${rep.next_run_at} y el planificador no lo ejecutó.`, impact: 'Los CEO no reciben el informe a tiempo.',
        owner: 'DevOps y confiabilidad', action: 'Revisar el flujo «AI Company HQ» en GitHub Actions y el cron de Vercel; se puede generar a mano desde HQ.' } });
  }
  // Sobrecostos.
  const budget = await S('hq.monthly_budget_usd');
  if (budget > 0) {
    const spent = (await db.get("SELECT COALESCE(SUM(amount), 0) AS n FROM costs WHERE kind = 'actual' AND created_at >= ?", [iso(t).slice(0, 7) + '-01'])).n;
    if (spent > budget) {
      await push({ key: 'budget:' + iso(t).slice(0, 7), kind: 'cost', severity: 'critical', title: `Costos del mes (${spent} USD) por encima del presupuesto (${budget} USD)`,
        details: { cause: 'Costos reales cargados en el mes.', impact: 'Sobrecosto.', owner: 'Finanzas y presupuestos', action: 'Revisar los costos por proveedor en HQ → Sala de servidores.' } });
    }
  }
  // Publicaciones sin aprobación vigente (la base lo impide; si aparece, es un incidente).
  const unauthorized = await db.all("SELECT id, title FROM content_pieces WHERE status IN ('scheduled','published') AND (approval_id IS NULL OR approved_hash IS NULL)");
  for (const p of unauthorized) {
    await push({ key: 'unauthorized_post:' + p.id, kind: 'content', severity: 'critical', title: `Publicación sin aprobación: «${p.title}»`,
      details: { cause: 'La pieza figura programada o publicada sin aprobación registrada.', impact: 'Publicación no autorizada.', owner: 'Dirección de marketing',
        action: 'Pausar la pieza en la red y revisar cómo cambió de estado.' } });
  }
  // Cuentas de CEO bloqueadas, desactivadas o con intentos fallidos.
  for (const u of await db.all("SELECT id, username, disabled, locked_until, failed_logins FROM users WHERE role = 'owner' AND deleted_at IS NULL")) {
    const locked = u.locked_until && Date.parse(u.locked_until) > t;
    if (u.disabled || locked || u.failed_logins >= 3) {
      await push({ key: 'ceo_account:' + u.id + ':' + iso(t).slice(0, 10), kind: 'security', severity: 'critical',
        title: `Problema con la cuenta de CEO «${u.username}»`,
        details: { cause: u.disabled ? 'Cuenta desactivada' : locked ? 'Bloqueada por intentos fallidos' : `${u.failed_logins} intentos fallidos`,
          impact: 'Un CEO puede quedar sin acceso o alguien intenta entrar a su cuenta.', owner: 'Seguridad informática', action: 'Confirmar con el CEO; si no fue él o ella, cambiar la contraseña.' } });
    }
  }
  // Intentos de eludir aprobaciones o permisos.
  const denied = await db.all("SELECT details, actor_id FROM audit_log WHERE action = 'security.denied' AND created_at >= ?", [iso(t - DAY)]);
  const bypass = denied.filter((d) => /approval_required|stale_version/.test(d.details || ''));
  if (bypass.length) {
    await push({ key: 'approval_bypass:' + iso(t).slice(0, 10), kind: 'security', severity: bypass.length >= 3 ? 'critical' : 'warning',
      title: `${bypass.length} intento(s) de completar o publicar sin aprobación vigente en 24 h`,
      details: { cause: 'El servidor rechazó acciones que requerían aprobación.', impact: 'Ninguno: fueron bloqueadas.', owner: 'Seguridad informática',
        action: 'Revisar la auditoría (acción security.denied).' } });
  }
  // Riesgos legales críticos abiertos.
  for (const r of await db.all("SELECT id, title FROM risks WHERE area = 'legal' AND severity = 'critical' AND status = 'open'")) {
    await push({ key: 'legal_risk:' + r.id, kind: 'legal', severity: 'critical', title: `Riesgo legal crítico: ${r.title}`,
      details: { cause: 'Riesgo cargado como crítico.', impact: 'Exposición legal.', owner: 'Dirección de cumplimiento', action: 'Consultar a un profesional (T-009).' } });
  }
}

module.exports = { scan, raise };
