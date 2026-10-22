'use strict';

// AI Company HQ: la oficina virtual de los CEO (ver docs/HQ.md).
// Todo lo que muestra sale de registros reales: ejecuciones (agent_runs), eventos
// (agent_events), tareas, aprobaciones, tareas programadas y alertas. El estado de
// cada agente se deriva de esos registros; si no hay registro, no hay actividad.

const { uuid, now, parseJson, HttpError } = require('./util');
const { audit } = require('./audit');
const { getSetting } = require('./settings');
const gov = require('./governance');

const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const iso = (t) => new Date(t).toISOString();

// ── Plano de la oficina ──
// Cada zona agrupa temas del pedido de los CEO. Un personaje aparece solo si hay un
// agente real asignado; una zona sin agente se muestra como «puesto vacante».
const FLOORS = [
  ['pb', 'Planta baja', 'Recepción, reuniones e infraestructura'],
  ['p1', 'Dirección', 'Despachos de los CEO y operaciones'],
  ['p2', 'Tecnología', 'Ingeniería, diseño, calidad e infraestructura'],
  ['p3', 'Legal', 'Cumplimiento, privacidad y contratos'],
  ['p4', 'Marketing y creatividad', 'Marca, contenidos y crecimiento'],
  ['p5', 'Redes y comunidad', 'Cuentas de la marca y comunidad'],
  ['p6', 'Producto y contenido', 'Banco de crípticos y experiencia de juego'],
];
// [id, planta, nombre, tipo, temas]
const ZONES = [
  ['reception', 'pb', 'Recepción y centro de operaciones', 'room', ['Estado general', 'Actividad de 48 h', 'Agentes por estado', 'Tareas pendientes', 'Alertas', 'Próximo informe']],
  ['meeting', 'pb', 'Sala de reuniones', 'room', ['Revisiones automáticas', 'Decisiones pendientes', 'Riesgos críticos', 'Propuestas de mejora', 'Informes por departamento']],
  ['servers', 'pb', 'Sala de servidores', 'room', ['Backend', 'Base de datos', 'APIs', 'Integraciones', 'Tareas programadas', 'Errores', 'Disponibilidad', 'Recursos', 'Costos']],
  ['ceo-juan', 'p1', 'Despacho de Juan Ignacio Elías', 'ceo', ['Centro de mando', 'Aprobaciones', 'Informes']],
  ['ceo-ines', 'p1', 'Despacho de Inés de Gregorio', 'ceo', ['Centro de mando', 'Aprobaciones', 'Informes']],
  ['direction', 'p1', 'Operaciones y planificación', 'team', ['Coordinación', 'Planificación', 'Proyectos', 'Finanzas', 'Conocimiento']],
  ['commercial', 'p1', 'Estrategia comercial', 'team', ['Líneas de ingreso', 'Requisitos con métricas reales', 'Estudio de mercado', 'Propuestas para los CEO', 'Ejecución de lo aprobado']],
  ['arch', 'p2', 'Arquitectura de software', 'team', ['Arquitectura', 'Auditoría de código']],
  ['backend', 'p2', 'Programación backend', 'team', ['APIs', 'Permisos', 'Lógica de negocio']],
  ['frontend', 'p2', 'Desarrollo frontend', 'team', ['Interfaz web', 'Funcionalidades', 'Rendimiento']],
  ['mobile', 'p2', 'Desarrollo móvil', 'team', ['Apps iOS y Android']],
  ['uxui', 'p2', 'Diseño UX/UI', 'team', ['Dirección de diseño', 'Interfaces', 'Sistema de diseño', 'Prototipos']],
  ['uxr', 'p2', 'Investigación de experiencia', 'team', ['Investigación UX', 'Usuarios', 'Accesibilidad']],
  ['qa', 'p2', 'QA y testing', 'team', ['QA funcional', 'Pruebas automatizadas', 'QA visual']],
  ['security', 'p2', 'Seguridad informática', 'team', ['Autenticación', 'Permisos', 'Secretos']],
  ['devops', 'p2', 'DevOps e infraestructura', 'team', ['CI/CD', 'Alertas', 'Confiabilidad']],
  ['database', 'p2', 'Bases de datos', 'team', ['Esquema', 'Migraciones', 'Copias']],
  ['automation', 'p2', 'Automatización e integraciones', 'team', ['Servicios externos', 'Conectores']],
  ['techdocs', 'p2', 'Documentación técnica', 'team', ['Guías', 'Arquitectura', 'Procedimientos']],
  ['legal-intl', 'p3', 'Investigación jurídica internacional', 'team', ['Legislación por país', 'Fuentes oficiales']],
  ['legal-terms', 'p3', 'Términos y condiciones', 'team', ['Términos de uso']],
  ['privacy', 'p3', 'Privacidad y protección de datos', 'team', ['Políticas', 'Conservación', 'Derechos']],
  ['ip', 'p3', 'Propiedad intelectual', 'team', ['Derechos', 'Licencias', 'Marcas']],
  ['contracts', 'p3', 'Contratos', 'team', ['Proveedores', 'Colaboradores']],
  ['country-policy', 'p3', 'Políticas por país y riesgo legal', 'team', ['Mapa de riesgos', 'Prioridades']],
  ['compliance-apps', 'p3', 'Cumplimiento de apps y plataformas', 'team', ['Tiendas', 'Contenido de usuarios', 'Publicidad']],
  ['reg-alerts', 'p3', 'Alertas normativas', 'team', ['Cambios legales', 'Políticas de plataformas']],
  ['human-review', 'p3', 'Revisión humana pendiente', 'team', ['Documentos para profesionales', 'Cumplimiento editorial']],
  ['brand', 'p4', 'Estrategia de marca', 'team', ['Posicionamiento', 'Identidad', 'Calendario']],
  ['market-research', 'p4', 'Investigación de mercado', 'team', ['Públicos', 'Competidores', 'Tendencias']],
  ['production', 'p4', 'Estudio de producción', 'team', ['Guiones', 'Diseño gráfico', 'Edición audiovisual', 'Reels', 'Carruseles', 'Historias', 'Artículos', 'PDFs']],
  ['seo-aso', 'p4', 'SEO y ASO', 'team', ['Buscadores', 'Tiendas de apps']],
  ['pr', 'p4', 'Relaciones públicas', 'team', ['Prensa', 'Alianzas', 'Creadores']],
  ['ads', 'p4', 'Publicidad', 'team', ['Campañas pagas']],
  ['localization', 'p4', 'Localización', 'team', ['Adaptación por país']],
  ['growth-analytics', 'p4', 'Analítica de crecimiento', 'team', ['Embudo', 'Retención', 'Atribución']],
  ['instagram', 'p5', 'Instagram', 'social', ['Publicaciones', 'Comentarios', 'Mensajes']],
  ['tiktok', 'p5', 'TikTok', 'social', ['Publicaciones', 'Comentarios', 'Mensajes']],
  ['youtube', 'p5', 'YouTube', 'social', ['Publicaciones', 'Comentarios']],
  ['facebook', 'p5', 'Facebook', 'social', ['Publicaciones', 'Comentarios', 'Mensajes']],
  ['linkedin', 'p5', 'LinkedIn', 'social', ['Publicaciones']],
  ['social-mgmt', 'p5', 'Gerencia de redes sociales', 'team', ['Comparación de las cuatro redes', 'Propuestas por red', 'Informe a la Dirección de marketing y publicidad']],
  ['community', 'p5', 'Comunidad y moderación', 'team', ['Respuestas preparadas', 'Incidencias', 'Moderación']],
  ['product', 'p6', 'Estrategia de producto', 'team', ['Hoja de ruta', 'Mejoras de juego']],
  ['editorial', 'p6', 'Banco de acertijos', 'team', ['Creación', 'Validación', 'Explicaciones', 'Idiomas', 'Dificultades', 'Duplicados', 'Pendientes de aprobación', 'Reportes de errores']],
];
const AGENT_ZONE = {
  operaciones: 'direction', planificacion: 'direction', proyectos: 'direction', finanzas: 'direction', documentacion: 'direction',
  mercado: 'market-research', usuarios: 'uxr', producto: 'product', accesibilidad: 'uxr',
  cto: 'arch', 'auditoria-codigo': 'arch', backend: 'backend', frontend: 'frontend', funcionalidades: 'frontend', rendimiento: 'frontend',
  movil: 'mobile', 'base-datos': 'database', 'direccion-diseno': 'uxui', 'ux-interfaces': 'uxui', 'sistema-diseno': 'uxui', prototipado: 'uxui',
  'ux-investigacion': 'uxr', integraciones: 'automation', automatizacion: 'devops', devops: 'devops',
  'qa-funcional': 'qa', pruebas: 'qa', 'qa-visual': 'qa', seguridad: 'security', 'doc-tecnica': 'techdocs',
  'legal-direccion': 'country-policy', 'legal-paises': 'legal-intl', 'legal-terminos': 'legal-terms', privacidad: 'privacy',
  'propiedad-intelectual': 'ip', 'legal-ugc': 'compliance-apps', 'legal-marketing': 'compliance-apps', 'legal-apps': 'compliance-apps',
  contratos: 'contracts', regulatorio: 'reg-alerts', 'cumplimiento-editorial': 'human-review',
  editorial: 'editorial', 'marketing-direccion': 'brand', crecimiento: 'seo-aso', 'produccion-contenido': 'production', localizacion: 'localization',
  analitica: 'growth-analytics', publicidad: 'ads', alianzas: 'pr', comunidad: 'community', moderacion: 'community',
  'redes-instagram': 'instagram', 'redes-facebook': 'facebook', 'redes-tiktok': 'tiktok', 'redes-youtube': 'youtube', 'gerente-redes': 'social-mgmt',
  'estrategia-comercial': 'commercial',
};
// Dependencias y código relacionado (se cargan solo si el agente no tiene datos propios).
const AGENT_LINKS = {
  editorial: [['base-datos', 'integration:turso', 'integration:github-actions'], ['scripts/bank.js', 'src/services/bank.js', '.github/workflows/bank.yml']],
  pruebas: [['integration:github-actions'], ['.github/workflows/ci.yml', 'test/']],
  'qa-visual': [['integration:github-actions'], ['test/e2e/browser.test.js']],
  devops: [['integration:vercel-cron', 'integration:github-actions'], ['src/services/alerts.js', 'src/services/jobs.js', '.github/workflows/hq.yml']],
  operaciones: [['integration:github-actions', 'analitica', 'devops'], ['src/services/hq-reports.js']],
  analitica: [['base-datos'], ['src/services/analytics.js']],
  privacidad: [['base-datos'], ['src/services/jobs.js']],
  frontend: [['backend'], ['public/js/app.js', 'public/css/app.css']],
  backend: [['base-datos'], ['src/routes/', 'src/services/']],
  'base-datos': [['integration:turso'], ['src/db/migrations/']],
  seguridad: [['backend'], ['src/services/security.js', 'src/services/auth.js']],
  'produccion-contenido': [['marketing-direccion'], ['scripts/social/', 'data/social/plan.json']],
  'marketing-direccion': [['integration:metricool'], ['src/services/social.js']],
  automatizacion: [['integration:vercel', 'integration:github-actions'], ['.github/workflows/', 'vercel.json']],
  ...Object.fromEntries(['instagram', 'facebook', 'tiktok', 'youtube'].map((n) => ['redes-' + n, [['integration:metricool', 'analitica'], ['src/services/growth.js', '.github/workflows/hq.yml']]])),
  'gerente-redes': [['redes-instagram', 'redes-facebook', 'redes-tiktok', 'redes-youtube'], ['src/services/growth.js']],
  'estrategia-comercial': [['analitica', 'mercado', 'finanzas'], ['src/services/growth.js', 'src/services/commercial-market.js']],
};
// Cadena de mando de crecimiento: cada red informa a su gerente, y el gerente a la dirección.
const SUPERVISORS = {
  'redes-instagram': 'Gerencia de redes sociales', 'redes-facebook': 'Gerencia de redes sociales', 'redes-tiktok': 'Gerencia de redes sociales', 'redes-youtube': 'Gerencia de redes sociales',
  'gerente-redes': 'Dirección de marketing y publicidad', publicidad: 'Dirección de marketing y publicidad', comunidad: 'Dirección de marketing y publicidad',
  'produccion-contenido': 'Dirección de marketing y publicidad', crecimiento: 'Dirección de marketing y publicidad', alianzas: 'Dirección de marketing y publicidad',
};

