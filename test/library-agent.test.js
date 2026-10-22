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
  await db().run("DELETE FROM clues WHERE generator_version = 'agent-2.0'");
  await db().run("DELETE FROM alerts WHERE kind = 'agent'");
  await db().run("UPDATE agent_variants SET status = 'active', paused_reason = NULL, probation = 0, cursor = 0, library_target = NULL, pilot_done = 0, exhausted_at = NULL");
  await db().run("UPDATE agent_control SET state = 'active', reason = NULL, lease_holder = NULL, lease_until = NULL, last_run_status = NULL");
  await set('agent.daily_budget_usd', 50);
  await set('agent.daily_target_per_variant', 20);
  await set('agent.batch_size', 40);
  await set('agent.pilot_batch_size', 10);
  await set('agent.concurrency', 1);
  await set('agent.mechanism_weights', require('../src/db/reference').DEFAULT_SETTINGS['agent.mechanism_weights']);
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
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM clues WHERE generator_version = 'agent-2.0' AND status = 'published'")).n, 0);
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
  await db().run("INSERT INTO agent_batches(id, cycle_id, variant_code, seq, generator_version, status) VALUES ('cut-1', ?, 'es-AR', 90, 'agent-2.0', 'running')", [c.id]);
  // el proceso murió con candidatos generados y en validación: nada se aprobó todavía
  await db().run(`INSERT INTO agent_candidates(id, batch_id, cycle_id, variant_code, status, mechanism, checks, generator_version) VALUES ('cand-v', 'cut-1', ?, 'es-AR', 'validating', 'anagram', '{}', 'agent-2.0')`, [c.id]);
  // un lote cuya escritura llegó a la base pero el proceso murió antes de verificarlo
  await db().run("INSERT INTO agent_batches(id, cycle_id, variant_code, seq, generator_version, status) VALUES ('cut-2', ?, 'es-AR', 91, 'agent-2.0', 'committed')", [c.id]);
  await db().run(`INSERT INTO agent_candidates(id, batch_id, cycle_id, variant_code, status, mechanism, checks, generator_version) VALUES ('cand-x', 'cut-2', ?, 'es-AR', 'rejected', 'anagram', '{}', 'agent-2.0')`, [c.id]);
  const r = await agent.recover(db());
  assert.deepEqual(r.map((x) => x.result).sort(), ['abandoned', 'verified']);
  assert.equal((await db().get("SELECT status FROM agent_batches WHERE id = 'cut-1'")).status, 'abandoned');
  assert.equal((await db().get("SELECT status FROM agent_batches WHERE id = 'cut-2'")).status, 'verified');
  const v = await db().get("SELECT status, reasons, clue_id FROM agent_candidates WHERE id = 'cand-v'");
  assert.deepEqual([v.status, JSON.parse(v.reasons)[0], v.clue_id], ['failed', 'interrupted', null]);
  // la ejecución siguiente sigue normalmente desde el último estado confirmado
  const before = (await db().get("SELECT cursor FROM agent_variants WHERE variant_code = 'es-AR'")).cursor;
  await run({ llm: fakeLlm() });
  assert.ok((await db().get("SELECT cursor FROM agent_variants WHERE variant_code = 'es-AR'")).cursor > before);
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM agent_candidates WHERE status IN ('generated','validating')")).n, 0);
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
  // los contadores del panel salen de la base: biblioteca por variante y mecanismo
  for (const v of o.json.variants) {
    for (const m of v.by_mechanism) {
      const n = (await db().get("SELECT COUNT(*) AS n FROM clues WHERE variant_code = ? AND mechanism = ? AND status = 'published'", [v.variant, m.mechanism])).n;
      assert.equal(m.library, n, `${v.variant} ${m.mechanism}`);
    }
    assert.equal(v.library, (await db().get("SELECT COUNT(*) AS n FROM clues WHERE variant_code = ? AND status = 'published'", [v.variant])).n);
  }
  assert.equal(o.json.agents.length, 10);
  assert.ok(o.json.taxonomy.some((x) => x.code === 'direct_definition'));
  assert.ok(o.json.infrastructure && o.json.costs && Array.isArray(o.json.reject_reasons));
  // filtros de registros
  const f = await analyst.c.get('/api/admin/agent/candidates?variant=es-AR&mechanism=anagram&status=approved&difficulty=1');
  assert.equal(f.status, 200);
  assert.ok(f.json.items.every((x) => x.variant_code === 'es-AR' && x.mechanism === 'anagram' && x.status === 'approved' && x.difficulty === 1));
  assert.equal((await analyst.c.get('/api/admin/agent/candidates?status=inventado')).status, 400);
  // cuotas: solo quien tiene settings.write; el agente no puede cambiarlas
  assert.equal((await analyst.c.put('/api/admin/settings/agent.mechanism_weights', { value: { anagram: 5 } })).status, 403);
  assert.equal((await owner.c.put('/api/admin/settings/agent.mechanism_weights', { value: { inventado: 1 } })).status, 400);
  assert.equal((await owner.c.put('/api/admin/settings/agent.concurrency', { value: 50 })).status, 400);
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

