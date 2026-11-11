'use strict';

// Plan Plus: suscripción mensual o anual cobrada con Polar (vendedor registrado: cobra,
// factura y liquida los impuestos de cada país). Incluye: sin anuncios, 10 Crípticos Plus por día,
// la comparación con la comunidad, la insignia Plus y avatares exclusivos. Nunca da ventajas en
// torneos ni duelos. Flujo de pago sin scripts de terceros:
//  1) POST /api/billing/plus/checkout crea un checkout de Polar con el id de la cuenta
//     (external_customer_id y metadata.user_id) y devuelve su enlace.
//  2) Polar vuelve a /es/plus?plus=ok; la página espera a que llegue el webhook.
//  3) El webhook (firma Standard Webhooks con el secreto del webhook) da y mantiene el beneficio:
//     altas, renovaciones, cancelaciones, vencimientos.
// El beneficio se guarda en users.plus_until, que viaja con la sesión: ver si una
// página lleva anuncios no suma lecturas a la base. Ver docs/PLUS.md.

const crypto = require('node:crypto');
const { now, HttpError } = require('./util');
const { audit } = require('./audit');
const { getSetting } = require('./settings');
const UI = require('./uievents');

// Precios que se muestran (el cobro real lo define cada producto en Polar).
const PLANS = {
  monthly: { price: 'USD 1,50', per: 'mes', months: 1 },
  yearly: { price: 'USD 12', per: 'año', months: 12, note: 'equivale a USD 1 por mes' },
};
const GRACE_MS = 3 * 86400000;          // margen si el cobro de la renovación se demora
const SIGNATURE_TOLERANCE_S = 5 * 60;   // avisos con más de 5 minutos de diferencia se rechazan
const SETTING = 'billing.polar';

const cfgOf = (config) => config.polar || {};
const apiBase = (config) => (cfgOf(config).server === 'sandbox' ? 'https://sandbox-api.polar.sh/v1' : 'https://api.polar.sh/v1');
function configured(config) {
  const c = cfgOf(config);
  return !!(c.accessToken && c.webhookSecret && (c.productMonthly || c.productYearly));
}
// Qué planes se pueden contratar: en Polar cada plan es un producto con su propio id.
function productIds(config) {
  const c = cfgOf(config);
  return Object.fromEntries([['monthly', c.productMonthly], ['yearly', c.productYearly]].filter(([, id]) => id));
}
const planOf = (config, productId) => Object.entries(productIds(config)).find(([, id]) => String(id) === String(productId))?.[0] || null;

// El pago se habilita con las claves y los términos del plan (con Polar) publicados.
async function available(db, config) {
  if (!configured(config)) return false;
  try { return (await getSetting(db, SETTING)) === true; } catch { return false; }
}

function isPlus(user) {
  return !!(user && user.plus_until && Date.parse(user.plus_until) > Date.now());
}

const PORTAL_PATH = '/api/billing/plus/portal';
async function status(db, config, user) {
  const sub = user ? await db.get('SELECT plan, status, renews_at, ends_at, portal_url FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [user.id]) : null;
  const ok = await available(db, config);
  const ids = ok ? productIds(config) : {};
  return {
    available: ok, plans: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, { ...p, available: ok && !!ids[k] }])),
    active: isPlus(user), until: user ? user.plus_until || null : null,
    subscription: sub ? { plan: sub.plan, status: sub.status, renews_at: sub.renews_at, ends_at: sub.ends_at } : null,
    manage_url: PORTAL_PATH,
  };
}

