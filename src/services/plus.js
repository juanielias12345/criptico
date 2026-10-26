'use strict';

// Plan Plus: suscripción mensual o anual cobrada con Lemon Squeezy (vendedor registrado: cobra,
// factura y liquida los impuestos de cada país). Incluye: sin anuncios, el Críptico Plus del día,
// la comparación con la comunidad, la insignia Plus y avatares exclusivos. Nunca da ventajas en
// torneos ni duelos. Flujo de pago sin scripts de terceros:
//  1) POST /api/billing/plus/checkout crea un checkout de Lemon Squeezy con el id de la cuenta
//     (custom.user_id) y devuelve su enlace.
//  2) Lemon Squeezy vuelve a /es/plus?plus=ok; la página espera a que llegue el webhook.
//  3) El webhook (firma HMAC con el secreto del webhook) da y mantiene el beneficio:
//     altas, renovaciones, cancelaciones, vencimientos.
// El beneficio se guarda en users.plus_until, que viaja con la sesión: ver si una
// página lleva anuncios no suma lecturas a la base. Ver docs/PLUS.md.

const crypto = require('node:crypto');
const { now, HttpError } = require('./util');
const { audit } = require('./audit');
const { getSetting } = require('./settings');

// Precios que se muestran (el cobro real lo define cada variante en Lemon Squeezy).
const PLANS = {
  monthly: { price: 'USD 1,50', per: 'mes', months: 1 },
  yearly: { price: 'USD 12', per: 'año', months: 12, note: 'equivale a USD 1 por mes' },
};
const GRACE_MS = 3 * 86400000;          // margen si el cobro de la renovación se demora
const API = 'https://api.lemonsqueezy.com/v1';

const cfgOf = (config) => config.lemonsqueezy || {};
function configured(config) {
  const c = cfgOf(config);
  return !!(c.apiKey && c.storeId && c.webhookSecret && (c.variantMonthly || c.variantYearly));
}
// Qué planes se pueden contratar (los que tienen variante en Lemon Squeezy).
function variantIds(config) {
  const c = cfgOf(config);
  return Object.fromEntries([['monthly', c.variantMonthly], ['yearly', c.variantYearly]].filter(([, id]) => id));
}
const planOf = (config, variantId) => Object.entries(variantIds(config)).find(([, id]) => String(id) === String(variantId))?.[0] || null;

// El pago se habilita con las claves y los términos del plan (con Lemon Squeezy) publicados.
async function available(db, config) {
  if (!configured(config)) return false;
  try { return (await getSetting(db, 'billing.lemonsqueezy')) === true; } catch { return false; }
}

function isPlus(user) {
  return !!(user && user.plus_until && Date.parse(user.plus_until) > Date.now());
}

async function status(db, config, user) {
  const sub = user ? await db.get('SELECT plan, status, renews_at, ends_at, portal_url FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1', [user.id]) : null;
  const ok = await available(db, config);
  const ids = variantIds(config);
  return {
    available: ok, plans: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, { ...p, available: ok && !!ids[k] }])),
    active: isPlus(user), until: user ? user.plus_until || null : null,
    subscription: sub ? { plan: sub.plan, status: sub.status, renews_at: sub.renews_at, ends_at: sub.ends_at } : null,
    manage_url: (sub && sub.portal_url) || 'https://app.lemonsqueezy.com/my-orders',
  };
}

