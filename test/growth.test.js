'use strict';

// Agentes de crecimiento: un agente por red con métricas importadas, gerente de redes que
// informa a la Dirección de marketing y publicidad, y estrategia comercial. Nada se ejecuta
// sin la aprobación de un CEO; sin datos no hay propuestas.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, staff } = require('./helpers');
const growth = require('../src/services/growth');
const { runJob } = require('../src/services/jobs');

let env; let juan;
test.before(async () => {
  env = await makeEnv();
  juan = await staff(env, 'owner', 'juan_growth');
});
test.after(async () => { await env.close(); });
test.beforeEach(async () => { if (env) await env.db.run('DELETE FROM rate_limits'); });

const day = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
const vote = async (id, decision, comment) => {
  const item = (await juan.c.get('/api/admin/approvals/' + id)).json;
  return juan.c.post(`/api/admin/approvals/${id}/vote`, { decision, comment, version: item.version, content_hash: item.content_hash });
};

test('un agente por red, su gerente y la dirección de marketing y publicidad, con la cadena de mando', async () => {
  const rows = await env.db.all("SELECT id, name, supervisor, runtime FROM agents WHERE id LIKE 'redes-%' OR id IN ('gerente-redes','marketing-direccion','estrategia-comercial') ORDER BY id");
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const n of ['instagram', 'facebook', 'tiktok', 'youtube']) {
    assert.equal(by['redes-' + n].supervisor, 'Gerencia de redes sociales');
    assert.equal(by['redes-' + n].runtime, 'job:social_insights');
  }
  assert.equal(by['gerente-redes'].supervisor, 'Dirección de marketing y publicidad');
  assert.equal(by['marketing-direccion'].name, 'Dirección de marketing y publicidad');
  assert.equal(by['estrategia-comercial'].runtime, 'job:commercial_review');
  const state = (await juan.c.get('/api/admin/hq/state')).json;
  assert.equal(state.agents.find((a) => a.id === 'redes-tiktok').zone, 'tiktok');
  assert.ok(state.zones.find((z) => z.id === 'social-mgmt').agents.includes('gerente-redes'));
  assert.ok(state.zones.find((z) => z.id === 'commercial').agents.includes('estrategia-comercial'));
});

