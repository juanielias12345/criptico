'use strict';

// Calendario de redes de 60 días: carpetas por día, aprobación en bloque atada a
// la versión, programación en Metricool con evidencia y archivos reales.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeEnv, client, staff } = require('./helpers');
const social = require('../src/services/social');

const PLAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'social', 'plan.json'), 'utf8'));
const ALL = PLAN.days.flatMap((d) => d.pieces);

let env; let owner;
test.before(async () => { env = await makeEnv(); owner = await staff(env, 'owner'); });
test.after(async () => { await env.close(); });

test('el plan: 60 días desde el viernes 23/10, solo Instagram, Facebook, TikTok y YouTube, con horario', () => {
  assert.equal(PLAN.days.length, 60);
  assert.equal(PLAN.days[0].date, '2026-10-23');
  assert.equal(PLAN.days[59].date, '2026-12-21');
  assert.deepEqual([...new Set(ALL.map((p) => p.platform))].sort(), ['facebook', 'instagram', 'tiktok', 'youtube']);
  for (const d of PLAN.days) {
    assert.ok(d.pieces.length >= 7, 'día ' + d.n);
    assert.ok(d.pieces.every((p) => p.date === d.date && p.schedule_note && /T\d\d:\d\d:00Z$/.test(p.scheduled_at)));
  }
  // 9 h en Argentina = 12 h UTC
  assert.equal(PLAN.days[0].pieces.find((p) => p.slot === 'instagram_clue').scheduled_at, '2026-10-23T12:00:00Z');
  // Un críptico distinto cada día, y todos existen en el catálogo del sitio.
  const answers = PLAN.days.map((d) => d.clue.answer);
  assert.equal(new Set(answers).size, 60);
});

test('cada archivo del plan existe de verdad (imágenes y videos)', () => {
  const missing = [...new Set(ALL.flatMap((p) => p.assets))].filter((a) => !fs.existsSync(path.join(__dirname, '..', 'public', a)));
  assert.deepEqual(missing, []);
  const v = path.join(__dirname, '..', 'public', 'social', 'd00', 'video.mp4');
  assert.ok(fs.statSync(v).size > 20000);
});

test('los crípticos del día están publicados en el catálogo con la misma dirección', async () => {
  for (const d of PLAN.days) {
    const c = await env.db.get("SELECT answer FROM clues WHERE slug = ? AND status = 'published'", [d.clue.slug]);
    assert.ok(c, d.clue.slug);
    assert.equal(c.answer, d.clue.answer);
  }
});

test('el calendario se carga una vez en el panel, en edición y sin aprobación', async () => {
  const n = (await env.db.get('SELECT COUNT(*) AS n FROM content_pieces WHERE campaign = ?', [social.CAMPAIGN])).n;
  assert.equal(n, ALL.length);
  assert.equal((await social.seedPlan(env.db)).loaded, 0);
  const bad = await env.db.get("SELECT COUNT(*) AS n FROM content_pieces WHERE campaign = ? AND (status != 'editing' OR approved_hash IS NOT NULL)", [social.CAMPAIGN]);
  assert.equal(bad.n, 0);
  const cal = await owner.c.get('/api/admin/social/calendar');
  assert.equal(cal.status, 200);
  assert.equal(cal.json.days.length, 60);
  assert.equal(cal.json.days[0].counts.pending, PLAN.days[0].pieces.length);
  assert.equal(cal.json.metricool.configured, false);
  const day = await owner.c.get('/api/admin/social/days/3');
  assert.equal(day.json.pieces.length, PLAN.days[3].pieces.length);
  assert.ok(day.json.pieces.every((p) => p.current_hash && Array.isArray(p.assets)));
});

