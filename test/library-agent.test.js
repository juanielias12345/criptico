'use strict';

// Agente Autónomo de Biblioteca: variantes reales, bloqueo sin credenciales ni
// presupuesto, controles A–F, cuota pareja por mecanismo, estados, duplicados,
// recuperación de lotes, bloqueo de ejecución, errores de la API, costos,
// invalidación por edición, pausa por calidad, informe diario y panel.
// La IA se simula (test/support/fake-llm.js): el generador escribe con el motor
// determinista del banco y el revisor responde lo que cada prueba pida.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeEnv, staff } = require('./helpers');
const agent = require('../src/services/library-agent');
const { setSetting } = require('../src/services/settings');
const { fakeLlm } = require('./support/fake-llm');

let env; let owner; let analyst;
const db = () => env.db;
const set = (k, v) => setSetting(env.db, k, v);

async function fresh() {
  // cada prueba arranca sin ciclos ni registros del agente
  for (const t of ['clue_audits', 'agent_candidates', 'agent_batches', 'agent_cycles']) await db().run(`DELETE FROM ${t}`);
  await db().run("DELETE FROM clues WHERE generator_version = 'agent-1.0'");
  await db().run("DELETE FROM alerts WHERE kind = 'agent'");
  await db().run("UPDATE agent_variants SET status = 'active', paused_reason = NULL, probation = 0, cursor = 0, library_target = NULL, pilot_done = 0");
  await db().run("UPDATE agent_control SET state = 'active', reason = NULL, lease_holder = NULL, lease_until = NULL, last_run_status = NULL");
  await set('agent.daily_budget_usd', 50);
  await set('agent.daily_target_per_variant', 20);
  await set('agent.batch_size', 40);
  await set('agent.pilot_batch_size', 10);
}

const cycleRow = async () => db().get('SELECT * FROM agent_cycles ORDER BY cycle_date DESC LIMIT 1');
const run = (opts = {}) => agent.runOnce(db(), { deadline: Date.now() + 120000, retryMs: 1, ...opts });

test.before(async () => {
  env = await makeEnv({ spanishOnly: true });
  owner = await staff(env, 'owner');
  analyst = await staff(env, 'analyst');
});
test.after(async () => { await env.close(); });

test('detecta las variantes reales del español y no crea ninguna', async () => {
  const before = (await db().get('SELECT COUNT(*) AS n FROM language_variants')).n;
  const vs = await agent.syncVariants(db());
  const real = await db().all("SELECT code FROM language_variants WHERE language_code = 'es' AND enabled = 1 ORDER BY code");
  assert.deepEqual(vs.map((v) => v.variant_code), real.map((r) => r.code));
  assert.equal(vs.length, 22);
  assert.equal((await db().get('SELECT COUNT(*) AS n FROM language_variants')).n, before);
  // para que las pruebas siguientes sean rápidas, se trabaja con dos variantes
  await db().run("UPDATE language_variants SET enabled = 0 WHERE language_code = 'es' AND code NOT IN ('es-AR','es-ES')");
});

