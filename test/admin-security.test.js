'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { makeEnv, client, staff } = require('./helpers');
const { findDuplicates } = require('../src/services/dedupe');
const { runJob, tick } = require('../src/services/jobs');

let env; let owner; let moderator; let editor;
test.before(async () => {
  env = await makeEnv();
  owner = await staff(env, 'owner');
  moderator = await staff(env, 'moderator');
  editor = await staff(env, 'editor');
});
test.after(async () => { await env.close(); });

test('seguridad del panel (#18): sin sesión 401, jugador 403, permisos por rol', async () => {
  const anon = client(env.base);
  assert.equal((await anon.get('/api/admin/dashboard')).status, 401);
  const player = client(env.base);
  await player.post('/api/auth/register', { accept: true, username: 'jugador1', password: 'clave-de-jugador-1' });
  assert.equal((await player.get('/api/admin/dashboard')).status, 403);
  assert.equal((await player.post('/api/auth/login', { username: 'jugador1', password: 'clave-de-jugador-1', admin: true })).status, 403);
  assert.equal((await owner.c.get('/api/admin/dashboard')).status, 200);
  assert.equal((await moderator.c.get('/api/admin/sources')).status, 403, 'moderación no gestiona fuentes');
  assert.equal((await editor.c.get('/api/admin/submissions')).status, 403, 'edición no modera propuestas');
  assert.equal((await editor.c.put('/api/admin/settings/game.max_hints', { value: 3 })).status, 403);
  assert.equal((await moderator.c.get('/api/admin/users')).status, 403);
  assert.equal((await owner.c.get('/api/admin/users')).status, 200);
  const adminPage = await anon.get('/admin');
  assert.equal(adminPage.status, 200);
  assert.match(adminPage.headers.get('x-robots-tag') || '', /noindex/);
});

test('CSRF y origen: sin token o desde otro sitio se rechaza', async () => {
  const noToken = await owner.c.put('/api/admin/settings/game.max_hints', { value: 3 }, { 'x-csrf-token': 'otro' });
  assert.equal(noToken.status, 403);
  assert.equal(noToken.json.error, 'csrf_failed');
  const foreign = await owner.c.put('/api/admin/settings/game.max_hints', { value: 3 }, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.json.error, 'bad_origin');
  const form = await owner.c.post('/api/admin/clues', 'clue_text=x', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415, 'solo JSON: un formulario de otro sitio no sirve');
  assert.equal((await owner.c.put('/api/admin/settings/game.max_hints', { value: 3 })).status, 200);
  assert.equal((await owner.c.put('/api/admin/settings/game.max_hints', { value: 'mucho' })).status, 400, 'valida tipos de configuración');
  assert.equal((await owner.c.put('/api/admin/settings/no.existe', { value: 1 })).status, 400);
});

test('bloqueo tras intentos fallidos, cookies seguras y sin contraseñas en claro', async () => {
  const u = await staff(env, 'moderator', 'victima');
  const c = client(env.base);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { username: 'victima', password: 'mal' })).status, 401);
  const locked = await c.post('/api/auth/login', { username: 'victima', password: u.password });
  assert.equal(locked.status, 429, 'cuenta bloqueada temporalmente aunque la contraseña sea correcta');
  const row = await env.db.get("SELECT password_hash FROM users WHERE username = 'victima'");
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes(u.password));
  const sess = await env.db.get('SELECT id FROM sessions LIMIT 1');
  assert.equal(sess.id.length, 64, 'la base guarda el hash del token de sesión, no el token');
  const login = await client(env.base).post('/api/auth/login', { username: owner.username, password: owner.password });
  const sc = login.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
  assert.equal((await client(env.base).post('/api/auth/register', { accept: true, username: 'debil', password: '123' })).status, 400, 'contraseñas débiles rechazadas');
});

