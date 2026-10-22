'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client, staff } = require('./helpers');
const { setClueStatus, insertClue, buildClue } = require('../src/services/clues');
const subs = require('../src/services/submissions');

let env; let owner; let moderator; let editor;
test.before(async () => {
  env = await makeEnv();
  owner = await staff(env, 'owner');
  moderator = await staff(env, 'moderator');
  editor = await staff(env, 'editor');
  await env.db.run(`UPDATE settings SET value = '50' WHERE key = 'antispam.submissions_per_day'`);
});
test.after(async () => { await env.close(); });
// Cada prueba parte sin contadores antiabuso (todas comparten la IP local).
test.beforeEach(async () => { await env.db.run('DELETE FROM rate_limits'); });

const good = (over = {}) => ({
  clue_text: 'Lago movido para un poco (4)', answer: 'algo', definition: 'un poco',
  explanation: 'Anagrama de LAGO ("movido") da ALGO, que significa "un poco".', mechanism: 'anagram',
  language_code: 'es', category: 'lenguaje', difficulty: 1, public_name: 'Ana', rights_confirmed: true, terms_accepted: true,
  form_started_at: Date.now() - 20000, ...over,
});

async function submit(over) {
  const c = client(env.base);
  const r = await c.post('/api/submissions', good(over));
  return { c, r };
}

test('envío de una propuesta (#13) que queda pendiente (#14) y no se juega', async () => {
  const { c, r } = await submit();
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.status, 'pending');
  assert.ok(r.json.tracking_code.length > 16);
  const st = await c.get('/api/submissions/status?code=' + encodeURIComponent(r.json.tracking_code));
  assert.equal(st.json.status, 'pending');
  const clue = await env.db.get("SELECT id FROM clues WHERE answer = 'ALGO'");
  assert.equal(clue, null, 'una propuesta no crea un críptico jugable');
  const s = await env.db.get('SELECT * FROM submissions WHERE id = ?', [r.json.id]);
  assert.notEqual(s.tracking_token, r.json.tracking_code, 'el código de seguimiento se guarda con hash');
  assert.equal(s.approved_by, null);
});

test('una propuesta no puede publicarse sin aprobación manual (#15)', async () => {
  const { r } = await submit({ clue_text: 'Raso movido para atreverse (4)', answer: 'osar', definition: 'atreverse', explanation: 'Anagrama de RASO: OSAR.' });
  const s = await env.db.get('SELECT * FROM submissions WHERE id = ?', [r.json.id]);
  const { row } = await buildClue(env.db, { clue_text: s.clue_text, answer: s.answer, definition: s.definition, explanation_text: s.explanation, language_code: 'es' });
  // 1) Insertar directamente como publicada: la base lo impide.
  await assert.rejects(insertClue(env.db, { ...row, origin: 'community', status: 'published', submission_id: s.id }, { actorKind: 'system' }), /manual_approval_required/);
  // 2) Insertar como borrador y luego publicar sin aprobación: también lo impide.
  const draft = await insertClue(env.db, { ...row, origin: 'community', status: 'draft', submission_id: s.id }, { actorKind: 'system' });
  await assert.rejects(setClueStatus(env.db, draft.id, 'published', { actorKind: 'system' }), (e) => e.code === 'publish_blocked_manual_approval_required');
  // 3) Un "aprobador" que no es moderador (editor) tampoco sirve, ni por API ni forzando la columna.
  const viaApi = await editor.c.post(`/api/admin/submissions/${s.id}/moderate`, { action: 'approve' });
  assert.equal(viaApi.status, 403);
  await env.db.run("UPDATE submissions SET approved_by = ?, status = 'approved' WHERE id = ?", [editor.user.id, s.id]);
  await assert.rejects(setClueStatus(env.db, draft.id, 'published', { actorKind: 'system' }), (e) => e.code === 'publish_blocked_manual_approval_required');
  // 4) Ni la reputación del autor ni la cantidad de aportes cambian nada: no existe ese camino en el código.
  await assert.rejects(subs.moderate(env.db, s.id, { action: 'approve' }, { id: 'x', role: 'player' }), (e) => e.status === 403);
  await env.db.run('DELETE FROM clues WHERE id = ?', [draft.id]);
  await env.db.run("UPDATE submissions SET approved_by = NULL, status = 'pending' WHERE id = ?", [s.id]);
});

