'use strict';

// Empresa: dos CEO con autoridad idéntica, MFA, sesiones, invitaciones,
// aprobaciones atadas a una versión, doble aprobación, conflictos, auditoría
// inalterable y centro de operaciones con datos reales.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client, staff } = require('./helpers');
const security = require('../src/services/security');
const auth = require('../src/services/auth');

let env;
test.before(async () => { env = await makeEnv(); });
test.after(async () => { await env.close(); });
// Muchas sesiones desde la misma IP de prueba: se limpia el límite por IP entre pruebas.
test.beforeEach(async () => { if (env) await env.db.run('DELETE FROM rate_limits'); });
// La doble aprobación es opcional (los CEO la desactivaron); las pruebas que la cubren la encienden.
const setDual = (on) => env.db.run("UPDATE settings SET value = ? WHERE key = 'governance.dual_approval'", [JSON.stringify(on)]);

async function loginWith(username, password, extra = {}, headers = {}) {
  const c = client(env.base);
  const r = await c.post('/api/auth/login', { username, password, admin: true, ...extra }, headers);
  return { c, r };
}

test('TOTP según RFC 6238 (vectores de prueba) y cifrado del secreto', () => {
  const secret = security.base32Encode(Buffer.from('12345678901234567890'));
  // RFC 6238, apéndice B (SHA-1): 59 s → 94287082 (8 dígitos) → 287082 con 6 dígitos
  assert.equal(security.totp(secret, 59 * 1000), '287082');
  assert.equal(security.totp(secret, 1111111109 * 1000), '081804');
  assert.ok(security.totpValid(secret, security.totp(secret, Date.now())));
  assert.ok(!security.totpValid(secret, '000000x'));
  const cfg = { ipHashSalt: 'una-sal-de-prueba' };
  const enc = security.encrypt(cfg, 'SECRETO');
  assert.notEqual(enc, 'SECRETO');
  assert.equal(security.decrypt(cfg, enc), 'SECRETO');
  assert.throws(() => security.decrypt({ ipHashSalt: 'otra' }, enc));
});