const PLATFORMS = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', linkedin: 'LinkedIn' };
const STATES = {
  working: 'Trabajando', analyzing: 'Analizando', review: 'Esperando revisión', blocked: 'Bloqueado', error: 'Con error',
  waiting: 'En espera', idle: 'Inactivo', paused: 'Pausado', offline: 'Desconectado',
};
const RESEARCH_STAGES = ['research', 'analysis', 'investigación', 'investigacion', 'análisis', 'analisis'];
const STAGES = { research: 'Investigación', analysis: 'Análisis', implementation: 'Implementación', testing: 'Pruebas', review: 'Revisión', delivery: 'Entrega' };

async function seedHq(db) {
  for (const [id, [deps, code]] of Object.entries(AGENT_LINKS)) {
    await db.run("UPDATE agents SET depends_on = ? WHERE id = ? AND depends_on = '[]'", [JSON.stringify(deps), id]);
    await db.run("UPDATE agents SET code_paths = ? WHERE id = ? AND code_paths = '[]'", [JSON.stringify(code), id]);
  }
  // El informe ejecutivo lo genera una tarea programada real: es el proceso de «Operaciones ejecutivas».
  await db.run("UPDATE agents SET runtime = 'job:exec_report' WHERE id = 'operaciones' AND runtime = 'on_demand'");
  // La dirección de marketing también conduce la publicidad (22/10/2026).
  await db.run("UPDATE agents SET name = 'Dirección de marketing y publicidad', mission = 'Marca, propuesta de valor, publicidad y estrategia por plataforma; recibe el informe de la Gerencia de redes.' WHERE id = 'marketing-direccion' AND name = 'Dirección de marketing y marca'");
  for (const [id, sup] of Object.entries(SUPERVISORS)) await db.run("UPDATE agents SET supervisor = ? WHERE id = ? AND supervisor = 'Los dos CEO'", [sup, id]);
}

// ── Registro de ejecuciones y eventos ──
async function recordEvent(db, e) {
  if (!e.agentId || !e.kind || !e.message) throw new HttpError(400, 'invalid_event');
  const progress = e.progress != null && e.progressBasis ? Math.max(0, Math.min(1, Number(e.progress))) : null;
  const r = await db.run(`INSERT INTO agent_events(agent_id, run_id, task_id, kind, stage, message, progress, progress_basis, data, cost_amount, cost_currency, source, actor_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [e.agentId, e.runId || null, e.taskId || null, e.kind, e.stage || null, String(e.message).slice(0, 500),
    progress, progress != null ? String(e.progressBasis).slice(0, 120) : null, e.data ? JSON.stringify(e.data) : null,
    e.costAmount ?? null, e.costAmount != null ? (e.costCurrency || 'USD') : null, e.source || 'system', e.actorId || null, e.at || now()]);
  return Number(r.lastInsertRowid);
}

async function startRun(db, { agentId, taskId, stage, summary, source = 'system', startedAt }) {
  const at = startedAt || now();
  const r = await db.run(`INSERT INTO agent_runs(agent_id, task_id, started_at, status, summary, stage, heartbeat_at, source)
    VALUES (?,?,?,'running',?,?,?,?)`, [agentId, taskId || null, at, summary || null, stage || null, at, source]);
  const runId = Number(r.lastInsertRowid);
  await recordEvent(db, { agentId, runId, taskId, kind: 'started', stage, message: summary || 'Comenzó una ejecución', source, at });
  return runId;
}

async function heartbeat(db, runId, { stage, message } = {}) {
  const run = await db.get('SELECT agent_id, task_id, stage FROM agent_runs WHERE id = ?', [runId]);
  if (!run) return;
  await db.run("UPDATE agent_runs SET heartbeat_at = ?, stage = COALESCE(?, stage) WHERE id = ? AND status = 'running'", [now(), stage || null, runId]);
  if (stage && stage !== run.stage) await recordEvent(db, { agentId: run.agent_id, runId, taskId: run.task_id, kind: 'stage', stage, message: message || ('Etapa: ' + (STAGES[stage] || stage)) });
}

async function finishRun(db, runId, { status, summary, evidence, error, costAmount, source = 'system' }) {
  const run = await db.get('SELECT * FROM agent_runs WHERE id = ?', [runId]);
  if (!run) return;
  await db.run(`UPDATE agent_runs SET status = ?, finished_at = ?, summary = COALESCE(?, summary), evidence = COALESCE(?, evidence), error = ?,
    cost_amount = COALESCE(?, cost_amount), cost_currency = CASE WHEN ? IS NOT NULL THEN 'USD' ELSE cost_currency END WHERE id = ?`,
  [status, now(), summary || null, evidence || null, error || null, costAmount ?? null, costAmount ?? null, runId]);
  if (status === 'error') await recordEvent(db, { agentId: run.agent_id, runId, taskId: run.task_id, kind: 'error', message: String(error || 'La ejecución falló').slice(0, 500), source });
  else if (status === 'cancelled') await recordEvent(db, { agentId: run.agent_id, runId, taskId: run.task_id, kind: 'finished', message: 'Ejecución cancelada' + (error ? ': ' + error : ''), source });
  else await recordEvent(db, { agentId: run.agent_id, runId, taskId: run.task_id, kind: 'finished', message: summary || 'Ejecución terminada', data: evidence ? { evidence } : null, costAmount, source });
}

// Ejecución ya terminada (por ejemplo, un commit o una corrida de CI que se registra al final).
async function recordCompletedRun(db, { agentId, taskId, status, summary, evidence, error, startedAt, finishedAt, stage, source, files, tests, costAmount }) {
  const agent = await db.get('SELECT id FROM agents WHERE id = ?', [agentId]);
  if (!agent) throw new HttpError(404, 'unknown_agent');
  if (!['ok', 'error', 'cancelled'].includes(status)) throw new HttpError(400, 'invalid_status');
  const r = await db.run(`INSERT INTO agent_runs(agent_id, task_id, started_at, finished_at, status, summary, evidence, error, stage, source, cost_amount, cost_currency)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [agentId, taskId || null, startedAt || now(), finishedAt || now(), status, summary || null, evidence || null,
    error || null, stage || null, source || 'cli', costAmount ?? null, costAmount != null ? 'USD' : null]);
  const runId = Number(r.lastInsertRowid);
  await recordEvent(db, { agentId, runId, taskId, kind: 'started', stage, message: summary || 'Ejecución registrada', source, at: startedAt || now() });
  for (const f of (files || []).slice(0, 40)) await recordEvent(db, { agentId, runId, taskId, kind: 'file', message: String(f).slice(0, 300), source, at: finishedAt });
  if (tests) await recordEvent(db, { agentId, runId, taskId, kind: 'test', message: tests.message || 'Pruebas', data: tests, source, at: finishedAt });
  await recordEvent(db, { agentId, runId, taskId, kind: status === 'error' ? 'error' : 'finished', message: status === 'error' ? String(error || summary || 'Falló') : (summary || 'Terminada'),
    data: evidence ? { evidence } : null, costAmount, source, at: finishedAt });
  return runId;
}

