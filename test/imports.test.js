'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { makeEnv, client, staff } = require('./helpers');
const importer = require('../src/services/importer');
const { runJob } = require('../src/services/jobs');

let env; let owner; let feedServer; let feedBase;
const routes = {};
const hits = {};

test.before(async () => {
  env = await makeEnv();
  owner = await staff(env, 'owner');
  feedServer = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    const r = routes[req.url];
    if (!r) { res.statusCode = 404; return res.end('no'); }
    res.statusCode = r.status || 200;
    for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  });
  await new Promise((r) => feedServer.listen(0, '127.0.0.1', r));
  feedBase = `http://127.0.0.1:${feedServer.address().port}`;
});
test.after(async () => { await env.close(); await new Promise((r) => feedServer.close(r)); });

const verifiedItem = (id, over = {}) => ({
  id, url: `${feedBase}/clues/${id}`, clue: 'Solar de vuelta para poco espesos (5)', answer: 'RALOS', definition: 'poco espesos',
  wordplay: { op: 'reverse', indicator: 'de vuelta', of: { op: 'lit', text: 'solar' } }, language: 'es', category: 'lenguaje', difficulty: 2, mechanism: 'reversal', ...over,
});

async function createSource(body) {
  const r = await owner.c.post('/api/admin/sources', {
    name: 'Fuente de prueba', url: `${feedBase}/feed.json`, language_code: 'es', access_method: 'json_feed', content_type: 'clues',
    access_authorized: true, license_id: 'cc-by-4.0', republish_allowed: true, attribution_required: true, attribution_text: 'Fuente de prueba (CC BY 4.0)',
    frequency_minutes: 60, ...body,
  });
  assert.equal(r.status, 201, r.text);
  return r.json.id;
}
const approve = (id) => owner.c.post(`/api/admin/sources/${id}/approve`, {});
const items = (sourceId) => env.db.all('SELECT * FROM import_items WHERE source_id = ? ORDER BY imported_at, external_id', [sourceId]);

test('una fuente nueva queda pendiente y no se sincroniza hasta que se apruebe', async () => {
  routes['/feed.json'] = { body: { items: [verifiedItem('p1')] } };
  const id = await createSource();
  const s = await env.db.get('SELECT status, admin_approved_by FROM sources WHERE id = ?', [id]);
  assert.deepEqual([s.status, s.admin_approved_by], ['pending_review', null]);
  assert.equal((await owner.c.post(`/api/admin/sources/${id}/run`, {})).status, 409);
  await runJob(env.db, 'import_sources');
  assert.equal((await items(id)).length, 0, 'el cron no toca fuentes sin aprobar');
  await owner.c.post(`/api/admin/sources/${id}/disable`, {});
});

test('no se puede aprobar una fuente de crípticos sin permiso de republicación (#11)', async () => {
  const noLicense = await createSource({ license_id: 'all-rights-reserved', republish_allowed: false });
  const r = await approve(noLicense);
  assert.equal(r.status, 422);
  assert.match(r.json.message, /republicación/);
  const unauthorized = await createSource({ access_authorized: false });
  assert.equal((await approve(unauthorized)).status, 422);
  const noAttribution = await createSource({ attribution_text: '' });
  assert.equal((await approve(noAttribution)).status, 422);
});