test('cuotas por peso: proporcionales, configurables y un peso 0 saca el mecanismo', () => {
  const q = agent.quotas(100000, ['anagram', 'hidden', 'homophone'], { anagram: 2, hidden: 1, homophone: 1 });
  assert.deepEqual(q, { anagram: 50000, hidden: 25000, homophone: 25000 });
  assert.deepEqual(agent.quotas(10, ['a', 'b'], { a: 1, b: 0 }), { a: 10, b: 0 });
  const eq = agent.quotas(100000, require('../src/lib/agent/mechanisms').production());
  assert.ok(Object.values(eq).every((n) => n === 10000), 'pesos iguales: 10.000 por mecanismo');
});

test('sin tope diario: produce hasta la meta de biblioteca por mecanismo y pasa a mantenimiento', async () => {
  await fresh();
  await set('agent.daily_target_per_variant', 0);
  await db().run("UPDATE agent_variants SET library_target = 10 WHERE variant_code = 'es-AR'");
  await db().run("UPDATE agent_variants SET status = 'paused' WHERE variant_code = 'es-ES'");
  const prev = {};
  for (const m of await db().all("SELECT mechanism, COUNT(*) AS n FROM clues WHERE variant_code = 'es-AR' AND status = 'published' GROUP BY mechanism")) prev[m.mechanism] = m.n;
  await run({ llm: fakeLlm() });
  // 10 de meta entre 10 mecanismos: 1 por mecanismo, contando lo que ya había; nunca se compensa con otro
  const added = await db().all("SELECT mechanism, COUNT(*) AS n FROM clues WHERE variant_code = 'es-AR' AND status = 'published' AND generator_version = 'agent-2.0' GROUP BY mechanism");
  assert.ok(added.length > 0);
  for (const m of added) assert.ok(m.n <= Math.max(0, 1 - (prev[m.mechanism] || 0)), `${m.mechanism}: ${m.n} nuevos y ${prev[m.mechanism] || 0} previos`);
  const rep = JSON.parse((await cycleRow()).report);
  assert.equal(rep.daily_cap, false);
  assert.equal(rep.totals.daily_target, null);
  const ar = rep.variants.find((v) => v.variant === 'es-AR');
  assert.equal(ar.library_target, 10);
  assert.ok(ar.by_mechanism.every((m) => m.library_target === 1 && m.target === null));
});

