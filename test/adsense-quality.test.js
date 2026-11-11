'use strict';

// Calidad para AdSense: contenido editorial indexable, páginas institucionales,
// crípticos generados sin auditar fuera del índice y anuncios solo donde hay contenido.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client } = require('./helpers');
const ADS = require('../src/services/ads');
const ARTICLES = require('../src/views/articles');

let env;
test.before(async () => { env = await makeEnv({ spanishOnly: true }); });
test.after(async () => { await env.close(); });

async function sitemaps(c) {
  const idx = (await c.get('/sitemap.xml')).text;
  const parts = [];
  for (const m of idx.matchAll(/<loc>[^<]*?(\/sitemap-[\w-]+\.xml)<\/loc>/g)) parts.push((await c.get(m[1])).text);
  return parts.join('');
}
const words = (html) => html.replace(/<(script|style|header|footer|nav)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

test('artículos, quiénes somos y contacto: páginas con texto, enlazadas y en el sitemap', async () => {
  const c = client(env.base);
  const maps = await sitemaps(c);
  for (const path of ['/es/articulos', '/es/quienes-somos', '/es/contacto', ...ARTICLES.es.items.map((x) => '/es/articulos/' + x.slug)]) {
    const r = await c.get(path);
    assert.equal(r.status, 200, path);
    assert.doesNotMatch(r.text, /name="robots" content="noindex/, path);
    assert.ok(maps.includes(path + '<'), `${path} en el sitemap`);
  }
  for (const x of ARTICLES.es.items) {
    const r = await c.get('/es/articulos/' + x.slug);
    assert.ok(words(r.text) >= 500, `${x.slug}: al menos 500 palabras`);
    assert.doesNotMatch(r.text, /\*\*|\]\(\w/, `${x.slug}: sin marcas sin convertir`);
    assert.match(r.text, /"@type":"Article"/);
    assert.doesNotMatch(r.text, /Argentin/i, 'la marca no nombra países');
  }
  const contact = await c.get('/es/contacto');
  assert.match(contact.text, /mailto:playcripticos@gmail\.com/);
  const home = await c.get('/es');
  for (const path of ['/es/quienes-somos', '/es/contacto', '/es/articulos']) assert.ok(home.text.includes(`href="${path}"`), `el pie enlaza ${path}`);
  assert.match((await c.get('/llms.txt')).text, /\/es\/articulos\/como-resolver-tu-primer-criptico/);
});

test('crípticos generados sin auditar: se juegan, pero con noindex, fuera del sitemap y sin anuncios', async () => {
  const c = client(env.base);
  const clue = await env.db.get("SELECT id, slug FROM clues WHERE status = 'published' AND language_code = 'es' AND origin = 'original' LIMIT 1");
  await env.db.run("UPDATE clues SET origin = 'generated', audit_status = NULL WHERE id = ?", [clue.id]);
  env.config.adsenseClient = 'ca-pub-1234567890123456';
  try {
    await require('../src/services/settings').setSetting(env.db, 'ads.enabled', true);
    ADS.clearCache();
    let page = await c.get('/es/c/' + clue.slug);
    assert.equal(page.status, 200);
    assert.match(page.text, /name="robots" content="noindex/);
    assert.doesNotMatch(page.text, /\/js\/ads\.js/, 'sin anuncios en páginas que no se indexan');
    assert.ok(!(await sitemaps(c)).includes('/c/' + clue.slug));

    await env.db.run("UPDATE clues SET audit_status = 'ok' WHERE id = ?", [clue.id]);
    page = await c.get('/es/c/' + clue.slug);
    assert.doesNotMatch(page.text, /name="robots" content="noindex/, 'auditado: vuelve al índice');
    assert.match(page.text, /\/js\/ads\.js/);
    assert.ok((await sitemaps(c)).includes('/c/' + clue.slug));

    for (const path of ['/es/jugar', '/es/diario', '/es/desafios']) {
      assert.doesNotMatch((await c.get(path)).text, /\/js\/ads\.js/, `${path}: pantalla de juego sin anuncios`);
    }
    for (const path of ['/es/articulos', '/es/preguntas-frecuentes', '/es/ayuda']) {
      assert.match((await c.get(path)).text, /\/js\/ads\.js/, `${path}: página de contenido con anuncios`);
    }
    assert.doesNotMatch((await c.get('/es/contacto')).text, /\/js\/ads\.js/, 'contacto sin anuncios');
  } finally {
    await env.db.run("UPDATE clues SET origin = 'original', audit_status = NULL WHERE id = ?", [clue.id]);
    env.config.adsenseClient = '';
    await require('../src/services/settings').setSetting(env.db, 'ads.enabled', false);
    ADS.clearCache();
  }
});

test('jugar y desafíos llevan texto explicativo legible sin JavaScript', async () => {
  const c = client(env.base);
  assert.match((await c.get('/es/jugar')).text, /<h2 id="play-about-t">Cómo se juega<\/h2>/);
  assert.match((await c.get('/es/desafios')).text, /Reglas de duelos y torneos/);
});
