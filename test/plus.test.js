'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client } = require('./helpers');
const PLUS = require('../src/services/plus');
const ADS = require('../src/services/ads');
const { setSetting } = require('../src/services/settings');

let env;
const realFetch = globalThis.fetch;
// PayPal falso: guarda las suscripciones creadas y responde como la API real.
const pp = { subs: new Map(), verify: 'SUCCESS', calls: [] };
function fakePayPal(url, init = {}) {
  const u = new URL(url);
  pp.calls.push(`${init.method || 'GET'} ${u.pathname}`);
  const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  if (u.pathname === '/v1/oauth2/token') return json(200, { access_token: 'tok', expires_in: 32400 });
  if (u.pathname === '/v1/billing/subscriptions' && init.method === 'POST') {
    const b = JSON.parse(init.body);
    const id = 'I-' + Math.random().toString(36).slice(2, 12).toUpperCase();
    pp.subs.set(id, { id, plan_id: b.plan_id, custom_id: b.custom_id, status: 'APPROVAL_PENDING' });
    return json(201, { id, status: 'APPROVAL_PENDING', links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${id}` }] });
  }
  const m = /^\/v1\/billing\/subscriptions\/(I-[A-Z0-9]+)$/.exec(u.pathname);
  if (m) return pp.subs.has(m[1]) ? json(200, pp.subs.get(m[1])) : json(404, { name: 'RESOURCE_NOT_FOUND' });
  if (u.pathname === '/v1/notifications/verify-webhook-signature') return json(200, { verification_status: pp.verify });
  return json(404, {});
}

test.before(async () => {
  env = await makeEnv({ spanishOnly: true });
  globalThis.fetch = (url, init) => (/paypal\.com/.test(String(url)) ? fakePayPal(String(url), init) : realFetch(url, init));
});
test.after(async () => { globalThis.fetch = realFetch; await env.close(); });

async function player(name) {
  const c = client(env.base);
  const r = await c.post('/api/auth/register', { username: name, password: 'Contraseña-segura-123', accept: true });
  assert.equal(r.status, 201, r.text);
  return { c, user: r.json.user };
}
const configure = () => {
  env.config.paypal = { env: 'sandbox', clientId: 'id', clientSecret: 'secret', planMonthly: 'P-MONTHLY1', planYearly: 'P-YEARLY12', webhookId: 'WH-1' };
  PLUS.clearTokenCache();
};
const activate = (id, extra = {}) => Object.assign(pp.subs.get(id), {
  status: 'ACTIVE', billing_info: { next_billing_time: new Date(Date.now() + 30 * 86400000).toISOString(), last_payment: { time: new Date().toISOString() } }, ...extra });

test('sin claves de PayPal o sin términos publicados, el pago no está disponible', async () => {
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
  st = await ana.c.get('/api/billing/plus');
  assert.equal(st.json.available, true);
  assert.equal(st.json.plans.yearly.available, true);
});

test('suscripción: PayPal aprueba, la cuenta queda Plus y deja de ver anuncios', async () => {
  configure();
  await setSetting(env.db, 'billing.enabled', true, null);
  assert.equal((await client(env.base).post('/api/billing/plus/checkout', { plan: 'monthly' })).status, 401, 'sin cuenta no se suscribe');
  const beto = await player('beto_plus');
  const co = await beto.c.post('/api/billing/plus/checkout', { plan: 'yearly' });
  assert.equal(co.status, 200, co.text);
  assert.match(co.json.url, /paypal\.com/);
  const id = [...pp.subs.keys()].pop();
  assert.equal(pp.subs.get(id).plan_id, 'P-YEARLY12');
  assert.equal(pp.subs.get(id).custom_id, beto.user.id, 'la cuenta viaja en custom_id');

  // Todavía sin aprobar: no da Plus.
  let cf = await beto.c.post('/api/billing/plus/confirm', { subscription_id: id });
  assert.equal(cf.status, 200);
  assert.equal(cf.json.active, false);

  activate(id);
  const otro = await player('otro_plus');
  assert.equal((await otro.c.post('/api/billing/plus/confirm', { subscription_id: id })).status, 403, 'otra cuenta no puede confirmar una suscripción ajena');
  cf = await beto.c.post('/api/billing/plus/confirm', { subscription_id: id });
  assert.equal(cf.json.active, true, cf.text);
  const st = await beto.c.get('/api/billing/plus');
  assert.equal(st.json.active, true);
  assert.equal(st.json.subscription.plan, 'yearly');
  assert.equal((await beto.c.post('/api/billing/plus/checkout', { plan: 'monthly' })).status, 409, 'no se suscribe dos veces');

  // Anuncios: encendidos para todos menos para la cuenta Plus.
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

test('webhook: firma verificada con PayPal, cancelación respeta lo pagado y avisos repetidos se ignoran', async () => {
  configure();
  await setSetting(env.db, 'billing.enabled', true, null);
  const caro = await player('caro_plus');
  await caro.c.post('/api/billing/plus/checkout', { plan: 'monthly' });
  const id = [...pp.subs.keys()].pop();
  activate(id);
  const hook = (ev) => client(env.base).post('/api/billing/webhook', ev, { 'paypal-transmission-id': 't1', 'paypal-transmission-sig': 'sig' });

  pp.verify = 'FAILURE';
  assert.equal((await hook({ id: 'WH-EV-0', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id } })).status, 401, 'firma inválida');
  pp.verify = 'SUCCESS';
  let r = await hook({ id: 'WH-EV-1', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id, status: 'ACTIVE' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.user, true);
  let u = await env.db.get('SELECT plus_until FROM users WHERE id = ?', [caro.user.id]);
  assert.ok(Date.parse(u.plus_until) > Date.now() + 29 * 86400000, 'activa hasta el próximo cobro (más el margen)');

  // Cancelación: sigue Plus hasta la fecha ya pagada.
  pp.subs.get(id).status = 'CANCELLED';
  r = await hook({ id: 'WH-EV-2', event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id } });
  assert.equal(r.status, 200);
  u = await env.db.get('SELECT plus_until FROM users WHERE id = ?', [caro.user.id]);
  assert.ok(Date.parse(u.plus_until) > Date.now() + 25 * 86400000, 'conserva el período pagado');
  const st = await caro.c.get('/api/billing/plus');
  assert.equal(st.json.active, true);
  assert.equal(st.json.subscription.status, 'CANCELLED');

  // Vencida: se termina.
  pp.subs.get(id).status = 'EXPIRED';
  await hook({ id: 'WH-EV-3', event_type: 'BILLING.SUBSCRIPTION.EXPIRED', resource: { id } });
  u = await env.db.get('SELECT plus_until FROM users WHERE id = ?', [caro.user.id]);
  assert.equal(u.plus_until, null);
  r = await hook({ id: 'WH-EV-3', event_type: 'BILLING.SUBSCRIPTION.EXPIRED', resource: { id } });
  assert.equal(r.json.duplicate, true, 'el mismo aviso no se aplica dos veces');
  r = await hook({ id: 'WH-EV-4', event_type: 'CHECKOUT.ORDER.APPROVED', resource: {} });
  assert.ok(r.json.ignored, 'otros avisos se ignoran');
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
  assert.match((await client(env.base).get('/es/plus')).text, /USD 12/);
});

test('cuenta: untilFor según el estado de PayPal', () => {
  const next = new Date(Date.now() + 10 * 86400000).toISOString();
  assert.ok(Date.parse(PLUS.untilFor({ status: 'ACTIVE', billing_info: { next_billing_time: next } })) > Date.parse(next), 'activa: próximo cobro + margen');
  assert.equal(PLUS.untilFor({ status: 'CANCELLED', billing_info: { next_billing_time: next } }), new Date(next).toISOString());
  assert.equal(PLUS.untilFor({ status: 'SUSPENDED' }), null);
  assert.equal(PLUS.untilFor({ status: 'APPROVAL_PENDING' }), null);
});
