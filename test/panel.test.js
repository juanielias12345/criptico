'use strict';

// Centro de control: seguimiento de partidas, indicadores, permisos, exportaciones
// y datos personales. Los números de «#n» siguen la lista de pruebas pedida.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client, staff } = require('./helpers');
const { runJob } = require('../src/services/jobs');
const { classifyStale } = require('../src/services/tracking');
const { csv } = require('../src/routes/admin-panel');

let env; let owner; let analyst; let moderator; let editor;
test.before(async () => {
  env = await makeEnv();
  owner = await staff(env, 'owner');
  analyst = await staff(env, 'analyst');
  moderator = await staff(env, 'moderator');
  editor = await staff(env, 'editor');
});
test.after(async () => { await env.close(); });

const answerOf = async (gameId) => (await env.db.get('SELECT c.answer FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.id = ?', [gameId])).answer;
const gameRow = (id) => env.db.get('SELECT * FROM games WHERE id = ?', [id]);
const events = async (id) => (await env.db.all('SELECT kind FROM game_events WHERE game_id = ? ORDER BY id', [id])).map((e) => e.kind);

async function newPlayer(prefix = 'p') {
  const c = client(env.base);
  const username = prefix + Math.random().toString(36).slice(2, 8);
  const r = await c.post('/api/auth/register', { accept: true, username, password: 'Una-clave-de-prueba-9', email: username + '@example.com' });
  assert.equal(r.status, 201, r.text);
  return { c, username, id: r.json.user.id };
}

test('#1 #2 #3 registro de cuenta, país e idioma elegidos se guardan', async () => {
  const p = await newPlayer();
  const me = await p.c.get('/api/auth/me');
  assert.equal(me.json.user.username, p.username);
  assert.equal((await p.c.put('/api/me/prefs', { country: 'UY', choice: 'es-AR', ui: 'es', timezone: 'America/Montevideo' })).status, 200);
  const u = await env.db.get('SELECT country_code, play_variant, ui_language, timezone FROM users WHERE id = ?', [p.id]);
  assert.deepEqual(u, { country_code: 'UY', play_variant: 'es-AR', ui_language: 'es', timezone: 'America/Montevideo' });
  const s = await p.c.post('/api/game/start', { choice: 'es-AR', country: 'UY' });
  const g = await gameRow(s.json.game_id);
  assert.equal(g.country_code, 'UY');
  assert.equal(g.play_variant, 'es-AR');
  const linked = await env.db.get('SELECT user_id FROM players WHERE id = ?', [g.player_id]);
  assert.equal(linked.user_id, p.id, 'la partida queda asociada a la cuenta');
});

test('#4 #5 #7 partida iniciada, resuelta y con tiempo de resolución correcto', async () => {
  const c = client(env.base);
  const s = await c.post('/api/game/start', { choice: 'es', country: 'AR' });
  let g = await gameRow(s.json.game_id);
  assert.equal(g.status, 'started');
  assert.deepEqual(await events(g.id), ['start']);
  // Simula que la partida empezó hace 90 s (la última actividad, también).
  const t0 = new Date(Date.now() - 90000).toISOString();
  await env.db.run('UPDATE games SET started_at = ?, last_activity_at = ? WHERE id = ?', [t0, t0, g.id]);
  await c.post(`/api/game/${g.id}/guess`, { answer: 'zzzz' });
  const ok = await c.post(`/api/game/${g.id}/guess`, { answer: await answerOf(g.id) });
  assert.equal(ok.json.correct, true);
  g = await gameRow(g.id);
  assert.equal(g.status, 'solved');
  assert.equal(g.result, 'solved');
  assert.equal(g.attempts, 2);
  assert.equal(g.wrong_attempts, 1);
  assert.ok(g.duration_ms >= 89000 && g.duration_ms < 120000, 'tiempo hasta resolver ≈ 90 s: ' + g.duration_ms);
  assert.ok(g.active_ms <= g.duration_ms, 'el tiempo activo nunca supera el transcurrido');
  assert.ok(g.active_ms <= 120000 + 1000, 'una pausa larga se recorta al tope configurado');
  assert.deepEqual(await events(g.id), ['start', 'guess_wrong', 'guess_correct']);
});