test('la cuota diaria se reparte en partes iguales entre los mecanismos', () => {
  const q = agent.quotas(3000, ['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone', 'double_definition', 'initials', 'combination']);
  assert.ok(Object.values(q).every((n) => n === 300));
  const r = agent.quotas(23, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(Object.values(r), [5, 5, 5, 4, 4]);
});

test('sin clave de la API queda bloqueado, avisa y no marca nada como cumplido', async () => {
  await fresh();
  const r = await run({ llm: { available: false } });
  assert.equal(r.blocked, 'missing_credentials');
  const c = await cycleRow();
  assert.equal(c.status, 'blocked');
  assert.equal(c.finished_at, null);
  assert.equal(JSON.parse(c.report).totals.approved, 0);
  assert.ok(await db().get("SELECT 1 FROM alerts WHERE kind = 'agent' AND dedupe_key LIKE 'agent:blocked:missing_credentials:%'"));
  const v = JSON.parse(c.report).variants[0];
  assert.match(v.shortfall_reason, /ANTHROPIC_API_KEY/);
});

test('sin presupuesto queda bloqueado sin llamar a la IA', async () => {
  await fresh();
  await set('agent.daily_budget_usd', 0);
  const llm = fakeLlm();
  const r = await run({ llm });
  assert.equal(r.blocked, 'no_budget');
  assert.equal(llm.calls.generator + llm.calls.reviewer, 0);
});

test('piloto y lotes: solo se aprueba lo que pasa todos los controles; cuota por mecanismo respetada', async () => {
  await fresh();
  const llm = fakeLlm();
  const r = await run({ llm });
  assert.equal(r.status, 'ok', JSON.stringify(r.batches.filter((b) => b.error)));
  const first = await db().get("SELECT kind, requested FROM agent_batches WHERE variant_code = 'es-AR' ORDER BY seq LIMIT 1");
  assert.equal(first.kind, 'pilot');
  assert.ok(first.requested <= 10, 'el piloto es de bajo volumen');
  const approved = await db().all("SELECT c.*, k.status AS clue_status, k.variant_code AS clue_variant, k.origin FROM agent_candidates c JOIN clues k ON k.id = c.clue_id WHERE c.status = 'approved'");
  assert.ok(approved.length > 0, 'hubo aprobados');
  for (const a of approved) {
    const ch = JSON.parse(a.checks);
    for (const k of ['A', 'B', 'C', 'D', 'E', 'F']) assert.equal(ch[k].ok, true, `${k} en ${a.clue_text}`);
    assert.equal(a.clue_status, 'published');
    assert.equal(a.clue_variant, a.variant_code);
    assert.equal(a.origin, 'generated');
    assert.ok(a.generator_model && a.reviewer_model && a.generator_model !== a.reviewer_model);
  }
  // pendientes: guardados en revisión; rechazados: nunca llegan a clues
  for (const p of await db().all("SELECT k.status FROM agent_candidates c JOIN clues k ON k.id = c.clue_id WHERE c.status = 'needs_review'")) assert.equal(p.status, 'review');
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM agent_candidates WHERE status = 'rejected' AND clue_id IS NOT NULL")).n, 0);
  // ningún mecanismo pasa su cuota (20 / 10 mecanismos = 2)
  for (const m of await db().all("SELECT variant_code, mechanism, COUNT(*) AS n FROM agent_candidates WHERE status = 'approved' GROUP BY variant_code, mechanism")) {
    assert.ok(m.n <= 2, `${m.variant_code} ${m.mechanism}: ${m.n}`);
  }
  // el informe sale de la base
  const rep = JSON.parse((await cycleRow()).report);
  const ar = rep.variants.find((v) => v.variant === 'es-AR');
  assert.equal(ar.approved, (await db().get("SELECT COUNT(*) AS n FROM agent_candidates WHERE variant_code = 'es-AR' AND status = 'approved'")).n);
  assert.equal(ar.by_mechanism.length, 10);
  // cada lote quedó verificado contra la base
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM agent_batches WHERE status NOT IN ('verified')")).n, 0);
  // el costo medido se registró
  assert.ok((await cycleRow()).cost_usd > 0);
});

test('la duda del revisor deja el críptico en revisión, nunca aprobado', async () => {
  await fresh();
  const r = await run({ llm: fakeLlm({ verdict: () => 'doubt' }) });
  assert.ok(r.batches.length);
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM agent_candidates WHERE status = 'approved'")).n, 0);
  assert.ok((await db().get("SELECT COUNT(*) AS n FROM agent_candidates WHERE status = 'needs_review'")).n > 0);
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM clues WHERE generator_version = 'agent-1.0' AND status = 'published'")).n, 0);
});

test('si el revisor es el mismo modelo que el generador, no hay aprobación', async () => {
  await fresh();
  await run({ llm: fakeLlm({ generatorModel: 'claude-sonnet-5-5', reviewerModel: 'claude-sonnet-5-5' }) });
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM agent_candidates WHERE status = 'approved'")).n, 0);
  const one = await db().get("SELECT checks FROM agent_candidates WHERE status = 'needs_review' LIMIT 1");
  assert.match(JSON.parse(one.checks).F.items[0], /no es independiente/);
});

test('calibración: pistas defectuosas nunca se aprueban', async () => {
  await fresh();
  const vs = await agent.syncVariants(db());
  const ctx = { L: require('../src/lib/bank/lexicon').load('es'), variant: vs[0], variantCodes: new Set(vs.map((v) => v.variant_code)),
    phonetics: await require('../src/services/clues').variantPhonetics(db(), 'es') };
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'clues.es.json'), 'utf8')).filter((c) => c.wordplay);
  const corrupt = [
    (c) => ({ ...c, clue: c.clue.replace(/\((\d+)\)\s*$/, (m, n) => `(${Number(n) + 1})`) }),                    // enumeración falsa
    (c) => ({ ...c, wordplay_json: JSON.stringify({ op: 'anagram', indicator: 'revuelto', of: [{ op: 'lit', text: 'zzz' }] }) }), // lógica rota
    (c) => ({ ...c, wordplay_json: '{no es json' }),                                                              // estructura
    (c) => ({ ...c, mechanism: c.mechanism, regional_words: ['pibe'] }),                                          // regional sin respaldo
  ];
  let good = { approvedable: 0, review: 0, rejected: 0 }; let bad = 0;
  for (const c of seed) {
    const tree = c.wordplay;
    const slot = { answer: c.answer, answerText: c.answer.toLowerCase(), mechanism: agent.mechanismClass(tree), difficulty: c.difficulty || 2, definitions: [String(c.definition || '').toLowerCase()], category: 'general' };
    const cand = { clue: c.clue, definition: c.definition || '', wordplay_json: JSON.stringify(tree), regional_words: [] };
    const ok = await agent.evaluate(db(), cand, slot, ctx);
    good[ok.status === 'pass' ? 'approvedable' : ok.status === 'needs_review' ? 'review' : 'rejected']++;
    for (const f of corrupt) {
      const r = await agent.evaluate(db(), f(cand), slot, ctx);
      assert.notEqual(r.status, 'pass', `defectuosa aceptada: ${JSON.stringify(f(cand))}`);
      bad++;
    }
  }
  assert.ok(bad >= 40);
  // las escritas a mano deben pasar o, en caso de duda, ir a revisión: nunca al rechazo por la lógica
  assert.ok(good.approvedable + good.review >= seed.length * 0.9, JSON.stringify(good));
});

