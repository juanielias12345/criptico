'use strict';

// Plan Plus: suscripción de PayPal, mensual o anual. Incluye: sin anuncios, el Críptico Plus
// del día, la comparación con la comunidad, la insignia Plus y avatares exclusivos. Nunca da
// ventajas en torneos ni duelos. Flujo de pago sin scripts de terceros:
//  1) POST /api/billing/ad-free/checkout crea la suscripción en PayPal con el id de la
//     cuenta (custom_id) y devuelve el enlace de aprobación de PayPal.
//  2) PayPal vuelve a /es/cuenta?subscription_id=…; la página llama a /confirm y el
//     servidor consulta la suscripción en PayPal antes de dar el beneficio.
//  3) El webhook de PayPal (firma verificada con la API de PayPal) mantiene el estado al
//     día: renovaciones, cancelaciones, suspensiones.
// El beneficio se guarda en users.plus_until, que viaja con la sesión: ver si una
// página lleva anuncios no suma lecturas a la base. Ver docs/PLUS.md.

const { now, HttpError } = require('./util');
const { audit } = require('./audit');
const { getSetting } = require('./settings');

// Precios que se muestran (el cobro real lo define cada plan en PayPal).
const PLANS = {
  monthly: { price: 'USD 1,50', per: 'mes', months: 1 },
  yearly: { price: 'USD 12', per: 'año', months: 12, note: 'equivale a USD 1 por mes' },
};
const GRACE_MS = 3 * 86400000;          // margen si el cobro de la renovación se demora
const MONTH_MS = 31 * 86400000;
const API = { live: 'https://api-m.paypal.com', sandbox: 'https://api-m.sandbox.paypal.com' };

const cfgOf = (config) => config.paypal || {};
function configured(config) {
  const c = cfgOf(config);
  return !!(c.clientId && c.clientSecret && (c.planMonthly || c.planYearly));
}
// Qué planes se pueden contratar (los que tienen id de plan de PayPal).
function planIds(config) {
  const c = cfgOf(config);
  return Object.fromEntries([['monthly', c.planMonthly], ['yearly', c.planYearly]].filter(([, id]) => id));
}
const planOf = (config, planId) => Object.entries(planIds(config)).find(([, id]) => id === planId)?.[0] || null;

// El pago se habilita con las claves de PayPal y los términos del plan publicados.
async function available(db, config) {
  if (!configured(config)) return false;
  try { return (await getSetting(db, 'billing.enabled')) === true; } catch { return false; }
}

function isPlus(user) {
  return !!(user && user.plus_until && Date.parse(user.plus_until) > Date.now());
}