test('#6 una partida no resuelta se clasifica según su estado real', async () => {
  const c = client(env.base);
  // Saltada: abandonada por la persona.
  const a = (await c.post('/api/game/start', { choice: 'es' })).json.game_id;
  await c.post(`/api/game/${a}/skip`, {});
  assert.deepEqual([(await gameRow(a)).status, (await gameRow(a)).end_reason], ['abandoned', 'skipped']);
  // Revelada: completada tras revelar.
  const b = (await c.post('/api/game/start', { choice: 'es' })).json.game_id;
  await c.post(`/api/game/${b}/reveal`, {});
  assert.equal((await gameRow(b)).status, 'revealed');
  // Sin actividad: no se marca enseguida como abandonada…
  const d = (await c.post('/api/game/start', { choice: 'es' })).json.game_id;
  await c.post(`/api/game/${d}/hint`, {});
  await classifyStale(env.db);
  assert.equal((await gameRow(d)).status, 'in_progress', 'cerrar la pestaña no la abandona de inmediato');
  // …pero sí tras la ventana de inactividad configurada (30 min por defecto).
  const old = new Date(Date.now() - 31 * 60000).toISOString();
  await env.db.run('UPDATE games SET last_activity_at = ? WHERE id = ?', [old, d]);
  await classifyStale(env.db);
  assert.deepEqual([(await gameRow(d)).status, (await gameRow(d)).end_reason], ['abandoned', 'inactivity']);
  // Si la persona vuelve y juega, se retoma.
  await c.post(`/api/game/${d}/guess`, { answer: 'qqqq' });
  assert.equal((await gameRow(d)).status, 'in_progress');
  assert.ok((await events(d)).includes('resume'));
  // Con errores del servidor y sin más actividad: interrumpida por error técnico.
  const e = (await c.post('/api/game/start', { choice: 'es' })).json.game_id;
  await env.db.run('UPDATE games SET error_count = 1, last_activity_at = ? WHERE id = ?', [old, e]);
  await classifyStale(env.db);
  assert.deepEqual([(await gameRow(e)).status, (await gameRow(e)).end_reason], ['error', 'server_error']);
  // Modo con tiempo: expirada.
  const f = (await c.post('/api/game/start', { choice: 'es', mode: 'timed' })).json.game_id;
  await c.post(`/api/game/${f}/skip`, { reason: 'timeout' });
  assert.equal((await gameRow(f)).status, 'expired');
});

test('#8 #19 pistas, revelaciones e intentos repetidos no se duplican', async () => {
  const c = client(env.base);
  const id = (await c.post('/api/game/start', { choice: 'es' })).json.game_id;
  // Dos pedidos simultáneos de pista (doble clic o reintento): cuenta una.
  await Promise.all([c.post(`/api/game/${id}/hint`, { level: 1 }), c.post(`/api/game/${id}/hint`, { level: 1 })]);
  assert.equal((await gameRow(id)).hints_used, 1);
  assert.equal((await events(id)).filter((k) => k === 'hint').length, 1);
  // El mismo intento reenviado tras un corte de conexión no suma otro intento.
  await c.post(`/api/game/${id}/guess`, { answer: 'xxxx' });
  const again = await c.post(`/api/game/${id}/guess`, { answer: 'xxxx' });
  assert.equal(again.json.repeated, true);
  assert.equal((await gameRow(id)).attempts, 1);
  // Revelar dos veces deja un solo evento.
  await c.post(`/api/game/${id}/reveal`, {});
  await c.post(`/api/game/${id}/reveal`, {});
  assert.equal((await events(id)).filter((k) => k === 'reveal').length, 1);
  // Una respuesta enviada después del cierre no altera la partida.
  await c.post(`/api/game/${id}/guess`, { answer: await answerOf(id) });
  const g = await gameRow(id);
  assert.equal(g.status, 'revealed');
  assert.equal(g.attempts, 1);
  // Un error del servidor en una acción queda anotado sin cambiar el resultado.
  const id2 = (await c.post('/api/game/start', { choice: 'es' })).json.game_id;
  const { markError } = require('../src/services/tracking');
  await markError(env.db, id2, 'guess');
  assert.equal((await gameRow(id2)).error_count, 1);
  assert.equal((await gameRow(id2)).status, 'started');
});