// ── Estado real de cada agente ──
async function context(db) {
  const t = Date.now();
  const staleMin = await getSetting(db, 'hq.stale_minutes');
  const [agents, lastRuns, running, tasks, approvals, jobs, events48] = await Promise.all([
    db.all('SELECT * FROM agents ORDER BY number'),
    db.all(`SELECT r.* FROM agent_runs r JOIN (SELECT agent_id, MAX(id) AS id FROM agent_runs WHERE status <> 'running' GROUP BY agent_id) m ON m.id = r.id`),
    db.all("SELECT * FROM agent_runs WHERE status = 'running' ORDER BY id DESC"),
    db.all("SELECT id, title, agent_id, status, blocked_reason, priority, due_at, category, approval_id, updated_at FROM ops_tasks WHERE status NOT IN ('done','cancelled') AND agent_id IS NOT NULL"),
    db.all(`SELECT a.id, a.title, a.status, a.target_id, a.requested_by, a.requested_by_kind, a.created_at, t.agent_id FROM approval_items a
      LEFT JOIN ops_tasks t ON a.target_kind = 'ops_task' AND t.id = a.target_id WHERE a.status IN ('pending','conflict')`),
    db.all('SELECT * FROM jobs'),
    db.all('SELECT agent_id, COUNT(*) AS n, MAX(created_at) AS last FROM agent_events WHERE created_at >= ? GROUP BY agent_id', [iso(t - 2 * DAY)]),
  ]);
  return { t, staleMin, agents, lastRuns, running, tasks, approvals, jobs, events48 };
}

function deriveState(a, ctx) {
  const lastRun = ctx.lastRuns.find((r) => r.agent_id === a.id) || null;
  const run = ctx.running.find((r) => r.agent_id === a.id) || null;
  const tasks = ctx.tasks.filter((x) => x.agent_id === a.id);
  const approvals = ctx.approvals.filter((x) => x.agent_id === a.id || (x.requested_by_kind === 'agent' && x.requested_by === a.id));
  const job = a.runtime.startsWith('job:') ? ctx.jobs.find((j) => j.name === a.runtime.slice(4)) : null;
  const ev = ctx.events48.find((x) => x.agent_id === a.id);
  const times = [lastRun && (lastRun.finished_at || lastRun.started_at), run && (run.heartbeat_at || run.started_at), job && job.last_run_at, ev && ev.last].filter(Boolean).sort();
  const verified = times.length ? times[times.length - 1] : null;
  const out = { state: 'idle', reason: '', verified_at: verified, current_run: null, paused: !!a.paused_at, stale: false };
  const blocked = tasks.filter((x) => x.status === 'blocked');
  const review = tasks.filter((x) => x.status === 'in_review');
  const open = tasks.filter((x) => ['pending', 'in_progress', 'approved'].includes(x.status));

  if (run) {
    const beat = Date.parse(run.heartbeat_at || run.started_at);
    if (ctx.t - beat > ctx.staleMin * MIN) {
      out.state = 'offline'; out.stale = true;
      out.reason = `Hay una ejecución abierta sin señal desde ${run.heartbeat_at || run.started_at}: no se puede verificar si sigue trabajando.`;
    } else {
      out.state = RESEARCH_STAGES.includes(String(run.stage || '').toLowerCase()) ? 'analyzing' : 'working';
      out.reason = (run.summary || 'Ejecución en curso') + (run.stage ? ` · etapa: ${STAGES[run.stage] || run.stage}` : '');
    }
    out.current_run = { id: run.id, started_at: run.started_at, stage: run.stage, summary: run.summary, heartbeat_at: run.heartbeat_at, task_id: run.task_id, source: run.source };
    return out;
  }
  if (a.paused_at) { out.state = 'paused'; out.reason = 'Asignaciones pausadas' + (a.pause_reason ? ': ' + a.pause_reason : ''); return out; }
  if (!a.enabled) { out.state = 'paused'; out.reason = 'Agente desactivado'; return out; }
  if (job && !job.enabled) { out.state = 'paused'; out.reason = `La tarea programada «${job.name}» está desactivada`; return out; }
  if (lastRun && lastRun.status === 'error') { out.state = 'error'; out.reason = 'La última ejecución falló: ' + String(lastRun.error || lastRun.summary || 'sin detalle').slice(0, 200); return out; }
  if (blocked.length) { out.state = 'blocked'; out.reason = blocked.map((x) => `${x.id}: ${x.blocked_reason || 'sin motivo cargado'}`).join(' · ').slice(0, 300); return out; }
  if (review.length || approvals.length) {
    out.state = 'review';
    out.reason = `${review.length + approvals.length} entregable(s) esperan aprobación` + (approvals[0] ? `: ${approvals[0].title}` : review[0] ? `: ${review[0].title}` : '');
    return out;
  }
  // Una tarea programada que el planificador dejó de ejecutar no se puede dar por disponible.
  if (job) {
    const limit = Math.max(job.interval_minutes * 3 * MIN, 26 * HOUR);
    if (!job.last_run_at || ctx.t - Date.parse(job.last_run_at) > limit) {
      out.state = 'offline'; out.stale = true;
      out.reason = job.last_run_at ? `La tarea «${job.name}» no corre desde ${job.last_run_at} (debería cada ${fmtMinutes(job.interval_minutes)}).`
        : `La tarea «${job.name}» todavía no se ejecutó nunca.`;
      return out;
    }
  }
  if (open.length) { out.state = 'waiting'; out.reason = `${open.length} tarea(s) asignada(s) sin ejecución en curso`; return out; }
  if (a.runtime === 'none') { out.state = 'offline'; out.reason = 'No existe un proceso que ejecute a este agente: no se puede verificar disponibilidad.'; return out; }
  if (a.runtime === 'workflow:ci.yml' && !lastRun) { out.state = 'offline'; out.reason = 'Todavía no hay corridas de «Pruebas» registradas en la base.'; return out; }
  out.state = 'idle';
  out.reason = a.runtime === 'on_demand' ? 'Sin trabajo en curso (trabaja cuando un CEO lo pide)' : job ? `Esperando la próxima ejecución programada (${job.next_run_at})` : 'Sin trabajo en curso';
  return out;
}
const fmtMinutes = (m) => (m >= 1440 ? `${Math.round(m / 1440)} día(s)` : m >= 60 ? `${Math.round(m / 60)} h` : `${m} min`);

