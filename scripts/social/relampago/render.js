'use strict';

// Serie «Relámpago» (20/11–3/12/2026): videos verticales de ~8,5 s con crípticos cortos.
// Sale de las métricas del 23/10–10/11: en TikTok los videos que explotaron (30.950,
// 18.476, 6.925 y 5.435 reproducciones) tenían respuestas de 3–4 letras y trucos
// fáciles (palabra oculta, inversión, quitar letra), y en reels el tiempo medio visto
// era de 6–8 s sobre 16 s. Por eso: la pista aparece en el primer cuadro, cuenta de
// 5 segundos con una ayuda a mitad de camino, respuesta y una sola línea de por qué.
// Corto para que se vea entero y se repita (TikTok premia el tiempo de visionado).
//
//   node scripts/social/relampago/render.js                 # escribe public/social/relampago/rNN.mp4
//   node scripts/social/relampago/render.js plus-serie.json # otra serie; cada pieza puede traer
//                                                           # dir, hook, end_title y end_line

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { page, tiles, top, esc, MARK, C } = require('../render');
const SERIES = require(path.resolve(__dirname, process.argv[2] || 'serie.json'));

const ROOT = path.join(__dirname, '..', '..', '..');
const outDir = (r) => path.join(ROOT, 'public', 'social', r.dir || 'relampago');

const clueSize = (t) => (t.length > 52 ? 64 : 76);
const shell = (inner) => page(1080, 1920, `<div style="padding:180px 88px 300px;display:flex;flex-direction:column;height:100%">${top()}<div style="margin:auto 0;display:flex;flex-direction:column">${inner}</div></div>`);
const bar = (left) => `<div style="margin-top:56px;height:18px;background:#e4dccb"><div style="height:18px;width:${left * 20}%;background:${C.accent}"></div></div>`;
const hintTiles = (word) => {
  const letters = [...word.normalize('NFC')].filter((ch) => /\p{L}/u.test(ch));
  return tiles(word).replace('<span style', '<span data-x style').replace(/(<span data-x[^>]*>)<\/span>/, `$1${esc(letters[0])}</span>`);
};

function frames(r) {
  const sheet = `<div class="sheet" style="margin-top:36px;font-size:${clueSize(r.clue_text)}px">${esc(r.clue_text)}</div>`;
  const out = [];
  for (const s of [5, 4, 3, 2, 1]) {
    const hint = s <= 2;
    out.push([shell(`<h2 style="font-size:84px">${r.hook || `¿Lo sacás en <span style="color:${C.accent}">5 segundos</span>?`}</h2>${sheet}<div style="margin-top:48px">${hint ? hintTiles(r.answer) : tiles(r.answer)}</div>
      <div style="margin-top:40px;display:flex;align-items:baseline;gap:28px"><span style="font-family:Fraunces,Georgia,serif;font-size:200px;line-height:1;color:${C.accent}">${s}</span>
      <span style="font-size:40px;color:${C.ink2}">${hint ? `Ayuda: empieza con ${esc([...r.answer][0])}` : ''}</span></div>${bar(s)}`), s === 5 ? 1.4 : 1.0]);
  }
  out.push([shell(`<div class="k">Respuesta</div>${sheet}<div style="margin-top:48px">${tiles(r.answer, { fill: true, ok: true })}</div>
    <p style="margin-top:48px;font-size:44px;color:${C.ink}">${esc(r.why)}</p>`), 2.2]);
  out.push([page(1080, 1920, `<div style="padding:180px 88px 300px;display:flex;flex-direction:column;height:100%;justify-content:center;align-items:flex-start">${MARK(140)}
    <h2 style="margin-top:48px">${esc(r.end_title || '¿Te salió? Contá en cuántos segundos 👇')}</h2><p style="margin-top:40px;font-size:52px;font-weight:600;color:${C.ink}">${esc(r.end_line || 'Uno nuevo cada día en playcripticos.com')}</p></div>`), 1.0]);
  return out;
}

async function main() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relampago-'));
  for (const r of SERIES) {
    const OUT = outDir(r); fs.mkdirSync(OUT, { recursive: true });
    const fr = frames(r); const dir = fs.mkdtempSync(path.join(tmp, 'v-')); const list = [];
    for (let i = 0; i < fr.length; i++) {
      const f = path.join(dir, `f${i}.png`);
      const p = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
      await p.setContent(fr[i][0]); await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: f }); await p.close();
      list.push(`file '${f}'\nduration ${fr[i][1]}`);
      if (i === 0) fs.copyFileSync(f, path.join(OUT, `${r.id}-portada.png`));
    }
    list.push(`file '${path.join(dir, `f${fr.length - 1}.png`)}'`);
    fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n'));
    // Mismo diseño de sonido que los videos diarios: el primer cuadro hace de entrada,
    // los de la cuenta de tic, después acierto y cierre.
    const d = fr.map((f) => f[1]);
    fs.writeFileSync(path.join(dir, 'sfx.wav'), require('../sfx').soundtrack([d[0] + d[1], d[2], d[3], d[4], d[5], 0.01, d[6]]));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-i', path.join(dir, 'sfx.wav'),
      '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart',
      path.join(OUT, `${r.id}.mp4`)]);
    console.log(r.id, r.answer);
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