test('#9 #10 los indicadores coinciden con los registros y los filtros funcionan', async () => {
  const r = await owner.c.get('/api/admin/analytics/overview?period=7d');
  assert.equal(r.status, 200, r.text);
  const from = r.json.period.from; const to = r.json.period.to;
  const direct = await env.db.get(`SELECT COUNT(*) AS started, SUM(CASE WHEN status = 'solved' THEN 1 ELSE 0 END) AS solved,
    SUM(CASE WHEN status IN ('solved','revealed') THEN 1 ELSE 0 END) AS completed, SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
    COUNT(DISTINCT player_id) AS players FROM games WHERE started_at >= ? AND started_at < ?`, [from, to]);
  const cur = r.json.current;
  assert.equal(cur.games.started, direct.started);
  assert.equal(cur.games.solved, direct.solved);
  assert.equal(cur.games.completed, direct.completed);
  assert.equal(cur.games.abandoned, direct.abandoned);
  assert.equal(cur.active_players, direct.players);
  assert.equal(r.json.registered_total, (await env.db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND deleted_at IS NULL")).n);
  // Filtro por país.
  const uy = await owner.c.get('/api/admin/analytics/overview?period=7d&country=UY');
  const uyDirect = await env.db.get("SELECT COUNT(*) AS n FROM games WHERE started_at >= ? AND started_at < ? AND country_code = 'UY'", [from, to]);
  assert.equal(uy.json.current.games.started, uyDirect.n);
  assert.ok(uyDirect.n >= 1);
  // Filtro por idioma (del críptico).
  const en = await owner.c.get('/api/admin/analytics/overview?period=7d&lang=en');
  const enDirect = await env.db.get("SELECT COUNT(*) AS n FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.started_at >= ? AND g.started_at < ? AND c.language_code = 'en'", [from, to]);
  assert.equal(en.json.current.games.started, enDirect.n);
  // Rango de fechas personalizado sin partidas.
  const past = await owner.c.get('/api/admin/analytics/overview?period=custom&from=2020-01-01&to=2020-01-31');
  assert.equal(past.json.current.games.started, 0);
  assert.equal(past.json.current.games.solve_rate, null, 'sin datos no se inventa una tasa');
  assert.equal((await owner.c.get('/api/admin/analytics/overview?period=custom&from=2020-02-01&to=2020-01-01')).status, 400);
  // Las 24 h (no alineadas al día) se calculan directamente desde las partidas.
  const h24 = await owner.c.get('/api/admin/analytics/overview?period=24h');
  const d24 = await env.db.get('SELECT COUNT(*) AS n FROM games WHERE started_at >= ? AND started_at < ?', [h24.json.period.from, h24.json.period.to]);
  assert.equal(h24.json.current.games.started, d24.n);
  // Geografía, embudo, retención y crípticos responden con datos reales.
  const geo = await owner.c.get('/api/admin/analytics/geo?period=7d');
  assert.ok(geo.json.countries.find((x) => x.country === 'UY'));
  assert.equal(geo.json.inferred_location, null, 'no se infiere ubicación');
  const fun = await owner.c.get('/api/admin/analytics/funnel?period=7d');
  assert.equal(fun.json.steps[1].key, 'start');
  const ret = await owner.c.get('/api/admin/analytics/retention');
  assert.equal(ret.status, 200);
  const cl = await owner.c.get('/api/admin/analytics/clues?sort=plays&min_plays=1');
  assert.ok(cl.json.items.length >= 1 && cl.json.items[0].plays >= 1);
  const visits = await client(env.base).post('/api/visit', { ui: 'es', country: 'AR', first: true });
  assert.equal(visits.status, 204);
  const tr = await env.db.get("SELECT SUM(n) AS n FROM traffic_daily WHERE kind = 'new_visitor'");
  assert.equal(tr.n, 1);
  assert.equal((await client(env.base).post('/api/visit', { first: true }, { dnt: '1' })).status, 204);
  assert.equal((await env.db.get("SELECT SUM(n) AS n FROM traffic_daily WHERE kind = 'new_visitor'")).n, 1, 'Do Not Track: no se cuenta');
});

test('#11 el correo solo lo ven los roles autorizados', async () => {
  const p = await newPlayer('mail');
  const asOwner = await owner.c.get('/api/admin/players?q=' + p.username);
  assert.equal(asOwner.json.items[0].email, p.username + '@example.com');
  const asAnalyst = await analyst.c.get('/api/admin/players?q=' + p.username);
  assert.equal(asAnalyst.status, 200);
  assert.equal(asAnalyst.json.items[0].email, undefined);
  assert.equal(asAnalyst.json.items[0].has_email, true);
  assert.equal((await analyst.c.get('/api/admin/players?q=' + encodeURIComponent(p.username + '@example.com'))).status, 403, 'no puede buscar por correo');
  const detail = await analyst.c.get('/api/admin/players/' + p.id);
  assert.equal(detail.json.user.email, undefined);
  for (const body of [asOwner.text, asAnalyst.text, detail.text]) {
    assert.doesNotMatch(body, /password|scrypt|csrf_token|session/i, 'nunca viajan contraseñas ni sesiones');
  }
  assert.equal((await moderator.c.get('/api/admin/players')).status, 403, 'moderación no ve usuarios');
});

test('#12 una persona no puede ver estadísticas privadas de otra', async () => {
  const a1 = await newPlayer('a');
  const b1 = await newPlayer('b');
  const s = await b1.c.post('/api/game/start', { choice: 'es' });
  await b1.c.post(`/api/game/${s.json.game_id}/reveal`, {});
  assert.equal((await a1.c.get('/api/admin/players/' + b1.id)).status, 403);
  assert.equal((await a1.c.get('/api/admin/games/' + s.json.game_id)).status, 403);
  assert.equal((await a1.c.post(`/api/game/${s.json.game_id}/hint`, {})).status, 404, 'tampoco puede operar su partida');
  const mine = await a1.c.get('/api/me/stats');
  assert.equal(mine.json.played, 0, 'sus estadísticas no incluyen partidas ajenas');
});

test('#13 un moderador o analista no ejecuta acciones de superadministrador', async () => {
  const p = await newPlayer('sus');
  for (const who of [moderator, analyst, editor]) {
    assert.equal((await who.c.post('/api/admin/users', { username: 'x' + Math.random().toString(36).slice(2, 7), password: 'Una-clave-larga-1', role: 'owner' })).status, 403);
    assert.equal((await who.c.put('/api/admin/settings/game.max_hints', { value: 2 })).status, 403);
    assert.equal((await who.c.post(`/api/admin/players/${p.id}/suspend`, {})).status, 403);
    assert.equal((await who.c.post(`/api/admin/players/${p.id}/anonymize`, { confirm: 'ELIMINAR' })).status, 403);
    assert.equal((await who.c.get('/api/admin/privacy/requests')).status, 403);
  }
  assert.equal((await analyst.c.get('/api/admin/analytics/overview')).status, 200, 'el analista sí ve estadísticas');
  assert.equal((await moderator.c.get('/api/admin/analytics/overview')).status, 403, 'moderación no ve estadísticas');
  assert.equal((await analyst.c.post('/api/admin/submissions/x/moderate', { action: 'approve' })).status, 403);
  // Suspender (superadministrador) cierra la sesión y bloquea el acceso.
  assert.equal((await owner.c.post(`/api/admin/players/${p.id}/suspend`, { reason: 'prueba' })).status, 200);
  assert.equal((await p.c.get('/api/auth/me')).json.user, null);
  const hist = await owner.c.get(`/api/admin/players/${p.id}/admin-history`);
  assert.equal(hist.json.items[0].action, 'user.suspend');
  assert.equal((await owner.c.post(`/api/admin/players/${p.id}/reactivate`, {})).status, 200);
  // La auditoría no se puede modificar.
  await assert.rejects(env.db.run("UPDATE audit_log SET action = 'otra'"), /audit_log_immutable/);
});

test('#14 #15 propuestas siempre con aprobación manual; tareas no las publican', async () => {
  const c = client(env.base);
  const sub = await c.post('/api/submissions', { clue_text: 'Ramo revuelto para el sentimiento (4)', answer: 'AMOR', definition: 'el sentimiento',
    explanation: 'Anagrama de RAMO.', mechanism: 'anagram', language_code: 'es', category: 'sentimientos', difficulty: 1,
    rights_confirmed: true, terms_accepted: true, form_started_at: Date.now() - 20000 });
  assert.ok([201, 409].includes(sub.status), sub.text);
  for (const j of ['generate_clues', 'import_sources', 'analytics_rollup', 'alerts_scan']) await runJob(env.db, j);
  const published = await env.db.get("SELECT COUNT(*) AS n FROM clues WHERE origin = 'community' AND status = 'published'");
  assert.equal(published.n, 0);
  assert.equal((await owner.c.get('/api/admin/analytics/imports')).status, 200);
  assert.equal((await moderator.c.get('/api/admin/analytics/imports')).status, 403);
});

test('#16 las exportaciones respetan los permisos y quedan auditadas', async () => {
  assert.equal((await moderator.c.get('/api/admin/export/users.csv')).status, 403);
  assert.equal((await editor.c.get('/api/admin/export/users.csv')).status, 403, 'contenido no exporta usuarios');
  assert.equal((await editor.c.get('/api/admin/export/clues.csv')).status, 200);
  const an = await analyst.c.get('/api/admin/export/users.csv?include_email=1');
  assert.equal(an.status, 200);
  assert.doesNotMatch(an.text.split('\n')[0], /email,/, 'el analista no exporta correos aunque lo pida');
  assert.doesNotMatch(an.text, /@example\.com/);
  const own = await owner.c.get('/api/admin/export/users.csv?include_email=1');
  assert.match(own.text.split('\n')[0], /,email,/);
  assert.match(own.text, /@example\.com/);
  assert.doesNotMatch(own.text, /scrypt|password/i);
  const logged = await env.db.get("SELECT details FROM audit_log WHERE action = 'export.users' ORDER BY id DESC LIMIT 1");
  assert.equal(JSON.parse(logged.details).personal_data, true);
  for (const name of ['games', 'daily', 'countries', 'languages', 'retention', 'imports', 'submissions']) {
    assert.equal((await owner.c.get(`/api/admin/export/${name}.csv?period=30d`)).status, 200, name);
  }
  assert.equal(csv([{ a: '=HYPERLINK("x")' }], ['a']).trim().split('\r\n')[1], "\"'=HYPERLINK(\"\"x\"\")\"", 'protege contra fórmulas');
});

test('#17 solicitudes de datos: acceso, eliminación y estadísticas agregadas que se mantienen', async () => {
  const p = await newPlayer('del');
  const s = await p.c.post('/api/game/start', { choice: 'es', country: 'CL' });
  await p.c.post(`/api/game/${s.json.game_id}/guess`, { answer: await answerOf(s.json.game_id) });
  const copy = await p.c.get('/api/me/export');
  assert.equal(copy.json.account.username, p.username);
  assert.equal(copy.json.games.length, 1);
  assert.doesNotMatch(copy.text, /scrypt|password_hash|csrf/);
  const req = await p.c.post('/api/me/data-requests', { kind: 'deletion', message: 'Borrar mi cuenta' });
  assert.equal(req.status, 201);
  const list = await owner.c.get('/api/admin/privacy/requests');
  assert.ok(list.json.items.find((x) => x.id === req.json.id));
  const before = (await env.db.get("SELECT COUNT(*) AS n FROM games WHERE status = 'solved'")).n;
  assert.equal((await owner.c.post('/api/admin/privacy/requests/' + req.json.id, { status: 'done', note: 'Hecho' })).status, 200);
  const u = await env.db.get('SELECT username, email, deleted_at, password_hash FROM users WHERE id = ?', [p.id]);
  assert.ok(u.deleted_at);
  assert.equal(u.email, null);
  assert.match(u.username, /^eliminado-/);
  assert.equal((await env.db.get('SELECT COUNT(*) AS n FROM players WHERE user_id = ?', [p.id])).n, 0, 'las partidas ya no se vinculan con la persona');
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM games WHERE status = 'solved'")).n, before, 'los agregados no cambian');
  assert.equal((await p.c.get('/api/auth/me')).json.user, null, 'la sesión se cerró');
  assert.equal((await client(env.base).post('/api/auth/login', { username: p.username, password: 'Una-clave-de-prueba-9' })).status, 401);
  const detail = await owner.c.get('/api/admin/players/' + p.id);
  assert.equal(detail.json.user.status, 'deleted');
  // Borrado directo desde la cuenta.
  const q = await newPlayer('self');
  assert.equal((await q.c.del('/api/me/account')).status, 200);
  assert.ok((await env.db.get('SELECT deleted_at FROM users WHERE id = ?', [q.id])).deleted_at);
  assert.ok(await env.db.get("SELECT 1 FROM data_requests WHERE user_id = ? AND kind = 'deletion' AND status = 'done'", [q.id]));
});

test('#20 alertas con umbrales, sin duplicados, y tareas que se recuperan', async () => {
  for (let i = 0; i < 25; i++) await env.db.run("INSERT INTO error_log(scope, message) VALUES ('test', 'falla simulada')");
  await runJob(env.db, 'alerts_scan');
  await env.db.run("UPDATE jobs SET lease_until = NULL WHERE name = 'alerts_scan'");
  await runJob(env.db, 'alerts_scan');
  const rows = await env.db.all("SELECT * FROM alerts WHERE kind = 'errors'");
  assert.equal(rows.length, 1, 'la misma condición no genera alertas duplicadas');
  assert.equal(rows[0].occurrences, 2);
  const list = await analyst.c.get('/api/admin/alerts');
  assert.ok(list.json.items.find((x) => x.kind === 'errors'));
  assert.equal((await analyst.c.post('/api/admin/alerts/' + rows[0].id, { status: 'resolved' })).status, 403, 'el analista ve, no gestiona');
  assert.equal((await owner.c.post('/api/admin/alerts/' + rows[0].id, { status: 'resolved' })).status, 200);
  // Una ejecución colgada del resumen se recupera y la siguiente funciona.
  await env.db.run("UPDATE jobs SET lease_until = ? WHERE name = 'analytics_rollup'", [new Date(Date.now() - 60000).toISOString()]);
  await env.db.run("INSERT INTO job_runs(job_name, started_at, status) VALUES ('analytics_rollup', ?, 'running')", [new Date(Date.now() - 3600000).toISOString()]);
  await runJob(env.db, 'recover_stuck');
  const out = await runJob(env.db, 'analytics_rollup');
  assert.equal(out.status, 'success');
  assert.equal((await env.db.get("SELECT COUNT(*) AS n FROM job_runs WHERE job_name = 'analytics_rollup' AND status = 'running'")).n, 0);
  // Un fallo controlado se registra y la tarea queda reprogramada.
  const { HANDLERS } = require('../src/services/jobs');
  const orig = HANDLERS.alerts_scan;
  HANDLERS.alerts_scan = async () => { throw new Error('fallo controlado'); };
  await env.db.run("UPDATE jobs SET lease_until = NULL WHERE name = 'alerts_scan'");
  const failed = await runJob(env.db, 'alerts_scan');
  HANDLERS.alerts_scan = orig;
  assert.equal(failed.status, 'failed');
  const job = await env.db.get("SELECT consecutive_failures, next_run_at, lease_until FROM jobs WHERE name = 'alerts_scan'");
  assert.equal(job.consecutive_failures, 1);
  assert.equal(job.lease_until, null);
  assert.ok(Date.parse(job.next_run_at) > Date.now());
});

test('partidas: búsqueda por identificador y detalle con eventos', async () => {
  const c = client(env.base);
  const id = (await c.post('/api/game/start', { choice: 'en', country: 'GB' })).json.game_id;
  await c.post(`/api/game/${id}/hint`, {});
  const list = await analyst.c.get('/api/admin/games?id=' + id);
  assert.equal(list.json.total, 1);
  assert.equal(list.json.items[0].status, 'in_progress');
  const det = await analyst.c.get('/api/admin/games/' + id);
  assert.deepEqual(det.json.events.map((e) => e.kind), ['start', 'hint']);
  assert.equal(det.json.game.answer !== undefined, true, 'el panel puede revisar la respuesta del críptico');
  const filtered = await analyst.c.get('/api/admin/games?country=GB&lang=en&status=in_progress');
  assert.ok(filtered.json.items.every((g) => g.country_code === 'GB' && g.language_code === 'en' && g.status === 'in_progress'));
  assert.ok(filtered.json.per_page <= 100, 'siempre paginado en el servidor');
});
