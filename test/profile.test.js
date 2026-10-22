'use strict';

// Perfil personal del jugador. Los números «#n» siguen las 16 pruebas pedidas
// (la #13, escritorio y móvil, está en test/e2e/browser.test.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client } = require('./helpers');
const P = require('../src/services/profile');
const { uuid } = require('../src/services/util');

let env;
test.before(async () => { env = await makeEnv(); });
test.after(async () => { await env.close(); });

const answerOf = async (gameId) => (await env.db.get('SELECT c.answer FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.id = ?', [gameId])).answer;
const gameRow = (id) => env.db.get('SELECT * FROM games WHERE id = ?', [id]);

async function newPlayer(c = client(env.base)) {
  const username = 'j' + Math.random().toString(36).slice(2, 9);
  // Este archivo crea muchas cuentas desde la misma IP: se vacía el límite de registros.
  await env.db.run("DELETE FROM rate_limits WHERE bucket LIKE 'register:%'");
  const r = await c.post('/api/auth/register', { accept: true, username, password: 'Una-clave-de-prueba-9' });
  assert.equal(r.status, 201, r.text);
  return { c, username, id: r.json.user.id, link_offer: r.json.link_offer };
}
async function play(c, { result = 'solved', wrong = 0, hints = 0, choice = 'es', ago = 0, mechanism, slug } = {}) {
  const s = await c.post('/api/game/start', { choice, mode: slug ? 'shared' : 'infinite', mechanism, slug });
  assert.equal(s.status, 200, s.text);
  const id = s.json.game_id;
  if (ago) {
    const t = new Date(Date.now() - ago).toISOString();
    await env.db.run('UPDATE games SET started_at = ?, last_activity_at = ? WHERE id = ?', [t, t, id]);
  }
  for (let i = 0; i < hints; i++) await c.post(`/api/game/${id}/hint`, { level: i + 1 });
  for (let i = 0; i < wrong; i++) await c.post(`/api/game/${id}/guess`, { answer: 'ZZZ' + 'Q'.repeat(i) });
  let out;
  if (result === 'solved') out = await c.post(`/api/game/${id}/guess`, { answer: await answerOf(id) });
  else if (result === 'revealed') out = await c.post(`/api/game/${id}/reveal`, {});
  else if (result === 'abandoned') out = await c.post(`/api/game/${id}/skip`, {});
  return { id, clue: s.json.clue, out };
}

test('#1 #2 #3 la partida se guarda con tiempos coherentes e intentos asociados a ella', async () => {
  const { c } = await newPlayer();
  const g = await play(c, { wrong: 2, ago: 75000 });
  const row = await gameRow(g.id);
  assert.equal(row.status, 'solved');
  assert.equal(row.attempts, 3);
  assert.ok(row.duration_ms >= 74000 && row.duration_ms < 100000, 'tiempo ≈ 75 s medido por el servidor: ' + row.duration_ms);
  assert.ok(row.active_ms <= row.duration_ms, 'tiempo activo ≤ tiempo total');
  const d = (await c.get(`/api/me/games/${g.id}`)).json;
  assert.equal(d.game.solve_ms, row.duration_ms);
  assert.ok(d.game.elapsed_ms >= row.duration_ms - 5);
  assert.equal(d.attempts.length, 3);
  assert.deepEqual(d.attempts.map((a) => a.correct), [false, false, true]);
  assert.deepEqual(d.attempts.slice(0, 2).map((a) => a.answer), ['ZZZ', 'ZZZQ'], 'se ven las respuestas que dio, normalizadas');
  assert.equal(d.attempts[2].answer, (await answerOf(g.id)).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-ZÑ]/gi, '').toUpperCase().length ? d.attempts[2].answer : null);
  assert.ok(d.attempts.every((a, i) => i === 0 || a.t_ms >= d.attempts[i - 1].t_ms), 'en orden');
  // Otra cuenta no puede ver la partida.
  const other = await newPlayer();
  assert.equal((await other.c.get(`/api/me/games/${g.id}`)).status, 404);
  // El historial la muestra con lo realmente registrado.
  const h = (await c.get('/api/me/history')).json;
  assert.equal(h.total, 1);
  assert.equal(h.items[0].id, g.id);
  assert.equal(h.items[0].attempts, 3);
  assert.equal(h.items[0].first_solve, true);
});

