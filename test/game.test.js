'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client } = require('./helpers');

let env;
test.before(async () => { env = await makeEnv(); });
test.after(async () => { await env.close(); });

// Junta el texto de todos los sitemaps que lista el índice.
async function sitemaps(c) {
  const idx = (await c.get('/sitemap.xml')).text;
  const parts = [];
  for (const m of idx.matchAll(/<loc>[^<]*?(\/sitemap-[\w-]+\.xml)<\/loc>/g)) parts.push((await c.get(m[1])).text);
  return parts.join('');
}
const answerOf = async (clueId) => (await env.db.get('SELECT answer FROM clues WHERE id = ?', [clueId])).answer;

test('inicio de partida (#4): devuelve la pista sin la respuesta ni el desglose', async () => {
  const c = client(env.base);
  const r = await c.post('/api/game/start', { choice: 'es', country: 'AR', mode: 'infinite' });
  assert.equal(r.status, 200);
  assert.ok(r.json.game_id && r.json.clue && r.json.clue.clue);
  assert.match(r.json.clue.clue, /\(\d+(,\d+)*\)$/);
  const answer = await answerOf(r.json.clue.id);
  assert.ok(!r.text.includes(`"${answer}"`), 'la respuesta no viaja al navegador');
  for (const k of ['answer', 'wordplay', 'explanation', 'definition']) assert.equal(r.json.clue[k], undefined);
  assert.ok(c.jar.pid, 'se crea un jugador anónimo con cookie');
});

test('validación de respuestas correctas e incorrectas (#5) y explicación (#6)', async () => {
  const c = client(env.base);
  const s = await c.post('/api/game/start', { choice: 'en', mode: 'infinite' });
  const wrong = await c.post(`/api/game/${s.json.game_id}/guess`, { answer: 'zzzzzz' });
  assert.equal(wrong.json.correct, false);
  assert.equal(wrong.json.solution, undefined, 'una respuesta incorrecta no revela la solución');
  const answer = await answerOf(s.json.clue.id);
  const right = await c.post(`/api/game/${s.json.game_id}/guess`, { answer: ` ${answer.toLowerCase()} ` });
  assert.equal(right.json.correct, true);
  assert.equal(right.json.attempts, 2);
  assert.equal(right.json.solution.answer, answer);
  assert.ok(right.json.solution.explanation.length >= 2);
  assert.ok(right.json.solution.explanation.at(-1).includes(answer));
  // Reenviar tras terminar no penaliza ni suma intentos.
  const again = await c.post(`/api/game/${s.json.game_id}/guess`, { answer: 'otra' });
  assert.equal(again.json.finished, true);
  const g = await env.db.get('SELECT attempts, result FROM games WHERE id = ?', [s.json.game_id]);
  assert.deepEqual([g.attempts, g.result], [2, 'solved']);
});

test('tildes y Ñ (#23): PANAMÁ se acepta como "panama"; AÑO no se acepta como ANO', async () => {
  const c = client(env.base);
  const clue = await env.db.get("SELECT id, slug FROM clues WHERE answer = 'PANAMÁ'");
  assert.ok(!clue.slug.includes('panama'), 'el enlace no revela la respuesta: ' + clue.slug);
  const s = await c.post('/api/game/start', { choice: 'es', mode: 'shared', slug: clue.slug });
  assert.equal(s.json.clue.clue, 'Alimento horneado que adora un país centroamericano (6)');
  const r = await c.post(`/api/game/${s.json.game_id}/guess`, { answer: 'panama' });
  assert.equal(r.json.correct, true);
  assert.equal(r.json.solution.answer, 'PANAMÁ');
  // Creamos una partida con respuesta que lleva Ñ para comprobar el rechazo de la N.
  const { buildClue, insertClue } = require('../src/services/clues');
  const { row } = await buildClue(env.db, { clue_text: 'Doce meses de nado sin principio (3)', answer: 'AÑO', definition: 'Doce meses', language_code: 'es',
    wordplay: { op: 'delete', indicator: 'sin principio', remove: 'first', of: { op: 'syn', from: 'nado', text: 'NAÑO' } } });
  // NAÑO no es palabra: el validador lo marca, pero sirve para probar la comparación de respuestas.
  const inserted = await insertClue(env.db, { ...row, validation_status: 'verified', validation_errors: 0, origin: 'original', status: 'published' }, { actorKind: 'seed' });
  const s2 = await c.post('/api/game/start', { choice: 'es', mode: 'shared', slug: inserted.slug });
  const ano = await c.post(`/api/game/${s2.json.game_id}/guess`, { answer: 'ANO' });
  assert.equal(ano.json.correct, false);
  assert.equal(ano.json.feedback[0].code, 'enye');
  assert.equal((await c.post(`/api/game/${s2.json.game_id}/guess`, { answer: 'año' })).json.correct, true);
  await env.db.run('DELETE FROM clues WHERE id = ?', [inserted.id]);
});