function agentCard(a, ctx) {
  const s = deriveState(a, ctx);
  const tasks = ctx.tasks.filter((x) => x.agent_id === a.id);
  return { id: a.id, number: a.number, name: a.name, department: a.department, role_title: a.role_title || ('Agente de ' + a.name.toLowerCase()), zone: AGENT_ZONE[a.id] || 'direction',
    runtime: a.runtime, ...s, state_label: STATES[s.state], open_tasks: tasks.length, blocked_tasks: tasks.filter((x) => x.status === 'blocked').length,
    urgent: tasks.some((x) => x.priority <= 1 || x.category === 'critical') || s.state === 'error' || s.state === 'blocked' };
}

// ── Vista general: lo que dibuja la oficina ──
async function snapshot(db, { config } = {}) {
  const ctx = await context(db);
  const agents = ctx.agents.map((a) => agentCard(a, ctx));
  const by = (k) => agents.filter((a) => a.state === k).length;
  const t = ctx.t;
  const count = async (sql, args = []) => (await db.get(sql, args)).n;
  const [alerts, ceos, pendingApprovals, events48, runs48, nextReport, lastReport, decisions, risks] = await Promise.all([
    db.all("SELECT id, kind, severity, title, details, last_seen_at, occurrences FROM alerts WHERE status = 'open' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC LIMIT 30"),
    ceoOffices(db),
    db.all("SELECT id, kind, area, title, status, created_at FROM approval_items WHERE status IN ('pending','conflict') ORDER BY created_at LIMIT 50"),
    count('SELECT COUNT(*) AS n FROM agent_events WHERE created_at >= ?', [iso(t - 2 * DAY)]),
    db.get("SELECT COUNT(*) AS n, SUM(status = 'ok') AS ok, SUM(status = 'error') AS err FROM agent_runs WHERE started_at >= ?", [iso(t - 2 * DAY)]),
    require('./hq-reports').nextRun(db),
    db.get("SELECT id, period_start, period_end, generated_at, trigger FROM exec_reports WHERE status = 'ready' ORDER BY period_end DESC LIMIT 1"),
    db.all("SELECT id, title, status FROM ops_tasks WHERE category = 'human_decision' AND status NOT IN ('done','cancelled') ORDER BY priority, id"),
    db.all("SELECT id, title, severity, area FROM risks WHERE status <> 'closed' AND severity IN ('critical','high') ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, id"),
  ]);
  const social = {};
  for (const r of await db.all('SELECT lower(platform) AS platform, status, COUNT(*) AS n FROM content_pieces GROUP BY lower(platform), status')) {
    for (const p of Object.keys(PLATFORMS)) if (String(r.platform).includes(p)) { social[p] = social[p] || {}; social[p][r.status] = (social[p][r.status] || 0) + r.n; }
  }
  const jobs = ctx.jobs.map((j) => {
    const stale = !j.last_run_at || ctx.t - Date.parse(j.last_run_at) > Math.max(j.interval_minutes * 3 * MIN, 26 * HOUR);
    const state = !j.enabled ? 'disabled' : j.last_status === 'failed' ? 'failed' : stale ? 'stale' : 'ok';
    return { name: j.name, state, label: { disabled: 'desactivada', failed: 'falló', stale: j.last_run_at ? 'atrasada' : 'nunca corrió', ok: 'al día' }[state] };
  });
  const zoneAlerts = {};
  for (const a of agents) if (a.urgent) zoneAlerts[a.zone] = (zoneAlerts[a.zone] || 0) + 1;
  return {
    generated_at: iso(t),
    version: { commit: (config && config.commit) || null },
    floors: FLOORS.map(([id, name, desc]) => ({ id, name, desc })),
    zones: ZONES.map(([id, floor, name, kind, topics]) => ({ id, floor, name, kind, topics, agents: agents.filter((a) => a.zone === id).map((a) => a.id), urgent: zoneAlerts[id] || 0 })),
    states: STATES,
    agents,
    totals: { agents: agents.length, working: by('working') + by('analyzing'), review: by('review'), blocked: by('blocked'), error: by('error'), waiting: by('waiting'),
      idle: by('idle'), paused: by('paused'), offline: by('offline'),
      open_tasks: ctx.tasks.length, pending_approvals: pendingApprovals.length, open_alerts: alerts.length, critical_alerts: alerts.filter((x) => x.severity === 'critical').length,
      events_48h: events48, runs_48h: runs48.n || 0, runs_ok_48h: runs48.ok || 0, runs_error_48h: runs48.err || 0 },
    alerts: alerts.map((x) => ({ ...x, details: parseJson(x.details, {}) })),
    approvals: pendingApprovals,
    decisions, risks,
    ceos,
    reports: { next: nextReport, last: lastReport },
    jobs, social,
  };
}

async function ceoOffices(db) {
  const owners = await db.all("SELECT id, username, display_name, title, last_login_at, disabled FROM users WHERE role = 'owner' AND deleted_at IS NULL ORDER BY created_at");
  const invite = await db.get("SELECT display_name, expires_at FROM staff_tokens WHERE kind = 'invite' AND role = 'owner' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1", [now()]);
  const find = (re) => owners.find((o) => re.test(`${o.display_name || ''} ${o.username}`));
  const juan = find(/juan/i); const ines = find(/in[eé]s/i);
  const rest = owners.filter((o) => o !== juan && o !== ines);
  const office = (zone, name, u) => ({ zone, name, account: u ? { username: u.username, display_name: u.display_name, title: u.title, last_login_at: u.last_login_at, disabled: !!u.disabled }
    : null, status: u ? (u.disabled ? 'Cuenta desactivada' : 'Cuenta activa') : (invite ? 'Invitación enviada, sin aceptar' : 'Sin cuenta en el sistema') });
  return [office('ceo-juan', 'Juan Ignacio Elías', juan || rest.shift()), office('ceo-ines', 'Inés de Gregorio', ines || rest.shift())];
}

// ── Eventos (panel de actividad) ──
async function listEvents(db, { since, agentId, limit = 80, before } = {}) {
  const where = []; const args = [];
  if (since) { where.push('e.id > ?'); args.push(Number(since)); }
  if (before) { where.push('e.id < ?'); args.push(Number(before)); }
  if (agentId) { where.push('e.agent_id = ?'); args.push(agentId); }
  const rows = await db.all(`SELECT e.*, a.name AS agent_name, u.username AS actor_username FROM agent_events e JOIN agents a ON a.id = e.agent_id
    LEFT JOIN users u ON u.id = e.actor_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.id DESC LIMIT ?`, [...args, Math.min(200, Number(limit) || 80)]);
  return rows.map((r) => ({ ...r, data: parseJson(r.data, null) }));
}

// ── Desempeño ──
// Cada indicador tiene definición y período. Los bloqueos por permisos, terceros o
// decisiones de los CEO se clasifican aparte y no cuentan en contra del agente.
const INDICATORS = {
  runs: 'Ejecuciones registradas que terminaron en el período (correctas, con error o canceladas).',
  success_rate: 'Ejecuciones correctas ÷ (correctas + con error). Se informa con 3 o más ejecuciones.',
  tasks_done: 'Tareas marcadas como completadas en el período (siempre con evidencia: la base lo exige).',
  first_pass: 'Entregables aprobados en su primera versión ÷ entregables decididos. Mide cumplimiento de criterios.',
  rework: 'Entregables a los que un CEO pidió cambios o rechazó en el período.',
  regressions: 'Veces que una ejecución falló inmediatamente después de una correcta.',
  median_minutes: 'Mediana de la duración de las ejecuciones terminadas, en minutos.',
  cost: 'Costo registrado en ejecuciones y eventos del período (solo valores cargados, nunca estimados).',
  permission_denials: 'Acciones del agente rechazadas por falta de permiso (registro de auditoría).',
  impact: 'Tareas completadas de categoría crítica, importante o de crecimiento.',
  documentation: 'Ejecuciones terminadas con resumen y evidencia ÷ ejecuciones terminadas.',
  external_blocks: 'Tareas bloqueadas por permisos, terceros o decisiones de los CEO: se informan y no penalizan.',
};

