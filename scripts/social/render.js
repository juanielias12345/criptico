'use strict';

// Dibuja los archivos del calendario de redes (imágenes PNG y videos MP4)
// siguiendo el manual de marca (docs/MARCA.md). Necesita Chromium (playwright-core)
// y ffmpeg. Los archivos quedan en public/social/ y el plan en data/social/plan.json.
//
//   node scripts/social/render.js              # plan + todos los archivos
//   node scripts/social/render.js --plan-only  # solo el plan
//   node scripts/social/render.js --days 0-6   # solo esos días

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { openDb, migrate } = require('../../src/db');
const { seedReference } = require('../../src/db/reference');
const { seedCatalog } = require('../../src/services/seed');
const { buildPlan, MECH } = require('./plan');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'public');
const F = path.join(ROOT, 'public', 'fonts');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };

const b64 = (f) => fs.readFileSync(path.join(F, f)).toString('base64');
const FONTS = `@font-face{font-family:Fraunces;src:url(data:font/woff2;base64,${b64('fraunces-latin-opsz-normal.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:Fraunces;src:url(data:font/woff2;base64,${b64('fraunces-latin-ext-opsz-normal.woff2')}) format('woff2');font-weight:100 900;unicode-range:U+0100-024F}
@font-face{font-family:Fraunces;font-style:italic;src:url(data:font/woff2;base64,${b64('fraunces-latin-opsz-italic.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:Inst;src:url(data:font/woff2;base64,${b64('instrument-sans-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900}`;

// Tokens del manual de marca.
const C = { paper: '#f4eee2', sheet: '#fbf8f1', ink: '#1a1712', ink2: '#474036', ink3: '#6b6255', accent: '#c2341b', accentInk: '#fff8ee', ok: '#2b654b', okSoft: '#dbe8dc', near: '#8a5c0c', nearSoft: '#f2e3c2', darkInk: '#efe7d6' };
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const MARK = (size = 56) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" fill="${C.accent}"/><path d="M10.5 7.5 25 16 10.5 24.5z" fill="${C.sheet}" stroke="${C.sheet}" stroke-width="1.6" stroke-linejoin="round"/><rect x="12.4" y="14" width="4" height="4" fill="${C.accent}"/></svg>`;

