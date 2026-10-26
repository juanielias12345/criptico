'use strict';

// Activación y retención (docs/CRECIMIENTO-PRODUCTO.md): contadores de la interfaz,
// siguiente paso al resolver, origen del registro y cuentas del equipo fuera de las métricas.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client, staff } = require('./helpers');

let env; let owner;
test.before(async () => { env = await makeEnv({ spanishOnly: true }); owner = await staff(env, 'owner'); });
test.after(async () => { await env.close(); });

const answerOf = async (gameId) => (await env.db.get('SELECT c.answer FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.id = ?', [gameId])).answer;
const counts = async () => Object.fromEntries((await env.db.all('SELECT kind, SUM(n) AS n FROM ui_events_daily GROUP BY kind')).map((r) => [r.kind, r.n]));

test('contadores de la interfaz: solo tipos conocidos y sin contar con «No rastrear»', async () => {
  const c = client(env.base);
  assert.equal((await c.post('/api/ui-event', { kind: 'signup_prompt_shown' })).status, 204);
  assert.equal((await c.post('/api/ui-event', { kind: 'signup_prompt_shown' }, { dnt: '1' })).status, 204);
  assert.equal((await c.post('/api/ui-event', { kind: 'signup_completed' })).status, 400, 'los del servidor no se aceptan desde el navegador');
  assert.equal((await c.post('/api/ui-event', { kind: 'cualquiera' })).status, 400);
  assert.equal((await counts()).signup_prompt_shown, 1);
});

test('al resolver en modo libre se informa si falta el desafío de hoy; en el diario no', async () => {
  const c = client(env.base);
  const s = await c.post('/api/game/start', { choice: 'es', mode: 'infinite' });
  const r = await c.post(`/api/game/${s.json.game_id}/guess`, { answer: await answerOf(s.json.game_id) });
  assert.deepEqual(r.json.next, { daily_pending: true });
  const d = await c.post('/api/daily/start', { choice: 'es' });
  const rd = await c.post(`/api/game/${d.json.game_id}/reveal`, {});
  assert.equal(rd.json.next, null);
  const s2 = await c.post('/api/game/start', { choice: 'es', mode: 'infinite' });
  const r2 = await c.post(`/api/game/${s2.json.game_id}/reveal`, {});
  assert.deepEqual(r2.json.next, { daily_pending: false }, 'ya jugó el de hoy');
});

test('registro: guarda la invitación de origen y cuenta errores por código', async () => {
  const c = client(env.base);
  const bad = await c.post('/api/auth/register', { accept: false, username: 'nadie1', password: 'x' });
  assert.equal(bad.status, 400);
  const weak = await c.post('/api/auth/register', { accept: true, username: 'nadie2', password: 'corta' });
  assert.equal(weak.status, 400);
  const ok = await c.post('/api/auth/register', { accept: true, username: 'invitado1', password: 'Una-clave-de-prueba-9', via: 'post_solve' });
  assert.equal(ok.status, 201);
  const other = await client(env.base).post('/api/auth/register', { accept: true, username: 'invitado2', password: 'Una-clave-de-prueba-9', via: '<script>' });
  assert.equal(other.status, 201);
  const u = Object.fromEntries((await env.db.all("SELECT username, signup_via FROM users WHERE username IN ('invitado1','invitado2')")).map((r) => [r.username, r.signup_via]));
  assert.deepEqual(u, { invitado1: 'post_solve', invitado2: null });
  const n = await counts();
  assert.equal(n.signup_error_accept_required, 1);
  assert.equal(n.signup_error_weak_password, 1);
  assert.equal(n.signup_completed_post_solve, 1);
  assert.equal(n.signup_completed, 1);
  const f = await owner.c.get('/api/admin/analytics/funnel?period=7d');
  assert.equal(f.json.ui.signup_completed_post_solve, 1);
  assert.equal(f.json.signups_via.post_solve, 1);
});

test('las cuentas del equipo no cuentan en embudo, retención ni sesiones', async () => {
  const before = await owner.c.get('/api/admin/analytics/funnel?period=7d');
  const retBefore = await owner.c.get('/api/admin/analytics/retention?period=7d');
  // El dueño juega varias partidas con su cuenta.
  for (let i = 0; i < 3; i++) {
    const s = await owner.c.post('/api/game/start', { choice: 'es', mode: 'infinite' });
    assert.equal(s.status, 200);
  }
  const after = await owner.c.get('/api/admin/analytics/funnel?period=7d');
  const retAfter = await owner.c.get('/api/admin/analytics/retention?period=7d');
  const step = (f, k) => f.json.steps.find((x) => x.key === k).n;
  assert.equal(step(after, 'start'), step(before, 'start'));
  assert.equal(retAfter.json.sessions.units, retBefore.json.sessions.units);
  assert.equal(retAfter.json.sessions.games, retBefore.json.sessions.games);
  // Un jugador común sí cuenta.
  await client(env.base).post('/api/game/start', { choice: 'es', mode: 'infinite' });
  const last = await owner.c.get('/api/admin/analytics/funnel?period=7d');
  assert.equal(step(last, 'start'), step(before, 'start') + 1);
});

test('/api/meta expone los interruptores de crecimiento', async () => {
  const m = await client(env.base).get('/api/meta');
  assert.deepEqual(m.json.growth, { direct_start: true, signup_prompt: true, signup_prompt_after: 3, next_step: true });
});