test('pistas progresivas, revelar y reiniciar', async () => {
  const c = client(env.base);
  const s = await c.post('/api/game/start', { choice: 'es', mode: 'infinite' });
  const kinds = [];
  for (let i = 0; i < 5; i++) {
    const h = await c.post(`/api/game/${s.json.game_id}/hint`, {});
    kinds.push(h.json.hints.map((x) => x.kind).join(','));
  }
  assert.deepEqual(kinds.slice(0, 4), ['mechanism', 'mechanism,definition', 'mechanism,definition,first_letter', 'mechanism,definition,first_letter,pattern']);
  assert.equal(kinds[4], kinds[3], 'no pasa del máximo');
  const rev = await c.post(`/api/game/${s.json.game_id}/reveal`, {});
  assert.ok(rev.json.solution.answer);
  const restart = await c.post(`/api/game/${s.json.game_id}/restart`, {});
  assert.equal(restart.status, 200);
  assert.equal(restart.json.clue.id, s.json.clue.id);
});

test('modo infinito sin límite diario (#7) y sin repeticiones innecesarias (#8)', async () => {
  const c = client(env.base);
  const pool = (await env.db.get("SELECT COUNT(*) AS n FROM clues WHERE status = 'published' AND language_code = 'en'")).n;
  const seen = [];
  for (let i = 0; i < pool + 15; i++) {
    const s = await c.post('/api/game/start', { choice: 'en', mode: 'infinite' });
    assert.equal(s.status, 200, `partida ${i + 1}`);
    assert.ok(s.json.clue, `partida ${i + 1} tiene pista`);
    seen.push(s.json.clue.id);
    if (i % 2) await c.post(`/api/game/${s.json.game_id}/skip`, {});
  }
  const firstRound = seen.slice(0, pool);
  assert.equal(new Set(firstRound).size, pool, 'no se repite ninguno hasta agotar el conjunto');
  assert.equal(seen.length, pool + 15, `jugó ${seen.length} partidas seguidas sin límite`);
});

test('país e idioma son independientes en el servidor (#2, #3)', async () => {
  const c = client(env.base);
  const a = await c.post('/api/game/start', { choice: 'en-GB', country: 'AR', mode: 'infinite' });
  assert.equal(a.json.clue.language, 'en', 'vivir en Argentina no cambia el idioma de juego');
  const b = await c.post('/api/game/start', { choice: 'es-AR', country: 'ES', mode: 'infinite' });
  assert.equal(b.json.clue.language, 'es');
  assert.ok([null, 'es-AR'].includes(b.json.clue.variant), 'en España se puede jugar con la variante de Argentina');
  const p = await env.db.get('SELECT country_code, play_variant FROM players WHERE id = ?', [c.jar.pid]);
  assert.deepEqual([p.country_code, p.play_variant], ['ES', 'es-AR']);
});

test('variantes: nunca aparecen pistas de otra región', async () => {
  const c = client(env.base);
  for (let i = 0; i < 30; i++) {
    const s = await c.post('/api/game/start', { choice: 'es-ES', mode: 'infinite' });
    assert.ok([null, 'es-ES'].includes(s.json.clue.variant), 'solo generales o de España');
  }
});

test('sin contenido en un idioma o variante (#24): se informa y se ofrecen alternativas', async () => {
  const c = client(env.base);
  const fr = await c.post('/api/game/start', { choice: 'fr', mode: 'infinite' });
  assert.equal(fr.status, 200);
  assert.equal(fr.json.clue, null);
  assert.equal(fr.json.notice.kind, 'language_unavailable');
  const mx = await c.post('/api/game/start', { choice: 'es-MX', mode: 'infinite' });
  assert.ok(mx.json.clue, 'se juega con los generales');
  assert.equal(mx.json.notice.kind, 'few_regional');
  // Idioma activo pero sin crípticos publicados.
  await env.db.run("UPDATE languages SET enabled = 1 WHERE code = 'it'");
  const it = await c.post('/api/game/start', { choice: 'it', mode: 'infinite' });
  assert.equal(it.json.clue, null);
  assert.equal(it.json.notice.kind, 'empty');
  assert.ok(it.json.notice.alternatives.length >= 2);
  await env.db.run("UPDATE languages SET enabled = 0 WHERE code = 'it'");
});