test('dos CEO con permisos idénticos; un CEO se suma solo por invitación de un solo uso', async () => {
  await setDual(true);
  const juan = await staff(env, 'owner', 'juan_ceo');
  const direct = await juan.c.post('/api/admin/users', { username: 'otro_ceo', password: 'Clave-segura-12345', role: 'owner' });
  assert.equal(direct.status, 400);
  assert.equal(direct.json.error, 'owner_requires_invite');

  const inv = await juan.c.post('/api/admin/team/invites', { role: 'owner', title: 'CEO y Súper Administradora', display_name: 'Inés de Gregorio' });
  assert.equal(inv.status, 201);
  assert.match(inv.json.path, /^\/admin#invite\?token=/);
  const row = await env.db.get("SELECT * FROM staff_tokens WHERE kind = 'invite'");
  assert.notEqual(row.id, inv.json.token, 'solo se guarda el hash del token');

  const anon = client(env.base);
  const info = await anon.get('/api/team/token?token=' + encodeURIComponent(inv.json.token));
  assert.equal(info.json.role, 'owner');
  const acc = await anon.post('/api/team/accept', { token: inv.json.token, username: 'ines_ceo', password: 'Otra-clave-segura-987', display_name: 'Inés de Gregorio' });
  assert.equal(acc.status, 201);
  const again = await anon.post('/api/team/accept', { token: inv.json.token, username: 'ines_dos', password: 'Otra-clave-segura-987' });
  assert.equal(again.status, 404, 'la invitación no se reutiliza');

  const ines = await env.db.get("SELECT role, title FROM users WHERE username = 'ines_ceo'");
  assert.equal(ines.role, 'owner');
  assert.equal(ines.title, 'CEO y Súper Administradora');
  const { r } = await loginWith('ines_ceo', 'Otra-clave-segura-987');
  assert.equal(r.status, 200);
  assert.deepEqual(auth.PERMISSIONS[ines.role], auth.PERMISSIONS[juan.user.role], 'mismos permisos');

  // Ninguno puede degradar al otro por su cuenta: queda pendiente de los dos.
  const inesId = (await env.db.get("SELECT id FROM users WHERE username = 'ines_ceo'")).id;
  const demote = await juan.c.patch('/api/admin/users/' + inesId, { role: 'editor' });
  assert.equal(demote.status, 202);
  assert.equal((await env.db.get('SELECT role FROM users WHERE id = ?', [inesId])).role, 'owner');
  const ap = await env.db.get('SELECT * FROM approval_items WHERE id = ?', [demote.json.approval_id]);
  assert.equal(ap.policy, 'both');
  await setDual(false);
});

test('MFA: activar, iniciar sesión con código, código incorrecto, recuperación de un solo uso y sesiones revocables', async () => {
  const u = await staff(env, 'owner', 'ceo_mfa');
  const setup = await u.c.post('/api/admin/security/mfa/setup', {});
  assert.equal(setup.status, 200);
  assert.match(setup.json.uri, /^otpauth:\/\/totp\//);
  const stored = await env.db.get('SELECT mfa_secret FROM users WHERE id = ?', [u.user.id]);
  assert.ok(!stored.mfa_secret.includes(setup.json.secret), 'el secreto se guarda cifrado');
  const bad = await u.c.post('/api/admin/security/mfa/enable', { code: '000000' });
  assert.equal(bad.status, 400);
  const first = security.totp(setup.json.secret);
  const en = await u.c.post('/api/admin/security/mfa/enable', { code: first });
  assert.equal(en.status, 200);
  assert.equal(en.json.recovery_codes.length, 8);

  const noCode = await loginWith('ceo_mfa', u.password);
  assert.equal(noCode.r.status, 401);
  assert.equal(noCode.r.json.error, 'mfa_required');
  const wrong = await loginWith('ceo_mfa', u.password, { code: '123456' });
  assert.equal(wrong.r.status, 401);
  assert.equal(wrong.r.json.error, 'invalid_code');
  const replay = await loginWith('ceo_mfa', u.password, { code: first });
  assert.equal(replay.r.status, 401, 'el código ya usado al activar no vuelve a servir');
  const ok = await loginWith('ceo_mfa', u.password, { code: security.totp(setup.json.secret, Date.now() + 30000) }, { 'user-agent': 'Otro navegador' });
  assert.equal(ok.r.status, 200);
  const rec = en.json.recovery_codes[0];
  assert.equal((await loginWith('ceo_mfa', u.password, { code: rec })).r.status, 200);
  assert.equal((await loginWith('ceo_mfa', u.password, { code: rec })).r.status, 401, 'el código de recuperación no se reutiliza');

  // Acceso desde un dispositivo nuevo: alerta de seguridad.
  const alert = await env.db.get("SELECT * FROM alerts WHERE kind = 'security' AND title LIKE '%ceo_mfa%'");
  assert.ok(alert, 'alerta de acceso nuevo');

  const me = await ok.c.get('/api/admin/security/me');
  assert.ok(me.json.mfa_enabled);
  assert.ok(me.json.sessions.length >= 3);
  const rv = await ok.c.post('/api/admin/security/sessions/revoke', { others: true });
  assert.ok(rv.json.revoked >= 2);
  assert.equal((await u.c.get('/api/admin/security/me')).status, 401, 'la sesión revocada deja de valer');
  assert.equal((await ok.c.get('/api/admin/security/me')).status, 200, 'la actual sigue');
});

test('migración 008: quita el MFA de los CEO y vuelven a entrar solo con contraseña', async () => {
  const u = await env.db.get("SELECT id, mfa_enabled_at FROM users WHERE username = 'ceo_mfa'");
  assert.ok(u.mfa_enabled_at, 'la prueba anterior lo dejó activado');
  await env.db.run("UPDATE settings SET value = 'true' WHERE key = 'security.require_mfa_owner'");
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'db', 'migrations', '008_mfa_off.sql'), 'utf8');
  await env.db.exec(sql);
  const after = await env.db.get('SELECT mfa_secret, mfa_enabled_at, mfa_recovery FROM users WHERE id = ?', [u.id]);
  assert.deepEqual({ ...after }, { mfa_secret: null, mfa_enabled_at: null, mfa_recovery: null });
  assert.equal((await env.db.get("SELECT value FROM settings WHERE key = 'security.require_mfa_owner'")).value, 'false');
  const audit = await env.db.get("SELECT * FROM audit_log WHERE action = 'security.mfa_disabled' AND actor_label = 'migración 008'");
  assert.ok(audit);
  await env.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [auth.hashPassword('Clave-de-prueba-008'), u.id]);
  const login = await loginWith('ceo_mfa', 'Clave-de-prueba-008');
  assert.equal(login.r.status, 200, login.r.text);
  assert.equal((await login.c.get('/api/admin/approvals')).status, 200, 'sin MFA el panel no se bloquea');
});

