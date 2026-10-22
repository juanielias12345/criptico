'use strict';

// Calendario de redes: carpetas por día, aprobación en bloque y programación en
// Metricool. Nada sale sin la aprobación de un CEO sobre la versión exacta que vio;
// «programada» exige el identificador que devuelve Metricool. Ver docs/REDES.md.

const fs = require('fs');
const path = require('path');
const { now, parseJson, HttpError } = require('./util');
const { audit } = require('./audit');
const gov = require('./governance');
const company = require('./company');

const PLAN_FILE = path.join(__dirname, '..', '..', 'data', 'social', 'plan.json');
const CAMPAIGN = 'lanzamiento-60';
let planCache = null;
function plan() {
  if (!planCache) planCache = fs.existsSync(PLAN_FILE) ? JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8')) : null;
  return planCache;
}

const RIGHTS = 'Diseño propio según el manual de marca; tipografías Fraunces e Instrument Sans (licencia OFL); crípticos originales del catálogo de Play Crípticos.';

const nets = (p) => (p && p.networks) || ['instagram', 'facebook', 'tiktok', 'youtube'];

// Piezas de redes que la marca dejó de usar: se pausan (no se borran) si todavía no
// salieron; su aprobación pendiente se retira. Lo programado o publicado no se toca.
async function retireOffPlan(db, all) {
  const keep = new Set(all.map((x) => x.id));
  const rows = await db.all("SELECT id, status, approval_id FROM content_pieces WHERE campaign = ? AND status NOT IN ('paused','scheduled','published')", [CAMPAIGN]);
  const off = rows.filter((r) => !keep.has(r.id));
  for (const r of off) {
    const ap = r.approval_id && await db.get("SELECT status FROM approval_items WHERE id = ? AND status = 'pending'", [r.approval_id]);
    if (ap) await gov.withdraw(db, r.approval_id, { id: null });
    await db.run("UPDATE content_pieces SET status = 'paused', updated_at = ? WHERE id = ?", [now(), r.id]);
  }
  if (off.length) await audit(db, { actorKind: 'agent', actorLabel: 'produccion-contenido', action: 'content.networks_dropped', targetKind: 'campaign', targetId: CAMPAIGN,
    details: { paused: off.length, networks: nets(plan()) } });
  return off.length;
}