test('auditoría de acciones administrativas', async () => {
  await owner.c.patch('/api/admin/languages/fr', { enabled: false });
  const a = await owner.c.get('/api/admin/audit');
  assert.ok(a.json.items.some((x) => x.action === 'language.toggle'));
  assert.ok(a.json.items.some((x) => x.action === 'admin.login'));
});

test('gestión del catálogo: crear, validar, publicar solo si es válido, editar y desactivar', async () => {
  const bad = await owner.c.post('/api/admin/clues', { clue_text: 'Rata loca para un atar (5)', answer: 'ATAR', definition: 'un atar', language_code: 'es',
    wordplay: { op: 'anagram', indicator: 'loca', of: [{ op: 'lit', text: 'rata' }] }, publish: true });
  assert.equal(bad.status, 201);
  assert.equal(bad.json.status, 'draft', 'con errores queda en borrador');
  const pub = await owner.c.post(`/api/admin/clues/${bad.json.id}/status`, { status: 'published' });
  assert.equal(pub.status, 422, 'la base impide publicar con errores (#25)');
  const fix = await owner.c.patch(`/api/admin/clues/${bad.json.id}`, { clue_text: 'Rata loca para unir con cuerda (4)', definition: 'unir con cuerda' });
  assert.equal(fix.json.report.errors, 0, JSON.stringify(fix.json.report.checks));
  assert.equal((await owner.c.post(`/api/admin/clues/${bad.json.id}/status`, { status: 'published' })).status, 200);
  const detail = await owner.c.get('/api/admin/clues/' + bad.json.id);
  assert.ok(detail.json.events.some((e) => e.action === 'edit'), 'historial de cambios');
  // Editar un publicado dejándolo inválido lo retira de las partidas.
  const broke = await owner.c.patch(`/api/admin/clues/${bad.json.id}`, { answer: 'TORO' });
  assert.equal(broke.json.status, 'review');
  assert.equal((await moderator.c.post(`/api/admin/clues/${bad.json.id}/status`, { status: 'disabled' })).status, 403);
  assert.equal((await editor.c.del('/api/admin/clues/' + bad.json.id)).status, 403, 'solo owner elimina');
  assert.equal((await owner.c.del('/api/admin/clues/' + bad.json.id)).status, 200);
});

test('detección de duplicados exactos y semánticos (#17)', async () => {
  const exact = await findDuplicates(env.db, { language_code: 'es', clue_text: '  ramo REVUELTO, para el sentimiento (4)', answer: 'amor' });
  assert.equal(exact.matches[0].kind, 'exact', 'ignora mayúsculas, signos y espacios');
  const semantic = await findDuplicates(env.db, { language_code: 'es', clue_text: 'Un ramo revuelto da el sentimiento (4)', answer: 'AMOR',
    wordplay: { op: 'anagram', indicator: 'revuelto', of: [{ op: 'lit', text: 'ramo' }] } });
  assert.equal(semantic.matches[0].kind, 'semantic');
  assert.ok(semantic.matches[0].similarity >= 0.6);
  const different = await findDuplicates(env.db, { language_code: 'es', clue_text: 'Mora alterada para el cariño (4)', answer: 'AMOR' });
  assert.equal(different.matches.length, 0, 'otra pista para la misma respuesta no es duplicado');
  const dup = await owner.c.post('/api/admin/clues', { clue_text: 'Ramo revuelto para el sentimiento (4)', answer: 'AMOR', definition: 'el sentimiento', language_code: 'es',
    wordplay: { op: 'anagram', indicator: 'revuelto', of: [{ op: 'lit', text: 'ramo' }] } });
  assert.equal(dup.status, 409);
});

