'use strict';

// Graba el producto real (servidor local con la base de demostración) en pantalla de
// teléfono para los videos de la campaña de 21 días. Cada recorrido deja un .webm en OUT.
//   BASE=http://localhost:3077 DB=file:/tmp/pc-demo.db node scripts/social/campana/grabar.js jugar diario ...

const fs = require('fs');
const path = require('path');
// Grabar video necesita el ffmpeg de Playwright; PLAYWRIGHT permite usar otra instalación.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright-core');
const { createClient } = require('@libsql/client');

const BASE = process.env.BASE || 'http://localhost:3077';
const OUT = process.env.OUT || '/tmp/campana-grabaciones';
const db = createClient({ url: process.env.DB || 'file:/tmp/pc-demo.db' });
const VW = 390; const VH = 780;

// Un punto que marca cada toque, para que se entienda qué se aprieta.
const TAPS = () => {
  addEventListener('pointerdown', (e) => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(194,52,27,.35);border:2px solid #c2341b;z-index:99999;pointer-events:none;transition:transform .5s,opacity .5s`;
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'scale(1.6)'; d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 600);
  }, true);
};

async function context(browser, name, { user } = {}) {
  const ctx = await browser.newContext({ locale: 'es-AR', viewport: { width: VW, height: VH }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: false, recordVideo: { dir: path.join(OUT, name + '-raw'), size: { width: VW * 2, height: VH * 2 } } });
  await ctx.addInitScript(() => { localStorage.setItem('cripta.prefs', JSON.stringify({ country: 'AR', choice: 'es', remember: true })); });
  await ctx.addInitScript(TAPS);
  if (user) {
    const r = await ctx.request.post(BASE + '/api/auth/register', { data: { username: user, password: 'demo-demo-1234', accept: true } });
    if (!r.ok()) await ctx.request.post(BASE + '/api/auth/login', { data: { username: user, password: 'demo-demo-1234' } });
  }
  return ctx;
}
const pause = (p, ms) => p.waitForTimeout(ms);
const answerOf = async (id) => (await db.execute({ sql: 'SELECT answer FROM clues WHERE id = ?', args: [id] })).rows[0].answer;
async function typeSlow(p, sel, text) { await p.click(sel); await p.fill(sel, ''); await p.type(sel, text, { delay: 140 }); }
async function smoothScroll(p, y, ms = 900) {
  await p.evaluate(([y, ms]) => new Promise((ok) => { const s = scrollY; const t0 = performance.now();
    const f = (t) => { const k = Math.min(1, (t - t0) / ms); scrollTo(0, s + (y - s) * (1 - Math.cos(Math.PI * k)) / 2); k < 1 ? requestAnimationFrame(f) : ok(); }; requestAnimationFrame(f); }), [y, ms]);
}
async function scrollTo(p, sel, offset = 120) {
  const y = await p.evaluate(([s, o]) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + scrollY - o : scrollY; }, [sel, offset]);
  await smoothScroll(p, y);
}

// Juega un críptico entero: intento errado, pista y acierto.
// «go» es una URL o una función que lleva a la partida (por ejemplo, tocar «Jugar ahora»).
async function playOne(p, go, { wrong = true } = {}) {
  const started = p.waitForResponse((r) => /\/api\/(game|daily|plus\/daily)\/start$/.test(r.url()));
  if (typeof go === 'string') await p.goto(BASE + go); else await go();
  const data = await (await started).json();
  const answer = await answerOf(data.clue.id);
  await p.locator('#clue-text').waitFor();
  await pause(p, 1600);
  await scrollTo(p, '#clue-text', 140);
  await pause(p, 1400);
  if (wrong) {
    const bad = [...answer].reverse().join('');
    await typeSlow(p, '#answer', bad === answer ? 'CASA' : bad);
    await p.click('#check-btn');
    await pause(p, 1500);
    await p.click('#hint-btn');
    await p.locator('.hints li').first().waitFor();
    await pause(p, 2200);
  }
  await typeSlow(p, '#answer', answer.toLowerCase());
  await p.click('#check-btn');
  await p.locator('#solution-answer').waitFor();
  await pause(p, 1200);
  await scrollTo(p, '#solution-answer', 160);
  await pause(p, 2600);
  return answer;
}

// Ronda de torneo o duelo: tocar «Jugar», resolver y ver los puntos.
async function arenaRound(p, button) {
  const started = p.waitForResponse((r) => /\/rounds\/\d+\/start$/.test(r.url()));
  await button.scrollIntoViewIfNeeded(); await pause(p, 700); await button.click();
  const data = await (await started).json();
  const answer = await answerOf(data.clue.id);
  const input = p.locator('input[placeholder="Tu respuesta"]');
  await input.waitFor(); await scrollTo(p, '#round-t', 100); await pause(p, 2200);
  await input.click(); await input.type(answer.toLowerCase(), { delay: 150 });
  await pause(p, 300); await p.getByRole('button', { name: 'Comprobar' }).click();
  await p.locator('.round-result').waitFor(); await pause(p, 800);
  await scrollTo(p, '.round-result', 120); await pause(p, 3000);
}