// Token de acceso de PayPal (dura ~9 h; se reutiliza mientras viva la instancia).
let tokenCache = { key: '', token: '', exp: 0 };
async function accessToken(config, fetchImpl) {
  const c = cfgOf(config);
  const key = `${c.env}:${c.clientId}`;
  if (tokenCache.key === key && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const res = await fetchImpl(`${API[c.env] || API.live}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new HttpError(502, 'paypal_auth_failed', 'No se pudo conectar con PayPal. Probá de nuevo en un rato.');
  tokenCache = { key, token: body.access_token, exp: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
  return body.access_token;
}
const clearTokenCache = () => { tokenCache = { key: '', token: '', exp: 0 }; };

async function paypal(config, fetchImpl, method, path, body) {
  const c = cfgOf(config);
  const res = await fetchImpl(`${API[c.env] || API.live}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(config, fetchImpl)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function status(db, config, user) {
  const sub = user ? await db.get('SELECT plan, status, renews_at, ends_at FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [user.id]) : null;
  const ok = await available(db, config);
  const ids = planIds(config);
  return {
    available: ok, plans: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, { ...p, available: ok && !!ids[k] }])),
    active: isPlus(user), until: user ? user.plus_until || null : null,
    subscription: sub ? { plan: sub.plan, status: sub.status, renews_at: sub.renews_at, ends_at: sub.ends_at } : null,
    manage_url: cfgOf(config).env === 'sandbox' ? 'https://www.sandbox.paypal.com/myaccount/autopay/' : 'https://www.paypal.com/myaccount/autopay/',
  };
}

// Crea la suscripción en PayPal y devuelve el enlace para que la persona la apruebe.
async function checkout(db, config, user, plan = 'monthly', fetchImpl = fetch) {
  if (!user) throw new HttpError(401, 'login_required', 'Entrá o creá una cuenta gratis para hacerte Plus.');
  if (!(await available(db, config))) throw new HttpError(503, 'not_configured', 'El pago todavía no está disponible.');
  const planId = planIds(config)[plan];
  if (!planId) throw new HttpError(400, 'invalid_plan');
  if (isPlus(user)) throw new HttpError(409, 'already_active', 'Ya sos Plus.');
  const back = `${config.siteUrl}/es/plus`;
  const r = await paypal(config, fetchImpl, 'POST', '/v1/billing/subscriptions', {
    plan_id: planId, custom_id: user.id,
    application_context: { brand_name: config.siteName || 'Play Crípticos', locale: 'es-AR', user_action: 'SUBSCRIBE_NOW', shipping_preference: 'NO_SHIPPING',
      return_url: `${back}?plus=ok`, cancel_url: `${back}?plus=cancelado` },
  });
  const link = r.ok && (r.data.links || []).find((l) => l.rel === 'approve');
  if (!link) throw new HttpError(502, 'checkout_failed', 'No se pudo abrir PayPal. Probá de nuevo en un rato.');
  await saveSubscription(db, { id: r.data.id, userId: user.id, plan, status: r.data.status || 'APPROVAL_PENDING', renewsAt: null, endsAt: null });
  return { url: link.href };
}

// Hasta cuándo queda sin anuncios según la suscripción de PayPal.
function untilFor(sub, months = 1) {
  const st = String(sub.status || '').toUpperCase();
  const next = Date.parse((sub.billing_info || {}).next_billing_time || '');
  if (st === 'ACTIVE') return new Date((Number.isFinite(next) ? next : Date.now() + months * MONTH_MS) + GRACE_MS).toISOString();
  if (st === 'CANCELLED') {
    // Al cancelar se respeta lo ya pagado: hasta el último cobro + un mes.
    const last = Date.parse(((sub.billing_info || {}).last_payment || {}).time || '');
    const end = Number.isFinite(next) ? next : Number.isFinite(last) ? last + months * MONTH_MS : NaN;
    return Number.isFinite(end) && end > Date.now() ? new Date(end).toISOString() : null;
  }
  return null;   // APPROVAL_PENDING, APPROVED (todavía sin cobrar), SUSPENDED, EXPIRED
}

async function saveSubscription(db, { id, userId, plan, status: st, renewsAt, endsAt }, until) {
  const subId = `paypal:${id}`;
  await db.tx(async (t) => {
    await t.run(`INSERT INTO subscriptions (id, user_id, provider, plan, status, renews_at, ends_at, updated_at) VALUES (?, ?, 'paypal', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id = COALESCE(subscriptions.user_id, excluded.user_id), plan = excluded.plan, status = excluded.status,
        renews_at = excluded.renews_at, ends_at = excluded.ends_at, updated_at = excluded.updated_at`,
    [subId, userId || null, plan || 'monthly', st, renewsAt, endsAt, now()]);
    if (userId && until !== undefined) await t.run('UPDATE users SET plus_until = ? WHERE id = ?', [until, userId]);
  });
}

// Lee la suscripción en PayPal y aplica su estado a la cuenta dueña (custom_id).
async function syncSubscription(db, config, subscriptionId, fetchImpl, source) {
  if (!/^I-[A-Z0-9]{6,40}$/.test(String(subscriptionId || ''))) throw new HttpError(400, 'bad_subscription');
  const r = await paypal(config, fetchImpl, 'GET', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, 'subscription_not_found', 'No encontramos la suscripción en PayPal.');
  const sub = r.data;
  const plan = planOf(config, sub.plan_id);
  if (!plan) throw new HttpError(400, 'wrong_plan');
  const user = sub.custom_id ? await db.get('SELECT id FROM users WHERE id = ?', [sub.custom_id]) : null;
  const until = untilFor(sub, PLANS[plan].months);
  await saveSubscription(db, { id: sub.id, userId: user ? user.id : null, plan, status: String(sub.status || 'UNKNOWN'),
    renewsAt: (sub.billing_info || {}).next_billing_time || null, endsAt: sub.status === 'CANCELLED' ? until : null }, user ? until : undefined);
  await audit(db, { actorId: null, action: 'billing.subscription', targetKind: 'user', targetId: user ? user.id : null,
    details: { source, plan, status: sub.status || null, until } });
  return { userId: user ? user.id : null, plan, status: sub.status, until };
}

// Vuelta desde PayPal: solo la cuenta dueña de la suscripción puede confirmarla.
async function confirm(db, config, user, subscriptionId, fetchImpl = fetch) {
  if (!user) throw new HttpError(401, 'login_required');
  if (!configured(config)) throw new HttpError(503, 'not_configured');
  const out = await syncSubscription(db, config, subscriptionId, fetchImpl, 'return');
  if (out.userId !== user.id) throw new HttpError(403, 'not_yours');
  return { active: !!(out.until && Date.parse(out.until) > Date.now()), status: out.status, until: out.until };
}

// Webhook de PayPal: se verifica la firma con la API de PayPal y después se vuelve a leer
// la suscripción (nunca se confía en el contenido del aviso).
async function handleWebhook(db, config, raw, headers, fetchImpl = fetch) {
  const c = cfgOf(config);
  if (!configured(config) || !c.webhookId) throw new HttpError(503, 'not_configured');
  let ev;
  try { ev = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')); } catch { throw new HttpError(400, 'invalid_json'); }
  const h = (k) => headers[k] || headers[k.toLowerCase()];
  const v = await paypal(config, fetchImpl, 'POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'), webhook_id: c.webhookId, webhook_event: ev,
  });
  if (!v.ok || v.data.verification_status !== 'SUCCESS') throw new HttpError(401, 'bad_signature');
  const kind = String(ev.event_type || '');
  const resource = ev.resource || {};
  // Avisos de suscripción: el id viene en resource.id. Cobros: en resource.billing_agreement_id.
  const subId = /^BILLING\.SUBSCRIPTION\./.test(kind) ? resource.id : /^PAYMENT\.SALE\./.test(kind) ? resource.billing_agreement_id : null;
  if (!subId) return { ok: true, ignored: kind || null };
  const eventId = `paypal:${ev.id || ''}`;
  if (ev.id && await db.get('SELECT id FROM payment_events WHERE id = ?', [eventId])) return { ok: true, duplicate: true };
  const out = await syncSubscription(db, config, subId, fetchImpl, kind);
  if (ev.id) await db.run('INSERT OR IGNORE INTO payment_events (id, provider, kind) VALUES (?, ?, ?)', [eventId, 'paypal', kind]);
  return { ok: true, user: !!out.userId, until: out.until };
}