const authHeaders = (config) => ({ Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${cfgOf(config).accessToken}` });

// Crea el checkout en Polar y devuelve su enlace.
async function checkout(db, config, user, plan = 'monthly', fetchImpl = fetch) {
  if (!user) throw new HttpError(401, 'login_required', 'Entrá o creá una cuenta gratis para hacerte Plus.');
  if (!(await available(db, config))) throw new HttpError(503, 'not_configured', 'El pago todavía no está disponible.');
  const product = productIds(config)[plan];
  if (!product) throw new HttpError(400, 'invalid_plan');
  if (isPlus(user)) throw new HttpError(409, 'already_active', 'Ya sos Plus.');
  const res = await fetchImpl(`${apiBase(config)}/checkouts/`, {
    method: 'POST', headers: authHeaders(config),
    body: JSON.stringify({ products: [product], external_customer_id: user.id, metadata: { user_id: user.id, plan },
      success_url: `${config.siteUrl}/es/plus?plus=ok` }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  const url = res && res.ok && body.url;
  if (!url || !/^https:\/\//.test(url)) throw new HttpError(502, 'checkout_failed', 'No se pudo abrir el pago. Probá de nuevo en un rato.');
  await UI.bump(db, 'plus_checkout_created').catch(() => {});
  return { url };
}

// Portal de cliente de Polar (administrar o cancelar): se abre con una sesión de un solo uso.
async function portal(config, user, fetchImpl = fetch) {
  if (!user) throw new HttpError(401, 'login_required');
  if (!configured(config)) throw new HttpError(503, 'not_configured');
  const res = await fetchImpl(`${apiBase(config)}/customer-sessions/`, {
    method: 'POST', headers: authHeaders(config), body: JSON.stringify({ external_customer_id: user.id }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  const url = res && res.ok && body.customer_portal_url;
  if (!url || !/^https:\/\//.test(url)) throw new HttpError(502, 'portal_failed', 'No se pudo abrir la administración del plan. Probá de nuevo en un rato.');
  return { url };
}

// Estado de Polar → el que guarda y muestra el sitio (active, on_trial, past_due, cancelled, expired).
function statusOf(sub) {
  const st = String(sub.status || '').toLowerCase();
  if (['active', 'trialing', 'past_due'].includes(st)) {
    if (sub.cancel_at_period_end || sub.ends_at) return 'cancelled';
    return st === 'trialing' ? 'on_trial' : st;
  }
  if (st === 'canceled') return 'cancelled';
  return st === 'incomplete' ? 'incomplete' : 'expired';   // incomplete_expired, unpaid
}

// Hasta cuándo queda Plus según la suscripción de Polar.
function untilFor(sub) {
  const st = statusOf(sub);
  const fut = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) && t > Date.now() ? t : null; };
  if (['active', 'on_trial', 'past_due'].includes(st)) {
    const base = Date.parse((st === 'on_trial' && sub.trial_end) || sub.current_period_end || '');
    return Number.isFinite(base) ? new Date(base + GRACE_MS).toISOString() : null;
  }
  // Cancelada: se respeta lo ya pagado, hasta el final del período (si ya terminó, se quita).
  if (st === 'cancelled') {
    if (sub.ended_at && !fut(sub.ended_at)) return null;
    const end = fut(sub.ends_at) || fut(sub.current_period_end);
    return end ? new Date(end).toISOString() : null;
  }
  return null;
}

// Claves posibles del secreto (Standard Webhooks): el «whsec_…» decodificado de base64, o sus bytes
// tal cual (secretos de Polar anteriores a septiembre de 2026).
function secretKeys(secret) {
  const s = String(secret || '');
  const keys = [Buffer.from(s, 'utf8')];
  const b64 = s.replace(/^whsec_/, '');
  if (/^[A-Za-z0-9+/]+=*$/.test(b64)) { const k = Buffer.from(b64, 'base64'); if (k.length >= 16) keys.unshift(k); }
  return keys;
}
function validSignature(secret, id, ts, buf, header) {
  const sigs = String(header || '').split(' ').map((p) => p.split(',')).filter(([v, s]) => v === 'v1' && s).map(([, s]) => Buffer.from(s, 'base64'));
  if (!sigs.length) return false;
  const signed = Buffer.concat([Buffer.from(`${id}.${ts}.`, 'utf8'), buf]);
  for (const key of secretKeys(secret)) {
    const expected = crypto.createHmac('sha256', key).update(signed).digest();
    if (sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(s, expected))) return true;
  }
  return false;
}

// Webhook de Polar (Standard Webhooks): firma HMAC-SHA256 de «id.timestamp.cuerpo».
async function handleWebhook(db, config, raw, headers) {
  const c = cfgOf(config);
  if (!configured(config)) throw new HttpError(503, 'not_configured');
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
  const id = String(headers['webhook-id'] || '');
  const ts = String(headers['webhook-timestamp'] || '');
  if (!id || !/^\d{1,12}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_S) throw new HttpError(401, 'bad_signature');
  if (!validSignature(c.webhookSecret, id, ts, buf, headers['webhook-signature'])) throw new HttpError(401, 'bad_signature');
  let ev;
  try { ev = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
  const kind = String(ev.type || '');
  const data = ev.data || {};
  if (!/^subscription\./.test(kind) || !data.id) return { ok: true, ignored: kind || null };
  const plan = planOf(config, data.product_id);
  if (!plan) return { ok: true, ignored: 'other_product' };
  // Un mismo aviso (mismo id de entrega) se aplica una vez.
  const eventId = `polar:${id}`;
  if (await db.get('SELECT id FROM payment_events WHERE id = ?', [eventId])) return { ok: true, duplicate: true };
  const subId = `polar:${data.id}`;
  const prev = await db.get('SELECT user_id FROM subscriptions WHERE id = ?', [subId]);
  const claimed = (data.metadata || {}).user_id || (data.customer || {}).external_id;
  const owner = prev && prev.user_id ? prev.user_id : claimed;
  const user = owner ? await db.get('SELECT id FROM users WHERE id = ?', [String(owner)]) : null;
  const until = untilFor(data);
  const st = statusOf(data);
  const renews = ['active', 'on_trial', 'past_due'].includes(st) ? data.current_period_end || null : null;
  const ends = st === 'cancelled' ? data.ends_at || data.ended_at || data.current_period_end || null : null;
  await db.tx(async (t) => {
    await t.run(`INSERT INTO subscriptions (id, user_id, provider, plan, status, renews_at, ends_at, portal_url, updated_at) VALUES (?, ?, 'polar', ?, ?, ?, ?, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET user_id = COALESCE(subscriptions.user_id, excluded.user_id), plan = excluded.plan, status = excluded.status,
        renews_at = excluded.renews_at, ends_at = excluded.ends_at, updated_at = excluded.updated_at`,
    [subId, user ? user.id : null, plan, st, renews, ends, now()]);
    if (user) await t.run('UPDATE users SET plus_until = ? WHERE id = ?', [until, user.id]);
    await t.run('INSERT OR IGNORE INTO payment_events (id, provider, kind) VALUES (?, ?, ?)', [eventId, 'polar', kind]);
  });
  if (kind === 'subscription.created') await UI.bump(db, 'plus_subscribed').catch(() => {});
  await audit(db, { actorId: null, action: 'billing.subscription', targetKind: 'user', targetId: user ? user.id : null,
    details: { source: kind, plan, status: st, until } });
  return { ok: true, user: !!user, until };
}

// ── Comparación con la comunidad (Plus) ──
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

module.exports = { benchmarks, comparison, PLANS, configured, available, isPlus, status, checkout, portal, handleWebhook, untilFor, statusOf, SETTING };