test('recuperación de cuenta: otro CEO genera el enlace; la propia persona no puede', async () => {
  const a = await staff(env, 'owner', 'ceo_a_rec');
  const b = await staff(env, 'owner', 'ceo_b_rec');
  const self = await a.c.post(`/api/admin/team/users/${a.user.id}/reset`, {});
  assert.equal(self.status, 400);
  const rs = await a.c.post(`/api/admin/team/users/${b.user.id}/reset`, {});
  assert.equal(rs.status, 201);
  const anon = client(env.base);
  const use = await anon.post('/api/team/reset', { token: rs.json.token, password: 'Nueva-clave-segura-555' });
  assert.equal(use.status, 200);
  assert.equal((await b.c.get('/api/admin/security/me')).status, 401, 'cierra las sesiones');
  assert.equal((await loginWith('ceo_b_rec', 'Nueva-clave-segura-555')).r.status, 200);
  assert.equal((await anon.post('/api/team/reset', { token: rs.json.token, password: 'Otra-clave-segura-777' })).status, 404);
});

test('aprobación atada a la versión: un cambio la invalida; votar una versión vieja falla', async () => {
  const a = await staff(env, 'owner');
  const cr = await a.c.post('/api/admin/approvals', { kind: 'post', title: 'Reel de lanzamiento', content: { text: 'Hola mundo', video: 'reel.mp4' } });
  assert.equal(cr.status, 201);
  const id = cr.json.id;
  const v1 = cr.json;
  const yes = await a.c.post(`/api/admin/approvals/${id}/vote`, { decision: 'approve', version: v1.version, content_hash: v1.content_hash });
  assert.equal(yes.json.status, 'approved', 'una publicación ordinaria se aprueba con un CEO');
  const rev = await a.c.put(`/api/admin/approvals/${id}`, { content: { text: 'Hola mundo!', video: 'reel.mp4' } });
  assert.equal(rev.json.status, 'pending', 'el cambio invalida la aprobación');
  assert.equal(rev.json.version, 2);
  assert.equal(rev.json.votes.filter((v) => v.current).length, 0);
  const stale = await a.c.post(`/api/admin/approvals/${id}/vote`, { decision: 'approve', version: 1, content_hash: v1.content_hash });
  assert.equal(stale.status, 409);
  // Los votos no se pueden borrar ni cambiar.
  await assert.rejects(env.db.run('DELETE FROM approval_votes'), /immutable/);
  await assert.rejects(env.db.run("UPDATE approval_votes SET decision = 'reject'"), /immutable/);
});

test('gasto sobre el umbral exige a los dos CEO; decisiones opuestas pausan y se resuelven', async () => {
  await setDual(true);
  const a = await staff(env, 'owner');
  const b = await staff(env, 'owner');
  const cr = await a.c.post('/api/admin/approvals', { kind: 'budget', title: 'Anuncios octubre', amount: 500, content: { plan: 'Meta Ads', amount: 500 } });
  assert.equal(cr.json.policy, 'both');
  const one = await a.c.post(`/api/admin/approvals/${cr.json.id}/vote`, { decision: 'approve', version: 1, content_hash: cr.json.content_hash });
  assert.equal(one.json.status, 'pending', 'falta el segundo CEO');
  const two = await b.c.post(`/api/admin/approvals/${cr.json.id}/vote`, { decision: 'approve', version: 1, content_hash: cr.json.content_hash });
  assert.equal(two.json.status, 'approved');

  const small = await a.c.post('/api/admin/approvals', { kind: 'budget', title: 'Tipografía', amount: 20, content: { amount: 20 } });
  assert.equal(small.json.policy, 'one');

  const task = await a.c.post('/api/admin/company/tasks', { title: 'Cambiar portada', area: 'tech', category: 'ux', approval_level: 3 });
  const req = await a.c.post(`/api/admin/company/tasks/${task.json.id}/request-approval`, { kind: 'design_change', note: 'Portada nueva' });
  const x = await a.c.post(`/api/admin/approvals/${req.json.id}/vote`, { decision: 'approve', version: 1, content_hash: req.json.content_hash });
  assert.equal(x.json.status, 'approved');
  // En política «one» el primer voto decide; el conflicto se prueba con «both».
  const both = await a.c.post('/api/admin/approvals', { kind: 'contract', title: 'Contrato con diseñador', content: { vendor: 'Estudio', months: 3 } });
  await a.c.post(`/api/admin/approvals/${both.json.id}/vote`, { decision: 'approve', version: 1, content_hash: both.json.content_hash });
  const no = await b.c.post(`/api/admin/approvals/${both.json.id}/vote`, { decision: 'reject', version: 1, content_hash: both.json.content_hash, comment: 'Prefiero otro estudio' });
  assert.equal(no.json.status, 'conflict');
  const list = await a.c.get('/api/admin/approvals?status=open');
  const conflict = list.json.conflicts.find((c) => c.subject_id === both.json.id);
  assert.ok(conflict);
  const solved = await b.c.post(`/api/admin/conflicts/${conflict.id}/resolve`, { resolution: 'Acordamos buscar dos presupuestos más' });
  assert.equal(solved.status, 200);
  const after = await a.c.get(`/api/admin/approvals/${both.json.id}`);
  assert.equal(after.json.status, 'pending');
  assert.equal(after.json.version, 2);
  await setDual(false);
});

