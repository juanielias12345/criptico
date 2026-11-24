'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeEnv, client } = require('./helpers');

test('las páginas públicas se cachean en la CDN solo para visitantes sin cookies', async () => {
  const env = await makeEnv({ spanishOnly: true });
  try {
    const slug = (await env.db.get("SELECT slug FROM clues WHERE status = 'published' AND language_code = 'es' AND origin <> 'generated' LIMIT 1")).slug;
    const anon = client(env.base);
    const page = await anon.get('/es/c/' + slug);
    assert.strictEqual(page.status, 200);
    assert.match(page.headers.get('cache-control') || '', /public.*s-maxage=86400/);
    assert.strictEqual(page.headers.get('set-cookie'), null);

    // Con jugador (cookie pid) la respuesta no se guarda para otros.
    const player = client(env.base);
    await player.post('/api/game/start', { choice: 'es' });
    const mine = await player.get('/es/c/' + slug);
    assert.doesNotMatch(mine.headers.get('cache-control') || '', /s-maxage/);

    // Páginas con datos de cada persona: nunca.
    const archive = await anon.get('/es/archivo');
    assert.doesNotMatch(archive.headers.get('cache-control') || '', /s-maxage/);
    const sm = await anon.get('/sitemap.xml');
    assert.match(sm.headers.get('cache-control') || '', /s-maxage=86400/);
  } finally { await env.close(); }
});

test('los crípticos relacionados salen del mismo mecanismo sin repetir el propio', async () => {
  const env = await makeEnv({ spanishOnly: true });
  try {
    const c = await env.db.get("SELECT slug, id, mechanism, clue_text FROM clues WHERE status = 'published' AND language_code = 'es' AND origin <> 'generated' ORDER BY id DESC LIMIT 1");
    const n = (await env.db.get("SELECT COUNT(*) AS n FROM clues WHERE status = 'published' AND language_code = 'es' AND mechanism = ? AND id <> ?", [c.mechanism, c.id])).n;
    const page = await client(env.base).get('/es/c/' + c.slug);
    assert.strictEqual(page.status, 200);
    const links = (page.text.match(/href="\/es\/c\/[^"]+"/g) || []).filter((h) => !h.includes('/' + c.slug + '"'));
    assert.ok(links.length >= Math.min(6, n) || n === 0, `esperaba relacionados (hay ${n})`);
  } finally { await env.close(); }
});
