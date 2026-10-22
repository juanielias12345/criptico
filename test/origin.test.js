'use strict';

// Origen del tráfico: clasificación, conteo agregado de visitas y origen por jugador y cuenta.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client, staff } = require('./helpers');
const { classify } = require('../src/lib/origin');
const { setSetting } = require('../src/services/settings');

let env;
test.before(async () => { env = await makeEnv(); });
test.after(async () => { await env.close(); });
test.beforeEach(async () => { if (env) await env.db.run('DELETE FROM rate_limits'); });

test('clasifica redes, buscadores, campañas, directo y visitas internas', () => {
  const site = 'playcripticos.com';
  assert.deepEqual(classify({ ref: 'l.instagram.com', landing: '/es' }, site), { source: 'Instagram', medium: 'social', campaign: '', referrer: 'l.instagram.com', landing: '/es' });
  assert.equal(classify({ ref: 'www.google.com.ar' }, site).source, 'Google');
  assert.equal(classify({ ref: 'www.google.com.ar' }, site).medium, 'search');
  assert.equal(classify({ ref: 'm.facebook.com' }, site).source, 'Facebook');
  assert.equal(classify({ ref: 'blog.ejemplo.org' }, site).source, 'blog.ejemplo.org');
  assert.equal(classify({ ref: 'blog.ejemplo.org' }, site).medium, 'referral');
  assert.deepEqual(classify({ ref: '' }, site), { source: 'Directo', medium: 'direct', campaign: '', referrer: '', landing: '' });
  const utm = classify({ ref: '', us: 'ig', um: 'social', uc: 'bio', landing: '/es/jugar?x=1' }, site);
  assert.deepEqual([utm.source, utm.medium, utm.campaign, utm.landing], ['Instagram', 'social', 'bio', '/es/jugar']);
  assert.equal(classify({ ref: 'playcripticos.com' }, site), null, 'navegar dentro del sitio no es una entrada');
  assert.equal(classify({ ref: 'www.playcripticos.com', us: 'tiktok' }, site).source, 'TikTok', 'un enlace con utm cuenta aunque venga del sitio');
  assert.equal(classify({ ref: 'x.com', landing: 'javascript:alert(1)' }, site).landing, '', 'solo se guardan rutas del sitio');
  assert.equal(classify(null, site), null);
});

test('visitas de entrada: conteo agregado por origen, sin identificadores y respetando Do Not Track', async () => {
  const c = client(env.base);
  await c.post('/api/visit', { ui: 'es', first: true, entry: { ref: 'l.instagram.com', landing: '/es' } });
  await c.post('/api/visit', { ui: 'es', entry: { ref: 'www.google.com' } });
  await c.post('/api/visit', { ui: 'es', entry: { ref: 'www.google.com' } }, { DNT: '1' });
  await c.post('/api/visit', { ui: 'es', entry: { ref: 'localhost' } });
  const rows = await env.db.all("SELECT source, kind, n FROM traffic_sources_daily ORDER BY source, kind");
  assert.deepEqual(rows.map((r) => r.source + ':' + r.kind + ':' + r.n), ['Google:entry:1', 'Instagram:entry:1', 'Instagram:new_visitor:1']);
  const cols = (await env.db.all('PRAGMA table_info(traffic_sources_daily)')).map((r) => r.name);
  assert.ok(!cols.some((k) => /player|user|ip/.test(k)), 'la tabla no guarda identificadores');
});

test('origen por jugador y cuenta: apagado hasta publicar la privacidad; después se guarda y se ve en el panel', async () => {
  const origin = { ref: 'l.instagram.com', us: '', um: '', uc: '', landing: '/es' };
  const before = client(env.base);
  await before.post('/api/game/start', { choice: 'es', mode: 'infinite', origin });
  const p0 = await env.db.get('SELECT origin_source FROM players ORDER BY created_at DESC LIMIT 1');
  assert.equal(p0.origin_source, null, 'sin la política publicada no se guarda');
  assert.equal((await before.get('/api/meta')).json.store_origin, false);

  await setSetting(env.db, 'privacy.store_origin', true);
  const c = client(env.base);
  await c.post('/api/game/start', { choice: 'es', mode: 'infinite', origin: { ...origin, us: 'instagram', uc: 'bio' } });
  const p1 = await env.db.get('SELECT origin_source, origin_medium, origin_campaign, origin_referrer, origin_landing FROM players ORDER BY created_at DESC LIMIT 1');
  assert.deepEqual({ ...p1 }, { origin_source: 'Instagram', origin_medium: 'social', origin_campaign: 'bio', origin_referrer: 'l.instagram.com', origin_landing: '/es' });

  const dnt = client(env.base);
  await dnt.post('/api/game/start', { choice: 'es', mode: 'infinite', origin }, { 'Sec-GPC': '1' });
  assert.equal((await env.db.get('SELECT origin_source FROM players ORDER BY created_at DESC LIMIT 1')).origin_source, null, 'Global Privacy Control lo apaga');

  // La cuenta toma el origen del jugador de ese navegador si el registro no lo trae.
  const r = await c.post('/api/auth/register', { username: 'llego_por_ig', password: 'Contraseña-segura-1', accept: true });
  assert.equal(r.status, 201);
  const u = await env.db.get("SELECT origin_source, origin_campaign FROM users WHERE username = 'llego_por_ig'");
  assert.deepEqual({ ...u }, { origin_source: 'Instagram', origin_campaign: 'bio' });
  const g = client(env.base);
  await g.post('/api/auth/register', { username: 'llego_por_google', password: 'Contraseña-segura-1', accept: true, origin: { ref: 'www.google.com', landing: '/es/mecanismos' } });
  assert.equal((await env.db.get("SELECT origin_source FROM users WHERE username = 'llego_por_google'")).origin_source, 'Google');

  const a = await staff(env, 'owner');
  const d = (await a.c.get('/api/admin/analytics/origins?period=7d')).json;
  assert.equal(d.storing, true);
  assert.ok(d.accounts.some((x) => x.source === 'Instagram' && x.users >= 1));
  assert.ok(d.players.some((x) => x.source === 'Instagram' && x.players >= 1));
  assert.ok(d.recent.some((x) => x.username === 'llego_por_google' && x.origin_landing === '/es/mecanismos'));
  const list = (await a.c.get('/api/admin/players?q=llego_por_ig')).json;
  assert.equal(list.items[0].origin_source, 'Instagram');
  const analyst = await staff(env, 'analyst');
  assert.equal((await analyst.c.get('/api/admin/analytics/origins')).status, 200);
  assert.equal((await client(env.base).get('/api/admin/analytics/origins')).status, 401);
});