test('con la doble aprobación desactivada alcanza un CEO para todo, y lo pendiente se resuelve con los votos que ya tenía', async () => {
  const gov = require('../src/services/governance');
  const { getSetting } = require('../src/services/settings');
  assert.equal(await getSetting(env.db, 'governance.dual_approval'), false, 'decisión de los CEO');
  const a = await staff(env, 'owner');
  const b = await staff(env, 'owner');
  const big = await a.c.post('/api/admin/approvals', { kind: 'contract', title: 'Contrato anual', amount: 5000, content: { vendor: 'X', amount: 5000 } });
  assert.equal(big.json.policy, 'one');
  const ok = await a.c.post(`/api/admin/approvals/${big.json.id}/vote`, { decision: 'approve', version: 1, content_hash: big.json.content_hash });
  assert.equal(ok.json.status, 'approved');
  // Instrucciones opuestas siguen pausando.
  const no = await b.c.post(`/api/admin/approvals/${big.json.id}/vote`, { decision: 'reject', version: 1, content_hash: big.json.content_hash, comment: 'No' });
  assert.equal(no.json.status, 'conflict');

  // Un pedido creado con doble aprobación y con un voto se aplica al desactivarla.
  await setDual(true);
  const put = await a.c.put('/api/admin/settings/governance.dual_approval_amount_usd', { value: 20 });
  const item = (await a.c.get('/api/admin/approvals/' + put.json.approval_id)).json;
  assert.equal(item.policy, 'both');
  await a.c.post(`/api/admin/approvals/${item.id}/vote`, { decision: 'approve', version: 1, content_hash: item.content_hash });
  assert.equal(await getSetting(env.db, 'governance.dual_approval_amount_usd'), 100);
  await setDual(false);
  assert.ok(await gov.relaxPending(env.db) >= 1);
  assert.equal(await getSetting(env.db, 'governance.dual_approval_amount_usd'), 20);
  assert.equal((await a.c.get('/api/admin/approvals/' + item.id)).json.status, 'executed');
  await env.db.run("UPDATE settings SET value = '100' WHERE key = 'governance.dual_approval_amount_usd'");
});

test('ajustes de seguridad y permisos de CEO solo cambian con los dos; la aprobación los aplica', async () => {
  await setDual(true);
  const a = await staff(env, 'owner');
  const b = await staff(env, 'owner');
  const put = await a.c.put('/api/admin/settings/governance.dual_approval_amount_usd', { value: 250 });
  assert.equal(put.status, 202);
  const item = (await a.c.get('/api/admin/approvals/' + put.json.approval_id)).json;
  await a.c.post(`/api/admin/approvals/${item.id}/vote`, { decision: 'approve', version: 1, content_hash: item.content_hash });
  const { getSetting } = require('../src/services/settings');
  assert.equal(await getSetting(env.db, 'governance.dual_approval_amount_usd'), 100, 'con un solo voto no cambia');
  const done = await b.c.post(`/api/admin/approvals/${item.id}/vote`, { decision: 'approve', version: 1, content_hash: item.content_hash });
  assert.equal(done.json.status, 'executed');
  assert.equal(await getSetting(env.db, 'governance.dual_approval_amount_usd'), 250);
  await env.db.run("UPDATE settings SET value = '100' WHERE key = 'governance.dual_approval_amount_usd'");
  await setDual(false);
});

