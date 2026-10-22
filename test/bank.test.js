'use strict';

// Banco de crípticos: metas por idioma y dificultad, lotes reanudables,
// deduplicación, derechos, auditoría, permisos e integración con el juego.
// Los números «#n» siguen la lista de pruebas finales pedida.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeEnv, client, staff } = require('./helpers');
const bank = require('../src/services/bank');
const { engine } = require('../src/lib/bank/generate');
const { validateClue } = require('../src/lib/validator');
const lexicon = require('../src/lib/bank/lexicon');

let env; let owner; let analyst; let moderator;
test.before(async () => {
  env = await makeEnv();
  owner = await staff(env, 'owner');
  analyst = await staff(env, 'analyst');
  moderator = await staff(env, 'moderator');
});
test.after(async () => { await env.close(); });

const cell = async (lang, d) => (await bank.matrix(env.db)).cells.find((c) => c.lang === lang && c.difficulty === d);

test('#1 cada idioma activo está documentado y tiene léxico', async () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'BANCO.md'), 'utf8');
  const langs = await env.db.all('SELECT code FROM languages WHERE enabled = 1');
  assert.ok(langs.length >= 2);
  for (const { code } of langs) {
    assert.match(doc, new RegExp('### ' + code + ' ', 'i'), `docs/BANCO.md documenta ${code}`);
    assert.ok(lexicon.available(code), `hay léxico para ${code}`);
  }
});

test('#2 las metas son independientes por idioma y dificultad', async () => {
  await bank.ensureTargets(env.db);
  const rows = await env.db.all('SELECT * FROM bank_targets');
  assert.equal(rows.length, 10, '2 idiomas × 5 dificultades');
  assert.ok(rows.every((r) => r.target === 10000));
  await bank.setCell(env.db, 'en', 4, { target: 12000 }, owner.user);
  const after = await env.db.all('SELECT language_code, difficulty, target FROM bank_targets WHERE target <> 10000');
  assert.deepEqual(after, [{ language_code: 'en', difficulty: 4, target: 12000 }]);
  await bank.setCell(env.db, 'en', 4, { target: 10000 }, owner.user);
});

test('el generador solo propone pistas que el validador acepta y con evidencia léxica comprobable', async () => {
  for (const lang of ['es', 'en']) {
    const E = engine(lang);
    let n = 0;
    for (const i of E.answers().slice(0, 60)) {
      for (const c of E.candidates(i)) {
        const r = validateClue(c);
        assert.equal(r.errors, 0, `${c.clue_text} → ${c.answer}: ${JSON.stringify(r.checks.filter((x) => x.level === 'error'))}`);
        assert.ok(bank.verifyEvidence(lang, c).ok, `evidencia de ${c.clue_text}`);
        assert.ok(c.difficulty >= 1 && c.difficulty <= 5);
        assert.ok(c.hints.length >= 3 && c.hints[0].kind === 'mechanism');
        assert.ok(c.dedup_key.startsWith(lang + '|'));
        n++;
      }
    }
    assert.ok(n > 20, `${lang}: hay candidatos (${n})`);
  }
});

test('#3 un lote guarda registros reales y solo se marca verificado después de releer la base', async () => {
  const r = await bank.runBatch(env.db, { lang: 'es', difficulty: 3, size: 25 });
  assert.ok(r.batch_id);
  const b = await env.db.get('SELECT * FROM generation_batches WHERE id = ?', [r.batch_id]);
  assert.equal(b.status, 'verified');
  assert.ok(b.verified_at);
  const rows = await env.db.all('SELECT * FROM clues WHERE batch_id = ?', [r.batch_id]);
  assert.equal(rows.length, r.published + r.pending);
  assert.ok(r.published > 0);
  for (const c of rows) {
    assert.equal(c.origin, 'generated');
    assert.equal(c.language_code, 'es');
    assert.equal(c.difficulty, 3);
    assert.equal(c.rights_status, 'original');
    assert.ok(c.dedup_key && c.answer_length === c.answer_key.length && c.generator_version);
    assert.ok(JSON.parse(c.explanation).length >= 2, 'explicación paso a paso');
    assert.ok(JSON.parse(c.hints).length >= 3, 'pistas progresivas');
    assert.ok(JSON.parse(c.evidence).length >= 1, 'evidencia léxica');
    assert.ok(Array.isArray(JSON.parse(c.mechanisms_secondary)));
    assert.ok(c.shuffle !== null);
    if (c.status === 'published') assert.equal(c.validation_errors, 0);
  }
  const ev = await env.db.get("SELECT COUNT(*) AS n FROM clue_events WHERE actor_kind = 'generator' AND clue_id IN (SELECT id FROM clues WHERE batch_id = ?)", [r.batch_id]);
  assert.equal(ev.n, rows.length, 'historial de cada críptico');
  const t = await env.db.get("SELECT cursor FROM bank_targets WHERE language_code = 'es' AND difficulty = 3");
  assert.equal(t.cursor, r.cursor_to);
});