test('estados: nada queda a medias; la sospecha de copia va a cuarentena y no se guarda', async () => {
  await fresh();
  const base = fakeLlm();
  const llm = { ...base, async json(args) {
    const r = await base.json(args);
    if (args.schema.properties.reviews) r.data.reviews.forEach((x, k) => { if (k === 0) x.copied_suspect = true; });
    return r;
  } };
  await run({ llm });
  const states = (await db().all('SELECT DISTINCT status FROM agent_candidates')).map((x) => x.status);
  assert.ok(!states.includes('generated') && !states.includes('validating'), states.join());
  const q = await db().all("SELECT * FROM agent_candidates WHERE status = 'quarantined'");
  assert.ok(q.length > 0);
  assert.ok(q.every((x) => x.clue_id === null && JSON.parse(x.reasons).includes('copied_suspect')));
  // cada aprobado pasó también las reglas de su mecanismo (control M) y registra sus hechos
  for (const a of await db().all("SELECT checks, mechanism FROM agent_candidates WHERE status = 'approved'")) {
    const ch = JSON.parse(a.checks);
    assert.equal(ch.M.ok, true);
    assert.equal(ch.M.agent, a.mechanism);
    assert.ok(ch.M.facts);
  }
});

test('retirar contenido cuestionado: sale del juego, queda en cuarentena y en la auditoría', async () => {
  await fresh();
  await run({ llm: fakeLlm() });
  const a = await db().get("SELECT id, clue_id FROM agent_candidates WHERE status = 'approved' LIMIT 1");
  assert.equal((await analyst.c.post(`/api/admin/agent/candidates/${a.id}/quarantine`, { reason: 'x' })).status, 403);
  assert.equal((await owner.c.post(`/api/admin/agent/candidates/${a.id}/quarantine`, {})).status, 400);
  assert.equal((await owner.c.post(`/api/admin/agent/candidates/${a.id}/quarantine`, { reason: 'posible copia de un libro' })).status, 200);
  assert.equal((await db().get('SELECT status FROM clues WHERE id = ?', [a.clue_id])).status, 'disabled');
  assert.equal((await db().get('SELECT status FROM agent_candidates WHERE id = ?', [a.id])).status, 'quarantined');
  assert.ok(await db().get("SELECT 1 FROM audit_log WHERE action = 'agent.quarantine'"));
});

test('concurrencia: dos variantes a la vez sin pasarse del presupuesto ni repetir juegos de palabras', async () => {
  await fresh();
  await set('agent.concurrency', 2);
  await set('agent.daily_target_per_variant', 3000);
  await set('agent.daily_budget_usd', 5);
  const r = await run({ llm: fakeLlm() });
  assert.equal(r.concurrency, 2);
  const c = await cycleRow();
  assert.ok(c.cost_usd <= 5, `gastó ${c.cost_usd}`);
  const vb = await db().all('SELECT variant_code, status, error, cost_usd FROM agent_batches');
  assert.equal(new Set(vb.filter((b) => b.status === 'verified').map((b) => b.variant_code)).size, 2, JSON.stringify({ vb, batches: r.batches }));
  const dup = await db().get("SELECT dedup_key, COUNT(*) AS n FROM clues WHERE generator_version = 'agent-2.0' GROUP BY dedup_key HAVING n > 1");
  assert.ok(!dup, JSON.stringify(dup));
});

test('idempotencia: repetir la verificación o la recuperación no duplica nada', async () => {
  await fresh();
  await run({ llm: fakeLlm() });
  const count = async () => (await db().get("SELECT COUNT(*) AS n FROM clues WHERE generator_version = 'agent-2.0'")).n;
  const n = await count();
  for (const b of await db().all("SELECT id FROM agent_batches WHERE status = 'verified'")) await agent.verifyBatch(db(), b.id);
  await agent.recover(db());
  assert.equal(await count(), n);
  // cada registro aprobado está efectivamente guardado y publicado
  assert.equal((await db().get("SELECT COUNT(*) AS n FROM agent_candidates c LEFT JOIN clues k ON k.id = c.clue_id WHERE c.status = 'approved' AND (k.id IS NULL OR k.status <> 'published')")).n, 0);
});