function blockCause(reason) {
  const r = String(reason || '').toLowerCase();
  if (/ceo|decisi|aprob|juan|inés|ines/.test(r)) return 'ceo_decision';
  if (/acceso|permiso|cuenta|credencial|token|clave/.test(r)) return 'permissions';
  if (/proveedor|pago|vercel|metricool|tienda|apple|google|abogad|contrat|plan /.test(r)) return 'third_party';
  return 'other';
}
const CAUSE_LABELS = { ceo_decision: 'Decisión de los CEO', permissions: 'Permisos o accesos', third_party: 'Terceros o proveedores', other: 'Otra causa' };

async function evaluate(db, agentId, { days = 30, at = Date.now() } = {}) {
  const from = iso(at - days * DAY); const to = iso(at);
  const runs = await db.all("SELECT id, status, started_at, finished_at, summary, evidence, error, cost_amount FROM agent_runs WHERE agent_id = ? AND status <> 'running' AND COALESCE(finished_at, started_at) >= ? AND COALESCE(finished_at, started_at) <= ? ORDER BY id", [agentId, from, to]);
  const ok = runs.filter((r) => r.status === 'ok').length; const err = runs.filter((r) => r.status === 'error').length;
  let regressions = 0;
  for (let i = 1; i < runs.length; i++) if (runs[i].status === 'error' && runs[i - 1].status === 'ok') regressions++;
  const durations = runs.filter((r) => r.finished_at).map((r) => (Date.parse(r.finished_at) - Date.parse(r.started_at)) / MIN).filter((x) => x >= 0).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : null;
  const tasksDone = await db.all("SELECT id, category FROM ops_tasks WHERE agent_id = ? AND status = 'done' AND done_at >= ? AND done_at <= ?", [agentId, from, to]);
  const decided = await db.all(`SELECT a.id, a.status, a.version,
      (SELECT MIN(v.version) FROM approval_votes v WHERE v.item_id = a.id AND v.decision = 'approve') AS approved_version,
      (SELECT COUNT(*) FROM approval_votes v WHERE v.item_id = a.id AND v.decision <> 'approve' AND v.created_at >= ? AND v.created_at <= ?) AS pushback
    FROM approval_items a LEFT JOIN ops_tasks t ON a.target_kind = 'ops_task' AND t.id = a.target_id
    WHERE (t.agent_id = ? OR (a.requested_by_kind = 'agent' AND a.requested_by = ?)) AND a.updated_at >= ?`, [from, to, agentId, agentId, from]);
  const decidedN = decided.filter((d) => ['approved', 'executed', 'rejected', 'changes_requested'].includes(d.status) || d.approved_version);
  const firstPass = decidedN.filter((d) => d.approved_version === 1).length;
  const evCost = await db.get('SELECT COALESCE(SUM(cost_amount), 0) AS c FROM agent_events WHERE agent_id = ? AND run_id IS NULL AND created_at >= ? AND created_at <= ?', [agentId, from, to]);
  const cost = runs.reduce((s, r) => s + (r.cost_amount || 0), 0) + (evCost.c || 0);
  const denials = (await db.get("SELECT COUNT(*) AS n FROM audit_log WHERE actor_kind = 'agent' AND actor_label = ? AND outcome = 'blocked' AND created_at >= ?", [agentId, from])).n;
  const blocked = await db.all("SELECT id, title, blocked_reason FROM ops_tasks WHERE agent_id = ? AND status = 'blocked'", [agentId]);
  const blocks = {};
  for (const b of blocked) { const c = blockCause(b.blocked_reason); (blocks[c] = blocks[c] || []).push(b.id); }
  const documented = runs.filter((r) => r.summary && r.evidence).length;
  const ind = {
    runs: { value: runs.length, ok, error: err, cancelled: runs.length - ok - err },
    success_rate: { value: ok + err >= 3 ? Math.round((ok / (ok + err)) * 1000) / 10 : null, sample: ok + err },
    tasks_done: { value: tasksDone.length },
    first_pass: { value: decidedN.length ? Math.round((firstPass / decidedN.length) * 1000) / 10 : null, sample: decidedN.length },
    rework: { value: decided.reduce((s, d) => s + (d.pushback || 0), 0) },
    regressions: { value: regressions },
    median_minutes: { value: median != null ? Math.round(median * 10) / 10 : null, sample: durations.length },
    cost: { value: Math.round(cost * 100) / 100, currency: 'USD' },
    permission_denials: { value: denials },
    impact: { value: tasksDone.filter((x) => ['critical', 'important', 'growth'].includes(x.category)).length },
    documentation: { value: runs.length ? Math.round((documented / runs.length) * 1000) / 10 : null, sample: runs.length },
    external_blocks: { value: blocked.length, by_cause: Object.fromEntries(Object.entries(blocks).map(([k, v]) => [CAUSE_LABELS[k], v])) },
  };
  for (const k of Object.keys(ind)) ind[k].definition = INDICATORS[k];
  // Calidad: solo con datos suficientes y sin contar los bloqueos ajenos al agente.
  let quality = { grade: 'insufficient', label: 'Sin datos suficientes', basis: 'Hace falta al menos 3 ejecuciones terminadas o 2 entregables decididos en el período.' };
  const sr = ind.success_rate.value; const fp = ind.first_pass.value;
  if (sr != null || (fp != null && decidedN.length >= 2)) {
    const problems = [];
    if (sr != null && sr < 70) problems.push(`éxito ${sr} %`);
    if (fp != null && decidedN.length >= 2 && fp < 50) problems.push(`aprobación a la primera ${fp} %`);
    if (regressions >= 2) problems.push(`${regressions} regresiones`);
    if (denials > 0) problems.push(`${denials} acciones sin permiso`);
    quality = problems.length >= 2 || (sr != null && sr < 50) ? { grade: 'poor', label: 'Con problemas', basis: problems.join(', ') }
      : problems.length ? { grade: 'watch', label: 'A observar', basis: problems.join(', ') }
        : { grade: 'good', label: 'Bien', basis: [sr != null ? `éxito ${sr} % (${ok + err} ejecuciones)` : null, fp != null ? `aprobación a la primera ${fp} %` : null].filter(Boolean).join(', ') };
  }
  return { period: { days, from, to, label: `Últimos ${days} días` }, indicators: ind, quality, pattern: await detectPattern(db, agentId, at) };
}

// Patrón de malos resultados: errores seguidos o tasa de éxito baja en 7 días.
async function detectPattern(db, agentId, at = Date.now()) {
  const streakMin = await getSetting(db, 'hq.agent_failure_streak');
  const recent = await db.all("SELECT id, status, error, started_at FROM agent_runs WHERE agent_id = ? AND status IN ('ok','error') ORDER BY id DESC LIMIT 20", [agentId]);
  let streak = 0; for (const r of recent) { if (r.status === 'error') streak++; else break; }
  const week = recent.filter((r) => Date.parse(r.started_at) >= at - 7 * DAY);
  const wErr = week.filter((r) => r.status === 'error');
  let pattern = null;
  if (streak >= streakMin) pattern = `${streak} ejecuciones seguidas con error`;
  else if (week.length >= 4 && wErr.length / week.length > 0.5) pattern = `${wErr.length} de ${week.length} ejecuciones con error en 7 días`;
  if (!pattern) return null;
  const errors = recent.filter((r) => r.status === 'error').slice(0, 10);
  const text = errors.map((r) => String(r.error || '')).join(' ').toLowerCase();
  const cause = /401|403|permiso|permission|unauthori|forbidden|token|credential/.test(text) ? 'permissions'
    : /timeout|fetch failed|econn|network|socket|503|502|rate limit|429/.test(text) ? 'third_party' : 'own';
  const proposals = {
    permissions: 'Revisar credenciales y permisos del proceso (variables de entorno o secretos de GitHub). No es una falla del agente.',
    third_party: 'Agregar reintentos con espera o revisar el estado del servicio externo. La causa es una dependencia, no el agente.',
    own: 'Revisar el último error, corregir el código o la configuración del proceso y volver a ejecutar con pruebas.',
  };
  return { pattern, cause, cause_label: { permissions: 'Permisos o credenciales', third_party: 'Dependencia externa', own: 'Falla propia del proceso' }[cause],
    penalizes: cause === 'own', evidence: errors.map((r) => ({ run: r.id, at: r.started_at, error: String(r.error || '').slice(0, 200) })), proposal: proposals[cause] };
}