test('modos: principiante filtra dificultad, temático exige categoría, un modo desactivado se rechaza', async () => {
  const c = client(env.base);
  for (let i = 0; i < 10; i++) {
    const s = await c.post('/api/game/start', { choice: 'es', mode: 'beginner' });
    assert.ok(s.json.clue.difficulty <= 2);
  }
  const th = await c.post('/api/game/start', { choice: 'es', mode: 'themed', category: 'comida' });
  assert.equal(th.json.clue.category, 'comida');
  assert.equal((await c.post('/api/game/start', { choice: 'es', mode: 'themed' })).status, 400);
  const timed = await c.post('/api/game/start', { choice: 'es', mode: 'timed' });
  assert.ok(timed.json.timed_seconds > 0);
  await env.db.run(`UPDATE settings SET value = '["infinite","daily"]' WHERE key = 'modes.enabled'`);
  assert.equal((await c.post('/api/game/start', { choice: 'es', mode: 'expert' })).status, 403);
  assert.equal((await c.post('/api/game/start', { choice: 'es', mode: 'infinite' })).status, 200, 'el infinito sigue activo');
  await env.db.run('DELETE FROM settings WHERE key = ?', ['modes.enabled']);
  await require('../src/db/reference').seedReference(env.db);
});

test('desafío diario: mismo críptico para todos y opcional', async () => {
  const a = client(env.base); const b = client(env.base);
  const da = await a.post('/api/daily/start', { choice: 'es' });
  const db = await b.post('/api/daily/start', { choice: 'es-AR' });
  assert.equal(da.json.clue.id, db.json.clue.id);
  assert.equal(da.json.clue.variant, null, 'el diario usa crípticos de uso general');
  const answer = await answerOf(da.json.clue.id);
  const solved = await a.post(`/api/game/${da.json.game_id}/guess`, { answer });
  assert.equal(solved.json.daily.players >= 1, true);
  const again = await a.post('/api/daily/start', { choice: 'es' });
  assert.equal(again.json.game_id, da.json.game_id, 'retoma la misma partida');
  assert.equal(again.json.finished.result, 'solved');
  assert.equal((await a.post('/api/game/start', { choice: 'es', mode: 'infinite' })).status, 200, 'el diario no limita el infinito');
});

test('una partida ajena no se puede manipular', async () => {
  const a = client(env.base); const b = client(env.base);
  const s = await a.post('/api/game/start', { choice: 'es' });
  await b.post('/api/game/start', { choice: 'es' });
  assert.equal((await b.post(`/api/game/${s.json.game_id}/reveal`, {})).status, 404);
  assert.equal((await client(env.base).post(`/api/game/${s.json.game_id}/guess`, { answer: 'x' })).status, 404);
});

test('archivo con filtros y paginación; informe de errores con límite', async () => {
  const c = client(env.base);
  const r = await c.get('/api/clues?lang=es&difficulty=1');
  assert.ok(r.json.total > 0);
  assert.ok(r.json.items.every((x) => x.difficulty === 1 && x.language === 'es' && x.answer === undefined));
  const page = await c.get('/es/archivo?lang=en&page=1');
  assert.equal(page.status, 200);
  assert.match(page.text, /clue-row/);
  const id = r.json.items[0].id;
  assert.equal((await c.post(`/api/clues/${id}/report`, { reason: 'typo', message: 'prueba' })).status, 200);
  assert.equal((await c.post(`/api/clues/${id}/report`, { reason: 'nope' })).status, 400);
  const rep = await env.db.get('SELECT COUNT(*) AS n FROM clue_reports WHERE clue_id = ?', [id]);
  assert.equal(rep.n, 1);
});

test('estadísticas y rachas del jugador', async () => {
  const c = client(env.base);
  for (let i = 0; i < 3; i++) {
    const s = await c.post('/api/game/start', { choice: 'es' });
    await c.post(`/api/game/${s.json.game_id}/guess`, { answer: await answerOf(s.json.clue.id) });
  }
  const st = await c.get('/api/me/stats');
  assert.equal(st.json.played, 3);
  assert.equal(st.json.solved, 3);
  assert.equal(st.json.current_streak, 3);
  assert.ok(st.json.achievements.includes('first_solve'));
});