// ── Comparación con la comunidad (Plus) ──
// Las referencias de la comunidad se recalculan como mucho una vez por día (y solo cuando
// alguien Plus las pide): leen las partidas de los últimos 30 días una vez, no en cada visita.
const BENCH_TTL = 24 * 3600000;
const BENCH_DAYS = 30;
const BENCH_WHERE = "g.finished_at IS NOT NULL AND g.mode NOT IN ('practice','duel','tournament') AND c.language_code = ?";

async function benchmarks(db, lang) {
  const rows = await db.all('SELECT * FROM community_benchmarks WHERE language_code = ? ORDER BY difficulty', [lang]);
  if (rows.length && Date.now() - Date.parse(rows[0].computed_at) < BENCH_TTL) return rows;
  const since = new Date(Date.now() - BENCH_DAYS * 86400000).toISOString();
  const agg = await db.all(`SELECT c.difficulty AS d, COUNT(*) AS n, SUM(CASE WHEN g.status = 'solved' THEN 1 ELSE 0 END) AS solved, AVG(g.hints_used) AS hints
    FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${BENCH_WHERE} AND g.finished_at >= ? GROUP BY c.difficulty`, [lang, since]);
  const at = now();
  const out = [];
  for (const r of agg) {
    const sql = `SELECT g.duration_ms AS v FROM games g JOIN clues c ON c.id = g.clue_id WHERE ${BENCH_WHERE} AND g.finished_at >= ? AND c.difficulty = ? AND g.status = 'solved' AND g.duration_ms IS NOT NULL`;
    const n = (await db.get(`SELECT COUNT(*) AS n FROM (${sql})`, [lang, since, r.d])).n;
    const mid = n ? await db.all(`${sql} ORDER BY v LIMIT ? OFFSET ?`, [lang, since, r.d, n % 2 ? 1 : 2, Math.floor((n - 1) / 2)]) : [];
    const median = mid.length ? Math.round(mid.reduce((x, m) => x + Number(m.v), 0) / mid.length) : null;
    out.push({ language_code: lang, difficulty: r.d, games: r.n, solve_rate: r.n ? Math.round((r.solved / r.n) * 1000) / 10 : null,
      median_ms: median, avg_hints: r.hints === null ? null : Math.round(r.hints * 10) / 10, computed_at: at });
  }
  await db.tx(async (t) => {
    await t.run('DELETE FROM community_benchmarks WHERE language_code = ?', [lang]);
    for (const b of out) {
      await t.run('INSERT INTO community_benchmarks (language_code, difficulty, games, solve_rate, median_ms, avg_hints, computed_at) VALUES (?,?,?,?,?,?,?)',
        [b.language_code, b.difficulty, b.games, b.solve_rate, b.median_ms, b.avg_hints, b.computed_at]);
    }
  });
  return out;
}

