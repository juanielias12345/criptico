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
const PM = '11111111-1111-4111-8111-111111111111';   // producto mensual
const PY = '22222222-2222-4222-8222-222222222222';   // producto anual
const SECRET = 'whsec_' + Buffer.from('secreto-de-prueba-polar-123').toString('base64');
// Polar falso: guarda los checkouts creados y responde como la API real.
const polar = { checkouts: [], sessions: [] };
function fakePolar(url, init = {}) {
  const u = new URL(url);
  const json = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  if (init.headers?.Authorization !== 'Bearer tok') return json(401, {});
  if (u.pathname === '/v1/checkouts/' && init.method === 'POST') {
    polar.checkouts.push(JSON.parse(init.body));
    return json(201, { id: 'co-1', url: 'https://buy.polar.sh/polar_c_abc' });
  }
  if (u.pathname === '/v1/customer-sessions/' && init.method === 'POST') {
    polar.sessions.push(JSON.parse(init.body));
    return json(201, { token: 't', customer_portal_url: 'https://polar.sh/play-cripticos/portal?customer_session_token=t' });
  }
  return json(404, {});
}

test.before(async () => {
  env = await makeEnv({ spanishOnly: true });
  globalThis.fetch = (url, init) => (/polar\.sh/.test(String(url)) ? fakePolar(String(url), init) : realFetch(url, init));
});
test.after(async () => { globalThis.fetch = realFetch; await env.close(); });