test('páginas públicas: SEO básico, hreflang y caracteres especiales (#23)', async () => {
  const c = client(env.base);
  const home = await c.get('/es');
  assert.match(home.text, /<html lang="es">/);
  assert.match(home.text, /hreflang="es"/);
  assert.doesNotMatch(home.text, /hreflang="en"/);
  assert.match(home.text, /rel="canonical"/);
  assert.match(home.text, /<title>Crípticos en español: jugá gratis y sin límite \| Play Crípticos<\/title>/);
  assert.match(home.text, /og:image" content="http:\/\/localhost\/og-image.png"/);
  assert.match(home.text, /"@type":"Organization"/);
  assert.match((await c.get('/es/ayuda')).text, /<title>Qué es un críptico y cómo resolverlo/);
  assert.equal((await c.get('/og-image.png')).status, 200);
  const clue = await env.db.get("SELECT slug FROM clues WHERE answer = 'SARTÉN'");
  const page = await c.get('/es/c/' + clue.slug);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('Entras alterado: utensilio de cocina (6)'));
  assert.ok(!page.text.includes('SARTÉN'), 'la página del críptico no revela la respuesta');
  const idx = (await c.get('/sitemap.xml')).text;
  assert.match(idx, /<sitemapindex/);
  assert.match(idx, /sitemap-cripticos-1\.xml/);
  assert.ok((await sitemaps(c)).includes('/c/' + clue.slug));
  assert.match((await c.get('/robots.txt')).text, /Disallow: \/admin/);
  const redirect = await c.get('/', { 'accept-language': 'en-GB,en;q=0.9' });
  assert.equal(redirect.status, 301, 'con un solo idioma la portada redirige en forma permanente');
  assert.equal(redirect.headers.get('location'), '/es');
  // Enlaces internos y migas de pan en la página del críptico.
  assert.match(page.text, /"@type":"BreadcrumbList"/);
  assert.match(page.text, /href="\/es\/mecanismos\/[a-z-]+"/);
});