// Tus números por dificultad (últimos 30 días) al lado de los de la comunidad.
async function comparison(db, user, lang = 'es') {
  const ids = (await db.all('SELECT id FROM players WHERE user_id = ?', [user.id])).map((r) => r.id);
  const community = await benchmarks(db, lang);
  const since = new Date(Date.now() - BENCH_DAYS * 86400000).toISOString();
  const mine = ids.length ? await db.all(`SELECT c.difficulty AS d, g.status, g.duration_ms, g.hints_used FROM games g JOIN clues c ON c.id = g.clue_id
    WHERE g.player_id IN (${ids.map(() => '?').join(',')}) AND ${BENCH_WHERE} AND g.finished_at >= ?`, [...ids, lang, since]) : [];
  const med = (a) => { if (!a.length) return null; const x = [...a].sort((p, q) => p - q); const m = Math.floor(x.length / 2); return Math.round(x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2); };
  const rows = [1, 2, 3, 4, 5].map((d) => {
    const list = mine.filter((r) => r.d === d);
    const solved = list.filter((r) => r.status === 'solved');
    const c = community.find((b) => b.difficulty === d) || null;
    return {
      difficulty: d,
      you: { games: list.length, solve_rate: list.length ? Math.round((solved.length / list.length) * 1000) / 10 : null,
        median_ms: med(solved.map((r) => r.duration_ms).filter((v) => v !== null)), avg_hints: list.length ? Math.round((list.reduce((x, r) => x + r.hints_used, 0) / list.length) * 10) / 10 : null },
      community: c ? { games: c.games, solve_rate: c.solve_rate, median_ms: c.median_ms, avg_hints: c.avg_hints } : null,
    };
  });
  return { days: BENCH_DAYS, computed_at: community.length ? community[0].computed_at : null, rows };
}

module.exports = { benchmarks, comparison, PLANS, configured, available, isPlus, status, checkout, confirm, handleWebhook, untilFor, clearTokenCache };