test('consistencia de la base (#22): restricciones e integridad', async () => {
  const db = env.db;
  await assert.rejects(db.run("INSERT INTO clues(id, slug, clue_text, answer, answer_key, enumeration, explanation, language_code, difficulty, mechanism, origin, fingerprint) VALUES ('x','x','x','x','X','1','[]','es',9,'anagram','original','f1')"), /CHECK/);
  await assert.rejects(db.run("INSERT INTO clues(id, slug, clue_text, answer, answer_key, enumeration, explanation, language_code, difficulty, mechanism, origin, fingerprint) VALUES ('y','y','x','x','X','1','[]','es',1,'anagram','external','f2')"), /CHECK/, 'externo sin fuente');
  await assert.rejects(db.run("INSERT INTO clues(id, slug, clue_text, answer, answer_key, enumeration, explanation, language_code, difficulty, mechanism, origin, status, fingerprint) VALUES ('z','z','x','x','X','1','[]','es',1,'anagram','original','published','f3')"), /publish_blocked/, 'publicado sin validar');
  await assert.rejects(db.run("INSERT INTO submissions(id, tracking_token, clue_text, answer, explanation, language_code, difficulty, rights_confirmed, terms_accepted, status) VALUES ('s1','t1','x','x','x','es',1,1,1,'inventado')"), /CHECK/, 'estado inexistente');
  await assert.rejects(db.run("INSERT INTO submissions(id, tracking_token, clue_text, answer, explanation, language_code, difficulty, rights_confirmed, terms_accepted) VALUES ('s2','t2','x','x','x','es',1,0,1)"), /CHECK/, 'sin confirmar derechos');
  await assert.rejects(db.run("INSERT INTO settings(key, value) VALUES ('k', 'no es json')"), /CHECK/);
  const fk = await db.all('PRAGMA foreign_key_check');
  assert.deepEqual(fk, [], 'sin referencias rotas');
  const orphanGames = await db.get('SELECT COUNT(*) AS n FROM games g LEFT JOIN clues c ON c.id = g.clue_id WHERE c.id IS NULL');
  assert.equal(orphanGames.n, 0);
  const integrity = await db.get('PRAGMA integrity_check');
  assert.equal(Object.values(integrity)[0], 'ok');
  const published = await db.get("SELECT COUNT(*) AS n FROM clues WHERE status = 'published' AND (validation_errors > 0 OR validation_status IN ('failed','unchecked'))");
  assert.equal(published.n, 0, 'nada publicado con errores');
});

test('tareas programadas (#20): bloqueo, recuperación de ejecuciones colgadas y reintento', async () => {
  const db = env.db;
  // Una ejecución quedó "running" por una caída hace una hora.
  const old = new Date(Date.now() - 3600 * 1000).toISOString();
  await db.run("INSERT INTO job_runs(job_name, started_at, status) VALUES ('cleanup', ?, 'running')", [old]);
  await db.run('UPDATE jobs SET lease_until = ? WHERE name = ?', [old, 'cleanup']);
  const rec = await runJob(db, 'recover_stuck');
  assert.equal(rec.status, 'success');
  assert.ok(rec.output.abandoned_jobs >= 1);
  assert.equal((await db.get("SELECT status FROM job_runs WHERE started_at = ?", [old])).status, 'abandoned');
  // Un lease vigente impide la doble ejecución.
  await db.run('UPDATE jobs SET lease_until = ? WHERE name = ?', [new Date(Date.now() + 600000).toISOString(), 'cleanup']);
  assert.equal((await runJob(db, 'cleanup')).skipped, 'locked');
  await db.run('UPDATE jobs SET lease_until = NULL WHERE name = ?', ['cleanup']);
  // Una tarea que falla se reprograma con espera y se registra.
  const { HANDLERS } = require('../src/services/jobs');
  const orig = HANDLERS.cleanup;
  HANDLERS.cleanup = async () => { throw new Error('disco lleno'); };
  const f = await runJob(db, 'cleanup');
  HANDLERS.cleanup = orig;
  assert.equal(f.status, 'failed');
  const j = await db.get("SELECT * FROM jobs WHERE name = 'cleanup'");
  assert.equal(j.consecutive_failures, 1);
  assert.equal(j.lease_until, null, 'libera el bloqueo aunque falle');
  assert.ok(Date.parse(j.next_run_at) > Date.now());
  assert.equal((await runJob(db, 'cleanup')).status, 'success', 'se recupera en el siguiente intento');
  // Diario y generador
  await runJob(db, 'daily_challenge');
  assert.ok((await db.get('SELECT COUNT(*) AS n FROM daily_challenges')).n >= 2);
  const gen = await runJob(db, 'generate_clues');
  assert.equal(gen.status, 'success');
  const generated = await db.all("SELECT status FROM clues WHERE origin = 'generated'");
  assert.ok(generated.length > 0 && generated.every((g) => g.status === 'review'), 'lo generado no se publica sin revisión');
  // El endpoint del cron exige el secreto.
  const c = client(env.base);
  assert.equal((await c.get('/api/cron/tick')).status, 401);
  assert.equal((await c.get('/api/cron/tick', { authorization: 'Bearer mal' })).status, 401);
  assert.equal((await c.get('/api/cron/tick', { authorization: 'Bearer ' + env.config.cronSecret })).status, 200);
  assert.ok(Array.isArray(await tick(db)));
});