test('importación desde una fuente autorizada (#10) con publicación automática (#12) y cola de revisión', async () => {
  routes['/feed.json'] = { body: { format: 'criptico-feed', version: 1, items: [
    verifiedItem('ok-1'),
    { id: 'asserted-1', url: `${feedBase}/clues/asserted-1`, clue: 'Taberna con cobalto, embarcación (5)', answer: 'BARCO', definition: 'embarcación',
      wordplay: { op: 'concat', indicator: 'con', parts: [{ op: 'syn', from: 'Taberna', text: 'BAR' }, { op: 'abbr', from: 'cobalto', text: 'CO' }] }, language: 'es' },
    { id: 'nowordplay-1', url: `${feedBase}/clues/nowordplay-1`, clue: 'Mezcla de lago para un poco (4)', answer: 'ALGO', definition: 'un poco', explanation: 'Anagrama de LAGO: ALGO.', language: 'es' },
    verifiedItem('wrong-1', { answer: 'RASOL' }),
    verifiedItem('foreign-1', { url: 'https://otro-sitio.example/x', clue: 'Atar de vuelta para un roedor (4)', answer: 'RATA', definition: 'un roedor', wordplay: { op: 'reverse', indicator: 'de vuelta', of: { op: 'lit', text: 'atar' } } }),
    { id: 'html-1', url: `${feedBase}/clues/html-1`, clue: '<script>alert(1)</script> (4)', answer: 'ALGO', explanation: 'x', language: 'es' },
    { id: 'missing-1', url: `${feedBase}/clues/missing-1`, clue: 'Sin respuesta (3)' },
    { id: 'dup-1', url: `${feedBase}/clues/dup-1`, clue: 'Ramo revuelto para el sentimiento (4)', answer: 'AMOR', definition: 'el sentimiento',
      wordplay: { op: 'anagram', indicator: 'revuelto', of: [{ op: 'lit', text: 'ramo' }] }, language: 'es' },
  ] } };
  const id = await createSource();
  assert.equal((await approve(id)).status, 200);
  const run = await owner.c.post(`/api/admin/sources/${id}/run`, {});
  assert.equal(run.status, 200, run.text);
  assert.equal(run.json.fetched, 8);
  const list = await items(id);
  const by = Object.fromEntries(list.map((i) => [i.external_id, i]));
  assert.equal(by['ok-1'].status, 'auto_published', by['ok-1'].checks);
  const clue = await env.db.get('SELECT * FROM clues WHERE id = ?', [by['ok-1'].clue_id]);
  assert.equal(clue.status, 'published');
  assert.equal(clue.origin, 'external');
  assert.equal(clue.source_url, `${feedBase}/clues/ok-1`);
  assert.equal(clue.license_id, 'cc-by-4.0');
  assert.equal(clue.attribution, 'Fuente de prueba (CC BY 4.0)');
  assert.ok(clue.imported_at);
  assert.ok(JSON.parse(by['ok-1'].checks).filter((c) => !c.code.startsWith('validation:')).every((c) => c.level === 'ok'), 'se guardan las 11 condiciones');
  assert.equal(by['asserted-1'].status, 'review', 'sinónimos sin comprobar: revisión humana');
  assert.equal(by['nowordplay-1'].status, 'review');
  assert.equal(by['wrong-1'].status, 'review');
  assert.ok(JSON.parse(by['wrong-1'].checks).some((c) => c.code === 'validation:wordplay_mismatch'), 'solución incorrecta detectada (#25)');
  assert.equal(by['foreign-1'].status, 'review');
  assert.ok(JSON.parse(by['foreign-1'].checks).some((c) => c.code === 'provenance_verifiable' && c.level === 'error'));
  assert.equal(by['html-1'].status, 'review');
  assert.ok(JSON.parse(by['html-1'].checks).some((c) => c.code === 'integrity_ok' && c.level === 'error'));
  assert.equal(by['missing-1'].status, 'error');
  assert.equal(by['dup-1'].status, 'duplicate', 'duplicado exacto del catálogo (#17)');
  for (const k of ['asserted-1', 'nowordplay-1', 'wrong-1', 'foreign-1', 'html-1']) assert.equal(by[k].clue_id, null, `${k} no se publica`);

  // La publicación automática se puede desactivar desde la configuración.
  await env.db.run(`UPDATE settings SET value = 'true' WHERE key = 'publishing.external_allow_asserted'`);
  routes['/feed.json'] = { body: { items: [verifiedItem('ok-2', { clue: 'Ocas de vuelta para una bolsa grande (4)', answer: 'SACO', definition: 'una bolsa grande', wordplay: { op: 'reverse', indicator: 'de vuelta', of: { op: 'lit', text: 'ocas' } } })] } };
  await env.db.run(`UPDATE settings SET value = 'false' WHERE key = 'publishing.external_autopublish'`);
  await owner.c.post(`/api/admin/sources/${id}/run`, {});
  assert.equal((await env.db.get("SELECT status FROM import_items WHERE external_id = 'ok-2'")).status, 'review');
  await env.db.run(`UPDATE settings SET value = 'true' WHERE key = 'publishing.external_autopublish'`);
  await env.db.run(`UPDATE settings SET value = 'false' WHERE key = 'publishing.external_allow_asserted'`);

  // Revisión manual de la cola: publicar uno y descartar otro.
  const pub = await owner.c.post(`/api/admin/imports/items/${by['asserted-1'].id}/publish`, {});
  assert.equal(pub.status, 200, pub.text);
  const wrong = await owner.c.post(`/api/admin/imports/items/${by['wrong-1'].id}/publish`, {});
  assert.equal(wrong.status, 422, 'con errores críticos no se publica ni a mano');
  assert.equal((await owner.c.post(`/api/admin/imports/items/${by['wrong-1'].id}/discard`, {})).status, 200);

  // Reimportar no duplica nada.
  routes['/feed.json'] = { body: { items: [verifiedItem('ok-1')] } };
  const again = await owner.c.post(`/api/admin/sources/${id}/run`, {});
  assert.equal(again.json.published, 0);
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM import_items WHERE external_id = 'ok-1'")).n, 1);
});

