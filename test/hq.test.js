'use strict';

// AI Company HQ: acceso solo de los CEO, estados derivados de registros reales,
// eventos inalterables, acciones con resguardos, evaluación sin castigar bloqueos
// ajenos, informe de 48 h sin duplicados, reintentos, alertas y entrega a ambos CEO.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client, staff } = require('./helpers');
const hq = require('../src/services/hq');
const reports = require('../src/services/hq-reports');
const { runJob } = require('../src/services/jobs');

let env; let juan; let ines;
test.before(async () => {
  env = await makeEnv({ catalog: false });
  juan = await staff(env, 'owner', 'juan_hq');
  ines = await staff(env, 'owner', 'ines_hq');
});
test.after(async () => { await env.close(); });
test.beforeEach(async () => { if (env) await env.db.run('DELETE FROM rate_limits'); });

const stateOf = async (id) => {
  const ctx = await hq.context(env.db);
  return hq.deriveState(ctx.agents.find((a) => a.id === id), ctx);
};

test('solo los CEO acceden: página y API protegidas, también por URL directa', async () => {
  const anon = client(env.base);
  const page = await anon.get('/hq');
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/admin#hq');
  assert.equal((await anon.get('/api/admin/hq/state')).status, 401);
  assert.notEqual((await anon.get('/hq.html')).status, 200, 'la página no se sirve como archivo estático');
  for (const role of ['editor', 'moderator', 'analyst']) {
    const s = await staff(env, role);
    assert.equal((await s.c.get('/hq')).status, 403, role);
    assert.equal((await s.c.get('/api/admin/hq/state')).status, 403, role);
    assert.equal((await s.c.get('/api/admin/hq/reports')).status, 403, role);
    assert.equal((await s.c.post('/api/admin/hq/reports', {})).status, 403, role);
    assert.equal((await s.c.post('/api/admin/hq/agents/frontend/pause', { reason: 'x' })).status, 403, role);
  }
  const player = await staff(env, 'player');
  assert.equal((await player.c.get('/hq')).status, 302);
  assert.equal((await player.c.get('/api/admin/hq/state')).status, 403);

  const ok = await juan.c.get('/hq');
  assert.equal(ok.status, 200);
  assert.match(ok.text, /AI Company HQ/);
  assert.equal(ok.headers.get('x-robots-tag'), 'noindex, nofollow');
  const logged = await env.db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'hq.open' AND actor_id = ?", [juan.user.id]);
  assert.equal(logged.n, 1, 'cada apertura queda en la auditoría');
});

test('los dos CEO ven lo mismo con los mismos permisos', async () => {
  const a = await juan.c.get('/api/admin/hq/state');
  const b = await ines.c.get('/api/admin/hq/state');
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(a.json.agents.map((x) => [x.id, x.state]), b.json.agents.map((x) => [x.id, x.state]));
  assert.equal(a.json.agents.length, 57);
  assert.equal(a.json.ceos.length, 2);
  assert.ok(a.json.zones.find((z) => z.id === 'ceo-juan') && a.json.zones.find((z) => z.id === 'ceo-ines'));
  // Cada agente está en una zona del plano.
  const zoneIds = new Set(a.json.zones.map((z) => z.id));
  for (const ag of a.json.agents) assert.ok(zoneIds.has(ag.zone), ag.id);
});