test('la auditoría es inalterable; la limpieza solo quita el hash de IP', async () => {
  await env.db.run("INSERT INTO audit_log(action, ip_hash, created_at) VALUES ('prueba.vieja', 'abc', '2000-01-01T00:00:00.000Z')");
  await assert.rejects(env.db.run('DELETE FROM audit_log'), /audit_log_immutable/);
  await assert.rejects(env.db.run("UPDATE audit_log SET action = 'otra'"), /audit_log_immutable/);
  const { runJob } = require('../src/services/jobs');
  const out = await runJob(env.db, 'cleanup');
  assert.equal(out.status, 'success');
  const row = await env.db.get("SELECT * FROM audit_log WHERE action = 'prueba.vieja'");
  assert.ok(row, 'sigue existiendo');
  assert.equal(row.ip_hash, null);
});

test('pieza de contenido: aprobación de la versión exacta, cambio material vuelve a revisión, publicada exige enlace', async () => {
  const a = await staff(env, 'owner');
  const ed = await staff(env, 'editor');
  const p = await ed.c.post('/api/admin/content', { title: 'Carrusel: qué es un críptico', platform: 'instagram', format: 'carousel', body: 'Texto', assets: ['slides/1.png'] });
  assert.equal(p.status, 201);
  const sched0 = await a.c.post(`/api/admin/content/${p.json.id}/status`, { status: 'scheduled' });
  assert.equal(sched0.status, 409, 'no se programa sin aprobación');
  const sub = await ed.c.post(`/api/admin/content/${p.json.id}/status`, { status: 'pending_approval' });
  assert.equal(sub.json.status, 'pending_approval');
  const ap = (await a.c.get('/api/admin/approvals/' + sub.json.approval_id)).json;
  const edVote = await ed.c.post(`/api/admin/approvals/${ap.id}/vote`, { decision: 'approve', version: ap.version, content_hash: ap.content_hash });
  assert.equal(edVote.status, 403, 'solo los CEO aprueban');
  await a.c.post(`/api/admin/approvals/${ap.id}/vote`, { decision: 'approve', version: ap.version, content_hash: ap.content_hash });
  let piece = (await a.c.get('/api/admin/content/' + p.json.id)).json;
  assert.equal(piece.status, 'approved');
  assert.ok(piece.approval_valid);

  const edit = await ed.c.patch('/api/admin/content/' + p.json.id, { body: 'Texto cambiado' });
  assert.equal(edit.json.status, 'pending_approval', 'el cambio invalida la aprobación');
  assert.equal(edit.json.approval_valid, false);
  const ap2 = (await a.c.get('/api/admin/approvals/' + sub.json.approval_id)).json;
  assert.equal(ap2.version, 2);
  await a.c.post(`/api/admin/approvals/${ap2.id}/vote`, { decision: 'approve', version: ap2.version, content_hash: ap2.content_hash });
  const sch = await a.c.post(`/api/admin/content/${p.json.id}/status`, { status: 'scheduled', scheduled_at: '2026-11-01T15:00:00Z' });
  assert.equal(sch.json.status, 'scheduled');
  const pubBad = await a.c.post(`/api/admin/content/${p.json.id}/status`, { status: 'published', published_url: 'no-es-un-enlace' });
  assert.equal(pubBad.status, 400);
  const pub = await a.c.post(`/api/admin/content/${p.json.id}/status`, { status: 'published', published_url: 'https://www.instagram.com/p/EJEMPLO/' });
  assert.equal(pub.json.status, 'published');
  assert.equal((await env.db.get('SELECT status FROM approval_items WHERE id = ?', [ap.id])).status, 'executed');
  // La base también lo impide sin pasar por la aplicación.
  await env.db.run("INSERT INTO content_pieces(id, title, platform, format) VALUES ('directa', 'x', 'x', 'x')");
  await assert.rejects(env.db.run("UPDATE content_pieces SET status = 'published', published_url = 'https://x.com/1' WHERE id = 'directa'"), /approval_required/);
});