const FLOWS = {
  // Cómo se juega: entrar, intento, pista, acierto y explicación.
  async jugar(browser) {
    const ctx = await context(browser, 'jugar'); const p = await ctx.newPage();
    await p.goto(BASE + '/es'); await pause(p, 1800);
    await playOne(p, () => p.click('a.btn.primary >> nth=0'));
    await ctx.close();
  },
  async diario(browser) {
    const ctx = await context(browser, 'diario'); const p = await ctx.newPage();
    await playOne(p, '/es/diario', { wrong: false });
    await smoothScroll(p, await p.evaluate(() => document.body.scrollHeight), 2500);
    await pause(p, 2500);
    await ctx.close();
  },
  async torneo(browser) {
    const ctx = await context(browser, 'torneo', { user: process.env.USUARIO || 'lucia_' + Date.now().toString(36) }); const p = await ctx.newPage();
    await p.goto(BASE + '/es/desafios'); await pause(p, 1800);
    const reg = p.getByRole('button', { name: /inscrib/i }).first();
    if (await reg.count()) { await reg.scrollIntoViewIfNeeded(); await pause(p, 800); await reg.click(); await pause(p, 1800); }
    await arenaRound(p, p.locator('.tour-days button').first());
    await ctx.close();
  },
  async duelo(browser) {
    const ctx = await context(browser, 'duelo', { user: 'martin_demo' }); const p = await ctx.newPage();
    await p.goto(BASE + '/es/desafios'); await pause(p, 1200);
    await scrollTo(p, '#duels-t', 90); await pause(p, 1600);
    await p.getByRole('button', { name: 'Crear enlace para cualquiera' }).click();
    await p.locator('#duel-t').waitFor(); await pause(p, 1500);
    await scrollTo(p, '.tour-days', 160); await pause(p, 1200);
    await scrollTo(p, '.share-box, .tour-days', 60); await pause(p, 1800);
    await arenaRound(p, p.locator('.tour-days button').first());
    await ctx.close();
  },
  async perfil(browser) {
    const ctx = await context(browser, 'perfil', { user: 'sofi_demo' });
    // Historial previo: unas partidas resueltas por la API, sin grabar.
    const me = await (await ctx.request.get(BASE + '/api/auth/me')).json();
    const h = { 'x-csrf-token': me.csrf };
    for (let i = 0; i < 6; i++) {
      const g = await (await ctx.request.post(BASE + '/api/game/start', { headers: h, data: { choice: 'es', country: 'AR', mode: 'infinite' } })).json();
      if (!g.clue) break;
      if (i % 3 === 1) await ctx.request.post(BASE + `/api/game/${g.game_id}/hint`, { headers: h, data: { level: 1 } });
      await ctx.request.post(BASE + `/api/game/${g.game_id}/guess`, { headers: h, data: { answer: await answerOf(g.clue.id) } });
    }
    const p = await ctx.newPage();
    await p.goto(BASE + '/es/perfil'); await pause(p, 2500);
    await smoothScroll(p, 650, 2200); await pause(p, 2000);
    const tab = p.getByRole('tab', { name: /logros/i }).first();
    if (await tab.count()) { await scrollTo(p, '[role=tablist]', 90); await pause(p, 600); await tab.click(); await pause(p, 2600); await smoothScroll(p, (await p.evaluate(() => scrollY)) + 600, 2000); await pause(p, 1800); }
    await ctx.close();
  },
  async mecanismos(browser) {
    const ctx = await context(browser, 'mecanismos'); const p = await ctx.newPage();
    await p.goto(BASE + '/es/mecanismos'); await pause(p, 2200);
    await smoothScroll(p, 900, 2200); await pause(p, 1500);
    await ctx.close();
  },
  async plus(browser) {
    const ctx = await context(browser, 'plus'); const p = await ctx.newPage();
    await p.goto(BASE + '/es/plus'); await pause(p, 2500);
    await smoothScroll(p, 1400, 4000); await pause(p, 2500);
    await ctx.close();
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT ? {} : { executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' }) });
  for (const name of process.argv.slice(2)) {
    await FLOWS[name](browser);
    const dir = path.join(OUT, name + '-raw');
    const f = fs.readdirSync(dir).filter((x) => x.endsWith('.webm')).map((x) => path.join(dir, x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    fs.copyFileSync(f, path.join(OUT, name + '.webm'));
    console.log('Grabado:', name);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