test('sin métricas: informes que dicen qué falta, ninguna propuesta y el gerente informa a la dirección', async () => {
  const out = await runJob(env.db, 'social_insights');
  assert.equal(out.status, 'success', out.error);
  const reps = await env.db.all("SELECT * FROM growth_reports WHERE kind = 'network'");
  assert.equal(reps.length, 4);
  for (const r of reps) {
    const c = JSON.parse(r.content);
    assert.equal(c.data.stale, true);
    assert.match(c.data.note, /no se importaron/);
    assert.equal(r.addressed_to, 'gerente-redes');
  }
  assert.equal((await env.db.get('SELECT COUNT(*) AS n FROM growth_proposals')).n, 0, 'sin datos no propone');
  const mgr = await env.db.get("SELECT * FROM growth_reports WHERE kind = 'manager'");
  assert.equal(mgr.addressed_to, 'marketing-direccion');
  assert.match(JSON.parse(mgr.content).recommendations[0], /Faltan métricas recientes/);
  const ev = await env.db.get("SELECT * FROM agent_events WHERE agent_id = 'marketing-direccion' AND kind = 'report'");
  assert.ok(ev, 'la dirección recibe el informe');
  // Una ejecución por agente, con su informe como evidencia (sin duplicar la del trabajo programado).
  const runs = await env.db.all("SELECT agent_id, COUNT(*) AS n, MIN(evidence) AS ev FROM agent_runs WHERE agent_id LIKE 'redes-%' OR agent_id = 'gerente-redes' GROUP BY agent_id");
  assert.equal(runs.length, 5);
  for (const r of runs) { assert.equal(r.n, 1); assert.match(r.ev, /^growth_reports #/); }
  await assert.rejects(env.db.run('UPDATE growth_reports SET addressed_to = NULL'), /report_immutable/);
});

test('métricas por CSV: solo los CEO cargan; con números claros la red propone, sin duplicar', async () => {
  const lines = ['fecha;seguidores;alcance;interacciones;publicaciones;reels;interacciones_reels'];
  for (let i = 14; i >= 1; i--) lines.push(`${day(i)};${1000 + (14 - i) * 5};${800};${i <= 7 ? 90 : 60};2;1;${i <= 7 ? 80 : 40}`);
  const editor = await staff(env, 'editor');
  assert.equal((await editor.c.post('/api/admin/hq/growth/metrics', { network: 'instagram', csv: lines.join('\n') })).status, 403);
  const bad = await juan.c.post('/api/admin/hq/growth/metrics', { network: 'instagram', csv: 'fecha;alcance\nayer;10' });
  assert.equal(bad.status, 400);
  const r = await juan.c.post('/api/admin/hq/growth/metrics', { network: 'instagram', csv: lines.join('\n') });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.imported[0].from, day(14));
  const a = await growth.analyzeNetwork(env.db, 'instagram');
  assert.equal(a.data.stale, false);
  assert.equal(a.metrics.posts, 14);
  assert.equal(a.metrics.video_ipp, 80);
  assert.equal(a.metrics.feed_ipp, 10);

  const run = await juan.c.post('/api/admin/hq/growth/run/social', {});
  assert.equal(run.status, 200, run.text);
  const props = await env.db.all("SELECT * FROM growth_proposals WHERE network = 'instagram'");
  assert.deepEqual(props.map((p) => p.rule).sort(), ['format_video', 'low_click_through']);
  const ap = await env.db.get('SELECT * FROM approval_items WHERE id = ?', [props[0].approval_id]);
  assert.equal(ap.status, 'pending');
  assert.equal(ap.requested_by, 'redes-instagram');
  assert.deepEqual(JSON.parse(ap.content).chain, ['Agente de Instagram', 'Gerencia de redes sociales', 'Dirección de marketing y publicidad', 'Decisión final: un CEO']);
  await runJob(env.db, 'social_insights').catch(() => null);
  await env.db.run("UPDATE jobs SET next_run_at = ? WHERE name = 'social_insights'", [new Date().toISOString()]);
  await growth.runSocial(env.db);
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM growth_proposals WHERE network = 'instagram'")).n, 2, 'no repite propuestas abiertas');
  const view = (await juan.c.get('/api/admin/hq/growth/social/instagram')).json;
  assert.equal(view.proposals.length, 2);
  assert.ok(view.series.length > 0);
});

test('lo aprobado por un CEO se ejecuta en tareas y después se mide; lo rechazado no', async () => {
  const p = await env.db.get("SELECT * FROM growth_proposals WHERE rule = 'format_video'");
  await assert.rejects(env.db.run("UPDATE growth_proposals SET status = 'executing' WHERE id = ?", [p.id]), /approval_required/);
  const r = await vote(p.approval_id, 'approve');
  assert.equal(r.status, 200, r.text);
  const after = await env.db.get('SELECT * FROM growth_proposals WHERE id = ?', [p.id]);
  assert.equal(after.status, 'executing');
  const tasks = JSON.parse(after.tasks);
  assert.equal(tasks.length, 2);
  const t = await env.db.get('SELECT * FROM ops_tasks WHERE id = ?', [tasks[0]]);
  assert.equal(t.agent_id, 'produccion-contenido');
  assert.equal((await env.db.get('SELECT status FROM approval_items WHERE id = ?', [p.approval_id])).status, 'executed');

  // Medición a los 14 días: compara la métrica con la de antes.
  await env.db.run('UPDATE growth_proposals SET measure_after = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), p.id]);
  const m = await growth.measureProposals(env.db);
  assert.equal(m.length, 1);
  const res = JSON.parse((await env.db.get('SELECT result FROM growth_proposals WHERE id = ?', [p.id])).result);
  assert.equal(res.measured, true);
  assert.equal(res.before, p.baseline);

  const q = await env.db.get("SELECT * FROM growth_proposals WHERE rule = 'low_click_through'");
  assert.equal((await vote(q.approval_id, 'reject', 'No por ahora')).status, 200);
  await growth.syncDecisions(env.db);
  const rej = await env.db.get('SELECT status, tasks FROM growth_proposals WHERE id = ?', [q.id]);
  assert.equal(rej.status, 'rejected');
  assert.equal(rej.tasks, '[]');
});

test('estrategia comercial: propone solo líneas que cumplen requisitos con datos reales y ejecuta lo aprobado', async () => {
  const m0 = await growth.commercialMetrics(env.db);
  assert.equal(m0.values.d7, null, 'sin cohorte suficiente no hay dato de retención');
  assert.match(m0.notes.d7, /al menos 20/);
  const before = await growth.runCommercial(env.db);
  const first = await env.db.all("SELECT rule FROM growth_proposals WHERE kind = 'commercial'");
  // 200 jugadores activos esta semana: alcanza para «aportes».
  const clue = await env.db.get("SELECT id FROM clues WHERE status = 'published' LIMIT 1");
  for (let i = 0; i < 200; i++) {
    await env.db.run('INSERT INTO players(id) VALUES (?)', ['pl-growth-' + i]);
    await env.db.run("INSERT INTO games(id, player_id, clue_id, mode) VALUES (?,?,?,'play')", ['g-growth-' + i, 'pl-growth-' + i, clue.id]);
  }
  const out = await growth.runCommercial(env.db);
  assert.ok(out.report_id > before.report_id);
  const rep = JSON.parse((await env.db.get('SELECT content FROM growth_reports WHERE id = ?', [out.report_id])).content);
  const aportes = rep.options.find((o) => o.id === 'aportes');
  assert.equal(aportes.ready, true);
  const sus = rep.options.find((o) => o.id === 'suscripcion');
  assert.equal(sus.ready, false);
  assert.ok(rep.not_ready.find((o) => o.id === 'suscripcion').missing.some((x) => /sin dato/.test(x)));
  for (const o of rep.options) for (const s of o.sources) assert.match(s.url, /^https:\/\//);
  const p = await env.db.get("SELECT * FROM growth_proposals WHERE kind = 'commercial' AND rule = 'aportes'");
  assert.ok(p, 'propone la línea lista');
  assert.ok(!first.some((x) => x.rule === 'aportes'));
  assert.equal((await vote(p.approval_id, 'approve')).status, 200);
  const done = await env.db.get('SELECT * FROM growth_proposals WHERE id = ?', [p.id]);
  assert.equal(done.status, 'executing');
  const ts = await env.db.all(`SELECT * FROM ops_tasks WHERE id IN (${JSON.parse(done.tasks).map(() => '?').join(',')})`, JSON.parse(done.tasks));
  assert.ok(ts.some((t) => t.status === 'blocked' && t.blocked_reason === 'Acción de un CEO'), 'lo que requiere a un CEO queda bloqueado para él');
  const view = (await juan.c.get('/api/admin/hq/growth/commercial')).json;
  assert.ok(view.proposals.some((x) => x.id === p.id));
});