test('recupera lotes cortados sin duplicar ni perder registros', async () => {
  await fresh();
  const c = await agent.runOnce(db(), { llm: { available: false } }) && await cycleRow();
  await db().run("INSERT INTO agent_batches(id, cycle_id, variant_code, seq, generator_version, status) VALUES ('cut-1', ?, 'es-AR', 90, 'agent-1.0', 'running')", [c.id]);
  // un lote cuya escritura llegó a la base pero el proceso murió antes de verificarlo
  await db().run("INSERT INTO agent_batches(id, cycle_id, variant_code, seq, generator_version, status) VALUES ('cut-2', ?, 'es-AR', 91, 'agent-1.0', 'committed')", [c.id]);
  await db().run(`INSERT INTO agent_candidates(id, batch_id, cycle_id, variant_code, status, mechanism, checks, generator_version) VALUES ('cand-x', 'cut-2', ?, 'es-AR', 'rejected', 'anagram', '{}', 'agent-1.0')`, [c.id]);
  const r = await agent.recover(db());
  assert.deepEqual(r.map((x) => x.result).sort(), ['abandoned', 'verified']);
  assert.equal((await db().get("SELECT status FROM agent_batches WHERE id = 'cut-1'")).status, 'abandoned');
  assert.equal((await db().get("SELECT status FROM agent_batches WHERE id = 'cut-2'")).status, 'verified');
});

test('un solo proceso a la vez: el bloqueo impide ejecuciones simultáneas', async () => {
  await fresh();
  assert.equal(await agent.acquireLock(db(), 'gha-1'), true);
  assert.equal(await agent.acquireLock(db(), 'gha-2'), false);
  const r = await run({ llm: fakeLlm(), holder: 'gha-2' });
  assert.equal(r.skipped, 'locked');
  await agent.releaseLock(db(), 'gha-1');
  // dos ejecuciones lanzadas a la vez: una trabaja y la otra se retira
  const [a, b] = await Promise.all([run({ llm: fakeLlm(), holder: 'p1' }), run({ llm: fakeLlm(), holder: 'p2' })]);
  assert.equal([a, b].filter((x) => x.skipped === 'locked').length, 1);
});

