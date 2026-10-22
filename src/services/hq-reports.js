'use strict';

// Informe ejecutivo cada 48 horas para los dos CEO (ver docs/HQ.md).
// Lo genera la tarea programada «exec_report» del servidor (planificador persistente
// en la base: sobrevive a reinicios y no depende del navegador). El próximo turno se
// calcula desde la última ejecución correcta. period_key evita duplicados y un turno
// que falló se reintenta sobre la misma fila. Cada informe guarda las fuentes usadas.

const { uuid, now, parseJson, HttpError } = require('./util');
const { audit } = require('./audit');
const { getSetting } = require('./settings');
const alerts = require('./alerts');

const HOUR = 3600000; const DAY = 86400000;
const iso = (t) => new Date(t).toISOString();
const PERIOD_MS = 48 * HOUR;
const STALE_GENERATING_MS = 15 * 60000;

async function timezone(db) {
  const tz = await getSetting(db, 'hq.report_timezone');
  try { new Intl.DateTimeFormat('es', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

function localTime(at, tz) {
  return new Intl.DateTimeFormat('es-AR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date(at));
}

// Próximo informe programado y si la automatización ya se verificó con una ejecución real.
async function nextRun(db) {
  const tz = await timezone(db);
  const job = await db.get("SELECT * FROM jobs WHERE name = 'exec_report'");
  const last = await db.get("SELECT id, period_end, generated_at FROM exec_reports WHERE trigger = 'scheduled' AND status = 'ready' ORDER BY period_end DESC LIMIT 1");
  const lastFail = await db.get("SELECT id, error, started_at FROM exec_reports WHERE status = 'failed' ORDER BY started_at DESC LIMIT 1");
  if (!job) return { at: null, timezone: tz, status: 'missing', note: 'La tarea programada no existe.' };
  return {
    at: job.next_run_at, local: localTime(job.next_run_at, tz), timezone: tz, enabled: !!job.enabled,
    status: last ? 'verified' : 'configured_unverified',
    status_label: last ? 'Automatización verificada' : 'Configurada, todavía sin una ejecución programada verificada',
    last_success: last ? last.generated_at : null, last_failure: lastFail || null, consecutive_failures: job.consecutive_failures,
    schedulers: ['Vercel Cron: /api/cron/tick una vez por día (06:00 UTC)', 'GitHub Actions «AI Company HQ»: revisa cada hora las tareas vencidas'],
  };
}

// ── Construcción del informe ──
async function build(db, { start, end }) {
  const S = []; // fuentes consultadas
  const q = async (label, sql, args = []) => { const rows = await db.all(sql, args); S.push({ source: label, rows: rows.length }); return rows; };
  const one = async (label, sql, args = []) => (await q(label, sql, args))[0] || {};
  const prevStart = iso(Date.parse(start) - (Date.parse(end) - Date.parse(start)));
  const hq = require('./hq');

  const ctx = await hq.context(db);
  const agents = ctx.agents.map((a) => ({ id: a.id, name: a.name, department: a.department, ...hq.deriveState(a, ctx) }));
  S.push({ source: 'Estado derivado de agentes (agent_runs, ops_tasks, approval_items, jobs)', rows: agents.length });

  const window = async (from, to) => ({
    runs: await one('agent_runs', "SELECT COUNT(*) AS n, SUM(status = 'ok') AS ok, SUM(status = 'error') AS err, COALESCE(SUM(cost_amount), 0) AS cost FROM agent_runs WHERE status <> 'running' AND COALESCE(finished_at, started_at) >= ? AND COALESCE(finished_at, started_at) < ?", [from, to]),
    tasks_done: (await one('ops_tasks', "SELECT COUNT(*) AS n FROM ops_tasks WHERE status = 'done' AND done_at >= ? AND done_at < ?", [from, to])).n || 0,
    errors: (await one('error_log', 'SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ? AND created_at < ?', [from, to])).n || 0,
    events: (await one('agent_events', 'SELECT COUNT(*) AS n FROM agent_events WHERE created_at >= ? AND created_at < ?', [from, to])).n || 0,
    games: (await one('games', 'SELECT COUNT(*) AS n FROM games WHERE started_at >= ? AND started_at < ?', [from, to])).n || 0,
    costs: (await one('costs', "SELECT COALESCE(SUM(amount), 0) AS n FROM costs WHERE kind = 'actual' AND created_at >= ? AND created_at < ?", [from, to])).n || 0,
  });
  const cur = await window(start, end); const prev = await window(prevStart, start);

  const runsByAgent = await q('agent_runs por agente', `SELECT r.agent_id, a.name, a.department, COUNT(*) AS n, SUM(r.status = 'ok') AS ok, SUM(r.status = 'error') AS err,
      MAX(COALESCE(r.finished_at, r.started_at)) AS last FROM agent_runs r JOIN agents a ON a.id = r.agent_id
      WHERE r.started_at >= ? AND r.started_at < ? GROUP BY r.agent_id ORDER BY n DESC`, [start, end]);
  const lastByDept = await q('último resultado por departamento', `SELECT a.department, r.agent_id, r.status, r.summary, r.evidence, COALESCE(r.finished_at, r.started_at) AS at
      FROM agent_runs r JOIN agents a ON a.id = r.agent_id WHERE r.id IN (SELECT MAX(r2.id) FROM agent_runs r2 JOIN agents a2 ON a2.id = r2.agent_id WHERE r2.status <> 'running' GROUP BY a2.department)`);
  const doneTasks = await q('ops_tasks completadas', "SELECT id, title, category, agent_id, evidence FROM ops_tasks WHERE status = 'done' AND done_at >= ? AND done_at < ?", [start, end]);
  const openTasks = await q('ops_tasks abiertas', `SELECT t.id, t.title, t.status, t.category, t.priority, t.agent_id, a.name AS agent_name, t.expected, t.depends_on, t.due_at,
      t.blocked_reason, t.updated_at, t.area FROM ops_tasks t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.status NOT IN ('done','cancelled')
      ORDER BY t.priority, CASE t.category WHEN 'critical' THEN 0 WHEN 'human_decision' THEN 1 WHEN 'important' THEN 2 ELSE 3 END, t.id`);
  const failedRuns = await q('agent_runs con error', "SELECT r.id, r.agent_id, r.error, r.started_at FROM agent_runs r WHERE r.status = 'error' AND r.started_at >= ? AND r.started_at < ? ORDER BY r.id DESC LIMIT 20", [start, end]);
  const approvalsPending = await q('approval_items pendientes', "SELECT id, kind, area, title, created_at FROM approval_items WHERE status IN ('pending','conflict') ORDER BY created_at");
  const openAlerts = await q('alerts abiertas', "SELECT kind, severity, title, details, last_seen_at FROM alerts WHERE status = 'open' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END");
  const risks = await q('risks abiertos', "SELECT id, area, title, severity, needs_lawyer FROM risks WHERE status <> 'closed' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END");
  const jobs = await q('jobs', 'SELECT name, last_status, last_error, consecutive_failures, last_run_at, enabled FROM jobs ORDER BY name');
  const decisions = openTasks.filter((t) => t.category === 'human_decision');
  const blocked = openTasks.filter((t) => t.status === 'blocked');
  const critical = [...openAlerts.filter((a) => a.severity === 'critical').map((a) => a.title), ...risks.filter((r) => r.severity === 'critical').map((r) => `${r.id}: ${r.title}`),
    ...jobs.filter((j) => j.consecutive_failures >= 2).map((j) => `La tarea «${j.name}» falló ${j.consecutive_failures} veces seguidas`)];

  // C. Tecnología
  const files = await q('agent_events (archivos)', "SELECT e.message, e.agent_id, e.created_at FROM agent_events e WHERE e.kind = 'file' AND e.created_at >= ? AND e.created_at < ? ORDER BY e.id DESC LIMIT 60", [start, end]);
  const commits = await q('agent_runs (commits)', "SELECT agent_id, summary, evidence, status, finished_at FROM agent_runs WHERE source = 'commit' AND started_at >= ? AND started_at < ? ORDER BY id DESC LIMIT 40", [start, end]);
  const ciRuns = await q('agent_runs (Pruebas)', "SELECT status, summary, evidence, finished_at FROM agent_runs WHERE agent_id = 'pruebas' AND started_at >= ? AND started_at < ? ORDER BY id DESC LIMIT 20", [start, end]);
  const errorsByScope = await q('error_log por origen', 'SELECT scope, COUNT(*) AS n FROM error_log WHERE created_at >= ? AND created_at < ? GROUP BY scope ORDER BY n DESC', [start, end]);
  const alertsResolved = await q('alerts resueltas', 'SELECT kind, title, resolved_at FROM alerts WHERE resolved_at >= ? AND resolved_at < ?', [start, end]);
  const recurring = await q('error_log recurrentes', 'SELECT scope, message, COUNT(*) AS n FROM error_log WHERE created_at >= ? AND created_at < ? GROUP BY scope, message HAVING n >= 2 ORDER BY n DESC LIMIT 10', [start, end]);

  // D. Legal
  const legalVersions = await q('legal_document_versions', 'SELECT doc_id, version, language, status, created_at FROM legal_document_versions WHERE created_at >= ? AND created_at < ?', [start, end]);
  const jurisdictions = await q('legal_jurisdictions', 'SELECT code, name, status, verified_at, official_sources IS NOT NULL AS has_sources, needs_lawyer FROM legal_jurisdictions ORDER BY code');
  const legalReview = await q('documentos para revisión profesional', "SELECT doc_id, version, status FROM legal_document_versions WHERE status IN ('draft','in_review','lawyer_review')");

  // E. Marketing
  const pieces = await one('content_pieces', `SELECT SUM(created_at >= ? AND created_at < ?) AS created, SUM(status = 'published' AND published_at >= ? AND published_at < ?) AS published,
      SUM(status IN ('approved','scheduled')) AS approved_open, SUM(status = 'pending_approval') AS pending, SUM(status = 'scheduled') AS scheduled FROM content_pieces`, [start, end, start, end]);
  const approvedPieces = await one('approval_votes de contenido', `SELECT COUNT(DISTINCT v.item_id) AS n FROM approval_votes v JOIN approval_items a ON a.id = v.item_id
      WHERE a.area = 'marketing' AND v.decision = 'approve' AND v.created_at >= ? AND v.created_at < ?`, [start, end]);
  const byPlatform = await q('content_pieces por red', "SELECT platform, status, COUNT(*) AS n FROM content_pieces GROUP BY platform, status ORDER BY platform");
  const campaigns = await q('content_pieces por campaña', "SELECT COALESCE(campaign, 'Sin campaña') AS campaign, COUNT(*) AS n, SUM(status IN ('scheduled','published')) AS live FROM content_pieces GROUP BY campaign");
  const byLang = await q('content_pieces por país e idioma', "SELECT COALESCE(country, '—') AS country, COALESCE(language, '—') AS language, COUNT(*) AS n, SUM(status = 'published') AS published FROM content_pieces GROUP BY country, language");

  // F. Comunidad
  const community = await one('submissions y clue_reports', `SELECT
      (SELECT COUNT(*) FROM clue_reports WHERE status = 'open') AS reports_open,
      (SELECT COUNT(*) FROM submissions WHERE status IN ('pending','in_review')) AS submissions_pending,
      (SELECT COUNT(*) FROM content_pieces WHERE status = 'publish_error') AS publish_errors`);
  const decidedSubs = await one('submissions decididas', "SELECT COUNT(*) AS n FROM submission_events WHERE created_at >= ? AND created_at < ? AND to_status IN ('approved','rejected')", [start, end]);
  const reportReasons = await q('clue_reports por motivo', 'SELECT reason, COUNT(*) AS n FROM clue_reports WHERE created_at >= ? AND created_at < ? GROUP BY reason ORDER BY n DESC', [start, end]);

  // G. Producto
  const product = await one('clues y games', `SELECT (SELECT COUNT(*) FROM clues WHERE status = 'published') AS published_total,
      (SELECT COALESCE(SUM(target), 0) FROM bank_targets) AS target,
      (SELECT COUNT(*) FROM clues WHERE created_at >= ? AND created_at < ?) AS created,
      (SELECT COUNT(*) FROM clues WHERE status = 'published' AND published_at >= ? AND published_at < ?) AS validated_published,
      (SELECT COUNT(*) FROM clue_reports WHERE created_at >= ? AND created_at < ?) AS reported,
      (SELECT COUNT(*) FROM games WHERE started_at >= ? AND started_at < ?) AS games,
      (SELECT SUM(status = 'solved') FROM games WHERE started_at >= ? AND started_at < ?) AS solved,
      (SELECT COUNT(DISTINCT player_id) FROM games WHERE started_at >= ? AND started_at < ?) AS players,
      (SELECT COUNT(*) FROM clue_audits WHERE verdict = 'pending') AS audits_pending`, [start, end, start, end, start, end, start, end, start, end, start, end]);
  const uxDone = doneTasks.filter((t) => t.category === 'ux');

  // H. Apps
  const appTasks = openTasks.filter((t) => t.area === 'apps');
  // I. Finanzas
  const costs = await q('costs', "SELECT kind, vendor, area, currency, SUM(amount) AS total FROM costs WHERE created_at >= ? AND created_at < ? GROUP BY kind, vendor, area, currency", [start, end]);
  const monthCost = await one('costs del mes', "SELECT COALESCE(SUM(amount), 0) AS total FROM costs WHERE kind = 'actual' AND created_at >= ?", [new Date().toISOString().slice(0, 7) + '-01']);
  const budget = await getSetting(db, 'hq.monthly_budget_usd');

  // Comparación entre períodos
  const stalled = openTasks.filter((t) => t.updated_at < start && t.status !== 'blocked');
  const overdue = openTasks.filter((t) => t.due_at && t.due_at < end);
  const delta = (a, b) => ({ current: a, previous: b, change: a - b });
  const causeOf = (t) => hq.blockCause(t.blocked_reason);
  const bottlenecks = {};
  for (const t of blocked) (bottlenecks[causeOf(t)] = bottlenecks[causeOf(t)] || []).push(t.id);
  const oldApprovals = approvalsPending.filter((a) => a.created_at < iso(Date.parse(end) - PERIOD_MS));

  const stateCount = (k) => agents.filter((a) => a.state === k).length;
  const status = critical.length ? 'critical' : (blocked.length || failedRuns.length || openAlerts.some((a) => a.severity === 'warning')) ? 'attention' : 'normal';
  const deptLoad = {};
  for (const t of openTasks) {
    const d = (ctx.agents.find((a) => a.id === t.agent_id) || {}).department || 'Sin agente';
    deptLoad[d] = deptLoad[d] || { open: 0, blocked: 0 }; deptLoad[d].open++; if (t.status === 'blocked') deptLoad[d].blocked++;
  }
  const plan = openTasks.filter((t) => t.status !== 'blocked').slice(0, 10).map((t) => ({ task: t.id, title: t.title, owner: t.agent_name || 'Sin agente asignado',
    expected: t.expected, depends_on: parseJson(t.depends_on, []), due_at: t.due_at || null, priority: t.priority }));

  const content = {
    status, status_label: { critical: 'Con problemas críticos', attention: 'Requiere atención', normal: 'Sin problemas detectados' }[status],
    A: {
      title: 'Resumen ejecutivo',
      advances: [...doneTasks.map((t) => `${t.id} completada: ${t.title}`), ...runsByAgent.filter((r) => r.ok).slice(0, 8).map((r) => `${r.name}: ${r.ok} ejecución(es) correcta(s)`)],
      objectives_met: doneTasks.map((t) => ({ id: t.id, title: t.title, evidence: t.evidence })),
      critical_problems: critical,
      decisions: [...decisions.map((t) => `${t.id}: ${t.title}`), ...approvalsPending.map((a) => `Aprobación pendiente: ${a.title}`)],
    },
    B: {
      title: 'Actividad de los agentes',
      agents_with_runs: runsByAgent,
      tasks: { completed: doneTasks.length, in_progress: openTasks.filter((t) => t.status === 'in_progress').length, failed_runs: failedRuns.length, blocked: blocked.length },
      states: Object.fromEntries(Object.keys(hq.STATES).map((k) => [k, stateCount(k)])),
      inactive: agents.filter((a) => a.state === 'idle').map((a) => a.name),
      no_records: agents.filter((a) => !runsByAgent.some((r) => r.agent_id === a.id)).map((a) => a.name),
      last_result_by_team: lastByDept,
      failed: failedRuns.map((r) => ({ run: r.id, agent: r.agent_id, error: hq.scrub(r.error).slice(0, 200), at: r.started_at })),
    },
    C: {
      title: 'Departamento tecnológico',
      commits, files: files.map((f) => f.message), tests: ciRuns,
      errors_by_scope: errorsByScope, fixed: alertsResolved.map((a) => a.title),
      pending: openTasks.filter((t) => ['tech', 'security'].includes(t.area)).map((t) => `${t.id}: ${t.title} (${t.status})`),
      production: { jobs: jobs.map((j) => ({ ...j, last_error: j.last_error ? hq.scrub(j.last_error).slice(0, 160) : null })) },
      security_risks: [...risks.filter((r) => ['security', 'tech'].includes(r.area)).map((r) => `${r.id}: ${r.title} (${r.severity})`),
        ...openAlerts.filter((a) => a.kind === 'security').map((a) => a.title)],
    },
    D: {
      title: 'Departamento legal',
      documents_changed: legalVersions,
      jurisdictions_verified: jurisdictions.filter((j) => j.verified_at && j.verified_at >= start && j.verified_at < end).map((j) => j.name),
      jurisdictions_with_sources: jurisdictions.filter((j) => j.has_sources).map((j) => j.name),
      regulatory_changes: { available: false, note: 'No hay seguimiento normativo automático: el agente «Seguimiento regulatorio» no tiene proceso.' },
      open_risks: risks.filter((r) => r.area === 'legal').map((r) => `${r.id}: ${r.title} (${r.severity})`),
      professional_review: legalReview.map((d) => `${d.doc_id} v${d.version} (${d.status})`),
      approvals: approvalsPending.filter((a) => a.area === 'legal').map((a) => a.title),
    },
    E: {
      title: 'Marketing',
      created: pieces.created || 0, approved_in_period: approvedPieces.n || 0, published_verified: pieces.published || 0,
      pending_approval: pieces.pending || 0, scheduled: pieces.scheduled || 0,
      by_platform: byPlatform, campaigns, by_country_language: byLang,
      performance: { available: false, note: 'No disponible: las métricas de cada red no se importan (Metricool sin API en el plan actual).' },
    },
    F: {
      title: 'Comunidad',
      inbox: { available: false, note: 'No disponible: no hay acceso a comentarios ni mensajes de las redes.' },
      prepared_replies: { available: false, note: 'No hay respuestas preparadas registradas en el sistema.' },
      resolved: decidedSubs.n ?? null, reports_open: community.reports_open || 0, submissions_pending: community.submissions_pending || 0,
      publish_errors: community.publish_errors || 0, recurring: reportReasons,
    },
    G: {
      title: 'Producto',
      bank: { published: product.published_total || 0, target: product.target || 0 },
      created: product.created || 0, published_in_period: product.validated_published || 0, reported: product.reported || 0, audits_pending: product.audits_pending || 0,
      ux_improvements: uxDone.map((t) => `${t.id}: ${t.title}`),
      usage: { games: product.games || 0, solved: product.solved || 0, players: product.players || 0 },
    },
    H: {
      title: 'Aplicaciones móviles',
      exists: false, note: 'No hay aplicaciones móviles en desarrollo: no hay builds, pruebas ni revisiones de tiendas para informar.',
      pending: appTasks.map((t) => `${t.id}: ${t.title} (${t.status}${t.blocked_reason ? ' — ' + t.blocked_reason : ''})`),
    },
    I: {
      title: 'Finanzas y recursos',
      costs, runs_cost_usd: Math.round((cur.runs.cost || 0) * 100) / 100,
      ai_usage: { available: false, note: 'El consumo de herramientas de IA no se registra automáticamente: solo cuenta lo cargado en ejecuciones o costos.' },
      month_actual_usd: Math.round((monthCost.total || 0) * 100) / 100, monthly_budget_usd: budget || null,
      budget_left_usd: budget ? Math.round((budget - (monthCost.total || 0)) * 100) / 100 : null,
      overrun_risk: budget ? (monthCost.total || 0) > budget * 0.8 : null,
    },
    J: { title: 'Plan para las próximas 48 horas', priorities: plan, decisions: decisions.map((t) => `${t.id}: ${t.title}`) },
    comparison: {
      runs_ok: delta(cur.runs.ok || 0, prev.runs.ok || 0), runs_error: delta(cur.runs.err || 0, prev.runs.err || 0),
      tasks_done: delta(cur.tasks_done, prev.tasks_done), errors: delta(cur.errors, prev.errors), events: delta(cur.events, prev.events),
      costs_usd: delta(Math.round(cur.costs * 100) / 100, Math.round(prev.costs * 100) / 100), games: delta(cur.games, prev.games),
      stalled: stalled.map((t) => `${t.id}: ${t.title}`), recurring_errors: recurring.map((r) => ({ scope: r.scope, message: hq.scrub(r.message).slice(0, 160), n: r.n })),
      bottlenecks: Object.fromEntries(Object.entries(bottlenecks).map(([k, v]) => [k, v])), delayed: overdue.map((t) => `${t.id}: ${t.title} (vencía ${t.due_at})`),
      previous_period: { start: prevStart, end: start },
    },
    review: {
      label: 'Revisión ejecutiva automática generada a partir de los registros. No fue una reunión entre agentes.',
      working: [...runsByAgent.filter((r) => r.ok && !r.err).map((r) => `${r.name}: ${r.ok} correctas, sin errores`), ...jobs.filter((j) => j.last_status === 'success' && j.enabled).map((j) => `Tarea programada «${j.name}» al día`)],
      not_working: [...failedRuns.map((r) => `${r.agent_id}: ${hq.scrub(r.error).slice(0, 120)}`), ...jobs.filter((j) => j.last_status === 'failed').map((j) => `«${j.name}» falló`)],
      blocked_agents: agents.filter((a) => a.state === 'blocked').map((a) => `${a.name}: ${a.reason}`),
      too_long: [...openTasks.filter((t) => t.status === 'in_progress' && t.updated_at < iso(Date.parse(end) - 7 * DAY)).map((t) => `${t.id}: en curso sin cambios desde ${t.updated_at.slice(0, 10)}`),
        ...oldApprovals.map((a) => `Aprobación «${a.title}» espera desde ${a.created_at.slice(0, 10)}`)],
      needs_resources: Object.entries(deptLoad).filter(([, v]) => v.blocked >= 2 || v.open >= 6).map(([k, v]) => `${k}: ${v.open} tareas abiertas, ${v.blocked} bloqueadas`),
      highest_impact: openTasks.filter((t) => ['critical', 'important'].includes(t.category) && t.status !== 'blocked').slice(0, 5).map((t) => `${t.id}: ${t.title}`),
      risks: risks.filter((r) => ['critical', 'high'].includes(r.severity)).map((r) => `${r.id}: ${r.title}`),
      ceo_decisions: [...decisions.map((t) => `${t.id}: ${t.title}`), ...approvalsPending.map((a) => a.title)].slice(0, 20),
      next_cycle: plan.slice(0, 5).map((p) => `${p.task}: ${p.title}`),
    },
    limitations: [
      'Comentarios, mensajes y métricas de redes: sin integración (no se puede afirmar actividad ni inactividad).',
      'Correo electrónico: no hay proveedor configurado; el informe se entrega en el panel (T-007).',
      'Disponibilidad del sitio: sin monitoreo externo (T-008).',
      'Consumo y costos de Vercel, Turso y herramientas de IA: no se leen automáticamente; solo cuenta lo cargado.',
      'Trabajo de agentes «a pedido»: se registra cuando el commit trae la línea «HQ-Agent:» o se carga con el flujo «AI Company HQ». Sin registro no se informa como trabajo, pero no prueba que no lo hubo.',
      'Copias de seguridad de la base: no son visibles desde el proyecto (T-018).',
    ],
  };
  return { content, sources: S };
}

// ── Generación ──
async function generate(db, { trigger, actor } = {}) {
  const tz = await timezone(db);
  const end = now();
  let start; let key;
  if (trigger === 'scheduled') {
    const last = await db.get("SELECT id, period_end FROM exec_reports WHERE trigger = 'scheduled' AND status = 'ready' ORDER BY period_end DESC LIMIT 1");
    // Un turno ya entregado no se repite aunque la tarea se dispare de nuevo antes de tiempo.
    if (last && Date.now() - Date.parse(last.period_end) < PERIOD_MS - HOUR) return { skipped: 'not_due', id: last.id };
    start = last ? last.period_end : iso(Date.now() - PERIOD_MS);
    key = 'scheduled:' + start;
  } else {
    start = iso(Date.now() - PERIOD_MS);
    key = 'manual:' + end.slice(0, 16);
  }
  const existing = await db.get('SELECT * FROM exec_reports WHERE period_key = ?', [key]);
  let id;
  if (existing) {
    if (existing.status === 'ready') return { skipped: 'duplicate', id: existing.id };
    if (existing.status === 'generating' && Date.now() - Date.parse(existing.started_at) < STALE_GENERATING_MS) return { skipped: 'in_progress', id: existing.id };
    // Reanuda un turno que falló o quedó a medias (por ejemplo, tras un reinicio).
    const r = await db.run("UPDATE exec_reports SET status = 'generating', attempts = attempts + 1, started_at = ?, error = NULL WHERE id = ? AND status = ?", [now(), existing.id, existing.status]);
    if (r.changes !== 1) return { skipped: 'in_progress', id: existing.id };
    id = existing.id;
  } else {
    id = uuid();
    try {
      await db.run('INSERT INTO exec_reports(id, period_key, trigger, period_start, period_end, timezone, requested_by) VALUES (?,?,?,?,?,?,?)',
        [id, key, trigger, start, end, tz, actor ? actor.id : null]);
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) return { skipped: 'duplicate' };
      throw e;
    }
  }
  try {
    const { content, sources } = await build(db, { start, end });
    await db.run("UPDATE exec_reports SET status = 'ready', period_end = ?, content = ?, sources = ?, generated_at = ? WHERE id = ?",
      [end, JSON.stringify(content), JSON.stringify(sources), now(), id]);
  } catch (e) {
    await db.run("UPDATE exec_reports SET status = 'failed', error = ? WHERE id = ?", [String(e.message).slice(0, 500), id]);
    await alerts.raise(db, { key: 'hq_report_generation', kind: 'hq_report', severity: 'critical', title: 'Falló la generación del informe ejecutivo',
      details: { cause: String(e.message).slice(0, 300), impact: 'Los CEO no reciben el informe de 48 horas.', owner: 'Operaciones ejecutivas / DevOps',
        action: 'Revisar el error en «Tareas y errores»; el turno se reintenta solo. También se puede generar a mano desde HQ.', report: id } });
    throw e;
  }
  await deliver(db, id);
  await audit(db, { actorId: actor && actor.id, actorKind: actor ? 'person' : 'system', action: 'hq.report_generated', targetKind: 'exec_report', targetId: id, details: { trigger, start, end } });
  return { id, status: 'ready' };
}

// Entrega: notificación interna a cada CEO activo, mismo informe para los dos.
async function deliver(db, id) {
  const report = await db.get('SELECT id, period_start, period_end, trigger FROM exec_reports WHERE id = ?', [id]);
  const owners = await db.all("SELECT id, username FROM users WHERE role = 'owner' AND deleted_at IS NULL AND disabled = 0");
  const delivery = {
    panel: { status: 'delivered', note: 'Disponible en HQ → Informes para los dos CEO.' },
    notification: { status: owners.length ? 'delivered' : 'failed', recipients: owners.map((o) => o.username) },
    email: { status: 'not_configured', note: 'Sin proveedor de correo (T-007).' },
    pdf: { status: 'available', note: 'Versión imprimible: «Descargar PDF» en el informe.' },
  };
  for (const o of owners) {
    await db.run('INSERT INTO notifications(user_id, kind, payload) VALUES (?,?,?)', [o.id, 'exec_report', JSON.stringify({ report_id: id, period_start: report.period_start, period_end: report.period_end })]);
  }
  await db.run('UPDATE exec_reports SET delivery = ?, delivered_at = ? WHERE id = ?', [JSON.stringify(delivery), owners.length ? now() : null, id]);
  if (!owners.length) {
    await alerts.raise(db, { key: 'hq_report_delivery', kind: 'hq_report', severity: 'critical', title: 'El informe ejecutivo no se pudo entregar',
      details: { cause: 'No hay cuentas de CEO activas.', impact: 'Nadie recibió el informe.', owner: 'Los dos CEO', action: 'Revisar las cuentas en «Equipo».', report: id } });
  }
  return delivery;
}

// Turno programado: lo llama la tarea «exec_report».
async function runScheduled(db) {
  const out = await generate(db, { trigger: 'scheduled' });
  // Una entrega correcta cierra alertas previas de generación.
  if (out.status === 'ready') {
    await db.run("UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE dedupe_key IN ('hq_report_generation') AND status <> 'resolved'", [now()]);
  }
  return out;
}

// Informes que quedaron «generando» por una caída: se marcan fallidos para reintentar.
async function recoverStuck(db) {
  const r = await db.run("UPDATE exec_reports SET status = 'failed', error = 'interrumpido' WHERE status = 'generating' AND started_at < ?", [iso(Date.now() - STALE_GENERATING_MS)]);
  return r.changes;
}

async function list(db, userId) {
  const rows = await db.all(`SELECT id, trigger, period_start, period_end, timezone, status, attempts, error, generated_at, delivered_at, delivery,
      (SELECT MAX(read_at) FROM notifications n WHERE n.user_id = ? AND n.kind = 'exec_report' AND json_extract(n.payload, '$.report_id') = exec_reports.id) AS read_at
    FROM exec_reports ORDER BY started_at DESC LIMIT 100`, [userId]);
  return rows.map((r) => ({ ...r, delivery: parseJson(r.delivery, null) }));
}

async function get(db, id, user) {
  const r = await db.get('SELECT * FROM exec_reports WHERE id = ?', [id]);
  if (!r) throw new HttpError(404, 'not_found');
  if (user) {
    await db.run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND kind = 'exec_report' AND read_at IS NULL AND json_extract(payload, '$.report_id') = ?", [now(), user.id, id]);
    await audit(db, { actorId: user.id, action: 'hq.report_view', targetKind: 'exec_report', targetId: id });
  }
  const readers = await db.all(`SELECT u.username, n.read_at FROM notifications n JOIN users u ON u.id = n.user_id
    WHERE n.kind = 'exec_report' AND json_extract(n.payload, '$.report_id') = ?`, [id]);
  return { ...r, content: parseJson(r.content, null), sources: parseJson(r.sources, []), delivery: parseJson(r.delivery, null), readers };
}

async function unread(db, userId) {
  return (await db.get("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'exec_report' AND read_at IS NULL", [userId])).n;
}

// Texto plano en Markdown para descargar o archivar.
function toMarkdown(r) {
  const c = r.content || {};
  const L = [];
  const list = (arr) => (arr && arr.length ? arr.map((x) => '- ' + (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') : '- Sin registros en el período');
  L.push(`# Informe ejecutivo · Play Crípticos`, '', `Período: ${r.period_start} → ${r.period_end} (${r.timezone}) · ${r.trigger === 'scheduled' ? 'Programado' : 'Manual'} · Estado: ${c.status_label || r.status}`, '');
  if (c.A) L.push('## A. Resumen ejecutivo', '', '**Avances**', list(c.A.advances), '', '**Problemas críticos**', list(c.A.critical_problems), '', '**Decisiones de los CEO**', list(c.A.decisions), '');
  if (c.B) L.push('## B. Actividad de los agentes', '', list((c.B.agents_with_runs || []).map((x) => `${x.name}: ${x.n} ejecuciones (${x.ok || 0} correctas, ${x.err || 0} con error)`)), '',
    `Tareas: ${c.B.tasks.completed} completadas, ${c.B.tasks.in_progress} en curso, ${c.B.tasks.failed_runs} ejecuciones fallidas, ${c.B.tasks.blocked} bloqueadas.`, '',
    `Sin registros en el período: ${(c.B.no_records || []).length} agentes.`, '');
  if (c.C) L.push('## C. Tecnología', '', '**Pendiente**', list(c.C.pending), '', '**Riesgos de seguridad**', list(c.C.security_risks), '');
  if (c.D) L.push('## D. Legal', '', '**Revisión profesional**', list(c.D.professional_review), '', '**Riesgos abiertos**', list(c.D.open_risks), '');
  if (c.E) L.push('## E. Marketing', '', `Creadas ${c.E.created}, aprobadas ${c.E.approved_in_period}, publicadas y verificadas ${c.E.published_verified}, pendientes ${c.E.pending_approval}, programadas ${c.E.scheduled}.`, '', c.E.performance.note, '');
  if (c.F) L.push('## F. Comunidad', '', c.F.inbox.note, '', `Reportes abiertos ${c.F.reports_open}, propuestas pendientes ${c.F.submissions_pending}, errores de publicación ${c.F.publish_errors}.`, '');
  if (c.G) L.push('## G. Producto', '', `Banco: ${c.G.bank.published} publicados de ${c.G.bank.target}. Creados ${c.G.created}, publicados ${c.G.published_in_period}, reportados ${c.G.reported}. Partidas ${c.G.usage.games}.`, '');
  if (c.H) L.push('## H. Aplicaciones móviles', '', c.H.note, list(c.H.pending), '');
  if (c.I) L.push('## I. Finanzas', '', `Costo real del mes: ${c.I.month_actual_usd} USD. Presupuesto: ${c.I.monthly_budget_usd ?? 'sin configurar'}.`, '');
  if (c.J) L.push('## J. Próximas 48 horas', '', list((c.J.priorities || []).map((p) => `${p.task} · ${p.title} · ${p.owner}${p.due_at ? ' · ' + p.due_at : ''}`)), '');
  if (c.review) L.push('## Revisión ejecutiva', '', `_${c.review.label}_`, '', '**Qué funciona**', list(c.review.working), '', '**Qué no funciona**', list(c.review.not_working), '', '**Prioridades del próximo ciclo**', list(c.review.next_cycle), '');
  if (c.limitations) L.push('## Limitaciones de visibilidad', '', list(c.limitations), '');
  L.push('## Fuentes', '', list((r.sources || []).map((s) => `${s.source}: ${s.rows} filas`)));
  return L.join('\n');
}

module.exports = { nextRun, build, generate, deliver, runScheduled, recoverStuck, list, get, unread, toMarkdown, timezone, PERIOD_MS };
