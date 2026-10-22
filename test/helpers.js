'use strict';

// Utilidades de prueba: base temporal, servidor en puerto libre y un cliente
// HTTP con cookies que imita al navegador (JSON + token CSRF).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb, migrate } = require('../src/db');
const { seedReference } = require('../src/db/reference');
const { seedCatalog } = require('../src/services/seed');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { createUser } = require('../src/services/auth');

// spanishOnly: false reactiva el inglés para las pruebas del motor multilingüe;
// en producción solo está activo el español (migración 006).
async function makeEnv({ catalog = true, spanishOnly = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cripta-test-'));
  const db = openDb({ url: 'file:' + path.join(dir, 'test.db') });
  await migrate(db);
  await seedReference(db);
  if (!spanishOnly) await db.run("UPDATE languages SET enabled = 1 WHERE code = 'en'");
  if (catalog) await seedCatalog(db);
  const config = { ...loadConfig({ NODE_ENV: 'test' }), siteUrl: 'http://localhost', cronSecret: 'test-cron-secret-123456', ipHashSalt: 'salt-for-tests' };
  const app = createApp({ db, config });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db, app, base, config, dir,
    async close() { await new Promise((r) => server.close(r)); db.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

function client(base) {
  const jar = {};
  let csrf = null;
  async function req(method, url, body, headers = {}) {
    const h = { ...headers };
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    if (body !== undefined) { h['content-type'] = h['content-type'] || 'application/json'; }
    if (csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = csrf;
    const init = { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' };
    let res;
    try { res = await fetch(base + url, init); } catch (e) {
      // Una conexión reutilizada que el servidor cerró por inactividad (keep-alive)
      // falla antes de enviar la petición: se reintenta una vez con una conexión nueva.
      if (!/other side closed|ECONNRESET|socket/i.test(String((e.cause && (e.cause.code || e.cause.message)) || ''))) throw e;
      res = await fetch(base + url, init);
    }
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair] = sc.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i); const v = pair.slice(i + 1);
      if (/Max-Age=0/.test(sc)) delete jar[k]; else jar[k] = v;
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
    if (json && json.csrf) csrf = json.csrf;
    return { status: res.status, json, text, headers: res.headers };
  }
  return {
    jar,
    get: (u, h) => req('GET', u, undefined, h),
    post: (u, b = {}, h) => req('POST', u, b, h),
    put: (u, b = {}, h) => req('PUT', u, b, h),
    patch: (u, b = {}, h) => req('PATCH', u, b, h),
    del: (u, b = {}, h) => req('DELETE', u, b, h),
    setCsrf: (v) => { csrf = v; },
  };
}

async function staff(env, role, username) {
  const name = username || `${role}_${Math.random().toString(36).slice(2, 8)}`;
  const password = 'Contraseña-segura-' + Math.random().toString(36).slice(2);
  const user = await createUser(env.db, { username: name, password, role });
  const c = client(env.base);
  const r = await c.post('/api/auth/login', { username: name, password, admin: role !== 'player' });
  if (r.status !== 200) throw new Error('login failed ' + r.text);
  return { c, user, password, username: name };
}

module.exports = { makeEnv, client, staff };