test('errores de la API: los transitorios se reintentan, los críticos bloquean, los repetidos pausan la variante', async () => {
  await fresh();
  let n = 0;
  const flaky = fakeLlm({ fail: () => (n++ % 3 === 0 ? Object.assign(new Error('overloaded'), { status: 529 }) : null) });
  const r1 = await run({ llm: flaky });
  assert.ok(r1.batches.some((b) => b.batch_id && b.candidates >= 0));
  await fresh();
  const dead = fakeLlm({ fail: () => Object.assign(new Error('invalid x-api-key'), { critical: true, code: 'credentials_rejected' }) });
  const r2 = await run({ llm: dead });
  assert.equal(r2.blocked, 'credentials_rejected');
  assert.equal((await cycleRow()).status, 'blocked');
  await fresh();
  await set('agent.max_consecutive_failures', 2);
  const down = fakeLlm({ fail: () => Object.assign(new Error('socket hang up'), { status: 503 }) });
  await run({ llm: down });
  const v = await db().get("SELECT status, paused_reason FROM agent_variants WHERE variant_code = 'es-AR'");
  assert.equal(v.status, 'paused');
  assert.match(v.paused_reason, /fallos repetidos/);
  assert.ok(await db().get("SELECT 1 FROM alerts WHERE dedupe_key = 'agent:failures:es-AR'"));
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM agent_batches WHERE status = 'failed'")).n >= 2, true);
  await set('agent.max_consecutive_failures', 3);
});

test('el presupuesto diario nunca se supera', async () => {
  await fresh();
  await set('agent.daily_budget_usd', 0.5);
  await set('agent.daily_target_per_variant', 3000);
  const r = await run({ llm: fakeLlm() });
  assert.ok(['budget_exhausted', 'variant_budget_exhausted'].includes(r.blocked), r.blocked);
  const c = await cycleRow();
  assert.ok(c.cost_usd <= 0.5, `gastó ${c.cost_usd}`);
  assert.equal(c.status, 'blocked');
});