test('estados derivados de registros: sin registro no hay actividad', async () => {
  // Sin proceso y sin tareas: desconectado; a pedido sin trabajo: inactivo.
  assert.equal((await stateOf('regulatorio')).state, 'offline');
  assert.equal((await stateOf('mercado')).state, 'idle');
  // Trabajando solo con una ejecución abierta; investigación = analizando.
  const run = await hq.startRun(env.db, { agentId: 'mercado', summary: 'Competidores', stage: 'research', source: 'cli' });
  assert.equal((await stateOf('mercado')).state, 'analyzing');
  await hq.heartbeat(env.db, run, { stage: 'implementation' });
  const w = await stateOf('mercado');
  assert.equal(w.state, 'working');
  assert.equal(w.current_run.id, run);
  // Sin señal por más tiempo que el permitido: no se puede verificar.
  await env.db.run('UPDATE agent_runs SET heartbeat_at = ? WHERE id = ?', [new Date(Date.now() - 3 * 3600000).toISOString(), run]);
  assert.equal((await stateOf('mercado')).state, 'offline');
  // Termina con error: «con error» hasta que haya una correcta.
  await hq.finishRun(env.db, run, { status: 'error', error: 'falló la búsqueda' });
  const e = await stateOf('mercado');
  assert.equal(e.state, 'error');
  assert.match(e.reason, /falló la búsqueda/);
  await hq.recordCompletedRun(env.db, { agentId: 'mercado', status: 'ok', summary: 'Informe con fuentes', evidence: 'https://example.com/informe', source: 'cli' });
  assert.equal((await stateOf('mercado')).state, 'idle');
  // Tareas: pendiente = en espera; bloqueada = bloqueado; en revisión = esperando revisión.
  const t = await hq.assignTask(env.db, 'mercado', { title: 'Mapa de competidores', expected: 'Lista con fuentes' }, juan.user);
  assert.equal((await stateOf('mercado')).state, 'waiting');
  await env.db.run("UPDATE ops_tasks SET status = 'blocked', blocked_reason = 'Falta decisión de los CEO' WHERE id = ?", [t.id]);
  assert.equal((await stateOf('mercado')).state, 'blocked');
  await env.db.run("UPDATE ops_tasks SET status = 'pending', blocked_reason = NULL WHERE id = ?", [t.id]);
  await require('../src/services/company').requestTaskApproval(env.db, t.id, { kind: 'decision' }, juan.user);
  assert.equal((await stateOf('mercado')).state, 'review');
  // Pausado.
  await hq.pause(env.db, 'mercado', { reason: 'Revisión de prioridades' }, juan.user);
  assert.equal((await stateOf('mercado')).state, 'paused');
  await hq.resume(env.db, 'mercado', juan.user);
});

test('el registro de eventos es inalterable y el progreso solo se muestra si se midió', async () => {
  const id = await hq.recordEvent(env.db, { agentId: 'frontend', kind: 'progress', message: 'Lotes', progress: 0.3, progressBasis: '3 de 10 lotes' });
  await assert.rejects(env.db.run('UPDATE agent_events SET message = ? WHERE id = ?', ['otro', id]), /agent_events_immutable/);
  await assert.rejects(env.db.run('DELETE FROM agent_events WHERE id = ?', [id]), /agent_events_immutable/);
  const noBasis = await hq.recordEvent(env.db, { agentId: 'frontend', kind: 'progress', message: 'Sin medición', progress: 0.5 });
  const row = await env.db.get('SELECT progress FROM agent_events WHERE id = ?', [noBasis]);
  assert.equal(row.progress, null, 'un porcentaje sin base medida no se guarda');
  const feed = await juan.c.get('/api/admin/hq/events?agent=frontend');
  assert.ok(feed.json.items.some((e) => e.progress_basis === '3 de 10 lotes'));
  const since = await juan.c.get('/api/admin/hq/events?since=' + id);
  assert.ok(since.json.items.every((e) => e.id > id));
});

test('acciones: asignar, prioridad, pausa segura con ejecución en curso, reintento e informe', async () => {
  const t = await juan.c.post('/api/admin/hq/agents/frontend/tasks', { title: 'Ajustar la oficina en móvil', expected: 'Sin desbordes', priority: 2 });
  assert.equal(t.status, 201);
  assert.equal(t.json.priority, 2);
  assert.equal(t.json.agent_id, 'frontend');
  const p = await ines.c.patch('/api/admin/hq/tasks/' + t.json.id + '/priority', { priority: 1 });
  assert.equal(p.json.priority, 1);
  assert.equal((await ines.c.patch('/api/admin/hq/tasks/' + t.json.id + '/priority', { priority: 9 })).status, 400);

  // Con una ejecución en curso, pausar pide confirmación explícita y no la corta.
  const run = await hq.startRun(env.db, { agentId: 'frontend', summary: 'Compilando', source: 'cli' });
  const noConfirm = await juan.c.post('/api/admin/hq/agents/frontend/pause', { reason: 'Cambio de plan' });
  assert.equal(noConfirm.status, 409);
  assert.equal(noConfirm.json.error, 'confirm_required');
  const paused = await juan.c.post('/api/admin/hq/agents/frontend/pause', { reason: 'Cambio de plan', confirm: 'PAUSAR' });
  assert.equal(paused.status, 200);
  assert.equal(paused.json.running_continues, true);
  assert.equal((await env.db.get('SELECT status FROM agent_runs WHERE id = ?', [run])).status, 'running');
  const blocked = await juan.c.post('/api/admin/hq/agents/frontend/tasks', { title: 'Otra' });
  assert.equal(blocked.status, 409, 'un agente pausado no recibe asignaciones');
  await juan.c.post('/api/admin/hq/agents/frontend/resume', {});
  await hq.finishRun(env.db, run, { status: 'error', error: 'falló el build' });

  // Reintento de una ejecución fallida: crea una tarea de reintento ligada.
  const r = await juan.c.post('/api/admin/hq/agents/frontend/retry', {});
  assert.equal(r.status, 200);
  assert.equal(r.json.mode, 'task');
  assert.equal((await env.db.get('SELECT retry_of FROM ops_tasks WHERE id = ?', [r.json.task])).retry_of, String(run));
  // Reintento de una tarea programada: la vuelve a ejecutar.
  const rj = await hq.recordCompletedRun(env.db, { agentId: 'analitica', status: 'error', summary: 'rollup', error: 'x', source: 'job' });
  const rr = await juan.c.post('/api/admin/hq/agents/analitica/retry', { run_id: rj });
  assert.equal(rr.json.mode, 'job');

  const rep = await ines.c.post('/api/admin/hq/agents/frontend/report', {});
  assert.equal(rep.status, 200);
  assert.ok(rep.json.lines.length >= 4);
  // Todo queda en la auditoría.
  const actions = (await env.db.all("SELECT action FROM audit_log WHERE action LIKE 'agent.%' OR action = 'task.priority'")).map((x) => x.action);
  for (const a of ['agent.pause', 'agent.resume', 'agent.retry', 'agent.report', 'task.priority']) assert.ok(actions.includes(a), a);
});