test('aprobación manual publica; rechazo y pedido de correcciones no (#16)', async () => {
  // Aprobar
  const a = await submit({ clue_text: 'Roca movida para un costoso (4)', answer: 'CARO', definition: 'un costoso', explanation: 'Anagrama de ROCA: CARO.' });
  const ap = await moderator.c.post(`/api/admin/submissions/${a.r.json.id}/moderate`, { action: 'approve', note: 'Buena' });
  assert.equal(ap.status, 200, ap.text);
  assert.equal(ap.json.status, 'published');
  const clue = await env.db.get('SELECT * FROM clues WHERE id = ?', [ap.json.clue_id]);
  assert.equal(clue.status, 'published');
  assert.equal(clue.origin, 'community');
  assert.equal(clue.author_name, 'Ana');
  assert.equal((await a.c.get('/api/submissions/status?code=' + encodeURIComponent(a.r.json.tracking_code))).json.status, 'published');
  // Pedir correcciones → el autor corrige → vuelve a pendiente
  const b = await submit({ clue_text: 'Sopa revuelta para un anfibio (4)', answer: 'SAPO', definition: 'un anfibio', explanation: 'Anagrama de sopa.' });
  assert.equal((await moderator.c.post(`/api/admin/submissions/${b.r.json.id}/moderate`, { action: 'request_changes' })).status, 400, 'exige comentario');
  const ch = await moderator.c.post(`/api/admin/submissions/${b.r.json.id}/moderate`, { action: 'request_changes', note: 'Mencioná SAPO en la explicación.' });
  assert.equal(ch.json.status, 'needs_changes');
  const view = await b.c.get('/api/submissions/status?code=' + encodeURIComponent(b.r.json.tracking_code));
  assert.equal(view.json.moderator_note, 'Mencioná SAPO en la explicación.');
  const fix = await b.c.post('/api/submissions/resubmit', { code: b.r.json.tracking_code, explanation: 'Anagrama de SOPA ("revuelta") da SAPO.' });
  assert.equal(fix.json.status, 'pending');
  // Rechazar
  const rj = await moderator.c.post(`/api/admin/submissions/${b.r.json.id}/moderate`, { action: 'reject', note: 'Duplica otra idea.' });
  assert.equal(rj.json.status, 'rejected');
  assert.equal(await env.db.get("SELECT id FROM clues WHERE answer = 'SAPO' AND origin = 'community'"), null);
  assert.equal((await moderator.c.post(`/api/admin/submissions/${b.r.json.id}/moderate`, { action: 'approve' })).status, 409, 'un rechazo es definitivo');
  // Historial
  const ev = await env.db.all('SELECT to_status FROM submission_events WHERE submission_id = ? ORDER BY id', [b.r.json.id]);
  assert.deepEqual(ev.map((e) => e.to_status), ['pending', 'needs_changes', 'pending', 'rejected']);
});

test('aprobar por error algo con errores críticos no lo publica', async () => {
  const { r } = await submit({ clue_text: 'Mora revuelta para la pasión (5)', answer: 'AMOR', definition: 'la pasión', explanation: 'Anagrama de MORA: AMOR.',
    wordplay: undefined });
  const ap = await owner.c.post(`/api/admin/submissions/${r.json.id}/moderate`, { action: 'approve' });
  assert.equal(ap.json.status, 'approved');
  assert.equal(ap.json.published, false);
  assert.ok(ap.json.blocked.some((c) => c.code === 'enumeration_mismatch'));
  assert.equal(await env.db.get("SELECT id FROM clues WHERE clue_text = 'Mora revuelta para la pasión (5)'"), null);
  // El moderador corrige y vuelve a aprobar: ahora sí se publica.
  const fixed = await owner.c.post(`/api/admin/submissions/${r.json.id}/moderate`, { action: 'approve', edits: { clue_text: 'Mora revuelta para la pasión (4)' } });
  assert.equal(fixed.json.status, 'published', JSON.stringify(fixed.json));
});

test('controles automáticos: duplicado exacto, spam, derechos y límites (#17)', async () => {
  const dup = await submit({ clue_text: 'Ramo revuelto para el sentimiento (4)', answer: 'AMOR', definition: 'el sentimiento', explanation: 'Anagrama de RAMO: AMOR.' });
  const s = await env.db.get('SELECT checks FROM submissions WHERE id = ?', [dup.r.json.id]);
  assert.ok(JSON.parse(s.checks).some((c) => c.code === 'duplicate_exact'));
  const rights = await submit({ clue_text: 'Ocas al revés: bolsa grande (4)', answer: 'SACO', definition: 'bolsa grande', explanation: 'OCAS al revés. © 2020 The Times', reference: 'The Times' });
  const s2 = await env.db.get('SELECT checks FROM submissions WHERE id = ?', [rights.r.json.id]);
  assert.ok(JSON.parse(s2.checks).some((c) => c.code === 'rights_signal'));
  assert.equal((await submit({ explanation: 'Comprá barato en https://spam.example casino casino' })).r.status, 400);
  assert.equal((await submit({ website: 'http://bot' })).r.status, 400, 'campo trampa');
  assert.equal((await submit({ form_started_at: Date.now() })).r.status, 400, 'demasiado rápido');
  assert.equal((await submit({ rights_confirmed: false })).r.status, 400, 'sin confirmación de derechos');
  assert.equal((await submit({ language_code: 'xx' })).r.status, 400);
  const errFields = (await submit({ clue_text: '', answer: '' })).r.json.details.fields;
  assert.ok(errFields.includes('clue_text') && errFields.includes('answer'));
});

test('límite de envíos por día', async () => {
  await env.db.run(`UPDATE settings SET value = '2' WHERE key = 'antispam.submissions_per_day'`);
  await env.db.run('DELETE FROM rate_limits');
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await submit({ clue_text: `Prueba número ${i} para algo (4)` })).r.status);
  assert.deepEqual(statuses, [201, 201, 429, 429]);
  await env.db.run(`UPDATE settings SET value = '50' WHERE key = 'antispam.submissions_per_day'`);
  await env.db.run('DELETE FROM rate_limits');
});

test('con cuenta: notificaciones y "mis propuestas"', async () => {
  const c = client(env.base);
  const reg = await c.post('/api/auth/register', { accept: true, username: 'autora1', password: 'una-clave-larga-123' });
  assert.equal(reg.status, 201, reg.text);
  const r = await c.post('/api/submissions', good({ clue_text: 'Mano revuelta para una simia (4)', answer: 'MONA', definition: 'una simia', explanation: 'Anagrama de MANO: MONA.' }));
  assert.equal(r.status, 201, r.text);
  await moderator.c.post(`/api/admin/submissions/${r.json.id}/moderate`, { action: 'approve' });
  const mine = await c.get('/api/me/submissions');
  assert.equal(mine.json.items[0].status, 'published');
  const notes = await c.get('/api/me/notifications');
  assert.equal(notes.json.items[0].kind, 'submission_published');
});