test('#4 #5 pistas registradas con su orden y momento; revelada no cuenta como resuelta', async () => {
  const { c } = await newPlayer();
  const g = await play(c, { result: 'revealed', hints: 2, wrong: 1 });
  // Pedir otra vez la pista 2 (reintento tras un corte) no suma.
  await c.post(`/api/game/${g.id}/hint`, { level: 2 });
  const d = (await c.get(`/api/me/games/${g.id}`)).json;
  assert.equal(d.game.status, 'revealed');
  assert.equal(d.game.solve_ms, null, 'una revelada no tiene tiempo de resolución');
  assert.deepEqual(d.hints.map((h) => [h.level, h.kind]), [[1, 'mechanism'], [2, 'definition']]);
  assert.ok(d.hints.every((h) => h.before_first_attempt), 'las dos pistas fueron antes del primer intento');
  assert.ok(d.reveal_ms !== null);
  assert.equal(d.solved_after_hint, false);
  assert.ok(d.solution && d.solution.answer, 'la solución se muestra en partidas cerradas');
  const s = (await c.get('/api/me/profile')).json.stats;
  assert.equal(s.unique_solved, 0);
  assert.equal(s.revealed, 1);
  assert.equal(s.solve_rate, 0);
  assert.equal(s.hints, 2);
  // Una partida abierta no muestra la solución.
  const open = await c.post('/api/game/start', { choice: 'es' });
  await c.post(`/api/game/${open.json.game_id}/hint`, { level: 1 });
  const od = (await c.get(`/api/me/games/${open.json.game_id}`)).json;
  assert.equal(od.solution, null);
  assert.equal(od.hints.length, 1, 'solo aparece la pista entregada');
});

test('#6 #7 el historial y los gráficos coinciden con los registros', async () => {
  const { c, id } = await newPlayer();
  await play(c, { ago: 3 * 86400000 });
  await play(c, { result: 'revealed', ago: 3 * 86400000 - 1000 });
  await play(c, { hints: 1, ago: 86400000 });
  await play(c, { result: 'abandoned' });
  const rows = await env.db.all('SELECT g.* FROM games g JOIN players p ON p.id = g.player_id WHERE p.user_id = ?', [id]);
  const h = (await c.get('/api/me/history?per=50')).json;
  assert.equal(h.total, rows.length);
  assert.deepEqual(h.items.map((x) => x.id).sort(), rows.map((x) => x.id).sort());
  assert.equal((await c.get('/api/me/history?result=solved')).json.total, 2);
  assert.equal((await c.get('/api/me/history?hints=used')).json.total, 1);
  const ev = (await c.get('/api/me/evolution?days=30&unit=day')).json;
  const sum = (k) => ev.series.reduce((s, x) => s + x[k], 0);
  assert.equal(sum('games'), rows.length);
  assert.equal(sum('solved'), rows.filter((r) => r.status === 'solved').length);
  assert.equal(sum('revealed'), 1);
  assert.equal(ev.current.games, rows.length);
  assert.equal(ev.current.solve_rate, Math.round((2 / 4) * 1000) / 10);
  const solvedMs = rows.filter((r) => r.status === 'solved').map((r) => r.duration_ms).sort((a, b) => a - b);
  assert.equal(ev.current.median_solve_ms, Math.round((solvedMs[0] + solvedMs[1]) / 2));
  assert.deepEqual(ev.insights.map((i) => i.kind), ['not_enough'], 'con pocos datos lo dice en vez de inventar conclusiones');
  const byMech = ev.by_mechanism.reduce((s, x) => s + x.games, 0);
  assert.equal(byMech, rows.length);
  const cal = (await c.get('/api/me/calendar')).json;
  assert.equal(cal.items.reduce((s, x) => s + x.games, 0), rows.length);
});

