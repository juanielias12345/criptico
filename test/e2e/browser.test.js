'use strict';

// Pruebas en un navegador real (Chromium sin interfaz) contra un servidor con
// base temporal. Usa el Chromium ya instalado; no descarga navegadores.
// Variable opcional: CHROMIUM_PATH.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { makeEnv, staff } = require('../helpers');

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const candidates = ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

let env; let browser;
const exe = findChromium();
test.before(async () => {
  env = await makeEnv();
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
});
test.after(async () => { if (browser) await browser.close(); if (env) await env.close(); });

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ locale: 'es-AR', ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { ctx, page, errors };
}

async function choose(dialog, pickerIndex, search, value) {
  const picker = dialog.locator('.picker').nth(pickerIndex);
  await picker.locator('.picker-toggle').click();
  await picker.locator('input[type=search]').fill(search);
  await picker.locator(`.opt[data-value="${value}"]`).click();
  // Al elegir, la lista se cierra y el botón muestra la elección.
  assert.equal(await picker.locator('.picker-pop').isHidden(), true);
  assert.equal(await picker.locator('.picker-toggle').getAttribute('aria-expanded'), 'false');
}

test('primera visita: diálogo con detección; país e idioma son independientes y se recuerdan', async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(env.base + '/es/jugar');
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor();
  assert.match(await dialog.textContent(), /Argentina/, 'sugiere el país del navegador');
  assert.equal(await dialog.locator('.picker').nth(1).locator('[aria-selected="true"]').getAttribute('data-value'), 'es-AR');

  // Cambiar el país no cambia el idioma.
  await choose(dialog, 0, 'japon', 'JP');
  assert.equal(await dialog.locator('.picker').nth(1).locator('[aria-selected="true"]').getAttribute('data-value'), 'es-AR');
  // Cambiar el idioma no cambia el país.
  await choose(dialog, 1, 'españa', 'es-ES');
  assert.equal(await dialog.locator('.picker').nth(0).locator('[aria-selected="true"]').getAttribute('data-value'), 'JP');
  await page.click('#prefs-save');
  await page.locator('#clue-text').waitFor();

  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('cripta.prefs')));
  assert.equal(prefs.country, 'JP');
  assert.equal(prefs.choice, 'es-ES');
  assert.match(await page.textContent('#prefs-label'), /JP/);

  // Al volver no se pregunta de nuevo.
  await page.reload();
  await page.locator('#clue-text').waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('sin consentimiento para recordar, la preferencia dura solo la sesión', async () => {
  const { ctx, page } = await newPage();
  await page.goto(env.base + '/es/jugar');
  await page.locator('dialog[open]').waitFor();
  await page.uncheck('#pref-remember');
  await page.click('#prefs-save');
  await page.locator('#clue-text').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('cripta.prefs')), null);
  assert.ok(await page.evaluate(() => sessionStorage.getItem('cripta.prefs')));
  await ctx.close();
});

async function playReady(page, choice = 'es') {
  await page.addInitScript((c) => { localStorage.setItem('cripta.prefs', JSON.stringify({ country: 'AR', choice: c, remember: true })); }, choice);
}