test('ficha: función, tareas reales, ejecuciones, archivos, dependencias y aprobaciones', async () => {
  const s = (await juan.c.get('/api/admin/hq/agents/editorial')).json;
  assert.equal(s.id, 'editorial');
  assert.ok(s.mission && s.tools.length && s.objectives.length);
  assert.ok(s.code_paths.includes('scripts/bank.js'));
  assert.ok(s.dependencies.integrations.some((i) => i.id === 'turso'));
  assert.ok(Array.isArray(s.runs) && Array.isArray(s.events) && Array.isArray(s.tasks));
  assert.ok(s.evaluation.week.period.label && s.evaluation.month.period.label);
  assert.equal((await juan.c.get('/api/admin/hq/agents/no-existe')).status, 404);
});

test('evaluación: definiciones y períodos; los bloqueos ajenos no penalizan; patrón con causa', async () => {
  const id = 'documentacion';
  let e = await hq.evaluate(env.db, id, { days: 7 });
  assert.equal(e.quality.grade, 'insufficient', 'sin datos no hay calificación');
  for (const k of Object.keys(hq.INDICATORS)) assert.ok(e.indicators[k].definition, k);
  await env.db.run("INSERT INTO ops_tasks(id, title, area, category, agent_id, status, blocked_reason) VALUES ('T-900','x','direction','important',?,'blocked','Espera la decisión de los CEO')", [id]);
  for (let i = 0; i < 4; i++) await hq.recordCompletedRun(env.db, { agentId: id, status: 'ok', summary: 'doc', evidence: 'https://example.com/' + i, source: 'cli' });
  e = await hq.evaluate(env.db, id, { days: 7 });
  assert.equal(e.indicators.success_rate.value, 100);
  assert.equal(e.quality.grade, 'good', 'una tarea bloqueada por los CEO no baja la calificación');
  assert.deepEqual(e.indicators.external_blocks.by_cause, { 'Decisión de los CEO': ['T-900'] });
  // Tres errores seguidos por permisos: patrón, causa ajena, no penaliza.
  for (let i = 0; i < 3; i++) await hq.recordCompletedRun(env.db, { agentId: id, status: 'error', summary: 'doc', error: '403 forbidden token', source: 'cli' });
  const p = await hq.detectPattern(env.db, id);
  assert.match(p.pattern, /3 ejecuciones seguidas/);
  assert.equal(p.cause, 'permissions');
  assert.equal(p.penalizes, false);
  assert.equal(p.evidence.length, 3);
  // Proponer corrección: pide aprobación; aplicar sin aprobación no se puede.
  const c = await juan.c.post('/api/admin/hq/agents/' + id + '/corrections', {});
  assert.equal(c.status, 201);
  assert.equal((await juan.c.post('/api/admin/hq/agents/' + id + '/corrections', {})).status, 409, 'una corrección abierta por agente');
  assert.equal((await juan.c.post('/api/admin/hq/corrections/' + c.json.id + '/applied', {})).status, 409);
  const item = (await juan.c.get('/api/admin/approvals/' + c.json.approval_id)).json;
  await ines.c.post('/api/admin/approvals/' + item.id + '/vote', { decision: 'approve', version: item.version, content_hash: item.content_hash });
  await hq.measureCorrections(env.db);
  assert.equal((await juan.c.post('/api/admin/hq/corrections/' + c.json.id + '/applied', {})).status, 200);
  for (let i = 0; i < 3; i++) await hq.recordCompletedRun(env.db, { agentId: id, status: 'ok', summary: 'doc', evidence: 'https://example.com/ok', source: 'cli' });
  await hq.measureCorrections(env.db);
  const row = await env.db.get('SELECT status, result FROM agent_corrections WHERE id = ?', [c.json.id]);
  assert.equal(row.status, 'effective');
});