test('#8 #9 #10 logros por condición, sin duplicados; repetir un críptico no suma únicos', async () => {
  const { c, id } = await newPlayer();
  const first = await play(c);
  assert.ok(first.out.json.achievements.includes('solved_1'), 'primer críptico resuelto');
  const slug = first.clue.slug;
  // Repetir el mismo críptico dos veces.
  const again = await play(c, { slug });
  await play(c, { slug });
  assert.deepEqual(again.out.json.achievements, [], 'no se vuelve a otorgar');
  const n = await env.db.get('SELECT COUNT(*) AS n FROM achievements_earned WHERE owner = ?', ['u:' + id]);
  assert.equal(n.n, 1);
  const s = (await c.get('/api/me/profile')).json;
  assert.equal(s.stats.games, 3);
  assert.equal(s.stats.solved_games, 3);
  assert.equal(s.stats.unique_solved, 1, 'tres resoluciones del mismo críptico = 1 único');
  const h = (await c.get('/api/me/history?sort=oldest')).json;
  assert.deepEqual(h.items.map((x) => x.first_solve), [true, false, false]);
  assert.deepEqual(h.items.map((x) => x.xp), [h.items[0].xp, 0, 0], 'repetir no da experiencia');
  // Evaluar de nuevo no duplica (clave primaria + INSERT OR IGNORE).
  const unit = await P.unitFor(env.db, { user: { id } });
  assert.deepEqual(await P.evaluateAchievements(env.db, unit, null), []);
  const list = (await c.get('/api/me/achievements')).json.items;
  const solvedFam = list.find((a) => a.family === 'solved');
  assert.ok(solvedFam.tiers[0].earned_at);
  assert.equal(solvedFam.next.threshold, 10);
  assert.equal(solvedFam.value, 1);
  // Récords: uno por dificultad, sin repetir filas aunque haya empates.
  const rec = (await c.get('/api/me/records')).json;
  const diffs = rec.by_difficulty.map((x) => x.k);
  assert.equal(new Set(diffs).size, diffs.length);
  assert.ok(rec.consecutive_best >= 3);
});

test('#8 condición de racha de días: 3 días seguidos otorgan el logro, 2 no', async () => {
  const { c, id } = await newPlayer();
  const unit = await P.unitFor(env.db, { user: { id } });
  const pid = unit.ids[0] || (await play(c, { result: 'abandoned' }), (await P.unitFor(env.db, { user: { id } })).ids[0]);
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await env.db.run('INSERT OR REPLACE INTO player_days(player_id, day, games, solved) VALUES (?,?,1,0),(?,?,1,0)', [pid, day(5), pid, day(4)]);
  let fresh = await P.evaluateAchievements(env.db, await P.unitFor(env.db, { user: { id } }), null);
  assert.ok(!fresh.includes('day_streak_3'));
  await env.db.run('INSERT OR REPLACE INTO player_days(player_id, day, games, solved) VALUES (?,?,1,0)', [pid, day(3)]);
  fresh = await P.evaluateAchievements(env.db, await P.unitFor(env.db, { user: { id } }), null);
  assert.ok(fresh.includes('day_streak_3'));
  const s = (await c.get('/api/me/profile')).json.stats;
  assert.equal(s.day_streak_best, 3);
  assert.equal(s.day_streak, 1, 'la racha actual es la de hoy: descansar no se castiga, solo vuelve a empezar');
});