// Carga el calendario en el panel: cada pieza queda «en edición», lista para revisar.
// Es idempotente y no toca piezas que ya existen (ni su estado ni su aprobación).
async function seedPlan(db) {
  const p = plan();
  if (!p) return { loaded: 0 };
  const all = p.days.flatMap((d) => d.pieces);
  await retireOffPlan(db, all);
  const have = (await db.get('SELECT COUNT(*) AS n FROM content_pieces WHERE campaign = ? AND platform IN (' + nets(p).map(() => '?').join(',') + ')', [CAMPAIGN, ...nets(p)])).n;
  if (have >= all.length) return { loaded: 0 };
  const stmts = all.map((x) => ({
    sql: `INSERT OR IGNORE INTO content_pieces(id, title, campaign, objective, audience, language, platform, format, body, hashtags, link, alt_text, assets,
      rights, metric, scheduled_at, status, created_by, day, slot, schedule_note, manual) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [x.id, x.title, CAMPAIGN, 'Lanzamiento: que la gente juegue en playcripticos.com', 'Personas que juegan juegos de palabras en español',
      'es', x.platform, x.format, x.body, x.hashtags, x.link, x.alt_text, JSON.stringify(x.assets), RIGHTS,
      'Partidas completadas que llegan desde esta red', x.scheduled_at, 'editing', 'agente:produccion-contenido', x.day, x.slot, x.schedule_note, x.manual ? 1 : 0],
  }));
  for (let i = 0; i < stmts.length; i += 100) {
    if (db.client && db.client.batch) await db.client.batch(stmts.slice(i, i + 100), 'write');
    else for (const s of stmts.slice(i, i + 100)) await db.run(s.sql, s.args);
  }
  await audit(db, { actorKind: 'agent', actorLabel: 'produccion-contenido', action: 'content.calendar_loaded', targetKind: 'campaign', targetId: CAMPAIGN,
    details: { days: p.days.length, pieces: all.length, start: p.start } });
  // Las piezas sueltas de carruseles que ahora están en el calendario se pausan si nadie las decidió todavía.
  for (const id of ['mk-c01', 'mk-c02', 'mk-c03', 'mk-c04']) {
    const old = await db.get("SELECT * FROM content_pieces WHERE id = ? AND status = 'pending_approval'", [id]);
    if (!old) continue;
    const ap = old.approval_id && await db.get("SELECT status FROM approval_items WHERE id = ? AND status = 'pending'", [old.approval_id]);
    if (old.approval_id && !ap) continue;
    if (old.approval_id) await gov.withdraw(db, old.approval_id, { id: null });
    await db.run("UPDATE content_pieces SET status = 'paused', updated_at = ? WHERE id = ?", [now(), id]);
    await audit(db, { actorKind: 'agent', actorLabel: 'produccion-contenido', action: 'content.superseded', targetKind: 'content_piece', targetId: id,
      details: { reason: 'Incluida en el calendario de 60 días' } });
  }
  return { loaded: all.length - have };
}

const STATUS_GROUPS = { pending: ['idea', 'research', 'production', 'editing', 'rights_review', 'pending_approval'], approved: ['approved'],
  scheduled: ['scheduled'], published: ['published'], changes: ['changes_requested', 'rejected', 'paused', 'publish_error'] };
const groupOf = (s) => Object.keys(STATUS_GROUPS).find((k) => STATUS_GROUPS[k].includes(s)) || 'pending';

async function calendar(db) {
  const p = plan();
  const N = nets(p); const inN = N.map(() => '?').join(',');
  const rows = await db.all(`SELECT day, status, COUNT(*) AS n FROM content_pieces WHERE campaign = ? AND platform IN (${inN}) GROUP BY day, status`, [CAMPAIGN, ...N]);
  const days = (p ? p.days : []).map((d) => {
    const c = { pending: 0, approved: 0, scheduled: 0, published: 0, changes: 0, total: 0 };
    for (const r of rows.filter((x) => x.day === d.n)) { c[groupOf(r.status)] += r.n; c.total += r.n; }
    return { n: d.n, date: d.date, weekday: d.weekday, label: d.label, clue: d.clue, counts: c };
  });
  return { campaign: CAMPAIGN, start: p && p.start, timezone: p && p.timezone, networks: N, slots: p && p.slots, days, metricool: metricool.status() };
}

async function day(db, n) {
  const p = plan();
  const meta = p && p.days.find((d) => d.n === Number(n));
  if (!meta) throw new HttpError(404, 'not_found');
  const N = nets(p);
  const rows = await db.all(`SELECT * FROM content_pieces WHERE campaign = ? AND day = ? AND platform IN (${N.map(() => '?').join(',')}) ORDER BY scheduled_at, platform`, [CAMPAIGN, meta.n, ...N]);
  return { ...meta, pieces: rows.map((r) => ({ ...r, assets: parseJson(r.assets, []), current_hash: company.pieceHash(r),
    approval_valid: !!r.approved_hash && r.approved_hash === company.pieceHash(r) })), metricool: metricool.status() };
}

// Aprueba varias piezas a la vez. Cada una se aprueba solo si su contenido sigue
// siendo exactamente el que la persona tenía en pantalla (hash).
async function approveMany(db, items, actor) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new HttpError(400, 'invalid_items');
  const out = { approved: 0, skipped: [], scheduled: 0, schedule_errors: 0 };
  for (const it of items) {
    const p = await db.get('SELECT * FROM content_pieces WHERE id = ? AND campaign = ?', [String(it.id), CAMPAIGN]);
    if (!p) { out.skipped.push({ id: it.id, reason: 'not_found' }); continue; }
    if (['approved', 'scheduled', 'published'].includes(p.status)) { out.skipped.push({ id: p.id, reason: 'already_' + p.status }); continue; }
    if (company.pieceHash(p) !== it.hash) { out.skipped.push({ id: p.id, reason: 'stale_version' }); continue; }
    let item = p.approval_id ? await db.get('SELECT * FROM approval_items WHERE id = ?', [p.approval_id]) : null;
    if (item && ['executed', 'withdrawn', 'rejected', 'conflict'].includes(item.status)) { out.skipped.push({ id: p.id, reason: 'approval_' + item.status }); continue; }
    if (!item) {
      item = await gov.createRequest(db, { kind: 'post', title: p.title, summary: `${p.platform} · ${p.format} · ${p.scheduled_at}`,
        content: company.pieceMaterial(p), targetKind: 'content_piece', targetId: p.id, requestedByKind: 'agent', requestedBy: 'produccion-contenido' }, null);
      await db.run("UPDATE content_pieces SET status = 'pending_approval', approval_id = ?, updated_at = ? WHERE id = ?", [item.id, now(), p.id]);
    } else if (item.content_hash !== it.hash) {
      item = await gov.revise(db, item.id, { content: company.pieceMaterial(p) }, actor);
    }
    try {
      await gov.vote(db, item.id, { decision: 'approve', version: item.version, content_hash: item.content_hash }, actor);
    } catch (e) { out.skipped.push({ id: p.id, reason: e.code || e.message }); continue; }
    const fresh = await db.get('SELECT * FROM content_pieces WHERE id = ?', [p.id]);
    if (fresh.status !== 'approved') { out.skipped.push({ id: p.id, reason: 'not_approved_yet' }); continue; }
    out.approved++;
    const s = await scheduleOne(db, fresh);
    if (s.scheduled) out.scheduled++; else if (s.error) out.schedule_errors++;
  }
  return out;
}

async function requestChanges(db, id, comment, actor) {
  if (!String(comment || '').trim()) throw new HttpError(400, 'comment_required', 'Contá qué hay que cambiar.');
  const p = await db.get('SELECT * FROM content_pieces WHERE id = ? AND campaign = ?', [id, CAMPAIGN]);
  if (!p) throw new HttpError(404, 'not_found');
  if (['scheduled', 'published'].includes(p.status)) throw new HttpError(409, 'already_' + p.status);
  let item = p.approval_id ? await db.get('SELECT * FROM approval_items WHERE id = ?', [p.approval_id]) : null;
  if (!item || ['executed', 'withdrawn'].includes(item.status)) {
    item = await gov.createRequest(db, { kind: 'post', title: p.title, summary: `${p.platform} · ${p.format} · ${p.scheduled_at}`,
      content: company.pieceMaterial(p), targetKind: 'content_piece', targetId: p.id, requestedByKind: 'agent', requestedBy: 'produccion-contenido' }, null);
  }
  if (item.status === 'pending') await gov.vote(db, item.id, { decision: 'changes', comment, version: item.version, content_hash: item.content_hash }, actor);
  await db.run("UPDATE content_pieces SET status = 'changes_requested', approval_id = ?, approved_hash = NULL, updated_at = ? WHERE id = ?", [item.id, now(), p.id]);
  await audit(db, { actorId: actor.id, action: 'content.changes_requested', targetKind: 'content_piece', targetId: p.id, details: { comment } });
  return { ok: true };
}

// ── Metricool ──
// API oficial: POST https://app.metricool.com/api/v2/scheduler/posts?blogId=…&userId=… con el
// token en X-Mc-Auth. Requiere un plan de Metricool con acceso a la API.
const NETWORK = { instagram: 'instagram', facebook: 'facebook', x: 'twitter', threads: 'threads', tiktok: 'tiktok', youtube: 'youtube' };
const metricool = {
  env: () => ({ token: process.env.METRICOOL_USER_TOKEN, userId: process.env.METRICOOL_USER_ID, blogId: process.env.METRICOOL_BLOG_ID }),
  configured() { const e = this.env(); return !!(e.token && e.userId && e.blogId); },
  status() { return { configured: this.configured() }; },
};

function metricoolBody(p, siteUrl) {
  const network = NETWORK[p.platform];
  const assets = parseJson(p.assets, []);
  const media = assets.map((a) => (/^https:\/\//.test(a) ? a : siteUrl + a));
  const local = new Date(new Date(p.scheduled_at).getTime() - 3 * 3600000).toISOString().slice(0, 19);
  const body = { publicationDate: { dateTime: local, timezone: 'America/Argentina/Buenos_Aires' }, text: p.body || '', providers: [{ network }],
    autoPublish: true, draft: false, shortener: false, saveExternalMediaFiles: true, media, mediaAltText: media.map(() => p.alt_text || '') };
  if (network === 'instagram') body.instagramData = { type: p.format === 'reel' ? 'REEL' : p.format === 'historia' ? 'STORY' : 'POST' };
  if (network === 'instagram' && p.format === 'historia') body.text = '';
  if (network === 'facebook') body.facebookData = { type: p.format === 'reel' ? 'REEL' : 'POST' };
  if (network === 'twitter') body.twitterData = { tags: [] };
  if (network === 'threads') body.threadsData = {};
  if (network === 'tiktok') body.tiktokData = { privacyOption: 'PUBLIC_TO_EVERYONE', title: (p.body || '').split('\n')[0].slice(0, 90) };
  if (network === 'youtube') body.youtubeData = { title: (p.body || '').split('\n')[0].slice(0, 95) || 'Críptico del día', type: 'short', privacy: 'public', madeForKids: false };
  return body;
}

// Programa una pieza aprobada. Devuelve { scheduled } con evidencia, { manual } o { error }.
async function scheduleOne(db, p, { fetchImpl = global.fetch, siteUrl = process.env.SITE_URL || 'https://playcripticos.com' } = {}) {
  if (p.status !== 'approved' || !p.approved_hash || company.pieceHash(p) !== p.approved_hash) return { skipped: true };
  if (p.manual || !NETWORK[p.platform]) return { manual: true };
  if (new Date(p.scheduled_at).getTime() < Date.now() + 5 * 60000) {
    await db.run('UPDATE content_pieces SET external_error = ? WHERE id = ?', ['El horario ya pasó: elegí otro o publicala a mano.', p.id]);
    return { error: 'past' };
  }
  if (!metricool.configured()) return { waiting: true };
  const e = metricool.env();
  try {
    const r = await fetchImpl(`https://app.metricool.com/api/v2/scheduler/posts?blogId=${encodeURIComponent(e.blogId)}&userId=${encodeURIComponent(e.userId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mc-Auth': e.token }, body: JSON.stringify(metricoolBody(p, siteUrl.replace(/\/$/, ''))),
    });
    const text = await r.text();
    let data = null; try { data = JSON.parse(text); } catch (x) { /* texto plano */ }
    const id = data && (data.id || (data.data && data.data.id));
    if (!r.ok || !id) throw new Error(`Metricool respondió ${r.status}: ${text.slice(0, 300)}`);
    await db.run("UPDATE content_pieces SET status = 'scheduled', external_id = ?, external_error = NULL, schedule_attempts = schedule_attempts + 1, updated_at = ? WHERE id = ?",
      [String(id), now(), p.id]);
    await audit(db, { actorKind: 'system', action: 'content.scheduled', targetKind: 'content_piece', targetId: p.id, details: { metricool_id: String(id), at: p.scheduled_at } });
    return { scheduled: true, id: String(id) };
  } catch (err) {
    await db.run('UPDATE content_pieces SET external_error = ?, schedule_attempts = schedule_attempts + 1, updated_at = ? WHERE id = ?', [String(err.message).slice(0, 500), now(), p.id]);
    return { error: err.message };
  }
}

// Tarea programada: reintenta lo aprobado que todavía no está en Metricool.
async function scheduleApproved(db, opts) {
  const rows = await db.all("SELECT * FROM content_pieces WHERE campaign = ? AND status = 'approved' AND manual = 0 AND scheduled_at > ? AND schedule_attempts < 5 ORDER BY scheduled_at LIMIT 50",
    [CAMPAIGN, now()]);
  const res = { tried: rows.length, scheduled: 0, waiting: 0, errors: 0 };
  for (const p of rows) {
    const r = await scheduleOne(db, p, opts);
    if (r.scheduled) res.scheduled++; else if (r.waiting) res.waiting++; else if (r.error) res.errors++;
  }
  return res;
}

module.exports = { seedPlan, retireOffPlan, calendar, day, approveMany, requestChanges, scheduleOne, scheduleApproved, metricoolBody, metricool, CAMPAIGN };