test('primeras piezas de marketing: con diseño real van a la bandeja; sin video quedan en producción; los archivos son privados', async () => {
  const a = await staff(env, 'owner');
  const rows = await env.db.all("SELECT id, status, assets, approval_id FROM content_pieces WHERE id LIKE 'mk-%' ORDER BY id");
  assert.equal(rows.length, 9);
  const ready = rows.filter((r) => r.status === 'pending_approval');
  assert.deepEqual(ready.map((r) => r.id), ['mk-a01']);
  assert.ok(ready.every((r) => r.approval_id));
  // Los carruseles pasaron al calendario de 60 días: quedan pausados sueltos para no publicarse dos veces.
  assert.deepEqual(rows.filter((r) => /^mk-c/.test(r.id)).map((r) => r.status), ['paused', 'paused', 'paused', 'paused']);
  assert.ok(rows.filter((r) => /^mk-(r|n)/.test(r.id)).every((r) => r.status === 'production'), 'sin video ni correo no se presentan como listas');
  const fs = require('fs'); const path = require('path');
  for (const r of rows) for (const f of JSON.parse(r.assets)) assert.ok(fs.existsSync(path.join(__dirname, '..', 'data', f)), f + ' existe');
  const img = await a.c.get('/api/admin/content-assets/marketing/c01-que-es-un-criptico/slide-01.png');
  assert.equal(img.status, 200);
  assert.equal((await client(env.base).get('/api/admin/content-assets/marketing/c01-que-es-un-criptico/slide-01.png')).status, 401);
  assert.equal((await a.c.get('/api/admin/content-assets/marketing/../../package.json')).status, 404);
});

test('documento legal: borrador → aprobación del texto exacto → publicado con evidencia; sin aprobación la base lo rechaza', async () => {
  const a = await staff(env, 'owner');
  const docs = await a.c.get('/api/admin/legal/documents');
  const privacy = docs.json.items.find((d) => d.id === 'privacy');
  assert.ok(privacy.versions.some((v) => v.status === 'published' && v.source_note === 'baseline'), 'el texto publicado hoy queda como versión 1');
  const d = await a.c.post('/api/admin/legal/documents/promotions/drafts', { language: 'es', body: 'Borrador de concursos y promociones.' });
  assert.equal(d.status, 201);
  const pv = d.json.version;
  await assert.rejects(env.db.run("UPDATE legal_document_versions SET status = 'approved' WHERE doc_id = 'promotions' AND version = " + pv), /approval_required/);
  await assert.rejects(env.db.run("UPDATE legal_document_versions SET body = 'otro' WHERE doc_id = 'promotions' AND version = " + pv), /immutable/);
  const early = await a.c.post(`/api/admin/legal/documents/promotions/${pv}/es/published`, { evidence: 'commit abc' });
  assert.equal(early.status, 409);
  const sub = await a.c.post(`/api/admin/legal/documents/promotions/${pv}/es/submit`, {});
  assert.equal(sub.json.policy, 'one');
  assert.equal(sub.json.level, 4);
  await a.c.post(`/api/admin/approvals/${sub.json.id}/vote`, { decision: 'approve', version: sub.json.version, content_hash: sub.json.content_hash });
  const v = (await a.c.get(`/api/admin/legal/documents/promotions/${pv}/es`)).json;
  assert.equal(v.status, 'approved');
  const pub = await a.c.post(`/api/admin/legal/documents/promotions/${pv}/es/published`, { evidence: 'Commit 1234abc publicado en /es/promociones' });
  assert.equal(pub.json.status, 'published');
  // Borradores de los agentes: entran como borrador, nunca publicados.
  const drafts = await env.db.all("SELECT doc_id, status FROM legal_document_versions WHERE source_note LIKE 'Borrador de agentes%'");
  assert.equal(drafts.length, 10);
  assert.ok(drafts.every((x) => x.status === 'draft'));
  const ar = await env.db.get("SELECT status, official_sources, needs_lawyer FROM legal_jurisdictions WHERE code = 'AR'");
  assert.equal(ar.status, 'draft_findings');
  assert.match(ar.official_sources, /argentina\.gob\.ar/);
  assert.equal(ar.needs_lawyer, 1);
  // Jurisdicciones: sin fuente oficial no se cargan requisitos.
  const j = await a.c.put('/api/admin/legal/jurisdictions/CL', { requirements: 'Ley 19.628' });
  assert.equal(j.status, 400);
  const j2 = await a.c.put('/api/admin/legal/jurisdictions/CL', { requirements: 'Ley 19.628', official_sources: 'https://www.bcn.cl/leychile/navegar?idNorma=141599', verified_at: '2026-10-22', status: 'draft_findings' });
  assert.equal(j2.status, 200);
});