test('jugar: respuesta incorrecta, pista, respuesta correcta, explicación y siguiente', async () => {
  const { ctx, page, errors } = await newPage();
  await playReady(page);
  const started = page.waitForResponse((r) => r.url().endsWith('/api/game/start'));
  await page.goto(env.base + '/es/jugar');
  const data = await (await started).json();
  const row = await env.db.get('SELECT answer FROM clues WHERE id = ?', [data.clue.id]);
  await page.locator('#clue-text').waitFor();

  await page.fill('#answer', 'ZZZZ');
  await page.click('#check-btn');
  await page.locator('#feedback.bad, #feedback.warn').waitFor();

  await page.click('#hint-btn');
  await page.locator('.hints li').first().waitFor();

  await page.fill('#answer', row.answer.toLowerCase());
  await page.click('#check-btn');
  await page.locator('#solution-answer').waitFor();
  assert.equal((await page.textContent('#solution-answer')).trim(), row.answer);
  assert.ok(await page.locator('#explanation li').count() >= 1, 'muestra la explicación');

  const next = page.waitForResponse((r) => r.url().endsWith('/api/game/start'));
  await page.click('#next-btn');
  const second = await (await next).json();
  assert.notEqual(second.clue.id, data.clue.id, 'el siguiente es otro críptico');
  await page.locator('#answer').waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('revelar muestra solución y explicación; compartir no revela la respuesta', async () => {
  const { ctx, page } = await newPage({ permissions: ['clipboard-read', 'clipboard-write'] });
  await playReady(page, 'es');
  const started = page.waitForResponse((r) => r.url().endsWith('/api/game/start'));
  await page.goto(env.base + '/es/jugar');
  const data = await (await started).json();
  assert.equal(data.clue.language, 'es');
  await page.locator('#reveal-btn').click();
  await page.locator('#solution-answer').waitFor();
  const row = await env.db.get('SELECT answer FROM clues WHERE id = ?', [data.clue.id]);
  assert.equal((await page.textContent('#solution-answer')).trim(), row.answer);
  await page.evaluate(() => { navigator.share = undefined; });
  await page.click('#share-btn');
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert.ok(copied, 'se copió el texto para compartir');
  // La pista misma puede contener la respuesta (palabra oculta); lo que no debe aparecer es la solución fuera de ella.
  const rest = copied.replace(data.clue.clue, '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  assert.ok(!rest.includes(row.answer.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')), 'ni el texto ni el enlace revelan la respuesta: ' + copied);
  await ctx.close();
});

test('un error de conexión no borra la respuesta escrita', async () => {
  const { ctx, page } = await newPage();
  await playReady(page);
  await page.goto(env.base + '/es/jugar');
  await page.locator('#clue-text').waitFor();
  await page.route('**/guess', (r) => r.abort('internetdisconnected'));
  await page.fill('#answer', 'MIRESPUESTA');
  await page.click('#check-btn');
  await page.locator('#feedback.error').waitFor();
  assert.equal(await page.inputValue('#answer'), 'MIRESPUESTA');
  await page.unroute('**/guess');
  await page.click('#check-btn');
  await page.locator('#feedback.bad, #feedback.warn').waitFor();
  await ctx.close();
});

