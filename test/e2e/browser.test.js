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
  await picker.locator('input[type=search]').fill(search);
  await picker.locator(`.opt[data-value="${value}"]`).click();
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
  await playReady(page, 'en');
  const started = page.waitForResponse((r) => r.url().endsWith('/api/game/start'));
  await page.goto(env.base + '/en/play');
  const data = await (await started).json();
  assert.equal(data.clue.language, 'en');
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