test('tareas: completar exige evidencia y, en nivel 3, aprobación; centro de operaciones con estados honestos', async () => {
  const a = await staff(env, 'owner');
  const t = await a.c.post('/api/admin/company/tasks', { title: 'Revisar contraste', area: 'tech', category: 'ux' });
  const noEv = await a.c.patch('/api/admin/company/tasks/' + t.json.id, { status: 'done' });
  assert.equal(noEv.status, 400, 'sin evidencia no se completa');
  const ok = await a.c.patch('/api/admin/company/tasks/' + t.json.id, { status: 'done', evidence: 'Commit abc123' });
  assert.equal(ok.json.status, 'done');
  const lvl3 = await a.c.patch('/api/admin/company/tasks/T-005', { status: 'done', evidence: 'Captura de la factura' });
  assert.equal(lvl3.status, 409, 'nivel 3 necesita aprobación');

  const ov = await a.c.get('/api/admin/company/overview');
  assert.equal(ov.status, 200);
  assert.ok(ov.json.agents.length >= 41);
  const movil = ov.json.agents.find((x) => x.id === 'movil');
  assert.equal(movil.state, 'Sin proceso activo');
  assert.equal(ov.json.agents.find((x) => x.id === 'editorial').state, 'Flujo programado (GitHub Actions, cada 6 h)');
  assert.equal(ov.json.apps.exists, false);
  assert.ok(ov.json.integrations.every((i) => i.status !== 'verified' || i.evidence), 'ninguna verificada sin evidencia');
  assert.ok(ov.json.direction.blocked.length > 0);
  const bad = await a.c.patch('/api/admin/company/integrations/email', { status: 'verified' });
  assert.equal(bad.status, 400);
  const real = await a.c.post('/api/admin/company/costs', { area: 'tech', vendor: 'Vercel', kind: 'actual', amount: 20 });
  assert.equal(real.status, 400, 'un gasto real necesita comprobante');

  const an = await staff(env, 'analyst');
  assert.equal((await an.c.get('/api/admin/company/overview')).status, 200);
  assert.equal((await an.c.post('/api/admin/company/tasks', { title: 'x', area: 'tech', category: 'ux' })).status, 403);
  const mod = await staff(env, 'moderator');
  assert.equal((await mod.c.get('/api/admin/company/overview')).status, 403);
});

test('si la política exige MFA, un CEO sin MFA solo puede configurarlo', async () => {
  const a = await staff(env, 'owner');
  await env.db.run("UPDATE settings SET value = 'true' WHERE key = 'security.require_mfa_owner'");
  try {
    const blocked = await a.c.get('/api/admin/company/overview');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.error, 'mfa_setup_required');
    assert.equal((await a.c.get('/api/admin/security/me')).status, 200);
    assert.equal((await a.c.get('/api/admin/me')).status, 200);
  } finally {
    await env.db.run("UPDATE settings SET value = 'false' WHERE key = 'security.require_mfa_owner'");
  }
});

test('app web instalable: manifiesto con el nombre de la marca e íconos que existen', async () => {
  const fs = require('fs'); const path = require('path');
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Play Crípticos');
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', i.src)), i.src);
  const home = await client(env.base).get('/es');
  assert.match(home.text, /apple-touch-icon\.png/);
});

test('tareas de posicionamiento: cargadas una vez, cada una con fecha límite y sin pisar cambios', async () => {
  const company = require('../src/services/company');
  const rows = await env.db.all("SELECT id, due_at, status, area FROM ops_tasks WHERE id LIKE 'SEO-%' ORDER BY id");
  assert.equal(rows.length, 9);
  assert.ok(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.due_at) && r.status === 'pending' && r.area === 'marketing'));
  await env.db.run("UPDATE ops_tasks SET status = 'in_progress', due_at = '2026-12-01' WHERE id = 'SEO-01'");
  await company.seedCompany(env.db);
  const t = await env.db.get("SELECT status, due_at FROM ops_tasks WHERE id = 'SEO-01'");
  assert.deepEqual({ ...t }, { status: 'in_progress', due_at: '2026-12-01' }, 'volver a sembrar no pisa lo que cambió un CEO');
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM ops_tasks WHERE id LIKE 'SEO-%'")).n, 9);
});