test('sin permisos claros no se copia el contenido (#11): solo se guarda la referencia', async () => {
  routes['/refs.json'] = { body: { items: [verifiedItem('ref-1', { clue: 'Pista protegida (5)' })] } };
  const id = await createSource({ url: `${feedBase}/refs.json`, content_type: 'metadata_only', license_id: 'all-rights-reserved', republish_allowed: false });
  assert.equal((await approve(id)).status, 200, 'una fuente de solo referencias se puede aprobar');
  await owner.c.post(`/api/admin/sources/${id}/run`, {});
  const [it] = await items(id);
  assert.equal(it.status, 'discarded');
  const payload = JSON.parse(it.payload);
  assert.deepEqual(Object.keys(payload).sort(), ['id', 'url']);
  assert.ok(!it.payload.includes('Pista protegida') && !it.payload.includes('RALOS'), 'ni pista ni respuesta se almacenan');
  assert.equal(await env.db.get("SELECT id FROM clues WHERE clue_text = 'Pista protegida (5)'"), null);
});

test('la base impide publicar externos si se revoca el permiso de la fuente', async () => {
  routes['/feed2.json'] = { body: { items: [{ id: 'q1', url: `${feedBase}/clues/q1`, clue: 'Mezcla de lago para un poco (4)', answer: 'ALGO', definition: 'un poco', explanation: 'Anagrama de LAGO.', language: 'es' }] } };
  const id = await createSource({ url: `${feedBase}/feed2.json` });
  await approve(id);
  await owner.c.post(`/api/admin/sources/${id}/run`, {});
  const [it] = await items(id);
  assert.equal(it.status, 'review');
  await env.db.run('UPDATE sources SET republish_allowed = 0 WHERE id = ?', [id]);
  const r = await owner.c.post(`/api/admin/imports/items/${it.id}/publish`, {});
  assert.equal(r.status, 422);
  assert.equal(r.json.error, 'publish_blocked_rights');
  // Editar la licencia obliga a reaprobar la fuente.
  const edit = await owner.c.patch(`/api/admin/sources/${id}`, { license_id: 'cc0-1.0' });
  assert.equal(edit.json.reapproval_required, true);
  assert.equal((await env.db.get('SELECT status FROM sources WHERE id = ?', [id])).status, 'pending_review');
});