// ── Ficha del agente ──
async function agentSheet(db, id) {
  const a = await db.get('SELECT * FROM agents WHERE id = ?', [id]);
  if (!a) throw new HttpError(404, 'not_found');
  const ctx = await context(db);
  const card = agentCard(a, ctx);
  const [tasks, runs, events, approvals, corrections, eval7, eval30] = await Promise.all([
    db.all("SELECT * FROM ops_tasks WHERE agent_id = ? ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'blocked' THEN 1 WHEN 'in_review' THEN 2 WHEN 'pending' THEN 3 ELSE 4 END, priority, id LIMIT 100", [id]),
    db.all('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY id DESC LIMIT 30', [id]),
    listEvents(db, { agentId: id, limit: 60 }),
    db.all(`SELECT a.id, a.kind, a.title, a.status, a.version, a.content_hash, a.created_at, a.target_id FROM approval_items a
      LEFT JOIN ops_tasks t ON a.target_kind = 'ops_task' AND t.id = a.target_id
      WHERE (t.agent_id = ? OR (a.requested_by_kind = 'agent' AND a.requested_by = ?)) ORDER BY a.created_at DESC LIMIT 30`, [id, id]),
    db.all('SELECT * FROM agent_corrections WHERE agent_id = ? ORDER BY created_at DESC LIMIT 10', [id]),
    evaluate(db, id, { days: 7 }), evaluate(db, id, { days: 30 }),
  ]);
  const job = a.runtime.startsWith('job:') ? await db.get('SELECT * FROM jobs WHERE name = ?', [a.runtime.slice(4)]) : null;
  const lastFinished = runs.find((r) => r.status !== 'running') || null;
  const nextTask = tasks.find((t) => ['pending', 'approved'].includes(t.status)) || null;
  const deps = parseJson(a.depends_on, []);
  const depAgents = deps.filter((d) => !d.startsWith('integration:'));
  const depInts = deps.filter((d) => d.startsWith('integration:')).map((d) => d.slice(12));
  const depRows = {
    agents: depAgents.length ? (await db.all(`SELECT * FROM agents WHERE id IN (${depAgents.map(() => '?').join(',')})`, depAgents)).map((x) => agentCard(x, ctx)) : [],
    integrations: depInts.length ? await db.all(`SELECT id, name, status, ceo_action FROM integrations WHERE id IN (${depInts.map(() => '?').join(',')})`, depInts) : [],
    tasks: [],
  };
  const taskDeps = [...new Set(tasks.flatMap((t) => parseJson(t.depends_on, [])))];
  if (taskDeps.length) depRows.tasks = await db.all(`SELECT id, title, status FROM ops_tasks WHERE id IN (${taskDeps.map(() => '?').join(',')})`, taskDeps);
  const paused = a.paused_by ? await db.get('SELECT username FROM users WHERE id = ?', [a.paused_by]) : null;
  return {
    ...card,
    mission: a.mission, objectives: parseJson(a.kpis, []), responsibilities: parseJson(a.responsibilities, []), tools: parseJson(a.tools, []), limits: parseJson(a.limits, []),
    autonomy_max: a.autonomy_max, supervisor: a.supervisor, code_paths: parseJson(a.code_paths, []),
    pause: a.paused_at ? { at: a.paused_at, by: paused && paused.username, reason: a.pause_reason } : null,
    job: job ? { name: job.name, enabled: !!job.enabled, interval_minutes: job.interval_minutes, next_run_at: job.next_run_at, last_run_at: job.last_run_at,
      last_status: job.last_status, consecutive_failures: job.consecutive_failures, leased: !!(job.lease_until && job.lease_until > now()) } : null,
    current_task: tasks.find((t) => t.status === 'in_progress') || (card.current_run && card.current_run.task_id ? tasks.find((t) => t.id === card.current_run.task_id) : null) || null,
    next_task: nextTask,
    last_result: lastFinished ? { status: lastFinished.status, summary: lastFinished.summary, evidence: lastFinished.evidence, error: lastFinished.error, at: lastFinished.finished_at || lastFinished.started_at } : null,
    elapsed_minutes: card.current_run ? Math.round((Date.now() - Date.parse(card.current_run.started_at)) / MIN) : null,
    tasks, runs, events, approvals, corrections: corrections.map((c) => ({ ...c, evidence: parseJson(c.evidence, []), baseline: parseJson(c.baseline, {}), result: parseJson(c.result, null) })),
    evaluation: { week: eval7, month: eval30 },
    recent_errors: runs.filter((r) => r.status === 'error').slice(0, 5).map((r) => ({ run: r.id, at: r.finished_at || r.started_at, error: r.error })),
    dependencies: depRows,
    files: [...new Set(runs.map((r) => r.evidence).filter(Boolean).concat(events.filter((e) => e.kind === 'file').map((e) => e.message)))].slice(0, 30),
    totals: { completed: tasks.filter((t) => t.status === 'done').length, failed: runs.filter((r) => r.status === 'error').length, blocked: tasks.filter((t) => t.status === 'blocked').length,
      cost: Math.round(runs.reduce((s, r) => s + (r.cost_amount || 0), 0) * 100) / 100 },
  };
}

// ── Acciones de los CEO ──
const ensureAgent = async (db, id) => {
  const a = await db.get('SELECT * FROM agents WHERE id = ?', [id]);
  if (!a) throw new HttpError(404, 'not_found');
  return a;
};

async function assignTask(db, agentId, b, actor) {
  const a = await ensureAgent(db, agentId);
  if (a.paused_at) throw new HttpError(409, 'agent_paused', 'Las asignaciones de este agente están pausadas. Reanudalas antes de asignarle trabajo.');
  const company = require('./company');
  const priority = Math.max(1, Math.min(5, Number(b.priority) || 3));
  const t = await company.saveTask(db, null, { title: b.title, objective: b.objective, expected: b.expected, area: b.area || 'direction', category: b.category || 'important',
    agent_id: agentId, due_at: b.due_at, approval_level: b.approval_level || 1, status: 'pending' }, actor);
  await db.run('UPDATE ops_tasks SET priority = ? WHERE id = ?', [priority, t.id]);
  await recordEvent(db, { agentId, taskId: t.id, kind: 'assigned', message: `Tarea asignada por ${actor.username}: ${t.title}`, source: 'ceo', actorId: actor.id });
  return db.get('SELECT * FROM ops_tasks WHERE id = ?', [t.id]);
}

async function setPriority(db, taskId, priority, actor) {
  const p = Number(priority);
  if (!(p >= 1 && p <= 5)) throw new HttpError(400, 'invalid_priority');
  const t = await db.get('SELECT * FROM ops_tasks WHERE id = ?', [taskId]);
  if (!t) throw new HttpError(404, 'not_found');
  await db.run('UPDATE ops_tasks SET priority = ?, updated_at = ? WHERE id = ?', [p, now(), taskId]);
  await audit(db, { actorId: actor.id, action: 'task.priority', targetKind: 'ops_task', targetId: taskId, details: { from: t.priority, to: p } });
  if (t.agent_id) await recordEvent(db, { agentId: t.agent_id, taskId, kind: 'note', message: `Prioridad de ${taskId}: ${t.priority} → ${p} (${actor.username})`, source: 'ceo', actorId: actor.id });
  return db.get('SELECT * FROM ops_tasks WHERE id = ?', [taskId]);
}

// Pausar detiene nuevas asignaciones. Una ejecución en curso no se corta: si es una
// tarea programada, se desactiva para la próxima vuelta y la actual termina sola.
async function pause(db, agentId, { reason, confirm }, actor) {
  const a = await ensureAgent(db, agentId);
  const running = await db.get("SELECT id, summary FROM agent_runs WHERE agent_id = ? AND status = 'running'", [agentId]);
  const job = a.runtime.startsWith('job:') ? await db.get('SELECT * FROM jobs WHERE name = ?', [a.runtime.slice(4)]) : null;
  const critical = running || (job && job.lease_until && job.lease_until > now());
  if (critical && confirm !== 'PAUSAR') {
    throw new HttpError(409, 'confirm_required', 'Este agente tiene una ejecución en curso. La pausa no la interrumpe: solo evita nuevas asignaciones y ejecuciones. Para confirmar escribí PAUSAR.',
      { running: running ? running.summary : job.name });
  }
  if (!String(reason || '').trim()) throw new HttpError(400, 'reason_required', 'Contá el motivo de la pausa.');
  await db.run('UPDATE agents SET paused_at = ?, paused_by = ?, pause_reason = ? WHERE id = ?', [now(), actor.id, String(reason).slice(0, 300), agentId]);
  if (job) await db.run('UPDATE jobs SET enabled = 0 WHERE name = ?', [job.name]);
  await audit(db, { actorId: actor.id, action: 'agent.pause', targetKind: 'agent', targetId: agentId, details: { reason, job: job && job.name, running: !!running } });
  await recordEvent(db, { agentId, kind: 'paused', message: `Asignaciones pausadas por ${actor.username}: ${reason}`, source: 'ceo', actorId: actor.id });
  return { ok: true, running_continues: !!critical };
}