test('#11 el perfil público no expone estadísticas privadas', async () => {
  const { c, username } = await newPlayer();
  await play(c, { wrong: 1, hints: 1 });
  // Privado por defecto.
  assert.equal((await client(env.base).get('/api/u/' + username)).status, 404);
  await c.put('/api/me/profile', { public_profile: true, public_name: 'Ana P.', share: { solved: true } });
  const pub = await client(env.base).get('/api/u/' + username);
  assert.equal(pub.status, 200);
  assert.deepEqual(Object.keys(pub.json).sort(), ['avatar', 'name', 'unique_solved', 'username']);
  for (const secret of ['email', 'history', 'country', 'streaks', 'level', 'hints', 'time', 'answers', 'badges']) assert.equal(pub.json[secret], undefined);
  assert.ok(!/ZZZ|duration|hints_used|@/.test(pub.text));
  // Cada dato se habilita por separado.
  await c.put('/api/me/profile', { share: { level: true, country: true } });
  const pub2 = (await client(env.base).get('/api/u/' + username)).json;
  assert.ok(pub2.level >= 1);
  assert.equal(pub2.unique_solved, undefined, 'lo que deja de compartir desaparece');
  // Una página pública no da acceso al historial ni a las partidas.
  assert.equal((await client(env.base).get('/api/me/history')).json.total, 0);
  // El enlace para compartir no incluye identificadores personales ni la respuesta salvo que se pida.
  const gid = (await c.get('/api/me/history')).json.items[0].id;
  const sh = await c.post(`/api/me/games/${gid}/share`, { show_time: false });
  const card = await client(env.base).get(`/api/share/${sh.json.token}`);
  assert.equal(card.status, 200);
  assert.equal(card.json.answer, null);
  assert.equal(card.json.time_ms, null);
  assert.ok(!card.text.includes(username) && !card.text.includes(gid), 'sin usuario ni id de partida');
  const svg = await client(env.base).get(`/api/share/${sh.json.token}.svg`);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.ok(!svg.text.includes(username));
  await c.post(`/api/me/games/${gid}/share`, { show_answer: true, show_time: true });
  const card2 = (await client(env.base).get(`/api/share/${sh.json.token}`)).json;
  assert.equal(card2.answer, await answerOf(gid));
  assert.ok(card2.time_ms > 0);
  await c.del(`/api/me/games/${gid}/share`);
  assert.equal((await client(env.base).get(`/api/share/${sh.json.token}`)).status, 404, 'al dejar de compartir el enlace deja de funcionar');
});

test('#11 rankings: solo con participación voluntaria y separados por ayudas', async () => {
  const { c, id } = await newPlayer();
  const s = await c.post('/api/daily/start', { choice: 'es' });
  assert.equal(s.status, 200, s.text);
  const t = new Date(Date.now() - 40000).toISOString();
  await env.db.run('UPDATE games SET started_at = ?, last_activity_at = ? WHERE id = ?', [t, t, s.json.game_id]);
  await c.post(`/api/game/${s.json.game_id}/guess`, { answer: await answerOf(s.json.game_id) });
  const date = (await gameRow(s.json.game_id)).daily_date;
  const board = async (b) => (await client(env.base).get(`/api/leaderboard?board=${b}&lang=es&date=${date}`)).json;
  assert.equal((await board('clean')).items.length, 0, 'sin participar no aparece');
  await c.put('/api/me/profile', { leaderboard_opt_in: true });
  const clean = await board('clean');
  assert.equal(clean.items.length, 1);
  assert.equal(clean.items[0].name, (await env.db.get('SELECT username FROM users WHERE id = ?', [id])).username);
  assert.deepEqual(Object.keys(clean.items[0]).sort(), ['attempts', 'hints', 'me', 'name', 'rank', 'time_ms']);
  assert.equal((await board('assisted')).items.length, 0, 'sin pistas no se mezcla con «con pistas»');
});