test('#4 no hay duplicados: el lote siguiente continúa sin repetir y la base rechaza el mismo juego de palabras', async () => {
  const r2 = await bank.runBatch(env.db, { lang: 'es', difficulty: 3, size: 25 });
  const prev = await env.db.get("SELECT MAX(cursor_end) AS c FROM generation_batches WHERE language_code = 'es' AND difficulty = 3 AND id <> ?", [r2.batch_id]);
  assert.equal(r2.cursor_from, prev.c, 'retoma desde el último cursor confirmado');
  const dupKeys = await env.db.get('SELECT COUNT(*) AS n FROM (SELECT dedup_key FROM clues WHERE dedup_key IS NOT NULL GROUP BY dedup_key HAVING COUNT(*) > 1)');
  assert.equal(dupKeys.n, 0);
  const dupFp = await env.db.get('SELECT COUNT(*) AS n FROM (SELECT fingerprint FROM clues GROUP BY fingerprint HAVING COUNT(*) > 1)');
  assert.equal(dupFp.n, 0);
  const one = await env.db.get('SELECT * FROM clues WHERE batch_id = ? LIMIT 1', [r2.batch_id]);
  await assert.rejects(env.db.run('INSERT INTO clues(id, slug, clue_text, answer, answer_key, enumeration, explanation, language_code, difficulty, mechanism, origin, fingerprint, dedup_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ['x1', 'x1', 'Otra redacción (4)', one.answer, one.answer_key, one.enumeration, '[]', 'es', 3, one.mechanism, 'generated', 'fp-otro', one.dedup_key]), /UNIQUE/);
  // Volver a procesar desde cero (por ejemplo tras cambiar de versión) solo produce duplicados descartados.
  await env.db.run("UPDATE bank_targets SET cursor = 0 WHERE language_code = 'es' AND difficulty = 3");
  const again = await bank.runBatch(env.db, { lang: 'es', difficulty: 3, size: 10 });
  const fresh = await env.db.all('SELECT dedup_key FROM clues WHERE batch_id = ?', [again.batch_id]);
  assert.ok(again.duplicates > 0, 'detecta lo ya guardado');
  assert.equal(new Set(fresh.map((f) => f.dedup_key)).size, fresh.length);
});

test('#5 lo rechazado, pendiente o sin permiso no cuenta para la meta', async () => {
  const before = await cell('es', 3);
  const some = await env.db.all("SELECT id FROM clues WHERE language_code = 'es' AND difficulty = 3 AND status = 'published' AND origin = 'generated' LIMIT 3");
  await env.db.run(`UPDATE clues SET status = 'review' WHERE id = ?`, [some[0].id]);
  await env.db.run(`UPDATE clues SET status = 'disabled' WHERE id = ?`, [some[1].id]);
  const after = await cell('es', 3);
  assert.equal(after.published, before.published - 2);
  assert.equal(after.pending, before.pending + 1);
  // Un externo sin permiso verificado queda en cuarentena: la base impide publicarlo.
  await env.db.run("UPDATE clues SET rights_status = 'unverified' WHERE id = ?", [some[2].id]);
  await assert.rejects(env.db.run("UPDATE clues SET status = 'review' WHERE id = ?", [some[2].id]).then(() => env.db.run("UPDATE clues SET status = 'published' WHERE id = ?", [some[2].id])), /publish_blocked: rights/);
  await env.db.run("UPDATE clues SET rights_status = 'reference_only' WHERE id = ?", [some[2].id]);
  await assert.rejects(env.db.run("UPDATE clues SET status = 'published' WHERE id = ?", [some[2].id]), /publish_blocked: rights/);
  const q = await cell('es', 3);
  assert.equal(q.published, before.published - 3);
  assert.ok(q.unverified >= 1);
  // vuelve a su estado para no afectar a las demás pruebas
  await env.db.run("UPDATE clues SET rights_status = 'original' WHERE id = ?", [some[2].id]);
  for (const s of some) await env.db.run("UPDATE clues SET status = 'published' WHERE id = ?", [s.id]);
});

test('#5b fuente externa con permiso vencido o revisión legal rechazada no publica', async () => {
  const src = 'src-' + Math.random().toString(36).slice(2, 8);
  await env.db.run(`INSERT INTO sources(id, name, url, language_code, access_method, access_authorized, license_id, republish_allowed, status, admin_approved_by, legal_review, permission_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [src, 'Prueba', 'https://example.org', 'es', 'manual_upload', 1, 'cc-by-4.0', 1, 'active', owner.user.id, 'approved', '2000-01-01T00:00:00Z']);
  const ins = (id, status) => env.db.run(`INSERT INTO clues(id, slug, clue_text, answer, answer_key, enumeration, explanation, language_code, difficulty, mechanism, origin, status, source_id, license_id, validation_status, fingerprint, rights_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, id, 'Pista externa de prueba (4)', 'CASA', 'CASA', '4', '[]', 'es', 2, 'anagram', 'external', status, src, 'cc-by-4.0', 'asserted', 'fp-' + id, 'licensed']);
  await assert.rejects(ins('ext1', 'published'), /publish_blocked: rights/, 'permiso vencido');
  await env.db.run('UPDATE sources SET permission_expires_at = NULL, legal_review = ? WHERE id = ?', ['rejected', src]);
  await assert.rejects(ins('ext2', 'published'), /publish_blocked: rights/, 'revisión legal rechazada');
  await env.db.run('UPDATE sources SET legal_review = ? WHERE id = ?', ['approved', src]);
  await ins('ext3', 'published');
  const pub = require('../src/services/clues').publicClue(await env.db.get("SELECT * FROM clues WHERE id = 'ext3'"));
  assert.equal(pub.license, 'cc-by-4.0');
  assert.equal(pub.author, null, 'autor desconocido se guarda vacío, nunca inventado');
  await env.db.run("DELETE FROM clues WHERE id = 'ext3'");
});

test('#6 #8 un críptico generado se juega: respuesta, pistas con indicador, explicación, estadísticas y perfil', async () => {
  await env.db.run("UPDATE languages SET enabled = 1 WHERE code = 'es'");
  const c = client(env.base);
  const s = await c.post('/api/game/start', { choice: 'es', difficulty: 3, mode: 'infinite' });
  assert.equal(s.status, 200, s.text);
  const row = await env.db.get('SELECT c.* FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.id = ?', [s.json.game_id]);
  assert.equal(row.difficulty, 3);
  assert.equal(s.json.clue.answer, undefined, 'la respuesta no viaja antes de tiempo');
  const h = await c.post(`/api/game/${s.json.game_id}/hint`, {});
  assert.equal(h.json.hints[0].kind, 'mechanism');
  if (row.origin === 'generated') assert.ok(h.json.hints[0].indicator || row.mechanism === 'double_definition' || row.mechanism === 'charade');
  const ok = await c.post(`/api/game/${s.json.game_id}/guess`, { answer: row.answer.toLowerCase() });
  assert.equal(ok.json.correct, true);
  assert.ok(ok.json.solution.explanation.length >= 2);
  assert.ok(ok.json.solution.explanation.some((x) => x.includes(row.answer)), 'la explicación llega a la respuesta');
  const g = await env.db.get('SELECT status, result FROM games WHERE id = ?', [s.json.game_id]);
  assert.equal(g.status, 'solved');
  const stats = await c.get('/api/me/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.json.solved >= 1, 'la estadística del jugador cuenta la partida');
  assert.ok(stats.json.mechanisms_solved.includes(row.mechanism));
  const prof = await c.get('/api/me/profile');
  assert.equal(prof.status, 200, prof.text);
});

test('#7 la atribución del origen se muestra: generados enlazan a créditos y los créditos nombran cada fuente', async () => {
  const c = client(env.base);
  const page = await c.get('/es/creditos');
  assert.equal(page.status, 200);
  for (const s of ['Multilingual Central Repository', 'WordNet', 'OpenThesaurus', 'CMU', 'wordfreq', 'CC BY 3.0']) assert.ok(page.text.includes(s), s);
  const en = await c.get('/en/credits');
  assert.equal(en.status, 301);
  assert.equal(en.headers.get('location'), '/es/creditos');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(js, /c\.origin === 'generated'/);
  assert.match(js, /author_unknown/);
});

test('#10 se reanuda sin pérdida: una escritura fallida no mueve el cursor y un corte después de guardar se verifica al volver', async () => {
  const before = await env.db.get("SELECT cursor FROM bank_targets WHERE language_code = 'en' AND difficulty = 2");
  const count0 = (await env.db.get("SELECT COUNT(*) AS n FROM clues WHERE language_code = 'en' AND difficulty = 2")).n;
  const realBatch = env.db.client.batch.bind(env.db.client);
  env.db.client.batch = async () => { throw new Error('conexión cortada (simulada)'); };
  await assert.rejects(bank.runBatch(env.db, { lang: 'en', difficulty: 2, size: 15 }), /conexión cortada/);
  env.db.client.batch = realBatch;
  const failed = await env.db.get("SELECT * FROM generation_batches WHERE language_code = 'en' AND difficulty = 2 ORDER BY started_at DESC LIMIT 1");
  assert.equal(failed.status, 'failed');
  assert.equal((await env.db.get("SELECT cursor FROM bank_targets WHERE language_code = 'en' AND difficulty = 2")).cursor, before ? before.cursor : 0);
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM clues WHERE language_code = 'en' AND difficulty = 2")).n, count0, 'nada a medias');
  const t = await env.db.get("SELECT status, lease_until FROM bank_targets WHERE language_code = 'en' AND difficulty = 2");
  assert.equal(t.lease_until, null, 'libera la celda');

  // Corte justo después de guardar: el lote queda "committed" y el proceso muere antes de verificar.
  const ok = await bank.runBatch(env.db, { lang: 'en', difficulty: 2, size: 15 });
  assert.equal(ok.cursor_from, before ? before.cursor : 0, 'retoma del mismo punto');
  await env.db.run("UPDATE generation_batches SET status = 'committed', verified_at = NULL WHERE id = ?", [ok.batch_id]);
  await bank.recoverCell(env.db, 'en', 2);
  assert.equal((await env.db.get('SELECT status FROM generation_batches WHERE id = ?', [ok.batch_id])).status, 'verified');

  // Un lote "running" sin registros (proceso muerto antes de escribir) se abandona.
  await env.db.run(`INSERT INTO generation_batches(id, run_id, language_code, difficulty, seq, generator_version, cursor_start) VALUES ('dead', 'r', 'en', 2, 999, 'x', 0)`);
  await bank.recoverCell(env.db, 'en', 2);
  assert.equal((await env.db.get("SELECT status FROM generation_batches WHERE id = 'dead'")).status, 'abandoned');
});

test('una celda ocupada no se procesa dos veces a la vez y una pausada no corre', async () => {
  const until = new Date(Date.now() + 60000).toISOString();
  await env.db.run("UPDATE bank_targets SET lease_until = ? WHERE language_code = 'en' AND difficulty = 1", [until]);
  assert.deepEqual(await bank.runBatch(env.db, { lang: 'en', difficulty: 1, size: 5 }), { skipped: 'busy_or_paused' });
  await env.db.run("UPDATE bank_targets SET lease_until = NULL, status = 'paused' WHERE language_code = 'en' AND difficulty = 1");
  assert.deepEqual(await bank.runBatch(env.db, { lang: 'en', difficulty: 1, size: 5 }), { skipped: 'busy_or_paused' });
  await env.db.run("UPDATE bank_targets SET status = 'idle' WHERE language_code = 'en' AND difficulty = 1");
});

test('varias celdas en paralelo con concurrencia acotada', async () => {
  const r = await bank.runCells(env.db, { langs: ['en'], difficulties: [3, 4], batches: 1, size: 8, concurrency: 2 });
  assert.equal(r.results.length, 2);
  assert.ok(r.results.every((x) => !x.error), JSON.stringify(r.results));
});

test('#11 permisos del panel: el analista lee, no ejecuta; el moderador audita; un jugador no entra', async () => {
  assert.equal((await analyst.c.get('/api/admin/bank/matrix')).status, 200);
  assert.equal((await analyst.c.post('/api/admin/bank/cells/es/2/run', { size: 5 })).status, 403);
  assert.equal((await analyst.c.post('/api/admin/bank/audits/1', { verdict: 'ok' })).status, 403);
  assert.equal((await moderator.c.get('/api/admin/bank/audits')).status, 200);
  assert.equal((await moderator.c.post('/api/admin/bank/cells/es/2/run', { size: 5 })).status, 403);
  assert.equal((await moderator.c.patch('/api/admin/bank/cells/es/2', { target: 5 })).status, 403);
  const player = await staff(env, 'player');
  assert.ok([401, 403].includes((await player.c.get('/api/admin/bank/matrix')).status));
  const anon = client(env.base);
  assert.ok([401, 403].includes((await anon.get('/api/admin/bank/matrix')).status));
  const run = await owner.c.post('/api/admin/bank/cells/es/2/run', { size: 5 });
  assert.equal(run.status, 200, run.text);
  const m = await owner.c.get('/api/admin/bank/matrix?lang=es');
  assert.ok(m.json.cells.every((x) => x.lang === 'es'));
  assert.equal(m.json.cells.length, 5);
  const csv = await owner.c.get('/api/admin/export/bank.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.text, /lang,difficulty,target,generated/);
  const cat = await owner.c.get('/api/admin/export/catalog.csv?lang=es&difficulty=3');
  assert.match(cat.text, /rights_status/);
  const list = await owner.c.get('/api/admin/clues?language_code=es&difficulty=3&origin=generated');
  assert.ok(list.json.items.length > 0 && list.json.items.every((x) => x.difficulty === 3));
  const audit = await env.db.get("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bank.run'");
  assert.ok(audit.n >= 1, 'queda registrado quién ejecutó');
});

test('#12 auditoría por muestra: rechazar retira el críptico y demasiados rechazos suspenden el lote', async () => {
  const q = await moderator.c.get('/api/admin/bank/audits?limit=50');
  assert.ok(q.json.items.length >= 3, 'cada lote separa una muestra');
  const byBatch = {};
  for (const it of q.json.items) (byBatch[it.batch_id] = byBatch[it.batch_id] || []).push(it);
  const [batchId, items] = Object.entries(byBatch).sort((a, b) => b[1].length - a[1].length)[0];
  assert.ok(items.length >= 3);
  const r1 = await moderator.c.post('/api/admin/bank/audits/' + items[0].audit_id, { verdict: 'rejected', reason: 'definición forzada' });
  assert.equal(r1.status, 200);
  assert.equal((await env.db.get('SELECT status FROM clues WHERE id = ?', [items[0].id])).status, 'disabled');
  await moderator.c.post('/api/admin/bank/audits/' + items[1].audit_id, { verdict: 'rejected' });
  const r3 = await moderator.c.post('/api/admin/bank/audits/' + items[2].audit_id, { verdict: 'ok' });
  assert.equal(r3.json.suspended, true, '2 de 3 rechazados supera el 20 %');
  assert.equal((await env.db.get('SELECT status FROM generation_batches WHERE id = ?', [batchId])).status, 'suspended');
  const still = await env.db.get("SELECT COUNT(*) AS n FROM clues WHERE batch_id = ? AND status = 'published'", [batchId]);
  assert.equal(still.n, 0, 'el lote completo sale de las partidas');
});

test('#13 jugar no carga el generador ni hace llamadas externas', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'game.js'), 'utf8');
  assert.doesNotMatch(src, /lib\/bank|fetch\(|https?:\/\//);
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api.js'), 'utf8');
  assert.doesNotMatch(routes, /lib\/bank|services\/bank/);
});

test('sorteo rápido con muchos crípticos: no repite los recientes y lee pocas filas', async () => {
  const c = client(env.base);
  const seen = new Set();
  for (let k = 0; k < 12; k++) {
    const s = await c.post('/api/game/start', { choice: 'en', mode: 'infinite' });
    assert.equal(s.status, 200, s.text);
    const id = (await env.db.get('SELECT clue_id FROM games WHERE id = ?', [s.json.game_id])).clue_id;
    assert.ok(!seen.has(id), 'no repite mientras haya crípticos sin ver');
    seen.add(id);
    await c.post(`/api/game/${s.json.game_id}/skip`, {});
  }
  const plan = await env.db.all("EXPLAIN QUERY PLAN SELECT c.* FROM clues c WHERE c.status = 'published' AND c.language_code = 'en' AND c.difficulty = 2 AND c.shuffle > 5 ORDER BY c.shuffle LIMIT 60");
  assert.ok(plan.some((p) => /idx_clues_shuffle/.test(p.detail)), JSON.stringify(plan));
});