async function resume(db, agentId, actor) {
  const a = await ensureAgent(db, agentId);
  await db.run('UPDATE agents SET paused_at = NULL, paused_by = NULL, pause_reason = NULL WHERE id = ?', [agentId]);
  if (a.runtime.startsWith('job:')) await db.run('UPDATE jobs SET enabled = 1 WHERE name = ?', [a.runtime.slice(4)]);
  await audit(db, { actorId: actor.id, action: 'agent.resume', targetKind: 'agent', targetId: agentId });
  await recordEvent(db, { agentId, kind: 'resumed', message: `Asignaciones reanudadas por ${actor.username}`, source: 'ceo', actorId: actor.id });
  return { ok: true };
}

// Reintentar: una tarea programada se vuelve a ejecutar ahora; cualquier otra
// ejecución fallida genera una tarea de reintento para el agente.
async function retry(db, agentId, { run_id: runId }, actor, ctx = {}) {
  const a = await ensureAgent(db, agentId);
  if (a.paused_at) throw new HttpError(409, 'agent_paused', 'El agente está pausado.');
  const run = runId ? await db.get('SELECT * FROM agent_runs WHERE id = ? AND agent_id = ?', [runId, agentId])
    : await db.get("SELECT * FROM agent_runs WHERE agent_id = ? AND status = 'error' ORDER BY id DESC LIMIT 1", [agentId]);
  if (!run || run.status !== 'error') throw new HttpError(409, 'nothing_to_retry', 'No hay una ejecución fallida para reintentar.');
  await audit(db, { actorId: actor.id, action: 'agent.retry', targetKind: 'agent', targetId: agentId, details: { run: run.id } });
  await recordEvent(db, { agentId, runId: run.id, kind: 'retry', message: `Reintento pedido por ${actor.username}`, source: 'ceo', actorId: actor.id });
  if (a.runtime.startsWith('job:')) {
    const out = await require('./jobs').runJob(db, a.runtime.slice(4), ctx);
    return { mode: 'job', result: out };
  }
  const t = await require('./company').saveTask(db, null, { title: `Reintentar: ${run.summary || 'ejecución ' + run.id}`.slice(0, 200), area: 'direction', category: 'important',
    agent_id: agentId, expected: 'Ejecución correcta con evidencia', input: `Falló la ejecución ${run.id}: ${String(run.error || '').slice(0, 300)}`, status: 'pending' }, actor);
  await db.run('UPDATE ops_tasks SET retry_of = ?, priority = 2 WHERE id = ?', [String(run.id), t.id]);
  return { mode: 'task', task: t.id };
}

// Informe del agente: se calcula de los registros en el momento y queda como evento.
async function agentReport(db, agentId, actor) {
  const s = await agentSheet(db, agentId);
  const m = s.evaluation.month.indicators;
  const lines = [
    `Estado: ${s.state_label}${s.reason ? ' — ' + s.reason : ''}.`,
    `Últimos 30 días: ${m.runs.value} ejecuciones (${m.runs.ok} correctas, ${m.runs.error} con error), ${m.tasks_done.value} tareas completadas.`,
    `Calidad: ${s.evaluation.month.quality.label}${s.evaluation.month.quality.basis ? ' (' + s.evaluation.month.quality.basis + ')' : ''}.`,
    `Tareas abiertas: ${s.open_tasks} (${s.blocked_tasks} bloqueadas).`,
    s.last_result ? `Último resultado: ${s.last_result.status} ${s.last_result.at} ${s.last_result.summary || ''}` : 'Sin ejecuciones registradas.',
  ];
  await recordEvent(db, { agentId, kind: 'report', message: `Informe pedido por ${actor.username}`, data: { lines }, source: 'ceo', actorId: actor.id });
  await audit(db, { actorId: actor.id, action: 'agent.report', targetKind: 'agent', targetId: agentId });
  return { generated_at: now(), lines, basis: 'Calculado a partir de agent_runs, agent_events, ops_tasks y approval_items.' };
}