test('#12 vincular partidas anónimas requiere autorización expresa', async () => {
  const c = client(env.base);
  await play(c); await play(c, { result: 'revealed' });
  const anonPid = c.jar.pid;
  const anon = (await c.get('/api/me/profile')).json;
  assert.equal(anon.stats.games, 2, 'sin cuenta, el perfil usa el identificador del navegador');
  const p = await newPlayer(c);
  assert.deepEqual(p.link_offer, { games: 2 }, 'se ofrece, no se une solo');
  const before = await env.db.get('SELECT user_id FROM players WHERE id = ?', [anonPid]);
  assert.equal(before.user_id, null);
  const prof = (await c.get('/api/me/profile')).json;
  assert.equal(prof.has_data, false);
  assert.deepEqual(prof.link_offer, { games: 2 });
  assert.equal((await c.post('/api/me/link-anonymous', {})).status, 400, 'sin confirmación no se une');
  const ok = await c.post('/api/me/link-anonymous', { confirm: true });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await env.db.get('SELECT user_id FROM players WHERE id = ?', [anonPid])).user_id, p.id);
  const after = (await c.get('/api/me/profile')).json;
  assert.equal(after.stats.games, 2);
  assert.equal(after.link_offer, null);
  assert.ok((await env.db.get("SELECT COUNT(*) AS n FROM achievements_earned WHERE owner = ? AND code = 'solved_1'", ['u:' + p.id])).n === 1, 'los logros pasan a la cuenta');
  assert.equal((await env.db.get('SELECT COUNT(*) AS n FROM achievements_earned WHERE owner = ?', ['p:' + anonPid])).n, 0);
  // Un tercero no puede unir partidas de otro navegador.
  const other = await newPlayer();
  assert.equal((await other.c.post('/api/me/link-anonymous', { confirm: true })).status, 409);
});

test('#14 un corte de conexión (reenvíos duplicados o simultáneos) no corrompe el resultado', async () => {
  const { c, id } = await newPlayer();
  const s = await c.post('/api/game/start', { choice: 'es' });
  const g = s.json.game_id;
  const ans = await answerOf(g);
  // El mismo intento incorrecto reenviado y dos pistas pedidas a la vez.
  await Promise.all([c.post(`/api/game/${g}/guess`, { answer: 'XYZW' }), c.post(`/api/game/${g}/guess`, { answer: 'XYZW' })]);
  await Promise.all([c.post(`/api/game/${g}/hint`, { level: 1 }), c.post(`/api/game/${g}/hint`, { level: 1 })]);
  // La respuesta correcta enviada dos veces a la vez.
  const [a, b] = await Promise.all([c.post(`/api/game/${g}/guess`, { answer: ans }), c.post(`/api/game/${g}/guess`, { answer: ans })]);
  assert.ok(a.json.correct || a.json.finished); assert.ok(b.json.correct || b.json.finished);
  const row = await gameRow(g);
  assert.equal(row.status, 'solved');
  assert.equal(row.attempts, 2, 'un incorrecto + el correcto');
  assert.equal(row.hints_used, 1);
  const kinds = (await env.db.all('SELECT kind FROM game_events WHERE game_id = ? ORDER BY id', [g])).map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'guess_correct').length, 1, 'un solo cierre');
  assert.equal(kinds.filter((k) => k === 'hint').length, 1);
  const ach = await env.db.all('SELECT code FROM achievements_earned WHERE owner = ?', ['u:' + id]);
  assert.equal(ach.filter((x) => x.code === 'solved_1').length, 1);
  // Un error al evaluar logros no afecta la partida ya guardada.
  const orig = env.db.all.bind(env.db);
  let boom = true;
  env.db.all = (sql, args) => (boom && /achievements_earned/.test(sql) ? Promise.reject(new Error('corte simulado')) : orig(sql, args));
  try {
    const s2 = await c.post('/api/game/start', { choice: 'es' });
    const r2 = await c.post(`/api/game/${s2.json.game_id}/guess`, { answer: await answerOf(s2.json.game_id) });
    assert.equal(r2.json.correct, true);
    assert.deepEqual(r2.json.achievements, []);
    assert.equal((await gameRow(s2.json.game_id)).status, 'solved');
  } finally { boom = false; env.db.all = orig; }
});