test('modificar un críptico aprobado invalida su aprobación', async () => {
  await fresh();
  await run({ llm: fakeLlm() });
  const a = await db().get("SELECT clue_id FROM agent_candidates WHERE status = 'approved' LIMIT 1");
  const { updateClue } = require('../src/services/clues');
  const clue = await db().get('SELECT * FROM clues WHERE id = ?', [a.clue_id]);
  await updateClue(db(), a.clue_id, { note: 'nota', clue_text: clue.clue_text.replace(/\s\(/, ', sí (') }, { actorId: owner.user.id });
  const after = await db().get('SELECT status FROM clues WHERE id = ?', [a.clue_id]);
  assert.equal(after.status, 'review');
  const cand = await db().get('SELECT status, invalidated_at FROM agent_candidates WHERE clue_id = ?', [a.clue_id]);
  assert.equal(cand.status, 'needs_review');
  assert.ok(cand.invalidated_at);
  assert.ok(await db().get("SELECT 1 FROM clue_events WHERE clue_id = ? AND action = 'agent_approval_invalidated'", [a.clue_id]));
});

test('lotes defectuosos: prueba controlada y, si sigue mal, la variante se pausa con alerta', async () => {
  await fresh();
  await set('agent.daily_target_per_variant', 3000);
  await set('agent.batch_size', 100);
  await db().run('UPDATE agent_variants SET pilot_done = 1');
  await run({ llm: fakeLlm({ verdict: () => 'bad' }), deadline: Date.now() + 60000 });
  const kinds = (await db().all("SELECT kind FROM agent_batches WHERE variant_code = 'es-AR' ORDER BY seq")).map((b) => b.kind);
  assert.equal(kinds[0], 'normal');
  assert.equal(kinds[1], 'probation');
  const v = await db().get("SELECT status, paused_reason FROM agent_variants WHERE variant_code = 'es-AR'");
  assert.equal(v.status, 'paused');
  assert.match(v.paused_reason, /calidad/);
  assert.ok(await db().get("SELECT 1 FROM alerts WHERE dedupe_key = 'agent:paused:es-AR' AND severity = 'critical'"));
});

test('con la biblioteca completa la variante pasa a mantenimiento y no genera', async () => {
  await fresh();
  await db().run("UPDATE agent_variants SET library_target = 0 WHERE variant_code = 'es-ES'");
  await run({ llm: fakeLlm() });
  assert.equal((await db().get("SELECT status FROM agent_variants WHERE variant_code = 'es-ES'")).status, 'maintenance');
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM agent_batches WHERE variant_code = 'es-ES'")).n, 0);
});

test('al cambiar el día, el ciclo anterior se cierra con su informe y el déficit explicado', async () => {
  await fresh();
  await set('agent.daily_target_per_variant', 3000);
  await set('agent.daily_budget_usd', 0.4);
  await run({ llm: fakeLlm() });
  await db().run("UPDATE agent_cycles SET cycle_date = '2020-01-01'");
  await set('agent.daily_budget_usd', 0);
  await run({ llm: fakeLlm() });
  const old = await db().get("SELECT * FROM agent_cycles WHERE cycle_date = '2020-01-01'");
  assert.ok(old.finished_at);
  assert.ok(['partial', 'blocked'].includes(old.status));
  const rep = JSON.parse(old.report);
  assert.equal(rep.final, true);
  assert.ok(rep.variants.every((v) => v.shortfall_reason), 'cada variante explica su déficit');
  assert.ok(await db().get("SELECT 1 FROM alerts WHERE dedupe_key = 'agent:shortfall:2020-01-01'"));
});

test('panel: datos reales, permisos en el servidor y controles pausar, reanudar y detener', async () => {
  await fresh();
  await run({ llm: fakeLlm() });
  const o = await analyst.c.get('/api/admin/agent');
  assert.equal(o.status, 200);
  assert.equal(o.json.variants.length, 2);
  assert.equal(o.json.today.totals.approved, (await db().get("SELECT COUNT(*) AS n FROM agent_candidates WHERE status = 'approved'")).n);
  assert.ok(o.json.next_run);
  assert.equal((await analyst.c.post('/api/admin/agent/control', { state: 'paused' })).status, 403);
  assert.equal((await owner.c.post('/api/admin/agent/control', { state: 'paused', reason: 'prueba' })).status, 200);
  const r = await run({ llm: fakeLlm() });
  assert.equal(r.paused, true);
  assert.equal((await owner.c.post('/api/admin/agent/control', { state: 'stopped', reason: 'prueba' })).status, 200);
  assert.equal((await cycleRow()).status, 'stopped');
  const llm = fakeLlm();
  await run({ llm });
  assert.equal(llm.calls.generator, 0, 'detenido no genera');
  assert.equal((await owner.c.post('/api/admin/agent/control', { state: 'active' })).status, 200);
  assert.equal((await owner.c.patch('/api/admin/agent/variants/es-AR', { status: 'paused' })).status, 200);
  assert.equal((await db().get("SELECT status FROM agent_variants WHERE variant_code = 'es-AR'")).status, 'paused');
  const cands = await analyst.c.get('/api/admin/agent/candidates?variant=es-AR&limit=5');
  assert.equal(cands.status, 200);
  const rep = await analyst.c.get('/api/admin/agent/cycles/' + (await cycleRow()).cycle_date);
  assert.equal(rep.status, 200);
  assert.ok(rep.json.variants);
  assert.ok(await db().get("SELECT 1 FROM audit_log WHERE action = 'agent.control'"));
});

test('la programación es persistente: GitHub Actions cada hora, sin ejecuciones simultáneas', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'library-agent.yml'), 'utf8');
  assert.match(yml, /cron: '7 \* \* \* \*'/);
  assert.match(yml, /group: library-agent/);
  assert.match(yml, /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.match(yml, /scripts\/library-agent\.js run/);
});