test('SEO: guía de mecanismos con una página por mecanismo, en el sitemap y enlazada', async () => {
  const c = client(env.base);
  const idx = await c.get('/es/mecanismos');
  assert.equal(idx.status, 200);
  assert.match(idx.text, /<title>Mecanismos de los crípticos/);
  const slugs = [...idx.text.matchAll(/href="\/es\/mecanismos\/([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(slugs.filter((x) => x !== 'abreviaturas')).size, 9);
  const sm = (await sitemaps(c));
  for (const s of new Set(slugs)) {
    const p = await c.get('/es/mecanismos/' + s);
    assert.equal(p.status, 200, s);
    assert.match(p.text, /<h1>/);
    assert.match(p.text, /"@type":"Article"/);
    assert.match(p.text, /<link rel="canonical" href="http:\/\/localhost\/es\/mecanismos\//);
    assert.ok(sm.includes('/es/mecanismos/' + s), 'en el sitemap: ' + s);
  }
  const ana = (await c.get('/es/mecanismos/anagrama')).text;
  assert.match(ana, /revuelto/, 'muestra los indicadores');
  assert.match(ana, /href="\/es\/c\//, 'enlaza crípticos para practicar');
  assert.match((await c.get('/es/ayuda')).text, /href="\/es\/mecanismos"/);
  assert.equal((await c.get('/es/mecanismos/no-existe')).status, 404);
  const ab = await c.get('/es/mecanismos/abreviaturas');
  assert.equal(ab.status, 200);
  assert.match(ab.text, /<td>oro<\/td><td><strong>AU<\/strong>/);
  assert.ok(sm.includes('/es/mecanismos/abreviaturas'));
  assert.match(idx.text, /href="\/es\/mecanismos\/abreviaturas"/);
});

test('solo español: el inglés no se ofrece, /en redirige y los crípticos en inglés no se muestran ni se borran', async () => {
  const e = await makeEnv({ spanishOnly: true });
  try {
    const c = client(e.base);
    const meta = await c.get('/api/meta');
    assert.deepEqual(meta.json.languages.filter((l) => l.enabled).map((l) => l.code), ['es']);
    assert.ok(meta.json.totals.every((t) => t.code === 'es'));
    const r = await c.get('/en/play?x=1');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), '/es/jugar?x=1');
    assert.equal((await c.get('/en/c/algo')).headers.get('location'), '/es/c/algo');
    assert.equal((await c.get('/en')).headers.get('location'), '/es');
    const en = await e.db.get("SELECT slug FROM clues WHERE language_code = 'en' AND status = 'published' LIMIT 1");
    assert.ok(en, 'los crípticos en inglés siguen guardados');
    assert.equal((await c.get('/es/c/' + en.slug)).status, 404);
    assert.ok(!(await sitemaps(c)).includes('/c/' + en.slug));
    const list = await c.get('/api/clues?lang=en');
    assert.equal(list.json.total, 0);
    const g = await c.post('/api/game/start', { choice: 'en' });
    assert.ok(!g.json.clue, 'no se juega en inglés');
    const home = await c.get('/es');
    assert.doesNotMatch(home.text, /English/);
  } finally { await e.close(); }
});

test('SEO: en producción de Vercel el dominio canónico es el propio, nunca *.vercel.app', () => {
  const { loadConfig } = require('../src/config');
  const base = { DATABASE_URL: 'file:x.db', IP_HASH_SALT: 'x'.repeat(32), CRON_SECRET: 'y'.repeat(32) };
  assert.equal(loadConfig({ ...base, VERCEL_ENV: 'production', SITE_URL: 'https://criptico.vercel.app/' }).siteUrl, 'https://playcripticos.com');
  assert.equal(loadConfig({ ...base, VERCEL_ENV: 'production' }).siteUrl, 'https://playcripticos.com');
  assert.equal(loadConfig({ ...base, VERCEL_ENV: 'preview', SITE_URL: 'https://x.vercel.app' }).siteUrl, 'https://x.vercel.app');
  assert.equal(loadConfig({ ...base, SITE_URL: 'https://playcripticos.com/' }).siteUrl, 'https://playcripticos.com');
});

test('SEO: IndexNow avisa las páginas nuevas solo desde el dominio público, y la clave está publicada', async () => {
  const { submit, KEY } = require('../src/services/indexnow');
  const { runJob } = require('../src/services/jobs');
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { status: 202 }; };
  assert.deepEqual(await submit(env.db, { siteUrl: 'http://localhost', fetchImpl }), { skipped: 'no_public_domain' });
  assert.deepEqual(await submit(env.db, { siteUrl: 'https://criptico.vercel.app', fetchImpl }), { skipped: 'no_public_domain' });
  assert.equal(calls.length, 0);
  await env.db.run("UPDATE jobs SET next_run_at = '2000-01-01', last_run_at = NULL, lease_until = NULL WHERE name = 'indexnow'");
  const r = await runJob(env.db, 'indexnow', { siteUrl: 'https://playcripticos.com', fetchImpl });
  assert.equal(r.status, 'success');
  assert.equal(calls.length, 1);
  const b = calls[0].body;
  assert.equal(b.host, 'playcripticos.com');
  assert.equal(b.keyLocation, `https://playcripticos.com/${KEY}.txt`);
  assert.ok(b.urlList.includes('https://playcripticos.com/es/mecanismos'));
  assert.ok(b.urlList.some((u) => u.startsWith('https://playcripticos.com/es/c/')));
  // La segunda vez solo manda lo publicado después: nada.
  const again = await submit(env.db, { siteUrl: 'https://playcripticos.com', fetchImpl });
  assert.deepEqual(again, { sent: 0 });
  const key = await client(env.base).get(`/${KEY}.txt`);
  assert.equal(key.status, 200);
  assert.equal(key.text.trim(), KEY);
  assert.match((await client(env.base).get('/es')).text, /"sameAs":\["https:\/\/www.instagram.com\/playcripticos\/"/);
});

test('SEO/GEO: robots permite buscadores e IA, llms.txt y preguntas frecuentes con FAQPage', async () => {
  const c = client(env.base);
  const robots = (await c.get('/robots.txt')).text;
  assert.match(robots, /User-agent: OAI-SearchBot/);
  assert.match(robots, /User-agent: ClaudeBot/);
  assert.equal(robots.match(/Disallow: \/admin/g).length, 2, 'los grupos con nombre repiten las reglas');
  const llms = await c.get('/llms.txt');
  assert.equal(llms.status, 200);
  assert.match(llms.text, /^# Play Crípticos/);
  assert.match(llms.text, /http:\/\/localhost\/es\/mecanismos\/anagrama/);
  assert.doesNotMatch(llms.text, /\{\w+\}|undefined/);
  const faq = await c.get('/es/preguntas-frecuentes');
  assert.equal(faq.status, 200);
  assert.match(faq.text, /"@type":"FAQPage"/);
  assert.match(faq.text, /<h2>¿Es gratis\?<\/h2>/);
  assert.doesNotMatch(faq.text.split('<article')[1].split('</article>')[0], /\{\w+\}/);
  assert.match(faq.text, /href="\/es\/plus"/);
  assert.ok((await sitemaps(c)).includes('/es/preguntas-frecuentes'));
  assert.match((await c.get('/es')).text, /"@type":"WebApplication"/);
});