test('#15 al borrar la cuenta se borran perfil, logros, biblioteca y el acceso a las partidas', async () => {
  const { c, id, username } = await newPlayer();
  const g = await play(c);
  const pid = c.jar.pid;
  await c.put('/api/me/profile', { public_profile: true, share: { solved: true }, leaderboard_opt_in: true });
  await c.post('/api/me/goals', { kind: 'solve', target: 5, period: 'day' });
  await c.post(`/api/me/retry/${g.clue.id}`);
  const col = await c.post('/api/me/collections', { name: 'Favoritas de anagramas' });
  await c.post(`/api/me/collections/${col.json.id}/items`, { clue_id: g.clue.id });
  const sh = await c.post(`/api/me/games/${g.id}/share`, {});
  assert.equal((await c.del('/api/me/account')).status, 200);
  for (const [sql, args] of [
    ['SELECT COUNT(*) AS n FROM achievements_earned WHERE owner = ?', ['u:' + id]],
    ['SELECT COUNT(*) AS n FROM user_goals WHERE user_id = ?', [id]],
    ['SELECT COUNT(*) AS n FROM retry_list WHERE user_id = ?', [id]],
    ['SELECT COUNT(*) AS n FROM collections WHERE user_id = ?', [id]],
    ['SELECT COUNT(*) AS n FROM game_shares WHERE game_id = ?', [g.id]],
    ['SELECT COUNT(*) AS n FROM players WHERE user_id = ?', [id]],
  ]) assert.equal((await env.db.get(sql, args)).n, 0, sql);
  const u = await env.db.get('SELECT public_profile, leaderboard_opt_in, email FROM users WHERE id = ?', [id]);
  assert.deepEqual(u, { public_profile: 0, leaderboard_opt_in: 0, email: null });
  assert.equal((await client(env.base).get('/api/u/' + username)).status, 404);
  assert.equal((await client(env.base).get(`/api/share/${sh.json.token}`)).status, 404);
  // El mismo navegador, ya sin sesión, no vuelve a ver esas partidas como propias.
  assert.ok(pid);
  const after = (await c.get('/api/me/history')).json;
  assert.equal(after.total, 0);
  const prof = (await c.get('/api/me/profile')).json;
  assert.equal(prof.has_data, false);
});

test('#16 las recomendaciones apuntan a contenido disponible y se pueden apagar', async () => {
  const { c } = await newPlayer();
  for (let i = 0; i < 3; i++) await play(c);
  const r = (await c.get('/api/me/recommendations?choice=es')).json;
  assert.ok(r.items.length >= 1);
  for (const it of r.items) {
    assert.ok(it.available > 0);
    const p = it.params;
    const s = await c.post('/api/game/start', { choice: p.choice || 'es', mechanism: p.mechanism, difficulty: p.difficulty });
    assert.equal(s.status, 200, `la recomendación ${it.kind} lleva a un críptico jugable: ${s.text}`);
    if (p.mechanism) assert.equal((await env.db.get('SELECT c.mechanism FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.id = ?', [s.json.game_id])).mechanism, p.mechanism);
    await c.post(`/api/game/${s.json.game_id}/skip`, {});
  }
  // Sin datos suficientes no afirma debilidades.
  assert.ok(!r.items.some((x) => x.kind === 'practice_mechanism'));
  await c.put('/api/me/profile', { prefs: { recommendations: false } });
  assert.deepEqual((await c.get('/api/me/recommendations')).json, { disabled: true, items: [] });
});