test('informe de 48 h: tarea programada real, sin duplicados, próximo turno desde el último correcto', async () => {
  const before = Date.now();
  const out = await runJob(env.db, 'exec_report', {});
  assert.equal(out.status, 'success');
  const rows = await env.db.all("SELECT * FROM exec_reports WHERE trigger = 'scheduled'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ready');
  const job = await env.db.get("SELECT next_run_at, interval_minutes FROM jobs WHERE name = 'exec_report'");
  assert.equal(job.interval_minutes, 2880);
  const next = Date.parse(job.next_run_at) - before;
  assert.ok(next > 47.9 * 3600000 && next < 48.1 * 3600000, 'próximo turno a 48 h de la ejecución correcta');
  // Volver a dispararla no crea otro informe.
  const again = await runJob(env.db, 'exec_report', {});
  assert.equal(again.output.skipped, 'not_due');
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM exec_reports WHERE trigger = 'scheduled'")).n, 1);
  // La clave del turno impide duplicados aunque dos procesos lo intenten a la vez.
  await assert.rejects(env.db.run("INSERT INTO exec_reports(id, period_key, trigger, period_start, period_end, timezone) VALUES ('x', ?, 'scheduled', 'a', 'b', 'UTC')", [rows[0].period_key]), /UNIQUE/);
  // Contenido: secciones A–J, comparación, revisión rotulada como automática, fuentes y limitaciones.
  const r = await reports.get(env.db, rows[0].id);
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'comparison', 'review', 'limitations']) assert.ok(r.content[k], k);
  assert.match(r.content.review.label, /No fue una reunión entre agentes/);
  assert.equal(r.content.E.performance.available, false, 'lo que no se puede medir se marca como no disponible');
  assert.ok(r.sources.length > 10);
  // Un informe listo no se puede reescribir.
  await assert.rejects(env.db.run("UPDATE exec_reports SET content = '{}' WHERE id = ?", [rows[0].id]), /report_immutable/);
  const nr = await reports.nextRun(env.db);
  assert.equal(nr.status, 'verified');
});