test('inyección SQL y entradas maliciosas no afectan las consultas', async () => {
  const c = client(env.base);
  const before = (await env.db.get('SELECT COUNT(*) AS n FROM clues')).n;
  const r = await owner.c.get("/api/admin/clues?q=" + encodeURIComponent("' OR 1=1; DROP TABLE clues; --"));
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 0);
  assert.equal((await c.get("/api/clues?lang=es'--&category=x%27")).status, 200);
  assert.equal((await env.db.get('SELECT COUNT(*) AS n FROM clues')).n, before);
  const xss = await c.get('/es/archivo?category=%3Cscript%3E');
  assert.ok(!xss.text.includes('<script>alert'), 'sin reflejo de HTML');
  assert.equal((await c.post('/api/game/start', '{malformado', { 'content-type': 'application/json' })).status, 400);
});

test('cabeceras de seguridad', async () => {
  const r = await client(env.base).get('/es');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('sin credenciales en el código (#21)', () => {
  const root = path.join(__dirname, '..');
  const files = execSync('git ls-files --cached --others --exclude-standard', { cwd: root }).toString().split('\n').filter(Boolean)
    .filter((f) => !f.startsWith('node_modules/') && fs.existsSync(path.join(root, f)) && !/\.(png|jpg|ico|db)$/.test(f));
  const patterns = [
    /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /ghp_[A-Za-z0-9]{30,}/, /sk-[A-Za-z0-9]{32,}/,
    /eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, /libsql:\/\/[^\s'"]+\?authToken=/,
    /(password|secret|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  ];
  const offenders = [];
  for (const f of files) {
    if (f.startsWith('test/')) continue;
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const p of patterns) if (p.test(text)) offenders.push(`${f}: ${p}`);
  }
  assert.deepEqual(offenders, []);
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.env$/m);
  assert.ok(!files.includes('.env'));
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  for (const line of example.split('\n').filter((l) => /^[A-Z_]+=/.test(l))) {
    const [k, v] = line.split('=');
    if (['SITE_URL', 'SITE_NAME'].includes(k)) continue;
    assert.equal(v, '', `${k} no debe traer un valor en .env.example`);
  }
});

test('en producción faltan variables obligatorias: no arranca con valores inseguros', () => {
  const { loadConfig } = require('../src/config');
  const c = loadConfig({ NODE_ENV: 'production' });
  assert.ok(c.missing.includes('DATABASE_URL'));
  assert.ok(c.missing.some((m) => m.startsWith('IP_HASH_SALT')));
  assert.ok(c.missing.some((m) => m.startsWith('CRON_SECRET')));
  assert.equal(c.cookieSecure, true);
  assert.equal(c.autoMigrate, false);
});