async function proposeCorrection(db, agentId, actor) {
  await ensureAgent(db, agentId);
  const p = await detectPattern(db, agentId);
  if (!p) throw new HttpError(409, 'no_pattern', 'No hay un patrón de malos resultados con evidencia suficiente.');
  const open = await db.get("SELECT id FROM agent_corrections WHERE agent_id = ? AND status IN ('proposed','approved','applied')", [agentId]);
  if (open) throw new HttpError(409, 'correction_open', 'Ya hay una corrección abierta para este agente.');
  const baseline = (await evaluate(db, agentId, { days: 7 })).indicators;
  const id = uuid();
  const item = await gov.createRequest(db, { kind: 'decision', title: `Corrección del agente ${agentId}: ${p.pattern}`.slice(0, 200), summary: p.proposal,
    content: { agent: agentId, pattern: p.pattern, cause: p.cause, proposal: p.proposal, evidence: p.evidence }, targetKind: 'agent_correction', targetId: id }, actor);
  await db.run(`INSERT INTO agent_corrections(id, agent_id, pattern, evidence, cause, proposal, baseline, approval_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, agentId, p.pattern, JSON.stringify(p.evidence), p.cause, p.proposal, JSON.stringify({ success_rate: baseline.success_rate.value, runs: baseline.runs }), item.id, actor.id]);
  await recordEvent(db, { agentId, kind: 'approval_request', message: `Corrección propuesta: ${p.proposal}`, data: { correction: id, approval: item.id }, source: 'ceo', actorId: actor.id });
  return { id, approval_id: item.id };
}

// Un CEO marca la corrección como aplicada; después se mide si funcionó.
async function correctionApplied(db, id, actor) {
  const c = await db.get('SELECT * FROM agent_corrections WHERE id = ?', [id]);
  if (!c) throw new HttpError(404, 'not_found');
  const ap = await db.get("SELECT status FROM approval_items WHERE id = ?", [c.approval_id]);
  if (!ap || !['approved', 'executed'].includes(ap.status)) throw new HttpError(409, 'approval_required', 'La corrección necesita la aprobación de un CEO.');
  await db.run("UPDATE agent_corrections SET status = 'applied', applied_at = ? WHERE id = ?", [now(), id]);
  await audit(db, { actorId: actor.id, action: 'agent.correction_applied', targetKind: 'agent', targetId: c.agent_id, details: { correction: id } });
  return db.get('SELECT * FROM agent_corrections WHERE id = ?', [id]);
}

// Mide las correcciones aplicadas con al menos 3 ejecuciones posteriores.
async function measureCorrections(db) {
  const rows = await db.all("SELECT * FROM agent_corrections WHERE status = 'applied'");
  const out = [];
  for (const c of rows) {
    const after = await db.all("SELECT status FROM agent_runs WHERE agent_id = ? AND status IN ('ok','error') AND started_at >= ?", [c.agent_id, c.applied_at]);
    if (after.length < 3) continue;
    const rate = Math.round((after.filter((r) => r.status === 'ok').length / after.length) * 1000) / 10;
    const base = parseJson(c.baseline, {}).success_rate;
    const effective = rate >= 70 && (base == null || rate > base);
    await db.run('UPDATE agent_corrections SET status = ?, measured_at = ?, result = ? WHERE id = ?',
      [effective ? 'effective' : 'ineffective', now(), JSON.stringify({ success_rate_after: rate, runs_after: after.length, baseline: base }), c.id]);
    out.push({ id: c.id, effective });
  }
  // Aprobación rechazada: la corrección queda rechazada.
  await db.run(`UPDATE agent_corrections SET status = 'rejected' WHERE status = 'proposed' AND approval_id IN
    (SELECT id FROM approval_items WHERE status IN ('rejected','withdrawn'))`);
  await db.run(`UPDATE agent_corrections SET status = 'approved' WHERE status = 'proposed' AND approval_id IN
    (SELECT id FROM approval_items WHERE status IN ('approved','executed'))`);
  return out;
}

// ── Salas especiales ──
const SECRET_RE = /(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+|(?:libsql|https?):\/\/[^\s]*@[^\s]+|\b[A-Fa-f0-9]{32,}\b|\b(?:sk|pk|ghp|gho|xox[bp])[-_][\w-]{10,}|(?:token|secret|password|clave|authorization)["'=:\s]+[^\s,"']+)/gi;
const scrub = (s) => String(s == null ? '' : s).replace(SECRET_RE, '[oculto]');

async function servers(db, { config } = {}) {
  const t0 = Date.now();
  await db.get('SELECT 1 AS ok');
  const dbLatency = Date.now() - t0;
  const day = iso(Date.now() - DAY);
  const [jobs, errorsByScope, recentErrors, integrations, costs, tables, budget] = await Promise.all([
    db.all('SELECT name, interval_minutes, enabled, next_run_at, last_run_at, last_status, last_error, consecutive_failures FROM jobs ORDER BY name'),
    db.all('SELECT scope, COUNT(*) AS n FROM error_log WHERE created_at >= ? GROUP BY scope ORDER BY n DESC', [day]),
    db.all('SELECT scope, message, created_at FROM error_log ORDER BY id DESC LIMIT 15'),
    db.all('SELECT id, name, category, status, limitations, ceo_action, checked_at FROM integrations ORDER BY category, name'),
    db.all("SELECT kind, vendor, area, currency, SUM(amount) AS total, COUNT(*) AS n FROM costs GROUP BY kind, vendor, area, currency ORDER BY vendor"),
    db.get(`SELECT (SELECT COUNT(*) FROM clues) AS clues, (SELECT COUNT(*) FROM games) AS games, (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM agent_events) AS events, (SELECT COUNT(*) FROM audit_log) AS audit`),
    getSetting(db, 'hq.monthly_budget_usd'),
  ]);
  const mem = process.memoryUsage();
  return {
    measured_at: now(),
    backend: { status: 'respondiendo', commit: (config && config.commit) || null, node: process.version, note: 'Esta respuesta es la prueba de que la instancia actual funciona.' },
    database: { latency_ms: dbLatency, rows: tables },
    apis: { errors_24h: errorsByScope },
    errors: recentErrors.map((e) => ({ ...e, message: scrub(e.message).slice(0, 300) })),
    integrations: integrations.map((i) => ({ ...i, limitations: scrub(i.limitations) })),
    jobs: jobs.map((j) => ({ ...j, last_error: j.last_error ? scrub(j.last_error).slice(0, 200) : null,
      stale: !j.last_run_at || Date.now() - Date.parse(j.last_run_at) > Math.max(j.interval_minutes * 3 * MIN, 26 * HOUR) })),
    availability: { available: false, note: 'No disponible: no hay monitoreo externo de disponibilidad (tarea T-008).' },
    resources: { instance_memory_mb: Math.round(mem.rss / 1048576), note: 'Memoria de la instancia que respondió. Vercel no expone a la aplicación el consumo total.' },
    costs: { rows: costs, monthly_budget_usd: budget || null, note: budget ? null : 'Sin presupuesto mensual configurado (ajuste hq.monthly_budget_usd).' },
  };
}

async function socialRoom(db, platform) {
  if (!PLATFORMS[platform]) throw new HttpError(404, 'not_found');
  const like = '%' + platform + '%';
  const [counts, next, published, errors, integ] = await Promise.all([
    db.all('SELECT status, COUNT(*) AS n FROM content_pieces WHERE lower(platform) LIKE ? GROUP BY status', [like]),
    db.all("SELECT id, title, format, status, scheduled_at FROM content_pieces WHERE lower(platform) LIKE ? AND status IN ('approved','scheduled') ORDER BY scheduled_at LIMIT 10", [like]),
    db.all("SELECT id, title, published_url, published_at FROM content_pieces WHERE lower(platform) LIKE ? AND status = 'published' ORDER BY published_at DESC LIMIT 10", [like]),
    db.all("SELECT id, title, external_error, updated_at FROM content_pieces WHERE lower(platform) LIKE ? AND status = 'publish_error' ORDER BY updated_at DESC LIMIT 10", [like]),
    db.all("SELECT id, name, status, limitations FROM integrations WHERE lower(name) LIKE ? OR id = 'metricool'", [like]),
  ]);
  const c = Object.fromEntries(counts.map((r) => [r.status, r.n]));
  return {
    platform, name: PLATFORMS[platform], counts: c,
    scheduled: c.scheduled || 0, approved: c.approved || 0, pending_approval: c.pending_approval || 0, published: c.published || 0, incidents: c.publish_error || 0,
    next, published_items: published, errors: errors.map((e) => ({ ...e, external_error: scrub(e.external_error) })), integrations: integ,
    comments: { available: false, note: 'No disponible: no hay acceso a comentarios ni mensajes (el plan de Metricool no tiene API de bandeja).' },
    results: { available: true, note: 'Las métricas de la cuenta y las propuestas del agente de la red están en «Métricas y estrategia».' },
  };
}

async function productRoom(db) {
  const g = async (sql, args = []) => (await db.get(sql, args)).n;
  return {
    bank: await db.get("SELECT COALESCE(SUM(target), 0) AS target, (SELECT COUNT(*) FROM clues WHERE status = 'published') AS published FROM bank_targets"),
    by_status: await db.all('SELECT status, COUNT(*) AS n FROM clues GROUP BY status'),
    by_difficulty: await db.all("SELECT difficulty, COUNT(*) AS n FROM clues WHERE status = 'published' GROUP BY difficulty ORDER BY difficulty"),
    languages: await db.all('SELECT code, name_native, enabled FROM languages ORDER BY sort_order'),
    review_pending: await g("SELECT COUNT(*) AS n FROM clues WHERE status = 'review'"),
    audits_pending: await g("SELECT COUNT(*) AS n FROM clue_audits WHERE verdict = 'pending'"),
    duplicates_open: await g("SELECT COUNT(*) AS n FROM duplicate_flags WHERE resolved = 0"),
    reports_open: await g("SELECT COUNT(*) AS n FROM clue_reports WHERE status = 'open'"),
    submissions_pending: await g("SELECT COUNT(*) AS n FROM submissions WHERE status IN ('pending','in_review')"),
    games_7d: await g('SELECT COUNT(*) AS n FROM games WHERE started_at >= ?', [iso(Date.now() - 7 * DAY)]),
    last_batch: await db.get('SELECT language_code, difficulty, status, published, started_at, finished_at FROM generation_batches ORDER BY started_at DESC LIMIT 1'),
  };
}

async function legalRoom(db) {
  return {
    docs: await db.all(`SELECT d.id, d.name AS title, v.version, v.status, v.language FROM legal_documents d LEFT JOIN legal_document_versions v ON v.doc_id = d.id
      AND v.version = (SELECT MAX(version) FROM legal_document_versions WHERE doc_id = d.id) ORDER BY d.id`),
    jurisdictions: await db.all('SELECT code, name, status, risk, needs_lawyer, verified_at FROM legal_jurisdictions ORDER BY COALESCE(priority, 999), code'),
    risks: await db.all("SELECT id, title, severity, status, needs_lawyer FROM risks WHERE area = 'legal' AND status <> 'closed' ORDER BY id"),
    approvals: await gov.list(db, { area: 'legal', status: 'open' }),
  };
}

async function marketingRoom(db) {
  return {
    by_status: await db.all('SELECT status, COUNT(*) AS n FROM content_pieces GROUP BY status'),
    campaigns: await db.all(`SELECT COALESCE(campaign, 'Sin campaña') AS campaign, COUNT(*) AS n, SUM(status = 'published') AS published, SUM(status = 'scheduled') AS scheduled,
      SUM(status = 'pending_approval') AS pending, SUM(status IN ('production','editing','idea','research')) AS in_production FROM content_pieces GROUP BY campaign ORDER BY n DESC`),
    in_production: await db.all("SELECT id, title, platform, format, status FROM content_pieces WHERE status IN ('idea','research','production','editing','rights_review','changes_requested') ORDER BY updated_at DESC LIMIT 20"),
    approvals: await gov.list(db, { area: 'marketing', status: 'open' }),
  };
}

module.exports = { FLOORS, ZONES, AGENT_ZONE, STATES, STAGES, INDICATORS, seedHq, recordEvent, startRun, heartbeat, finishRun, recordCompletedRun,
  context, deriveState, snapshot, listEvents, evaluate, detectPattern, agentSheet, assignTask, setPriority, pause, resume, retry, agentReport,
  proposeCorrection, correctionApplied, measureCorrections, servers, socialRoom, productRoom, legalRoom, marketingRoom, scrub, blockCause, ceoOffices };