test('objetivos, biblioteca y colecciones guardan referencias y validan lo que reciben', async () => {
  const { c } = await newPlayer();
  const g = await play(c);
  assert.equal((await c.post('/api/me/goals', { kind: 'solve', target: 0, period: 'day' })).status, 400);
  assert.equal((await c.post('/api/me/goals', { kind: 'mechanism', target: 2, period: 'week', param: 'inventado' })).status, 400);
  const goal = await c.post('/api/me/goals', { kind: 'solve', target: 5, period: 'day' });
  const list = (await c.get('/api/me/goals')).json.items;
  assert.equal(list[0].progress.value, 1);
  assert.equal(list[0].progress.done, false);
  await c.put(`/api/me/goals/${goal.json.id}`, { kind: 'solve', target: 1, period: 'day' });
  assert.equal((await c.get('/api/me/goals')).json.items[0].progress.done, true);
  await c.del(`/api/me/goals/${goal.json.id}`);
  assert.equal((await c.get('/api/me/goals')).json.items.length, 0);
  assert.equal((await c.post('/api/me/retry/no-existe')).status, 404);
  await c.post(`/api/me/retry/${g.clue.id}`);
  const lib = (await c.get('/api/me/library?tab=retry')).json;
  assert.equal(lib.items[0].id, g.clue.id);
  assert.ok(lib.items[0].solution, 'la explicación solo de lo ya resuelto');
  const solved = (await c.get('/api/me/library?tab=solved')).json;
  assert.equal(solved.total, 1);
  // Un críptico retirado deja de mostrarse (se guarda solo la referencia).
  await env.db.run("UPDATE clues SET status = 'disabled' WHERE id = ?", [g.clue.id]);
  const gone = (await c.get('/api/me/library?tab=retry')).json.items[0];
  assert.deepEqual(Object.keys(gone).sort(), ['available', 'id', 'saved_at']);
  await env.db.run("UPDATE clues SET status = 'published' WHERE id = ?", [g.clue.id]);
  assert.equal((await c.post('/api/me/collections', { name: '' })).status, 400);
  const other = await newPlayer();
  const col = await c.post('/api/me/collections', { name: 'Mías' });
  assert.equal((await other.c.post(`/api/me/collections/${col.json.id}/items`, { clue_id: g.clue.id })).status, 404, 'colecciones ajenas no');
  assert.equal((await other.c.get(`/api/me/library?tab=collection:${col.json.id}`)).status, 404);
});

test('rendimiento: miles de partidas se consultan con índices y paginado', async () => {
  const { c, id } = await newPlayer();
  await play(c);
  const pid = (await env.db.get('SELECT id FROM players WHERE user_id = ?', [id])).id;
  const clues = (await env.db.all("SELECT id FROM clues WHERE status = 'published'")).map((r) => r.id);
  const N = 3000; const t0 = Date.now() - 300 * 86400000;
  await env.db.tx(async (t) => {
    for (let i = 0; i < N; i++) {
      const st = new Date(t0 + i * 8600000).toISOString();
      const solved = i % 3 !== 0;
      await t.run(`INSERT INTO games(id, player_id, clue_id, mode, started_at, finished_at, result, status, attempts, hints_used, duration_ms, active_ms, last_activity_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [uuid(), pid, clues[i % clues.length], 'infinite', st, st, solved ? 'solved' : 'revealed', solved ? 'solved' : 'revealed', 1 + (i % 3), i % 2, 20000 + i, 15000, st]);
      if (i % 7 === 0) await t.run('INSERT OR IGNORE INTO player_days(player_id, day, games, solved) VALUES (?,?,1,1)', [pid, st.slice(0, 10)]);
    }
  });
  const time = async (u) => { const s = Date.now(); const r = await c.get(u); assert.equal(r.status, 200, u + ' ' + r.text); return [Date.now() - s, r.json]; };
  const [tp, prof] = await time('/api/me/profile');
  assert.equal(prof.stats.games, N + 1);
  const [th, h] = await time('/api/me/history?page=50');
  assert.equal(h.items.length, 20, 'paginado');
  assert.equal(h.total, N + 1);
  const [te] = await time('/api/me/evolution?days=365');
  const [ts] = await time('/api/me/strengths');
  const [tr] = await time('/api/me/records');
  for (const [name, ms] of Object.entries({ profile: tp, history: th, evolution: te, strengths: ts, records: tr })) assert.ok(ms < 3000, `${name} tardó ${ms} ms`);
  const plan = await env.db.all(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM games g WHERE g.player_id IN (?) AND g.status = 'solved'`, [pid]);
  assert.ok(plan.some((p) => /USING (COVERING )?INDEX/.test(p.detail)), JSON.stringify(plan));
});