async function player(name) {
  const c = client(env.base);
  const r = await c.post('/api/auth/register', { username: name, password: 'Contraseña-segura-123', accept: true });
  assert.equal(r.status, 201, r.text);
  return { c, user: r.json.user };
}
const configure = () => {
  env.config.polar = { accessToken: 'tok', productMonthly: PM, productYearly: PY, webhookSecret: SECRET, server: 'production' };
};
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
function event(type, userId, attrs = {}, subId = 'sub-9001') {
  return { type, timestamp: new Date().toISOString(), data: { id: subId, status: 'active', product_id: PM, recurring_interval: 'month',
    current_period_end: days(30), cancel_at_period_end: false, ends_at: null, ended_at: null,
    metadata: userId ? { user_id: userId } : {}, customer: { id: 'cus-1', external_id: userId || null }, ...attrs } };
}
let seq = 0;
function hook(ev, { secret = SECRET, id = `msg_${++seq}`, ts = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(ev);
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return realFetch(`${env.base}/api/billing/webhook`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` }, body: raw })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
}

test('sin claves de Polar o sin términos publicados, el pago no está disponible', async () => {
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
  await setSetting(env.db, 'billing.lemonsqueezy', true, null);
  assert.equal((await ana.c.get('/api/billing/plus')).json.available, false, 'los términos con Lemon Squeezy no alcanzan');
  await setSetting(env.db, 'billing.polar', true, null);
  st = await ana.c.get('/api/billing/plus');
  assert.equal(st.json.available, true);
  assert.equal(st.json.plans.yearly.available, true);
});

test('suscripción: checkout con la cuenta, webhook da Plus y deja de ver anuncios', async () => {
  configure();
  await setSetting(env.db, 'billing.polar', true, null);
  assert.equal((await client(env.base).post('/api/billing/plus/checkout', { plan: 'monthly' })).status, 401, 'sin cuenta no se suscribe');
  const beto = await player('beto_plus');
  const co = await beto.c.post('/api/billing/plus/checkout', { plan: 'yearly' });
  assert.equal(co.status, 200, co.text);
  assert.match(co.json.url, /polar\.sh/);
  const sent = polar.checkouts.pop();
  assert.deepEqual(sent.products, [PY]);
  assert.equal(sent.external_customer_id, beto.user.id, 'la cuenta viaja como cliente externo');
  assert.equal(sent.metadata.user_id, beto.user.id);
  assert.match(sent.success_url, /\/es\/plus\?plus=ok$/);

  const r = await hook(event('subscription.created', beto.user.id, { product_id: PY, recurring_interval: 'year', current_period_end: days(365) }, 'sub-9100'));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user, true);
  const st = await beto.c.get('/api/billing/plus');
  assert.equal(st.json.active, true);
  assert.equal(st.json.subscription.plan, 'yearly');
  assert.equal(st.json.manage_url, '/api/billing/plus/portal');
  const portal = await beto.c.get('/api/billing/plus/portal');
  assert.equal(portal.status, 303, portal.text);
  assert.match(portal.headers.get('location'), /polar\.sh\/.*portal/);
  assert.equal(polar.sessions.pop().external_customer_id, beto.user.id);
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

test('webhook: firma Standard Webhooks, cancelación respeta lo pagado, la cuenta no se cambia y avisos repetidos se ignoran', async () => {
  configure();
  const caro = await player('caro_plus');
  const otro = await player('otro_plus');
  const otherSecret = 'whsec_' + Buffer.from('otro-secreto-distinto-456').toString('base64');
  assert.equal((await hook(event('subscription.created', caro.user.id, {}, 'sub-9200'), { secret: otherSecret })).status, 401, 'firma inválida');
  assert.equal((await hook(event('subscription.created', caro.user.id, {}, 'sub-9200'), { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401, 'aviso viejo');
  const created = event('subscription.created', caro.user.id, {}, 'sub-9200');
  let r = await hook(created, { id: 'msg_dup' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  let u = await env.db.get('SELECT plus_until FROM users WHERE id = ?', [caro.user.id]);
  assert.ok(Date.parse(u.plus_until) > Date.now() + 29 * 86400000, 'activa hasta el próximo cobro (más el margen)');
  assert.equal((await hook(created, { id: 'msg_dup' })).json.duplicate, true, 'el mismo aviso no se aplica dos veces');

  // Un aviso con otra cuenta en metadata no le pasa la suscripción a otra persona.
  await hook(event('subscription.updated', otro.user.id, {}, 'sub-9200'));
  assert.equal((await env.db.get('SELECT plus_until FROM users WHERE id = ?', [otro.user.id])).plus_until, null);

  r = await hook(event('subscription.canceled', caro.user.id, { cancel_at_period_end: true, current_period_end: days(20), ends_at: days(20) }, 'sub-9200'));
  assert.equal(r.status, 200);
  u = await env.db.get('SELECT plus_until FROM users WHERE id = ?', [caro.user.id]);
  assert.ok(Date.parse(u.plus_until) > Date.now() + 19 * 86400000, 'conserva el período pagado');
  assert.ok(Date.parse(u.plus_until) < Date.now() + 21 * 86400000, 'sin margen extra al cancelar');
  const st = await caro.c.get('/api/billing/plus');
  assert.equal(st.json.active, true);
  assert.equal(st.json.subscription.status, 'cancelled');

  await hook(event('subscription.revoked', caro.user.id, { status: 'canceled', ends_at: days(-1), ended_at: days(-1) }, 'sub-9200'));
  u = await env.db.get('SELECT plus_until FROM users WHERE id = ?', [caro.user.id]);
  assert.equal(u.plus_until, null);
  r = await hook({ type: 'order.created', data: { id: 'o1' } });
  assert.ok(r.json.ignored, 'otros avisos se ignoran');
  r = await hook(event('subscription.created', caro.user.id, { product_id: '99999999-9999-4999-8999-999999999999' }, 'sub-9300'));
  assert.equal(r.json.ignored, 'other_product', 'productos ajenos se ignoran');
});

test('webhook: secretos viejos de Polar (bytes del secreto tal cual) también se aceptan', async () => {
  const legacy = 'polar_whs_textoplano';
  env.config.polar = { accessToken: 'tok', productMonthly: PM, productYearly: PY, webhookSecret: legacy, server: 'production' };
  const fer = await player('fer_plus');
  const raw = JSON.stringify(event('subscription.active', fer.user.id, {}, 'sub-9500'));
  const id = 'msg_legacy'; const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', Buffer.from(legacy, 'utf8')).update(`${id}.${ts}.${raw}`).digest('base64');
  const r = await realFetch(`${env.base}/api/billing/webhook`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` }, body: raw });
  assert.equal(r.status, 200, await r.text());
  configure();
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
  assert.equal(s1.json.plus.number, 1);
  assert.equal(s1.json.plus.total, 10, 'una tanda de 10 por día');
  const set = await env.db.all('SELECT clue_id FROM plus_daily_set WHERE date = ?', [new Date().toISOString().slice(0, 10)]);
  assert.equal(new Set(set.map((x) => x.clue_id)).size, 10, 'sin repetidos');
  await dani.c.post('/api/game/' + s1.json.game_id + '/skip', {});
  const s3 = await dani.c.post('/api/plus/daily/start', {});
  assert.notEqual(s3.json.clue.id, s1.json.clue.id, 'al terminar uno sigue el próximo de la tanda');
  assert.equal(s3.json.plus.number, 2);
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

test('cuenta: untilFor según el estado de Polar', () => {
  const next = days(10);
  assert.ok(Date.parse(PLUS.untilFor({ status: 'active', current_period_end: next })) > Date.parse(next), 'activa: próximo cobro + margen');
  assert.ok(PLUS.untilFor({ status: 'past_due', current_period_end: next }), 'cobro demorado: se mantiene mientras reintenta');
  assert.equal(PLUS.untilFor({ status: 'active', cancel_at_period_end: true, current_period_end: next }), new Date(next).toISOString(), 'cancelada al final del período');
  assert.equal(PLUS.untilFor({ status: 'canceled', ends_at: next }), new Date(next).toISOString());
  assert.equal(PLUS.untilFor({ status: 'canceled', ended_at: days(-1) }), null);
  assert.equal(PLUS.untilFor({ status: 'unpaid' }), null);
  assert.equal(PLUS.untilFor({ status: 'incomplete_expired' }), null);
  assert.equal(PLUS.statusOf({ status: 'trialing' }), 'on_trial');
});