function page(w, h, body, { dark = false } = {}) {
  const bg = dark ? C.ink : C.paper; const fg = dark ? C.darkInk : C.ink;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${FONTS}
*{margin:0;box-sizing:border-box}
body{width:${w}px;height:${h}px;background:${bg};color:${fg};font-family:Inst,Arial,sans-serif;display:flex;flex-direction:column;overflow:hidden}
.top{display:flex;align-items:center;gap:20px;font-size:34px;font-weight:600}
.top b{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:40px}.top b i{color:${dark ? '#f0694c' : C.accent}}
.k{font-size:30px;letter-spacing:.14em;text-transform:uppercase;color:${dark ? '#f0694c' : C.accent};font-weight:700}
h1{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:104px;line-height:1.02;letter-spacing:-.01em;text-wrap:balance}
h1 em{color:${C.accent}}
h2{font-family:Fraunces,Georgia,serif;font-weight:500;font-size:72px;line-height:1.08;text-wrap:balance}
p{font-size:40px;line-height:1.4;color:${dark ? '#cbc1ae' : C.ink2}}
.sheet{background:${C.sheet};border:2px solid ${C.ink};color:${C.ink};padding:56px 52px;font-family:Fraunces,Georgia,serif;font-size:68px;line-height:1.2;text-wrap:balance}
.tiles{display:flex;gap:10px;flex-wrap:nowrap}
.tiles span{border:2px solid ${dark ? C.darkInk : C.ink};background:${C.sheet};color:${C.ink};font-family:Fraunces,Georgia,serif;display:flex;align-items:center;justify-content:center}
.tiles.ok span{background:${C.okSoft};border-color:${C.ok};color:${C.ok}}
.foot{font-size:30px;font-weight:600;display:flex;justify-content:space-between;align-items:center}
.steps{display:flex;flex-direction:column;gap:22px;list-style:none}
.steps.big li{font-size:46px}
.steps li{font-size:38px;line-height:1.35;padding-left:44px;position:relative}
.steps li::before{content:"";position:absolute;left:0;top:18px;width:22px;height:2px;background:currentColor}
.chip{display:inline-block;border:2px solid currentColor;padding:8px 18px;font-size:28px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
</style></head><body>${body}</body></html>`;
}

function tiles(word, { maxW = 904, fill = false, ok = false } = {}) {
  const letters = [...word.normalize('NFC')].filter((ch) => /\p{L}/u.test(ch));
  const n = letters.length; const gap = 10;
  const s = Math.min(104, Math.floor((maxW - gap * (n - 1)) / n));
  return `<div class="tiles${ok ? ' ok' : ''}">${letters.map((ch) => `<span style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.56)}px">${fill ? esc(ch) : ''}</span>`).join('')}</div>`;
}
const top = (dark) => `<div class="top">${MARK(56)}<b><i>Play</i> Crípticos</b></div>`;
const foot = (right = '') => `<div class="foot"><span>playcripticos.com</span><span>${right}</span></div>`;
const clueSize = (t) => (t.length > 70 ? 54 : t.length > 52 ? 60 : 68);

// ── Plantillas ──
const T = {
  clue: (r) => page(1080, 1350, `<div style="padding:96px 88px;display:flex;flex-direction:column;height:100%;gap:0">
    ${top()}<div class="k" style="margin-top:84px">${esc(r.label)}</div>
    <div class="sheet" style="margin-top:36px;font-size:${clueSize(r.clue.clue_text)}px">${esc(r.clue.clue_text)}</div>
    <div style="margin-top:48px">${tiles(r.clue.answer)}</div>
    <div style="margin-top:64px;background:${C.nearSoft};color:${C.near};padding:32px 36px;font-size:34px;line-height:1.4"><b>Cómo se juega:</b> una parte de la frase define la palabra; la otra la arma con un juego de letras.</div>
    <p style="margin-top:auto">¿La sacás? La solución sale a las 21 h.</p>
    <div style="margin-top:40px">${foot('@playcripticos')}</div></div>`),
  solution: (r) => page(1080, 1920, `<div style="padding:180px 88px 270px;display:flex;flex-direction:column;height:100%">
    ${top(true)}<div class="k" style="margin-top:96px">${esc(r.label)}</div>
    <p style="margin-top:28px;font-family:Fraunces,Georgia,serif;font-size:48px;line-height:1.25;color:#efe7d6">«${esc(r.clue.clue_text)}»</p>
    <div style="margin-top:56px">${tiles(r.clue.answer, { fill: true, ok: true })}</div>
    <ul class="steps" style="margin-top:64px;color:#efe7d6">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    <p style="margin-top:auto">Mañana a las 9, uno nuevo.</p>
    <div style="margin-top:32px;color:#efe7d6">${foot()}</div></div>`, { dark: true }),
  launch: () => page(1080, 1350, `<div style="padding:96px 88px;display:flex;flex-direction:column;height:100%">
    ${top()}<div class="k" style="margin-top:auto">Hoy arranca</div>
    <h1 style="margin-top:28px">Crípticos en español, <em>gratis y sin límite</em></h1>
    <p style="margin-top:36px">Cada pista esconde una palabra. Uno nuevo cada día a las 9 y la solución a las 21.</p>
    <div style="margin-top:56px">${tiles('JUGA', { fill: true })}</div>
    <div style="margin-top:56px">${foot('@playcripticos')}</div></div>`),
  weekend: (r) => page(1080, 1350, `<div style="padding:96px 88px;display:flex;flex-direction:column;height:100%">
    ${top()}<div class="k" style="margin-top:72px">${esc(r.label)}</div>
    ${r.pair.map((c, i) => `<div style="margin-top:${i ? 40 : 32}px"><div class="chip">${i + 1}</div>
      <div class="sheet" style="margin-top:16px;font-size:${Math.min(56, clueSize(c.clue_text) - 6)}px;padding:40px 44px">${esc(c.clue_text)}</div>
      <div style="margin-top:20px">${tiles(c.answer, { maxW: 640 })}</div></div>`).join('')}
    <div style="margin-top:auto">${foot('Soluciones: domingo 12 h')}</div></div>`),
  weekend_solutions: (r) => page(1080, 1350, `<div style="padding:96px 88px;display:flex;flex-direction:column;height:100%">
    ${top()}<div class="k" style="margin-top:72px">${esc(r.label)}</div>
    ${r.pair.map((c, i) => `<div style="margin-top:${i ? 44 : 32}px"><p style="font-family:Fraunces,Georgia,serif;font-size:40px;color:${C.ink}">${i + 1}. «${esc(c.clue_text)}»</p>
      <div style="margin-top:18px">${tiles(c.answer, { maxW: 700, fill: true, ok: true })}</div>
      <p style="margin-top:14px;font-size:32px">${esc(require('./plan').steps(c).join(' '))}</p></div>`).join('')}
    <div style="margin-top:auto">${foot('@playcripticos')}</div></div>`),
};

// Carrusel de lección (6) y «así se resuelve» (5), 1080×1350.
function lessonSlides(r) {
  const m = r.m; const ex = r.ex; const n = (i, k) => `${i}/${k}`;
  const frame = (inner, i, k) => page(1080, 1350, `<div style="padding:96px 88px;display:flex;flex-direction:column;height:100%">${top()}${inner}<div style="margin-top:auto">${foot(n(i, k))}</div></div>`);
  return [
    frame(`<div class="k" style="margin-top:auto">Cómo funciona</div><h1 style="margin-top:28px">${esc(m.name)}</h1><p style="margin-top:36px">${esc(m.what)}</p><div style="margin-top:48px">${tiles(m.name.split(' ')[0], { fill: true, maxW: 760 })}</div>`, 1, 6),
    frame(`<div class="k" style="margin-top:120px">Qué tenés que buscar</div><h2 style="margin-top:28px">Palabras que lo avisan</h2><ul class="steps" style="margin-top:48px">${m.signals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><p style="margin-top:48px">En el críptico, esas palabras se llaman indicadores.</p>`, 2, 6),
    frame(`<div class="k" style="margin-top:120px">Un ejemplo</div><div class="sheet" style="margin-top:36px;font-size:${clueSize(ex.clue_text)}px">${esc(ex.clue_text)}</div><div style="margin-top:44px">${tiles(ex.answer)}</div><p style="margin-top:44px">Pensalo antes de deslizar.</p>`, 3, 6),
    frame(`<div class="k" style="margin-top:120px">Paso a paso</div><ul class="steps" style="margin-top:44px">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`, 4, 6),
    frame(`<div class="k" style="margin-top:120px">Respuesta</div><div style="margin-top:44px">${tiles(ex.answer, { fill: true, ok: true })}</div><p style="margin-top:44px">${esc(ex.definition ? `«${ex.definition}» es la definición; el resto arma la palabra.` : 'Las dos partes de la pista llevan a la misma palabra.')}</p>`, 5, 6),
    frame(`<div class="k" style="margin-top:auto">Ahora vos</div><h2 style="margin-top:28px">Practicá ${esc(m.short)} en playcripticos.com</h2><p style="margin-top:32px">Filtrá el archivo por este tipo de pista y jugá todos los que quieras, gratis.</p>`, 6, 6),
  ];
}
function stepSlides(r) {
  const ex = r.ex; const k = 5;
  const frame = (inner, i) => page(1080, 1350, `<div style="padding:96px 88px;display:flex;flex-direction:column;height:100%">${top()}${inner}<div style="margin-top:auto">${foot(`${i}/${k}`)}</div></div>`);
  const mech = MECH[ex.mechanism] || { name: ex.mechanism, what: '' };
  return [
    frame(`<div class="k" style="margin-top:auto">Así se resuelve</div><div class="sheet" style="margin-top:36px;font-size:${clueSize(ex.clue_text)}px">${esc(ex.clue_text)}</div><div style="margin-top:44px">${tiles(ex.answer)}</div>`, 1),
    frame(`<div class="k" style="margin-top:120px">Primero, la definición</div><h2 style="margin-top:28px">Está al principio o al final de la pista</h2><p style="margin-top:36px">${esc(ex.definition ? `Acá es «${ex.definition}».` : 'En esta, las dos mitades son definiciones.')}</p>`, 2),
    frame(`<div class="k" style="margin-top:120px">Después, el juego</div><h2 style="margin-top:28px">${esc(mech.name)}</h2><p style="margin-top:36px">${esc(mech.what)}</p>`, 3),
    frame(`<div class="k" style="margin-top:120px">Paso a paso</div><ul class="steps" style="margin-top:44px">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`, 4),
    frame(`<div class="k" style="margin-top:120px">Respuesta</div><div style="margin-top:44px">${tiles(ex.answer, { fill: true, ok: true })}</div><p style="margin-top:48px">¿La habías sacado? Hay uno nuevo cada día en playcripticos.com</p>`, 5),
  ];
}

// Video 1080×1920: cuadros fijos con la duración de cada uno.
function videoFrames(r) {
  const c = r.clue;
  // Contenido centrado en la zona segura de TikTok, Shorts y reels.
  const shell = (inner) => page(1080, 1920, `<div style="padding:180px 88px 270px;display:flex;flex-direction:column;height:100%">${top()}<div style="margin:auto 0;display:flex;flex-direction:column">${inner}</div></div>`);
  const clueBlock = `<div class="sheet" style="margin-top:40px;font-size:${clueSize(c.clue_text)}px">${esc(c.clue_text)}</div>`;
  const frames = [
    [shell(`<h2>${esc(r.title)}</h2>${clueBlock}<div style="margin-top:56px">${tiles(c.answer)}</div>`), 3.0],
  ];
  for (const s of [3, 2, 1]) frames.push([shell(`<div class="k">Pensalo</div>${clueBlock}<div style="margin-top:56px">${tiles(c.answer)}</div><div style="margin-top:72px;font-family:Fraunces,Georgia,serif;font-size:220px;line-height:1;color:${C.accent}">${s}</div>`), 1.0]);
  frames.push([shell(`<div class="k">Respuesta</div>${clueBlock}<div style="margin-top:56px">${tiles(c.answer, { fill: true, ok: true })}</div>`), 2.5]);
  frames.push([shell(`<div class="k">Por qué</div><div style="margin-top:44px">${tiles(c.answer, { fill: true, ok: true })}</div><ul class="steps big" style="margin-top:56px">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`), 5.0]);
  frames.push([page(1080, 1920, `<div style="padding:180px 88px 270px;display:flex;flex-direction:column;height:100%;justify-content:center;align-items:flex-start">${MARK(160)}<h1 style="margin-top:56px"><em>Play</em> Crípticos</h1><p style="margin-top:32px">Uno nuevo cada día, gratis.</p><p style="margin-top:56px;font-size:52px;font-weight:600;color:${C.ink}">playcripticos.com</p></div>`), 2.5]);
  return frames;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-'));
  const db = openDb({ url: 'file:' + path.join(tmp, 'catalog.db') });
  await migrate(db); await seedReference(db); await seedCatalog(db);
  const clues = await db.all("SELECT slug, clue_text, answer, enumeration, definition, explanation, mechanism, difficulty FROM clues WHERE language_code = 'es' ORDER BY rowid");
  db.close();
  const plan = buildPlan(clues);
  const { renders, ...stored } = plan;
  fs.mkdirSync(path.join(ROOT, 'data', 'social'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'data', 'social', 'plan.json'), JSON.stringify(stored, null, 1) + '\n');
  const pieces = plan.days.reduce((s, d) => s + d.pieces.length, 0);
  console.log(`Plan: ${plan.days.length} días, ${pieces} piezas.`);
  if (process.argv.includes('--plan-only')) return;

  const [from, to] = String(arg('days', '0-59')).split('-').map(Number);
  const inRange = (p) => { const m = /\/d(\d\d)\//.exec(p); return !m || (Number(m[1]) >= from && Number(m[1]) <= (to ?? from)); };
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const shot = async (html, file, w, h) => {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.setContent(html); await p.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file }); await p.close();
  };
  for (const r of renders) {
    const where = r.path || r.dir + '/';
    if (!inRange(where)) continue;
    if (r.kind === 'lesson' || r.kind === 'steps') {
      const slides = r.kind === 'lesson' ? lessonSlides(r) : stepSlides(r);
      for (let i = 0; i < slides.length; i++) await shot(slides[i], path.join(OUT, r.dir, `carrusel-${String(i + 1).padStart(2, '0')}.png`), 1080, 1350);
    } else if (r.kind === 'video') {
      const frames = videoFrames(r); const dir = fs.mkdtempSync(path.join(tmp, 'v-'));
      const list = [];
      for (let i = 0; i < frames.length; i++) { const f = path.join(dir, `f${i}.png`); await shot(frames[i][0], f, 1080, 1920); list.push(`file '${f}'\nduration ${frames[i][1]}`); }
      list.push(`file '${path.join(dir, `f${frames.length - 1}.png`)}'`);
      fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'));
      const out = path.join(OUT, r.path); fs.mkdirSync(path.dirname(out), { recursive: true });
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'),
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', out]);
    } else {
      const big = r.kind === 'solution';
      await shot(T[r.kind](r), path.join(OUT, r.path), 1080, big ? 1920 : 1350);
    }
  }
  await browser.close();
  // Carruseles ya diseñados antes del calendario.
  const src = path.join(ROOT, 'data', 'marketing');
  for (const deck of fs.readdirSync(src)) {
    const dest = path.join(OUT, 'social', 'carruseles', deck); fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(path.join(src, deck))) fs.copyFileSync(path.join(src, deck, f), path.join(dest, f));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Archivos listos en public/social/.');
}

main().catch((e) => { console.error(e); process.exit(1); });