test('aprobar un día: solo la versión que se vio, con pedido y voto en la bandeja; sin Metricool queda aprobada', async () => {
  const day = (await owner.c.get('/api/admin/social/days/1')).json;
  const [first, second, ...rest] = day.pieces;
  // Alguien cambia el texto de una pieza después de que el CEO abrió la carpeta.
  await env.db.run("UPDATE content_pieces SET body = body || ' (cambio)' WHERE id = ?", [second.id]);
  const r = await owner.c.post('/api/admin/social/approve', { items: [first, second, ...rest].map((p) => ({ id: p.id, hash: p.current_hash })) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.approved, day.pieces.length - 1);
  assert.deepEqual(r.json.skipped.map((s) => s.reason), ['stale_version']);
  assert.equal(r.json.scheduled, 0);
  const p1 = await env.db.get('SELECT * FROM content_pieces WHERE id = ?', [first.id]);
  assert.equal(p1.status, 'approved');
  const ap = await env.db.get('SELECT * FROM approval_items WHERE id = ?', [p1.approval_id]);
  assert.equal(ap.status, 'approved');
  assert.equal(ap.content_hash, p1.approved_hash);
  const votes = await env.db.all('SELECT * FROM approval_votes WHERE item_id = ?', [ap.id]);
  assert.equal(votes.length, 1);
  assert.equal(votes[0].user_id, owner.user.id);
  const p2 = await env.db.get('SELECT status FROM content_pieces WHERE id = ?', [second.id]);
  assert.notEqual(p2.status, 'approved');
  // Aprobar de nuevo no duplica nada.
  const again = await owner.c.post('/api/admin/social/approve', { items: [{ id: first.id, hash: first.current_hash }] });
  assert.equal(again.json.approved, 0);
});

test('pedir cambios exige comentario y devuelve la pieza; un analista no aprueba', async () => {
  const day = (await owner.c.get('/api/admin/social/days/2')).json;
  const p = day.pieces[0];
  assert.equal((await owner.c.post(`/api/admin/social/pieces/${p.id}/changes`, { comment: '' })).status, 400);
  assert.equal((await owner.c.post(`/api/admin/social/pieces/${p.id}/changes`, { comment: 'Cambiar el gancho' })).status, 200);
  assert.equal((await env.db.get('SELECT status FROM content_pieces WHERE id = ?', [p.id])).status, 'changes_requested');
  const analyst = await staff(env, 'analyst');
  assert.equal((await analyst.c.post('/api/admin/social/approve', { items: [{ id: day.pieces[1].id, hash: day.pieces[1].current_hash }] })).status, 403);
});

test('Metricool: arma el pedido de cada red y guarda el identificador como evidencia', async () => {
  const get = (slot) => env.db.get('SELECT * FROM content_pieces WHERE campaign = ? AND day = 1 AND slot = ?', [social.CAMPAIGN, slot]);
  const reel = social.metricoolBody(await get('instagram_reel'), 'https://playcripticos.com');
  assert.deepEqual(reel.providers, [{ network: 'instagram' }]);
  assert.equal(reel.instagramData.type, 'REEL');
  assert.equal(reel.media[0], 'https://playcripticos.com/social/d01/video.mp4');
  assert.deepEqual(reel.publicationDate, { dateTime: '2026-10-24T21:00:00', timezone: 'America/Argentina/Buenos_Aires' });
  const story = social.metricoolBody(await get('instagram_story'), 'https://playcripticos.com');
  assert.equal(story.instagramData.type, 'STORY');
  assert.equal(story.text, '');
  assert.equal(social.metricoolBody(await get('tiktok_video'), 'https://x').providers[0].network, 'tiktok');
  const yt = social.metricoolBody(await get('youtube_video'), 'https://x');
  assert.equal(yt.youtubeData.type, 'short');
  assert.equal(yt.youtubeData.madeForKids, false);

  const piece = await get('facebook_reel');
  assert.equal(piece.status, 'approved');
  // Reloj fijo antes del lanzamiento: el calendario es de fechas reales y la prueba no debe vencer.
  const clock = Date.parse('2026-10-22T12:00:00Z');
  // Sin credenciales: espera.
  assert.deepEqual(await social.scheduleOne(env.db, piece, { clock }), { waiting: true });
  const old = { ...process.env };
  Object.assign(process.env, { METRICOOL_USER_TOKEN: 't', METRICOOL_USER_ID: '1', METRICOOL_BLOG_ID: '2' });
  try {
    let sent = null;
    const ok = await social.scheduleOne(env.db, piece, { fetchImpl: async (url, o) => { sent = { url, o }; return { ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 98765 } }) }; }, clock });
    assert.deepEqual(ok, { scheduled: true, id: '98765' });
    assert.match(sent.url, /^https:\/\/app\.metricool\.com\/api\/v2\/scheduler\/posts\?blogId=2&userId=1$/);
    assert.equal(sent.o.headers['X-Mc-Auth'], 't');
    const after = await get('facebook_reel');
    assert.equal(after.status, 'scheduled');
    assert.equal(after.external_id, '98765');
    // Un error de Metricool no la marca como programada.
    const other = await get('instagram_clue');
    const bad = await social.scheduleOne(env.db, other, { fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'plan sin API' }), clock });
    assert.match(bad.error, /403/);
    const o2 = await get('instagram_clue');
    assert.equal(o2.status, 'approved');
    assert.match(o2.external_error, /plan sin API/);
  } finally { for (const k of ['METRICOOL_USER_TOKEN', 'METRICOOL_USER_ID', 'METRICOOL_BLOG_ID']) if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
  // Nada sin aprobar se programa.
  const pend = await env.db.get("SELECT * FROM content_pieces WHERE campaign = ? AND day = 5 LIMIT 1", [social.CAMPAIGN]);
  assert.deepEqual(await social.scheduleOne(env.db, pend), { skipped: true });
});