test('errores de conexión con fuentes externas (#19): reintentos, sin eludir bloqueos, y el juego sigue', async () => {
  routes['/flaky.json'] = { status: 500, body: 'boom' };
  routes['/forbidden.json'] = { status: 403, body: 'no' };
  routes['/slow.json'] = { status: 429, headers: { 'retry-after': '7200' }, body: 'later' };
  const flaky = await createSource({ url: `${feedBase}/flaky.json` }); await approve(flaky);
  const forbidden = await createSource({ url: `${feedBase}/forbidden.json` }); await approve(forbidden);
  const slow = await createSource({ url: `${feedBase}/slow.json` }); await approve(slow);
  const down = await createSource({ url: 'http://127.0.0.1:1/feed.json' }); await approve(down);

  const f = await importer.runSource(env.db, flaky, { backoffMs: 5 });
  assert.equal(f.status, 'failed');
  assert.equal(hits['/flaky.json'], 3, 'tres intentos con espera creciente');
  const fs = await env.db.get('SELECT * FROM sources WHERE id = ?', [flaky]);
  assert.equal(fs.consecutive_failures, 1);
  assert.equal(fs.status, 'active', 'un fallo transitorio no desactiva la fuente');
  assert.ok(Date.parse(fs.next_run_at) > Date.now(), 'se reprograma');

  const fb = await importer.runSource(env.db, forbidden, { backoffMs: 5 });
  assert.equal(fb.status, 'failed');
  assert.equal(hits['/forbidden.json'], 1, 'un 403 no se reintenta');
  assert.equal((await env.db.get('SELECT status FROM sources WHERE id = ?', [forbidden])).status, 'error');

  await importer.runSource(env.db, slow, { backoffMs: 5 });
  const ss = await env.db.get('SELECT * FROM sources WHERE id = ?', [slow]);
  assert.equal(hits['/slow.json'], 1);
  assert.ok(Date.parse(ss.next_run_at) - Date.now() > 7000 * 1000, 'respeta Retry-After');

  const d = await importer.runSource(env.db, down, { backoffMs: 5 });
  assert.equal(d.status, 'failed');
  const runs = await env.db.all("SELECT status FROM import_runs WHERE source_id = ? ", [down]);
  assert.deepEqual(runs.map((r) => r.status), ['failed']);
  assert.ok((await env.db.get("SELECT COUNT(*) AS n FROM error_log WHERE scope = 'import'")).n >= 4);

  const c = client(env.base);
  const g = await c.post('/api/game/start', { choice: 'es' });
  assert.equal(g.status, 200, 'las partidas no dependen de las fuentes');
  assert.ok(g.json.clue);
});

test('credencial faltante y robots.txt que prohíbe el acceso', async () => {
  const needsToken = await createSource({ url: `${feedBase}/private.json`, auth_env_var: 'SOURCE_TEST_TOKEN' }); await approve(needsToken);
  const r = await importer.runSource(env.db, needsToken, { env: {} });
  assert.match(r.error, /falta_credencial:SOURCE_TEST_TOKEN/);
  routes['/private.json'] = { body: { items: [] } };
  const ok = await importer.runSource(env.db, needsToken, { env: { SOURCE_TEST_TOKEN: 'abc' } });
  assert.equal(ok.status, 'success');

  routes['/robots.txt'] = { body: 'User-agent: *\nDisallow: /blocked/\n' };
  routes['/blocked/feed.json'] = { body: { items: [verifiedItem('b1')] } };
  const blocked = await createSource({ url: `${feedBase}/blocked/feed.json` }); await approve(blocked);
  const b = await importer.runSource(env.db, blocked);
  assert.match(b.error, /robots/);
  assert.equal(hits['/blocked/feed.json'], undefined, 'no se descarga lo que robots.txt prohíbe');
  delete routes['/robots.txt'];
});

test('formatos CSV y RSS y carga manual', async () => {
  const csv = 'id,url,clue,answer,definition,explanation,language\n'
    + `c1,${feedBase}/c1,"Mezcla de rato para un moro, quizás (4)",TORA,,"x",es\n`;
  assert.equal(importer.parseCsv(csv)[0].clue, 'Mezcla de rato para un moro, quizás (4)');
  const rss = `<?xml version="1.0"?><rss xmlns:criptico="https://cripta.example/ns"><channel><item><guid>r1</guid><link>${feedBase}/r1</link>
    <title><![CDATA[Ocas de vuelta para una bolsa (4)]]></title><criptico:answer>SACO</criptico:answer><criptico:definition>una bolsa</criptico:definition>
    <criptico:wordplay>{"op":"reverse","indicator":"de vuelta","of":{"op":"lit","text":"ocas"}}</criptico:wordplay></item></channel></rss>`;
  const parsed = importer.parseRss(rss);
  assert.equal(parsed[0].clue, 'Ocas de vuelta para una bolsa (4)');
  assert.equal(parsed[0].wordplay.op, 'reverse');
  const manual = await createSource({ url: `${feedBase}/manual`, access_method: 'manual_upload' }); await approve(manual);
  const up = await owner.c.post(`/api/admin/sources/${manual}/upload`, { format: 'rss', content: rss.replace(feedBase + '/r1', feedBase + '/manual/r1') });
  assert.equal(up.status, 200, up.text);
  assert.equal(up.json.fetched, 1);
});
