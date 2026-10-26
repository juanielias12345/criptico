'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { makeEnv, client } = require('./helpers');
const PLUS = require('../src/services/plus');
const ADS = require('../src/services/ads');
const { setSetting } = require('../src/services/settings');

let env;
const realFetch = globalThis.fetch;
// Lemon Squeezy falso: guarda los checkouts creados y responde como la API real.
const ls = { checkouts: [] };
function fakeLemon(url, init = {}) {
  const u = new URL(url);
  const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/vnd.api+json' } }));
  if (u.pathname === '/v1/checkouts' && init.method === 'POST') {
    if (init.headers.Authorization !== 'Bearer key') return json(401, {});
    const b = JSON.parse(init.body);
    ls.checkouts.push(b.data);
    return json(201, { data: { type: 'checkouts', id: 'co-1', attributes: { url: 'https://playcripticos.lemonsqueezy.com/checkout/custom/abc' } } });
  }
  return json(404, {});
}

test.before(async () => {
  env = await makeEnv({ spanishOnly: true });
  globalThis.fetch = (url, init) => (/lemonsqueezy\.com/.test(String(url)) ? fakeLemon(String(url), init) : realFetch(url, init));
});
test.after(async () => { globalThis.fetch = realFetch; await env.close(); });

async function player(name) {
  const c = client(env.base);
  const r = await c.post('/api/auth/register', { username: name, password: 'Contraseña-segura-123', accept: true });
  assert.equal(r.status, 201, r.text);
  return { c, user: r.json.user };
}
const configure = () => {
  env.config.lemonsqueezy = { apiKey: 'key', storeId: '111', variantMonthly: '201', variantYearly: '212', webhookSecret: 'secreto' };
};
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
let seq = 0;
function event(name, userId, attrs = {}, subId = '9001') {
  return { meta: { event_name: name, custom_data: userId ? { user_id: userId } : undefined },
    data: { type: 'subscriptions', id: subId, attributes: { store_id: 111, variant_id: 201, status: 'active', renews_at: days(30), ends_at: null,
      updated_at: `2026-10-26T00:00:${String(seq++).padStart(2, '0')}Z`, urls: { customer_portal: 'https://playcripticos.lemonsqueezy.com/billing?x=1' }, ...attrs } } };
}
function hook(ev, secret = 'secreto') {
  const raw = JSON.stringify(ev);
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  return realFetch(`${env.base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': sig }, body: raw })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}

test('sin claves de Lemon Squeezy o sin términos publicados, el pago no está disponible', async () => {
  const ana = await player('ana_plus');
  let st = await ana.c.get('/api/billing/plus');
  assert.equal(st.status, 200);
  assert.equal(st.json.available, false);
  assert.equal(st.json.plans.monthly.price, 'USD 1,50');
  assert.equal(st.json.plans.yearly.price, 'USD 12');
  assert.equal((await ana.c.post('/api/billing/plus/checkout', { plan: 'monthly' })).status, 503);
  configure();
  st = await ana.c.get('/api/billing/plus');
  assert.equal(st.json.available, false, 'faltan los términos del plan publicados');
  await setSetting(env.db, 'billing.enabled', true, null);
  assert.equal((await ana.c.get('/api/billing/plus')).json.available, false, 'los términos con PayPal no alcanzan');
  await setSetting(env.db, 'billing.lemonsqueezy', true, null);
  st = await ana.c.get('/api/billing/plus');
  assert.equal(st.json.available, true);
  assert.equal(st.json.plans.yearly.available, true);
});

test('suscripción: checkout con la cuenta, webhook da Plus y deja de ver anuncios', async () => {
  configure();
  await setSetting(env.db, 'billing.lemonsqueezy', true, null);
  assert.equal((await client(env.base).post('/api/billing/plus/checkout', { plan: 'monthly' })).status, 401, 'sin cuenta no se suscribe');
  const beto = await player('beto_plus');
  const co = await beto.c.post('/api/billing/plus/checkout', { plan: 'yearly' });
  assert.equal(co.status, 200, co.text);
  assert.match(co.json.url, /lemonsqueezy\.com/);
  const sent = ls.checkouts.pop();
  assert.equal(sent.relationships.variant.data.id, '212');
  assert.equal(sent.relationships.store.data.id, '111');
  assert.equal(sent.attributes.checkout_data.custom.user_id, beto.user.id, 'la cuenta viaja en custom.user_id');
  assert.match(sent.attributes.product_options.redirect_url, /\/es\/plus\?plus=ok$/);

  const r = await hook(event('subscription_created', beto.user.id, { variant_id: 212, renews_at: days(365) }, '9100'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user, true);
  const st = await beto.c.get('/api/billing/plus');
  assert.equal(st.json.active, true);
  assert.equal(st.json.subscription.plan, 'yearly');
  assert.match(st.json.manage_url, /lemonsqueezy\.com\/billing/);
  assert.equal((await beto.c.post('/api/billing/plus/checkout', { plan: 'monthly' })).status, 409, 'no se suscribe dos veces');

  env.config.adsenseClient = 'ca-pub-1234567890123456';
  await setSetting(env.db, 'ads.enabled', true, null);
  ADS.clearCache();
  const anon = await client(env.base).get('/es');
  assert.match(anon.text, /\/js\/ads\.js/, 'sin Plus hay anuncios');
  assert.match(anon.text, /Jugá sin anuncios con Plus/);
  const mine = await beto.c.get('/es');
  assert.doesNotMatch(mine.text, /\/js\/ads\.js/, 'con Plus no se cargan anuncios');
  env.config.adsenseClient = '';
  ADS.clearCache();
});

test('webhook: firma HMAC, cancelación respeta lo pagado, la cuenta no se cambia y avisos repetidos se ignoran', async () => {
  configure();
  const caro = await player('caro_plus');
  const otro = await player('otro_plus');
  assert.equal((await hook(event('subscription_created', caro.user.id, {}, '9200'), 'otro-secreto')).status, 401, 'firma inválida');
  const created = event('subscription_created', caro.user.id, {}, '9200');
  let r = await hook(created);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let u = await env.db.get('SELECT plus_until FROM users WHERE id = ?', [caro.user.id]);
  assert.ok(Date.parse(u.plus_until) > Date.now() + 29 * 86400000, 'activa hasta el próximo cobro (más el margen)');
  assert.equal((await hook(created)).json.duplicate, true, 'el mismo aviso no se aplica dos veces');

  // Un aviso con otra cuenta en custom_data no le pasa la suscripción a otra persona.
  await hook(event('subscription_updated', otro.user.id, {}, '9200'));
  assert.equal((await env.db.get('SELECT plus_until FROM users WHERE id = ?', [otro.user.id])).plus_until, null);

  r = await hook(event('subscription_cancelled', caro.user.id, { status: 'cancelled', ends_at: days(20) }, '9200'));
  assert.equal(r.status, 200);
  u = await env.db.get('SELECT plus_until FROM users WHERE id = ?', [caro.user.id]);
  assert.ok(Date.parse(u.plus_until) > Date.now() + 19 * 86400000, 'conserva el período pagado');
  const st = await caro.c.get('/api/billing/plus');
  assert.equal(st.json.active, true);
  assert.equal(st.json.subscription.status, 'cancelled');

  await hook(event('subscription_expired', caro.user.id, { status: 'expired', ends_at: days(-1) }, '9200'));
  u = await env.db.get('SELECT plus_until FROM users WHERE id = ?', [caro.user.id]);
  assert.equal(u.plus_until, null);
  r = await hook({ meta: { event_name: 'order_created' }, data: { type: 'orders', id: '1', attributes: {} } });
  assert.ok(r.json.ignored, 'otros avisos se ignoran');
  r = await hook(event('subscription_created', caro.user.id, { variant_id: 999 }, '9300'));
  assert.equal(r.json.ignored, 'other_variant', 'productos ajenos se ignoran');
});

test('beneficios: Críptico Plus del día, comparación con la comunidad y avatares exclusivos', async () => {
  const dani = await player('dani_plus');
  assert.equal((await dani.c.post('/api/plus/daily/start', {})).status, 403, 'sin Plus no hay Críptico Plus del día');
  assert.equal((await dani.c.get('/api/plus/comparison')).status, 403);
  assert.equal((await dani.c.put('/api/me/profile', { avatar: '★-2' })).status, 400, 'avatar Plus bloqueado');

  await env.db.run('UPDATE users SET plus_until = ? WHERE id = ?', [new Date(Date.now() + 86400000).toISOString(), dani.user.id]);
  await env.db.run("UPDATE clues SET difficulty = 4 WHERE id IN (SELECT id FROM clues WHERE language_code = 'es' AND variant_code IS NULL AND difficulty = 3 LIMIT 4)");
  const s1 = await dani.c.post('/api/plus/daily/start', {});
  assert.equal(s1.status, 200, s1.text);
  assert.ok(s1.json.clue && !('answer' in s1.json.clue));
  const diff = (await env.db.get('SELECT c.difficulty FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.id = ?', [s1.json.game_id])).difficulty;
  assert.ok(diff >= 4, 'es de los difíciles');
  const s2 = await dani.c.post('/api/plus/daily/start', {});
  assert.equal(s2.json.game_id, s1.json.game_id, 'volver a entrar retoma la misma partida');
  const daily = await env.db.get('SELECT clue_id FROM daily_challenges WHERE date = ?', [new Date().toISOString().slice(0, 10)]);
  if (daily) assert.notEqual(daily.clue_id, s1.json.clue.id, 'distinto del diario común');
  const g = await env.db.get('SELECT mode, daily_date FROM games WHERE id = ?', [s1.json.game_id]);
  assert.equal(g.mode, 'plus_daily');
  assert.equal(g.daily_date, null, 'no cuenta para la racha del diario común');

  const cmp = await dani.c.get('/api/plus/comparison');
  assert.equal(cmp.status, 200, cmp.text);
  assert.equal(cmp.json.rows.length, 5);
  const again = await dani.c.get('/api/plus/comparison');
  assert.equal(again.json.computed_at, cmp.json.computed_at, 'las referencias de la comunidad se reutilizan (se calculan una vez por día)');

  assert.equal((await dani.c.put('/api/me/profile', { avatar: '★-2' })).status, 200, 'con Plus se puede elegir');
  const page = await dani.c.get('/es/plus');
  assert.equal(page.status, 200);
  assert.match(page.text, /Tu Plus/);
  const pub = (await client(env.base).get('/es/plus')).text;
  assert.match(pub, /USD 12/);
  assert.doesNotMatch(pub, /PayPal Business|cuenta de PayPal/);
});

test('cuenta: untilFor según el estado de Lemon Squeezy', () => {
  const next = days(10);
  assert.ok(Date.parse(PLUS.untilFor({ status: 'active', renews_at: next })) > Date.parse(next), 'activa: próximo cobro + margen');
  assert.ok(PLUS.untilFor({ status: 'past_due', renews_at: next }), 'cobro demorado: se mantiene mientras reintenta');
  assert.equal(PLUS.untilFor({ status: 'cancelled', ends_at: next }), new Date(next).toISOString());
  assert.equal(PLUS.untilFor({ status: 'expired', ends_at: next }), null);
  assert.equal(PLUS.untilFor({ status: 'unpaid' }), null);
  assert.equal(PLUS.untilFor({ status: 'paused' }), null);
});