// Crea el checkout en Lemon Squeezy y devuelve su enlace.
async function checkout(db, config, user, plan = 'monthly', fetchImpl = fetch) {
  if (!user) throw new HttpError(401, 'login_required', 'Entrá o creá una cuenta gratis para hacerte Plus.');
  if (!(await available(db, config))) throw new HttpError(503, 'not_configured', 'El pago todavía no está disponible.');
  const variant = variantIds(config)[plan];
  if (!variant) throw new HttpError(400, 'invalid_plan');
  if (isPlus(user)) throw new HttpError(409, 'already_active', 'Ya sos Plus.');
  const c = cfgOf(config);
  const res = await fetchImpl(`${API}/checkouts`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json', Authorization: `Bearer ${c.apiKey}` },
    body: JSON.stringify({ data: { type: 'checkouts', attributes: {
      checkout_data: { custom: { user_id: user.id } },
      product_options: { redirect_url: `${config.siteUrl}/es/plus?plus=ok` },
      checkout_options: { embed: false },
    }, relationships: {
      store: { data: { type: 'stores', id: String(c.storeId) } },
      variant: { data: { type: 'variants', id: String(variant) } },
    } } }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  const url = res && res.ok && body.data && body.data.attributes && body.data.attributes.url;
  if (!url || !/^https:\/\//.test(url)) throw new HttpError(502, 'checkout_failed', 'No se pudo abrir el pago. Probá de nuevo en un rato.');
  return { url };
}

// Hasta cuándo queda Plus según la suscripción de Lemon Squeezy.
function untilFor(sub) {
  const st = String(sub.status || '').toLowerCase();
  const renews = Date.parse(sub.renews_at || '');
  const ends = Date.parse(sub.ends_at || '');
  if (['active', 'on_trial', 'past_due'].includes(st)) {
    const base = st === 'on_trial' && Number.isFinite(Date.parse(sub.trial_ends_at || '')) ? Date.parse(sub.trial_ends_at) : renews;
    return Number.isFinite(base) ? new Date(base + GRACE_MS).toISOString() : null;
  }
  // Cancelada: se respeta lo ya pagado, hasta el final del período.
  if (st === 'cancelled') return Number.isFinite(ends) && ends > Date.now() ? new Date(ends).toISOString() : null;
  return null;   // expired, unpaid, paused
}

const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// Webhook de Lemon Squeezy: firma HMAC-SHA256 del cuerpo crudo con el secreto del webhook.
async function handleWebhook(db, config, raw, headers) {
  const c = cfgOf(config);
  if (!configured(config)) throw new HttpError(503, 'not_configured');
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw || ''), 'utf8');
  const sig = String(headers['x-signature'] || '');
  const expected = crypto.createHmac('sha256', c.webhookSecret).update(buf).digest('hex');
  if (!/^[0-9a-f]{64}$/i.test(sig) || !safeEqual(Buffer.from(sig.toLowerCase()), Buffer.from(expected))) throw new HttpError(401, 'bad_signature');
  let ev;
  try { ev = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
  const meta = ev.meta || {};
  const kind = String(meta.event_name || '');
  const data = ev.data || {};
  if (!/^subscription_/.test(kind) || data.type !== 'subscriptions' || !data.id) return { ok: true, ignored: kind || null };
  const attrs = data.attributes || {};
  if (c.storeId && attrs.store_id != null && String(attrs.store_id) !== String(c.storeId)) return { ok: true, ignored: 'other_store' };
  const plan = planOf(config, attrs.variant_id);
  if (!plan) return { ok: true, ignored: 'other_variant' };
  // Un mismo aviso (mismo evento, misma suscripción, misma fecha de actualización) se aplica una vez.
  const eventId = `lemonsqueezy:${kind}:${data.id}:${attrs.updated_at || ''}`;
  if (await db.get('SELECT id FROM payment_events WHERE id = ?', [eventId])) return { ok: true, duplicate: true };
  const subId = `lemonsqueezy:${data.id}`;
  const prev = await db.get('SELECT user_id FROM subscriptions WHERE id = ?', [subId]);
  const claimed = (meta.custom_data || {}).user_id;
  const owner = prev && prev.user_id ? prev.user_id : claimed;
  const user = owner ? await db.get('SELECT id FROM users WHERE id = ?', [String(owner)]) : null;
  const until = untilFor(attrs);
  const st = String(attrs.status || 'unknown');
  await db.tx(async (t) => {
    await t.run(`INSERT INTO subscriptions (id, user_id, provider, plan, status, renews_at, ends_at, portal_url, updated_at) VALUES (?, ?, 'lemonsqueezy', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id = COALESCE(subscriptions.user_id, excluded.user_id), plan = excluded.plan, status = excluded.status,
        renews_at = excluded.renews_at, ends_at = excluded.ends_at, portal_url = COALESCE(excluded.portal_url, subscriptions.portal_url), updated_at = excluded.updated_at`,
    [subId, user ? user.id : null, plan, st, attrs.renews_at || null, attrs.ends_at || null, ((attrs.urls || {}).customer_portal) || null, now()]);
    if (user) await t.run('UPDATE users SET plus_until = ? WHERE id = ?', [until, user.id]);
    await t.run('INSERT OR IGNORE INTO payment_events (id, provider, kind) VALUES (?, ?, ?)', [eventId, 'lemonsqueezy', kind]);
  });
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

module.exports = { benchmarks, comparison, PLANS, configured, available, isPlus, status, checkout, handleWebhook, untilFor };