test('ejemplos interactivos de la portada y de las lecciones', async () => {
  const { ctx, page, errors } = await newPage();
  await playReady(page);
  await page.goto(env.base + '/es');
  const box = page.locator('.try').first();
  await box.locator('input').fill('lobo');
  await box.locator('button[type=submit]').click();
  await box.locator('.feedback').filter({ hasText: /./ }).waitFor();
  assert.ok(!(await box.getAttribute('class')).includes('solved'));
  await box.locator('input').fill('oso');
  await box.locator('button[type=submit]').click();
  await page.locator('.try.solved').first().waitFor();
  await page.goto(env.base + '/es/ayuda');
  assert.equal(await page.locator('.lesson').count(), 7);
  const first = page.locator('.lesson .try').first();
  await first.locator('input').fill('amor');
  await first.locator('button[type=submit]').click();
  await page.locator('.lesson .try.solved').first().waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('todas las páginas cargan sin errores en tema claro y oscuro', async () => {
  for (const colorScheme of ['light', 'dark']) {
    const { ctx, page, errors } = await newPage({ colorScheme });
    await playReady(page);
    for (const path of ['/es', '/es/jugar', '/es/diario', '/es/archivo', '/es/archivo?mech=anagrama', '/es/contribuir', '/es/propuesta', '/es/ayuda', '/es/perfil', '/es/cuenta', '/es/privacidad', '/en', '/en/play', '/en/archive', '/en/help', '/admin']) {
      const r = await page.goto(env.base + path);
      assert.equal(r.status(), 200, path);
      await page.waitForLoadState('networkidle');
    }
    assert.deepEqual(errors, [], colorScheme);
    await ctx.close();
  }
});

test('móvil: sin desplazamiento horizontal en las páginas principales', async () => {
  const { ctx, page } = await newPage({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await playReady(page);
  for (const path of ['/es', '/es/jugar', '/es/diario', '/es/archivo', '/es/contribuir', '/es/ayuda', '/en/play']) {
    await page.goto(env.base + path);
    await page.waitForLoadState('networkidle');
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert.ok(sw <= cw + 1, `${path}: ancho ${sw} > ${cw}`);
  }
  await ctx.close();
});

test('proponer un críptico y aprobarlo desde el panel', async () => {
  const { ctx, page, errors } = await newPage();
  await playReady(page);
  await page.goto(env.base + '/es/contribuir');
  await page.fill('#f-clue', 'Raso movido para atreverse (4)');
  await page.fill('#f-answer', 'OSAR');
  await page.fill('#f-definition', 'atreverse');
  await page.fill('#f-explanation', 'Anagrama de RASO ("movido") da OSAR, que significa atreverse.');
  await page.check('#f-rights');
  await page.check('#f-terms');
  // El formulario exige unos segundos de uso antes de enviar (antispam).
  await page.waitForTimeout(5500);
  await page.click('#f-send');
  await page.locator('#tracking-code').waitFor();
  const code = (await page.textContent('#tracking-code')).trim();
  assert.ok(code.length > 16);
  assert.equal(await env.db.get("SELECT id FROM clues WHERE answer = 'OSAR' AND origin = 'community'"), null, 'no se publica sola');

  // Panel: un moderador entra y aprueba.
  const mod = await staff(env, 'moderator');
  const admin = await ctx.newPage();
  await admin.goto(env.base + '/admin');
  await admin.fill('#a-user', mod.username);
  await admin.fill('#a-pass', mod.password);
  await admin.click('#admin-login button[type=submit]');
  await admin.locator('#logout').waitFor({ state: 'visible' });
  const sub = await env.db.get("SELECT id FROM submissions WHERE answer = 'OSAR' ORDER BY created_at DESC");
  await admin.goto(env.base + '/admin#submission/' + sub.id);
  await admin.getByRole('button', { name: 'Aprobar y publicar' }).click();
  await waitFor(async () => (await env.db.get('SELECT status FROM submissions WHERE id = ?', [sub.id])).status === 'published');
  const clue = await env.db.get("SELECT status, origin FROM clues WHERE answer = 'OSAR' AND origin = 'community'");
  assert.equal(clue.status, 'published');

  // El autor ve el nuevo estado con su código.
  await page.goto(env.base + '/es/propuesta?code=' + encodeURIComponent(code));
  await page.locator('#status-pill').waitFor();
  assert.ok((await page.getAttribute('#status-pill', 'class')).includes('published'));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('panel sin sesión muestra el acceso y no datos', async () => {
  const { ctx, page } = await newPage();
  await page.goto(env.base + '/admin');
  await page.locator('#admin-login').waitFor();
  assert.equal(await page.locator('table').count(), 0);
  await ctx.close();
});

async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timeout');
}

// #18: el centro de control carga en escritorio y en móvil, con datos reales y sin errores.
async function adminLogin(page, who) {
  await page.goto(env.base + '/admin');
  await page.fill('#a-user', who.username);
  await page.fill('#a-pass', who.password);
  await page.click('#admin-login button[type=submit]');
  await page.locator('#logout').waitFor({ state: 'visible' });
}

test('#18 panel de administración en escritorio y móvil', async () => {
  const { client } = require('../helpers');
  const c = client(env.base);
  const reg = await c.post('/api/auth/register', { username: 'panel' + Date.now().toString(36), password: 'Una-clave-de-prueba-9', email: 'panel@example.com' });
  assert.equal(reg.status, 201);
  const s = await c.post('/api/game/start', { choice: 'es-AR', country: 'AR' });
  const ans = (await env.db.get('SELECT c.answer FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.id = ?', [s.json.game_id])).answer;
  await c.post(`/api/game/${s.json.game_id}/guess`, { answer: ans });
  const owner = await staff(env, 'owner');
  const views = ['dashboard', 'alerts', 'geo', 'funnel', 'cluestats', 'exports', 'players', 'player/' + reg.json.user.id, 'player/' + reg.json.user.id + '?tab=games',
    'player/' + reg.json.user.id + '?tab=performance', 'games', 'game/' + s.json.game_id, 'privacy', 'catstats', 'importstats', 'catalog', 'submissions', 'users', 'bank', 'bankaudit',
    ...['direction', 'agents', 'tech', 'marketing', 'legal', 'community', 'apps', 'audit', 'integrations', 'risks'].map((t) => 'company?tab=' + t),
    'agent/editorial', 'approvals', 'tasks', 'task/T-001', 'content', 'piece/new', 'legal', 'legaldoc/terms/1/es', 'jurisdiction/AR', 'security'];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    const { ctx, page, errors } = await newPage({ viewport });
    await adminLogin(page, owner);
    for (const v of views) {
      await page.goto(env.base + '/admin#' + v);
      await page.waitForFunction(() => !document.querySelector('#admin-main .flash.bad') && document.querySelector('#admin-main h1'));
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `${v} desborda ${overflow}px a ${viewport.width}px`);
      assert.equal(await page.locator('#admin-main .flash.bad').count(), 0, v);
    }
    // Resumen con datos reales: la partida resuelta aparece.
    await page.goto(env.base + '/admin#dashboard');
    await page.locator('.card:has-text("Resueltas correctamente") b').waitFor();
    assert.ok(Number(await page.textContent('.card:has-text("Resueltas correctamente") b')) >= 1);
    if (viewport.width < 800) {
      assert.equal(await page.locator('#admin-nav').isVisible(), false, 'el menú arranca plegado en móvil');
      await page.click('#nav-toggle');
      assert.equal(await page.locator('#admin-nav').isVisible(), true);
    }
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('panel: el rol analista no ve correos ni acciones', async () => {
  const analyst = await staff(env, 'analyst');
  const { ctx, page, errors } = await newPage();
  await adminLogin(page, analyst);
  assert.equal(await page.locator('#admin-nav a[href="#users"]').isVisible(), false);
  assert.equal(await page.locator('#admin-nav a[href="#privacy"]').isVisible(), false);
  await page.goto(env.base + '/admin#players');
  await page.waitForLoadState('networkidle');
  await page.locator('#admin-main tbody a').first().waitFor();
  assert.equal(await page.locator('#admin-main th:has-text("Correo")').count(), 0);
  await page.locator('#admin-main tbody a').first().click();
  await page.locator('.tabs').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Suspender' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Eliminar datos personales' }).count(), 0);
  assert.equal(await page.locator('text=@example.com').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('#13 perfil personal en escritorio y móvil: pestañas, detalle de partida, compartir y vincular con permiso', async () => {
  for (const viewport of [{ width: 1366, height: 860 }, { width: 360, height: 740 }]) {
    const { ctx, page, errors } = await newPage({ viewport });
    await playReady(page);
    // Juega sin cuenta: una incorrecta, una pista y la correcta.
    const started = page.waitForResponse((r) => r.url().endsWith('/api/game/start'));
    await page.goto(env.base + '/es/jugar');
    const data = await (await started).json();
    const row = await env.db.get('SELECT answer FROM clues WHERE id = ?', [data.clue.id]);
    await page.fill('#answer', 'ZZZZ'); await page.click('#check-btn');
    await page.locator('#feedback.bad, #feedback.warn').waitFor();
    await page.click('#hint-btn'); await page.locator('.hints li').first().waitFor();
    await page.fill('#answer', row.answer); await page.click('#check-btn');
    await page.locator('#solution-answer').waitFor();
    await page.locator('.toast:has-text("Logro nuevo")').waitFor();
    // Perfil sin cuenta: muestra la partida real.
    await page.goto(env.base + '/es/perfil');
    await page.locator('.kpi[data-k="unique_solved"] .kpi-value').waitFor();
    assert.equal((await page.textContent('.kpi[data-k="unique_solved"] .kpi-value')).trim(), '1');
    assert.equal((await page.textContent('.kpi[data-k="hints"] .kpi-value')).trim(), '1');
    // Cada indicador tiene su definición.
    await page.locator('.kpi[data-k="solve_rate"] .def summary').click();
    assert.match(await page.textContent('.kpi[data-k="solve_rate"] .def p'), /cerradas/);
    await page.goto(env.base + '/es/perfil#history');
    await page.locator('.pf-table.history tbody tr').first().waitFor();
    assert.equal(await page.locator('.pf-table.history tbody tr').count(), 1);
    await page.locator('.pf-table.history tbody a.btn').first().click();
    await page.locator('.pf-detail').waitFor();
    assert.equal(await page.locator('.attempts:not(.hints) li').count(), 2, 'dos respuestas: incorrecta y correcta');
    assert.equal(await page.locator('.attempts.hints li').count(), 1);
    assert.equal((await page.textContent('.pf-answer b')).trim(), row.answer);
    // Compartir: el enlace muestra la tarjeta sin la respuesta.
    await page.click('#share-create');
    const url = await page.locator('#share-url').inputValue();
    const card = await ctx.newPage();
    await card.goto(url);
    await card.locator('.share-card').waitFor();
    assert.equal(await card.locator(`text=${row.answer}`).count(), 0, 'sin la respuesta salvo que se elija');
    await card.close();
    for (const tab of ['progress', 'strengths', 'achievements', 'records', 'leaderboard', 'goals', 'library', 'settings']) {
      await page.goto(env.base + '/es/perfil#' + tab);
      await page.locator('#pf-' + tab).waitFor();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('#pf-' + tab + ' .notice.error').count(), 0, tab);
      assert.equal(await page.locator('#pf-' + tab + ' >> text=null').count(), 0, tab + ': sin «null» suelto');
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(sw <= cw + 1, `${tab}: ancho ${sw} > ${cw}`);
    }
    await page.goto(env.base + '/es/perfil#goals');
    await page.locator('#pf-goals .empty').waitFor(); // objetivos piden cuenta
    // Crear cuenta: se ofrece sumar las partidas, no se suman solas.
    const username = 'e2e' + Math.random().toString(36).slice(2, 8);
    await page.goto(env.base + '/es/cuenta');
    await page.fill('#register-form [name=username]', username);
    await page.fill('#register-form [name=password]', 'Una-clave-de-prueba-9');
    await env.db.run("DELETE FROM rate_limits WHERE bucket LIKE 'register:%'");
    await page.click('#register-form button[type=submit]');
    await page.waitForURL(/\/es\/perfil/);
    await page.locator('#link-yes').waitFor();
    const u = await env.db.get('SELECT id FROM users WHERE username = ?', [username]);
    assert.equal((await env.db.get('SELECT COUNT(*) AS n FROM players WHERE user_id = ?', [u.id])).n, 0, 'todavía no se unieron');
    await page.click('#link-yes');
    await page.locator('.kpi[data-k="unique_solved"] .kpi-value').waitFor();
    assert.equal((await page.textContent('.kpi[data-k="unique_solved"] .kpi-value')).trim(), '1');
    // Ajustes: perfil público privado por defecto; al activarlo se ve solo lo elegido.
    await page.goto(env.base + '/es/perfil#settings');
    await page.locator('#public-on').waitFor();
    assert.equal(await page.isChecked('#public-on'), false);
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/me/profile') && r.request().method() === 'PUT');
    await page.check('#public-on'); await saved;
    const pub = await ctx.newPage();
    await pub.goto(env.base + '/es/u/' + username);
    await pub.locator('.pub-profile h1').waitFor();
    assert.equal(await pub.locator('.pf-quick').count(), 0, 'sin datos elegidos no muestra estadísticas');
    await pub.close();
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('práctica dirigida desde una recomendación: el críptico es del mecanismo pedido', async () => {
  const { ctx, page, errors } = await newPage();
  await playReady(page);
  const started = page.waitForResponse((r) => r.url().endsWith('/api/game/start'));
  await page.goto(env.base + '/es/jugar?mechanism=anagram');
  const data = await (await started).json();
  await page.locator('#practice-focus').waitFor();
  const c = await env.db.get('SELECT mechanism FROM clues WHERE id = ?', [data.clue.id]);
  assert.equal(c.mechanism, 'anagram');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('banco: generar un lote desde la matriz, verlo en la base y jugar un críptico generado', async () => {
  const owner = await staff(env, 'owner');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    const { ctx, page, errors } = await newPage({ viewport });
    await adminLogin(page, owner);
    await page.goto(env.base + '/admin#bank');
    await page.locator('.bank-matrix').waitFor();
    assert.ok(await page.locator('.bank-cell').count() >= 10, 'matriz de idiomas por dificultades');
    if (viewport.width > 800) {
      await page.locator('.bank-cell[aria-label^="es dificultad 2"]').click();
      await page.getByRole('button', { name: 'Generar un lote corto' }).click();
      await page.locator('.flash:has-text("verificado en base")').waitFor({ timeout: 60000 });
      const n = await env.db.get("SELECT count(*) n FROM clues WHERE origin = 'generated' AND status = 'published' AND language_code = 'es' AND difficulty = 2");
      assert.ok(n.n > 0, 'los publicados existen en la base');
      await page.goto(env.base + '/admin#bank?lang=es&difficulty=2');
      await page.locator('.bank-cell[aria-label^="es dificultad 2"]').waitFor();
      const label = await page.locator('.bank-cell[aria-label^="es dificultad 2"]').getAttribute('aria-label');
      const all = await env.db.get("SELECT count(*) n FROM clues WHERE status = 'published' AND language_code = 'es' AND difficulty = 2");
      assert.equal(Number(label.match(/: (\d+) de/)[1]), all.n, 'la matriz muestra lo que hay en la base');
      await page.goto(env.base + '/admin#bankaudit');
      await page.locator('#admin-main h1:has-text("Auditoría")').waitFor();
      assert.ok(await page.getByRole('button', { name: 'Correcto' }).count() >= 1, 'el lote separó una muestra para auditar');
    }
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `banco desborda ${overflow}px`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
  // Partida con un críptico generado: indicador en la pista y atribución en la solución.
  const others = await env.db.all("SELECT id FROM clues WHERE status = 'published' AND language_code = 'es' AND origin <> 'generated'");
  await env.db.run("UPDATE clues SET status = 'disabled' WHERE status = 'published' AND language_code = 'es' AND origin <> 'generated'");
  try {
    const { ctx, page, errors } = await newPage();
    await playReady(page);
    const started = page.waitForResponse((r) => r.url().endsWith('/api/game/start'));
    await page.goto(env.base + '/es/jugar');
    const data = await (await started).json();
    const row = await env.db.get('SELECT answer, origin FROM clues WHERE id = ?', [data.clue.id]);
    assert.equal(row.origin, 'generated');
    await page.locator('#clue-text').waitFor();
    for (let k = 0; k < 2; k++) { await page.click('#hint-btn'); await page.locator('.hints li').nth(k).waitFor(); }
    await page.fill('#answer', row.answer.toLowerCase());
    await page.click('#check-btn');
    await page.locator('#solution-answer').waitFor();
    assert.ok(await page.locator('#explanation li').count() >= 1);
    await page.locator('.attribution a[href$="/creditos"]').waitFor();
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    for (const o of others) await env.db.run("UPDATE clues SET status = 'published' WHERE id = ?", [o.id]);
  }
});

test('el menú desplegable lleva a «Mi perfil» en móvil y escritorio', async () => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
    const { ctx, page, errors } = await newPage({ viewport });
    await playReady(page);
    await page.goto(env.base + '/es/ayuda');
    if (viewport.width < 800) await page.click('.nav-toggle');
    const link = page.locator('#nav-links a[href="/es/perfil"]');
    assert.equal(await link.isVisible(), true);
    await link.click();
    await page.waitForURL(/\/es\/perfil/);
    assert.equal(await page.locator('#nav-links a[href="/es/perfil"]').getAttribute('aria-current'), 'page');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `desborda ${overflow}px`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

test('empresa: invitar a un CEO, aceptar, activar MFA y entrar con código', async () => {
  const { totp } = require('../../src/services/security');
  const owner = await staff(env, 'owner');
  const { ctx, page, errors } = await newPage();
  await adminLogin(page, owner);
  await page.goto(env.base + '/admin#users');
  await page.selectOption('#inv-role', 'owner');
  await page.fill('#inv-name', 'Inés de Prueba');
  await page.fill('#inv-title', 'CEO y Súper Administradora');
  await page.getByRole('button', { name: 'Generar invitación' }).click();
  const link = await page.locator('#invite-result .copy-input').inputValue();
  assert.match(link, /\/admin#invite\?token=/);
  await ctx.close();

  // La persona invitada abre el enlace sin sesión y elige su contraseña.
  const b = await newPage();
  const password = 'Clave-de-la-ceo-2026';
  const username = 'ceo' + Date.now().toString(36);
  await b.page.goto(link);
  await b.page.locator('#invite-form').waitFor();
  await b.page.fill('#i-user', username);
  await b.page.fill('#i-pass', password);
  await b.page.fill('#i-pass2', password);
  await b.page.click('#invite-form button[type=submit]');
  await b.page.locator('.login-box h1:has-text("Listo")').waitFor();
  const row = await env.db.get('SELECT role, title FROM users WHERE username = ?', [username]);
  assert.deepEqual({ ...row }, { role: 'owner', title: 'CEO y Súper Administradora' });

  // Activa la verificación en dos pasos.
  await adminLogin(b.page, { username, password });
  await b.page.goto(env.base + '/admin#security');
  await b.page.getByRole('button', { name: 'Configurar' }).click();
  const secret = (await b.page.textContent('#mfa-secret')).replace(/\s/g, '');
  await b.page.fill('#mfa-code', totp(secret));
  await b.page.getByRole('button', { name: 'Activar' }).click();
  await b.page.locator('#recovery-codes li').nth(7).waitFor();

  // Al volver a entrar, el panel pide el código.
  await b.page.click('#logout');
  await b.page.locator('#admin-login').waitFor();
  await b.page.fill('#a-user', username);
  await b.page.fill('#a-pass', password);
  await b.page.click('#admin-login button[type=submit]');
  await b.page.locator('#a-code').waitFor({ state: 'visible' });
  // El código de 30 s ya se usó al activar: se espera al siguiente intervalo si hace falta.
  await b.page.fill('#a-code', totp(secret, Date.now() + 30000));
  await b.page.click('#admin-login button[type=submit]');
  await b.page.locator('#logout').waitFor({ state: 'visible' });
  assert.equal(await b.page.locator('#admin-nav a[href="#approvals"]').isVisible(), true);
  assert.deepEqual(b.errors.filter((e) => !/401/.test(e)), []);
  await b.ctx.close();
});

test('redes: un botón arriba aprueba toda la semana; desde un día también se aprueba su semana', async () => {
  const owner = await staff(env, 'owner');
  const { ctx, page, errors } = await newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await adminLogin(page, owner);
    await page.goto(env.base + '/admin#social');
    const top = page.locator('#admin-main > .toolbar button', { hasText: 'Aprobar toda la semana 1' });
    await top.waitFor();
    await top.click();
    await page.locator('#admin-main .flash', { hasText: 'Aprobadas:' }).waitFor({ timeout: 60000 });
    const w1 = await env.db.get("SELECT COUNT(*) AS n FROM content_pieces WHERE campaign = 'lanzamiento-60' AND day BETWEEN 0 AND 6 AND status = 'approved'");
    const all = await env.db.get("SELECT COUNT(*) AS n FROM content_pieces WHERE campaign = 'lanzamiento-60' AND day BETWEEN 0 AND 6 AND platform IN ('instagram','facebook','tiktok','youtube')");
    assert.equal(w1.n, all.n);
    await page.locator('#admin-main > .toolbar button', { hasText: 'Aprobar toda la semana 2' }).waitFor();
    // Desde la carpeta de un día de la semana 3.
    await page.goto(env.base + '/admin#socialday/15');
    await page.locator('button', { hasText: 'Aprobar toda la semana 3' }).click();
    await page.locator('#admin-main .flash', { hasText: 'Semana 3: aprobadas' }).waitFor({ timeout: 60000 });
    const w3 = await env.db.get("SELECT COUNT(*) AS n FROM content_pieces WHERE campaign = 'lanzamiento-60' AND day BETWEEN 14 AND 20 AND status = 'approved'");
    assert.ok(w3.n > 0);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