test('nueva revisión del calendario: lo no publicado toma fecha y archivos nuevos y vuelve a pedir aprobación', async () => {
  await env.db.run("UPDATE settings SET value = '1' WHERE key = 'social.plan_revision'");
  const ig = PLAN.days[1].pieces.find((p) => p.slot === 'instagram_reel');
  await env.db.run("UPDATE content_pieces SET scheduled_at = '2026-10-27T00:00:00Z', body = 'viejo' WHERE id = ?", [ig.id]);
  const before = await env.db.get('SELECT status, approval_id FROM content_pieces WHERE id = ?', [ig.id]);
  assert.equal(before.status, 'approved');
  await env.db.run(`INSERT INTO content_pieces(id, title, campaign, platform, format, body, assets, status, day, slot, scheduled_at)
    VALUES ('l60-d05-instagram_weekend', 'viejo finde', ?, 'instagram', 'imagen', 'x', '[]', 'editing', 5, 'instagram_weekend', '2026-10-31T15:00:00Z')`, [social.CAMPAIGN]);
  await social.seedPlan(env.db);
  const after = await env.db.get('SELECT * FROM content_pieces WHERE id = ?', [ig.id]);
  assert.equal(after.status, 'editing');
  assert.equal(after.scheduled_at, ig.scheduled_at);
  assert.equal(after.body, ig.body);
  assert.equal(after.approved_hash, null);
  assert.equal((await env.db.get('SELECT status FROM approval_items WHERE id = ?', [before.approval_id])).status, 'withdrawn');
  assert.equal((await env.db.get("SELECT status FROM content_pieces WHERE id = 'l60-d05-instagram_weekend'")).status, 'paused');
  // Lo ya programado en Metricool no se toca.
  assert.equal((await env.db.get("SELECT status FROM content_pieces WHERE campaign = ? AND day = 1 AND slot = 'facebook_reel'", [social.CAMPAIGN])).status, 'scheduled');
  assert.equal(JSON.parse((await env.db.get("SELECT value FROM settings WHERE key = 'social.plan_revision'")).value), PLAN.revision);
  // Correr de nuevo no cambia nada.
  await social.seedPlan(env.db);
  assert.equal((await env.db.get('SELECT status FROM content_pieces WHERE id = ?', [ig.id])).status, 'editing');
});

test('las piezas de redes que ya no se usan quedan pausadas y fuera de las carpetas', async () => {
  await env.db.run(`INSERT INTO content_pieces(id, title, campaign, platform, format, body, assets, status, day, slot, scheduled_at)
    VALUES ('l60-d04-x_clue', 'Día 4 · X', ?, 'x', 'post', 'texto', '[]', 'editing', 4, 'x_clue', '2026-10-30T12:00:00Z')`, [social.CAMPAIGN]);
  await social.seedPlan(env.db);
  assert.equal((await env.db.get("SELECT status FROM content_pieces WHERE id = 'l60-d04-x_clue'")).status, 'paused');
  const day = (await owner.c.get('/api/admin/social/days/4')).json;
  assert.ok(day.pieces.every((p) => ['instagram', 'facebook', 'tiktok', 'youtube'].includes(p.platform)));
  assert.equal(day.pieces.length, PLAN.days[4].pieces.length);
  const cal = (await owner.c.get('/api/admin/social/calendar')).json;
  assert.equal(cal.days[4].counts.total, PLAN.days[4].pieces.length);
  assert.ok(await env.db.get("SELECT 1 FROM audit_log WHERE action = 'content.networks_dropped'"));
});

test('los archivos de redes se sirven pero no se indexan', async () => {
  const c = client(env.base);
  assert.match((await c.get('/robots.txt')).text, /Disallow: \/social\//);
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.ok(vercel.headers.some((h) => h.source === '/social/(.*)' && h.headers.some((x) => x.key === 'X-Robots-Tag')));
  assert.match(vercel.functions['api/index.js'].includeFiles, /data\/social\/plan\.json/);
});

test('los videos llevan efectos de sonido propios alineados con la cuenta regresiva y la respuesta', () => {
  const { soundtrack } = require('../scripts/social/sfx');
  const wav = soundtrack([3, 1, 1, 1, 2.5, 5, 2.5]);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  const samples = (wav.length - 44) / 4;
  assert.equal(samples, 16 * 44100);
  const peak = (from, to) => { let m = 0; for (let i = Math.floor(from * 44100); i < to * 44100; i++) m = Math.max(m, Math.abs(wav.readInt16LE(44 + i * 4))); return m; };
  assert.ok(peak(3, 3.1) > 3000, 'tic del 3');
  assert.ok(peak(6, 6.4) > 3000, 'campanita de la respuesta');
  assert.ok(peak(4.6, 4.95) < 500, 'silencio entre tics');
  // Los MP4 ya generados tienen pista de audio AAC (marca «mp4a» en el contenedor).
  const mp4 = fs.readFileSync(path.join(__dirname, '..', 'public', 'social', 'd00', 'video.mp4'));
  assert.ok(mp4.includes(Buffer.from('mp4a')));
});