test('ambos CEO reciben el mismo informe y lo consultan; historial, descarga y generación manual', async () => {
  const list = await juan.c.get('/api/admin/hq/reports');
  const list2 = await ines.c.get('/api/admin/hq/reports');
  assert.deepEqual(list.json.items.map((r) => r.id), list2.json.items.map((r) => r.id));
  const id = list.json.items[0].id;
  const n = await env.db.all("SELECT user_id FROM notifications WHERE kind = 'exec_report' AND json_extract(payload, '$.report_id') = ?", [id]);
  assert.deepEqual(new Set(n.map((x) => x.user_id)), new Set([juan.user.id, ines.user.id]));
  const st = await ines.c.get('/api/admin/hq/state');
  assert.equal(st.json.unread_reports, 1);
  const r = await ines.c.get('/api/admin/hq/reports/' + id);
  assert.equal(r.json.delivery.notification.status, 'delivered');
  assert.equal(r.json.delivery.email.status, 'not_configured');
  assert.equal((await ines.c.get('/api/admin/hq/state')).json.unread_reports, 0, 'leerlo lo marca como leído');
  const md = await juan.c.get('/api/admin/hq/reports/' + id + '/markdown');
  assert.equal(md.status, 200);
  assert.match(md.text, /# Informe ejecutivo/);
  assert.match(md.headers.get('content-disposition'), /attachment/);
  assert.equal((await client(env.base).get('/api/admin/hq/reports/' + id + '/markdown')).status, 401);
  const manual = await juan.c.post('/api/admin/hq/reports', {});
  assert.equal(manual.status, 201);
  const dup = await juan.c.post('/api/admin/hq/reports', {});
  assert.equal(dup.status, 409, 'dos pedidos en el mismo minuto no duplican');
});

test('si falla la generación: alerta, reintento sobre el mismo turno y recuperación tras un corte', async () => {
  // Fuerza un turno vencido y una falla en la construcción del informe.
  await env.db.run("DELETE FROM exec_reports WHERE status <> 'ready'");
  const last = await env.db.get("SELECT id, period_end FROM exec_reports WHERE trigger = 'scheduled' AND status = 'ready'");
  // Se simula que pasaron 48 h desde el último informe (el disparador se quita solo para preparar la prueba).
  await env.db.run("DROP TRIGGER exec_reports_ready_immutable");
  await env.db.run('UPDATE exec_reports SET period_end = ? WHERE id = ?', [new Date(Date.now() - 49 * 3600000).toISOString(), last.id]);
  await env.db.run("ALTER TABLE risks RENAME TO risks_tmp");
  const fail = await runJob(env.db, 'exec_report', {});
  assert.equal(fail.status, 'failed');
  const failed = await env.db.get("SELECT * FROM exec_reports WHERE status = 'failed'");
  assert.ok(failed);
  const alert = await env.db.get("SELECT * FROM alerts WHERE dedupe_key = 'hq_report_generation' AND status = 'open'");
  assert.equal(alert.severity, 'critical');
  const det = JSON.parse(alert.details);
  for (const k of ['cause', 'impact', 'owner', 'action']) assert.ok(det[k], k);
  await env.db.run("ALTER TABLE risks_tmp RENAME TO risks");
  // El reintento usa la misma fila (no duplica) y cierra la alerta.
  await env.db.run("UPDATE jobs SET next_run_at = ?, lease_until = NULL WHERE name = 'exec_report'", [new Date(Date.now() - 1000).toISOString()]);
  const ok = await runJob(env.db, 'exec_report', {});
  assert.equal(ok.status, 'success');
  const row = await env.db.get('SELECT status, attempts FROM exec_reports WHERE id = ?', [failed.id]);
  assert.deepEqual({ ...row }, { status: 'ready', attempts: 2 });
  assert.equal((await env.db.get("SELECT status FROM alerts WHERE dedupe_key = 'hq_report_generation'")).status, 'resolved');
  // Un informe que quedó «generando» por un corte se marca para reintentar.
  await env.db.run("INSERT INTO exec_reports(id, period_key, trigger, period_start, period_end, timezone, status, started_at) VALUES ('stuck','manual:stuck','manual','a','b','UTC','generating',?)", [new Date(Date.now() - 3600000).toISOString()]);
  assert.equal(await reports.recoverStuck(env.db), 1);
  assert.equal((await env.db.get("SELECT status FROM exec_reports WHERE id = 'stuck'")).status, 'failed');
  await env.db.exec(`CREATE TRIGGER exec_reports_ready_immutable BEFORE UPDATE OF content, sources, period_start, period_end ON exec_reports
    WHEN OLD.status = 'ready' BEGIN SELECT RAISE(ABORT, 'report_immutable'); END;`);
});

test('si falla la entrega: alerta inmediata', async () => {
  const id = (await env.db.get("SELECT id FROM exec_reports WHERE status = 'ready' LIMIT 1")).id;
  await env.db.run("UPDATE users SET disabled = 1 WHERE role = 'owner'");
  const d = await reports.deliver(env.db, id);
  await env.db.run("UPDATE users SET disabled = 0 WHERE role = 'owner'");
  assert.equal(d.notification.status, 'failed');
  assert.ok(await env.db.get("SELECT 1 FROM alerts WHERE dedupe_key = 'hq_report_delivery' AND severity = 'critical'"));
});

test('alertas inmediatas: cuenta de CEO, informe atrasado, sobrecosto y agente con fallos, sin repetirse', async () => {
  await env.db.run("UPDATE users SET locked_until = ? WHERE id = ?", [new Date(Date.now() + 600000).toISOString(), ines.user.id]);
  await env.db.run("UPDATE jobs SET next_run_at = ? WHERE name = 'exec_report'", [new Date(Date.now() - 5 * 3600000).toISOString()]);
  await env.db.run("UPDATE settings SET value = '10' WHERE key = 'hq.monthly_budget_usd'");
  await env.db.run("INSERT INTO costs(area, vendor, kind, amount) VALUES ('tech', 'Proveedor', 'actual', 25)");
  const alerts = require('../src/services/alerts');
  await alerts.scan(env.db);
  await alerts.scan(env.db);
  const rows = await env.db.all("SELECT dedupe_key, severity, occurrences, details FROM alerts WHERE status = 'open'");
  const has = (re) => rows.find((r) => re.test(r.dedupe_key));
  assert.ok(has(/^ceo_account:/), 'cuenta de CEO bloqueada');
  assert.ok(has(/^hq_report_overdue$/), 'informe atrasado');
  assert.ok(has(/^budget:/), 'sobrecosto');
  assert.equal(has(/^ceo_account:/).occurrences, 2, 'la misma alerta se agrupa en lugar de repetirse');
  for (const r of rows.filter((x) => /^(ceo_account|hq_report_overdue|budget)/.test(x.dedupe_key))) {
    const d = JSON.parse(r.details);
    for (const k of ['cause', 'impact', 'owner', 'action']) assert.ok(d[k], `${r.dedupe_key}: ${k}`);
  }
  await env.db.run("UPDATE users SET locked_until = NULL WHERE id = ?", [ines.user.id]);
  await env.db.run("UPDATE settings SET value = '0' WHERE key = 'hq.monthly_budget_usd'");
});

test('un intento de completar sin aprobación queda registrado y alerta', async () => {
  await env.db.run("INSERT INTO ops_tasks(id, title, area, category, agent_id, approval_level, status) VALUES ('T-950','Cambio','tech','important','backend',3,'pending')");
  const r = await juan.c.patch('/api/admin/company/tasks/T-950', { status: 'done', evidence: 'https://example.com/commit' });
  assert.equal(r.status, 409);
  assert.ok(await env.db.get("SELECT 1 FROM audit_log WHERE action = 'security.denied' AND outcome = 'blocked' AND actor_id = ?", [juan.user.id]));
  await require('../src/services/alerts').scan(env.db);
  assert.ok(await env.db.get("SELECT 1 FROM alerts WHERE dedupe_key LIKE 'approval_bypass:%'"));
});

test('la sala de servidores no expone secretos', async () => {
  await env.db.run("INSERT INTO error_log(scope, message) VALUES ('db', 'fallo con libsql://user:SECRETO@base.turso.io token=abc123def456')");
  const s = await juan.c.get('/api/admin/hq/rooms/servers');
  assert.equal(s.status, 200);
  const text = JSON.stringify(s.json);
  assert.ok(!text.includes('SECRETO') && !text.includes('abc123def456'));
  assert.equal(s.json.availability.available, false);
  for (const p of ['instagram', 'tiktok', 'youtube', 'facebook', 'linkedin']) {
    const r = await juan.c.get('/api/admin/hq/rooms/social/' + p);
    assert.equal(r.status, 200);
    assert.equal(r.json.comments.available, false);
  }
  assert.equal((await juan.c.get('/api/admin/hq/rooms/social/myspace')).status, 404);
  for (const room of ['product', 'legal', 'marketing']) assert.equal((await juan.c.get('/api/admin/hq/rooms/' + room)).status, 200, room);
});

test('las tareas programadas registran la ejecución de su agente (prueba de actividad)', async () => {
  const before = (await env.db.get("SELECT COUNT(*) AS n FROM agent_runs WHERE agent_id = 'devops'")).n;
  await env.db.run("UPDATE jobs SET lease_until = NULL WHERE name = 'alerts_scan'");
  await runJob(env.db, 'alerts_scan', {});
  const runs = await env.db.all("SELECT status, source, evidence FROM agent_runs WHERE agent_id = 'devops' ORDER BY id DESC");
  assert.equal(runs.length, before + 1);
  assert.equal(runs[0].status, 'ok');
  assert.equal(runs[0].source, 'job');
  assert.match(runs[0].evidence, /^job_runs #\d+$/);
  const ev = await env.db.all("SELECT kind FROM agent_events WHERE agent_id = 'devops' ORDER BY id DESC LIMIT 2");
  assert.deepEqual(ev.map((e) => e.kind), ['finished', 'started']);
});

test('zona horaria configurable y validada', async () => {
  const bad = await juan.c.put('/api/admin/settings', { key: 'hq.report_timezone', value: 'Marte/Olympus' });
  assert.notEqual(bad.status, 200);
  await env.db.run("UPDATE settings SET value = ? WHERE key = 'hq.report_timezone'", [JSON.stringify('Europe/Madrid')]);
  const n = await reports.nextRun(env.db);
  assert.equal(n.timezone, 'Europe/Madrid');
  assert.ok(n.local);
});