test('textos legales globales: sin datos del titular no se cargan; con datos, un CEO los aprueba y quedan publicados en /es/legal', async () => {
  const company = require('../src/services/company');
  const G = require('../src/db/legal-global');
  const a = await staff(env, 'owner');
  const saved = { ...G.OWNER };
  Object.assign(G.OWNER, { name: '', address: '', country: '', email: '' });
  try { assert.equal((await company.seedGlobalLegal(env.db)).missing, 'owner', 'sin titular no se carga nada'); } finally { Object.assign(G.OWNER, saved); }
  assert.ok(G.ownerReady(), 'los datos del titular están completos');
  assert.ok(await env.db.get("SELECT 1 FROM legal_jurisdictions WHERE code = 'ROW'"), 'la matriz cubre el resto del mundo');
  const n = Object.keys(G.DOCS).length + G.REVISION_SETS.reduce((k, [, revs]) => k + Object.keys(revs).length, 0);
  const notes = [G.NOTE, ...G.REVISION_SETS.map(([x]) => x)];
  const drafts = await env.db.all(`SELECT doc_id, status, body FROM legal_document_versions WHERE source_note IN (${notes.map(() => '?').join(',')})`, notes);
  assert.equal(drafts.length, n, 'el despliegue los carga como borrador');
  assert.ok(drafts.every((d) => !/\{\{|\[COMPLETAR/.test(d.body)), 'sin datos sin completar');
  assert.ok(drafts.every((d) => d.status === 'draft'));
  assert.equal((await company.seedGlobalLegal(env.db)).loaded, 0, 'se cargan una sola vez');
  assert.match((await client(env.base).get('/es/condiciones')).text, /Condiciones/, 'antes de aprobar sigue el texto anterior');
  const nonOwner = await staff(env, 'analyst');
  assert.equal((await nonOwner.c.post('/api/admin/legal/global/approve', {})).status, 403);
  const res = await a.c.post('/api/admin/legal/global/approve', {});
  assert.equal(res.status, 200);
  assert.equal(res.json.published, n);
  const page = await client(env.base).get('/es/legal/cookies');
  assert.equal(page.status, 200);
  assert.match(page.text, /estrictamente necesarios/);
  assert.match((await client(env.base).get('/es/privacidad')).text, /Cómo llegaste/, 'la privacidad publicada explica el origen');
  const { getSetting } = require('../src/services/settings');
  assert.equal(await getSetting(env.db, 'privacy.store_origin'), true, 'publicarla habilita guardar el origen');
  assert.match((await client(env.base).get('/es/privacidad')).text, /Google AdSense/, 'la privacidad publicada explica los anuncios');
  assert.match(page.text, /cookies de anuncios/, 'las cookies publicadas explican los anuncios');
  assert.equal(await getSetting(env.db, 'ads.enabled'), true, 'publicar privacidad y cookies con anuncios los enciende');
  assert.match((await client(env.base).get('/es/condiciones')).text, /Plan Plus/, 'los términos publicados explican Plus');
  assert.match((await client(env.base).get('/es/privacidad')).text, /Lemon Squeezy/, 'la privacidad publicada explica el cobro con Lemon Squeezy');
  assert.equal(await getSetting(env.db, 'billing.lemonsqueezy'), true, 'publicar los términos de Plus con Lemon Squeezy habilita el pago');
  assert.doesNotMatch((await client(env.base).get('/es/condiciones')).text, /PayPal/, 'los términos ya no nombran PayPal');
  assert.match((await client(env.base).get('/es/condiciones')).text, new RegExp(G.OWNER.name));
  assert.match((await client(env.base).get('/es/legal/ip')).text, new RegExp(G.OWNER.name));
  assert.match((await client(env.base).get('/es/legal')).text, /\/es\/legal\/cookies/);
  const votes = await env.db.get("SELECT COUNT(*) AS n FROM approval_votes v JOIN approval_items i ON i.id = v.item_id WHERE i.target_kind = 'legal_version' AND v.user_id = ?", [a.user.id]);
  assert.ok(votes.n >= n, 'cada documento tiene el voto del CEO');
  const again = await a.c.post('/api/admin/legal/global/approve', {});
  assert.equal(again.json.published, n, 'repetir no duplica');
});
