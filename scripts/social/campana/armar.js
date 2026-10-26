'use strict';

// Arma las piezas propias de la campaña de 21 días (30/10–19/11/2026): videos con el
// producto real grabado en pantalla (grabar.js), carruseles de funcionalidades e
// imágenes del torneo. Todo sigue el manual de marca (docs/MARCA.md) y sale en
// public/social/campana/. Solo afirma lo que el producto hace hoy (docs/CAMPANA.md).
//
//   REC=/tmp/campana-grabaciones node scripts/social/campana/armar.js            # todo
//   REC=... node scripts/social/campana/armar.js videos | carruseles | imagenes

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { page, tiles, top, foot, esc, MARK, C } = require('../render');

const ROOT = path.join(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'public', 'social', 'campana');
const REC = process.env.REC || '/tmp/campana-grabaciones';
const only = process.argv[2] || 'todo';

// ── Videos: grabación + subtítulos por tramo + cierre ──
// Cada tramo es [desde, hasta, texto] en segundos de la grabación. Los subtítulos van
// arriba (fuera de la zona de botones de TikTok, Shorts y reels) para verse sin sonido.
const VIDEOS = [
  { id: 'v1-asi-se-juega', rec: 'jugar', cut: [0, 16.6], outro: ['Jugá gratis', 'sin registrarte'], caps: [
    [0, 2.6, '¿Nunca jugaste un críptico?'], [2.6, 6.2, 'Cada pista esconde una palabra'],
    [6.2, 8.8, '¿Le erraste? Pedí una pista'], [8.8, 12.2, 'Te dice el truco: es un anagrama'],
    [12.2, 16.6, 'Y al final te explica por qué']] },
  { id: 'v2-diario', rec: 'diario', cut: [0, 11.5], outro: ['Uno nuevo', 'cada día'], caps: [
    [0, 3.2, 'El Diario: un críptico por día'], [3.2, 7, 'El mismo para todos'],
    [7, 11.5, 'Mirá cuántos lo resolvieron hoy']] },
  { id: 'v3-torneo', rec: 'torneo', cut: [0, 14.2], outro: ['Torneo semanal', 'gratis'], caps: [
    [0, 2.8, 'Hay un torneo cada semana'], [2.8, 5.6, 'Te anotás gratis con un toque'],
    [5.6, 9.4, 'Una ronda nueva por día'], [9.4, 14.2, 'Rápido y sin pistas: hasta 200 puntos']] },
  { id: 'v4-duelo', rec: 'duelo', cut: [0, 20], outro: ['Retá a', 'quien quieras'], caps: [
    [0, 3.4, 'Duelos 1 contra 1'], [3.4, 7.2, 'Creás un enlace para cualquiera'],
    [7.2, 10.6, 'Lo mandás por WhatsApp'], [10.6, 15.6, 'Los dos juegan los mismos crípticos'],
    [15.6, 20, 'Gana quien suma más puntos']] },
  { id: 'v5-mecanismos', rec: 'mecanismos', cut: [0, 5.85], slow: 1.6, outro: ['Aprendé', 'los 9 trucos'], caps: [
    [0, 4.6, 'Todos los crípticos usan 9 trucos'], [4.6, 9.4, 'Hay una guía gratis para cada uno']] },
  { id: 'v6-plus', rec: 'plus', cut: [0, 9], outro: ['Jugar sigue', 'siendo gratis'], caps: [
    [0, 2.6, 'Jugar sigue siendo gratis'], [2.6, 5.4, 'Plus: sin anuncios y 10 crípticos difíciles por día'],
    [5.4, 9, 'Sin ventajas en torneos ni duelos']] },
];

const PHONE = { w: 600, h: 1200, x: 240, y: 430 };

function bgVideo() {
  return page(1080, 1920, `<div style="position:absolute;inset:0;padding:120px 88px 0">${top()}</div>
    <div style="position:absolute;left:${PHONE.x - 10}px;top:${PHONE.y - 10}px;width:${PHONE.w + 20}px;height:${PHONE.h + 20}px;border:4px solid ${C.ink};background:${C.ink};border-radius:36px;box-shadow:0 30px 80px rgba(26,23,18,.25)"></div>
    <div style="position:absolute;left:88px;right:88px;top:1680px">${foot('Gratis · sin registro para jugar')}</div>`);
}
const capFrame = (text) => page(1080, 1920, `<div style="position:absolute;left:88px;right:88px;top:230px;height:170px;display:flex;align-items:center">
  <h2 style="font-size:${text.length > 34 ? 54 : 64}px;background:${C.ink};color:${C.paper};padding:18px 28px;line-height:1.12">${esc(text)}</h2></div>`)
  .replace(/background:#f4eee2;color:#1a1712/, 'background:transparent;color:#1a1712');
const outroFrame = ([a, b]) => page(1080, 1920, `<div style="padding:180px 88px 270px;display:flex;flex-direction:column;height:100%;justify-content:center;align-items:flex-start">
  ${MARK(160)}<h1 style="margin-top:56px">${esc(a)} <em>${esc(b)}</em></h1>
  <p style="margin-top:40px;font-size:56px;font-weight:600;color:${C.ink}">playcripticos.com</p>
  <p style="margin-top:20px">Link en el perfil · @playcripticos</p></div>`);

// Efectos propios (sin muestras de terceros): un «pop» en cada subtítulo y una campanita al cierre.
function sound(total, marks, outroAt) {
  const RATE = 44100; const n = Math.ceil(total * RATE); const buf = new Float32Array(n);
  const tone = (at, f, len, vol, decay, harm = [1]) => { const s0 = Math.floor(at * RATE); const ph = harm.map(() => 0);
    for (let i = 0; i < len * RATE && s0 + i < n; i++) { const x = i / RATE; let v = 0;
      harm.forEach((h, k) => { ph[k] += 2 * Math.PI * f * h / RATE; v += Math.sin(ph[k]) / (k + 1); });
      buf[s0 + i] += v * Math.min(1, x / 0.005) * Math.exp(-decay * x) * vol; } };
  marks.forEach((m, i) => { tone(m, i ? 520 : 392, 0.25, 0.22, 18, [1, 2]); tone(m + 0.06, i ? 780 : 588, 0.2, 0.1, 22); });
  // Pulso suave de fondo, una nota cada 2 s, para que no quede en silencio.
  const notes = [196, 220, 247, 220];
  for (let t = 0.4, k = 0; t < outroAt - 0.5; t += 2, k++) tone(t, notes[k % 4], 1.8, 0.07, 1.6, [1, 2, 3]);
  [784, 1046.5, 1318.5].forEach((f, i) => tone(outroAt + 0.1 + i * 0.12, f, 1.8, 0.15, 2.6, [1, 2]));
  const out = Buffer.alloc(44 + n * 4);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 4, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.tanh(buf[i] * 1.2) * 0.9 * 32767); out.writeInt16LE(v, 44 + i * 4); out.writeInt16LE(v, 46 + i * 4); }
  return out;
}

// ── Carruseles 1080×1350 ──
const frame = (inner, i, k) => page(1080, 1350, `<div style="padding:96px 88px;display:flex;flex-direction:column;height:100%">${top()}${inner}<div style="margin-top:auto">${foot(`${i}/${k}`)}</div></div>`);
const list = (items, size = 40) => `<ul class="steps" style="margin-top:44px">${items.map((s) => `<li style="font-size:${size}px">${s}</li>`).join('')}</ul>`;
const table = (rows, head) => `<table style="margin-top:44px;border-collapse:collapse;width:100%;font-size:34px">${head ? `<tr>${head.map((h) => `<th style="text-align:left;padding:14px 10px;border-bottom:3px solid ${C.ink};font-size:26px;letter-spacing:.1em;text-transform:uppercase">${h}</th>`).join('')}</tr>` : ''}
  ${rows.map((r) => `<tr>${r.map((c, j) => `<td style="padding:18px 10px;border-bottom:2px solid #d9cfbd;${j ? 'font-weight:600' : ''}">${c}</td>`).join('')}</tr>`).join('')}</table>`;

const CAROUSELS = {
  'k1-todo-gratis': [
    `<div class="k" style="margin-top:auto">Guardalo</div><h1 style="margin-top:28px">Todo lo que podés hacer <em>gratis</em></h1><p style="margin-top:36px">En Play Crípticos, hoy. Deslizá →</p>`,
    `<div class="k" style="margin-top:110px">1 · Jugar</div><h2 style="margin-top:28px">Crípticos sin límite</h2>${list(['Sin tope diario y sin registrarte', '5 dificultades: de «muy fácil» a «experto»', 'Pistas que te dicen el truco', 'Cada solución, explicada paso a paso'])}`,
    `<div class="k" style="margin-top:110px">2 · El Diario</div><h2 style="margin-top:28px">Uno por día, el mismo para todos</h2>${list(['Se renueva a las 21 h de Argentina', 'Mirá cuántos lo resolvieron', 'Calendario para jugar los días anteriores'])}`,
    `<div class="k" style="margin-top:110px">3 · Desafíos</div><h2 style="margin-top:28px">Torneo semanal y duelos</h2>${list(['Torneo: 7 rondas, una por día, con ranking', 'Duelos 1 contra 1 con un enlace', 'Amigos: mirá quién está conectado', 'Se juega con una cuenta gratis'])}`,
    `<div class="k" style="margin-top:110px">4 · Tu perfil</div><h2 style="margin-top:28px">Tu progreso, a la vista</h2>${list(['12 niveles: de Curioso a Leyenda del crucigrama', 'Rachas, récords y logros', 'Tus fortalezas por tipo de pista', 'Perfil público solo si querés'])}`,
    `<div class="k" style="margin-top:110px">5 · Aprender</div><h2 style="margin-top:28px">De cero a experto</h2>${list(['«Cómo jugar»: 7 lecciones cortas', 'Guía de los 9 mecanismos', 'Práctica libre por tipo de pista'])}`,
    `<div class="k" style="margin-top:auto">Empezá ahora</div><h2 style="margin-top:28px">playcripticos.com</h2><p style="margin-top:32px">Link en el perfil. Ni hace falta registrarte para jugar.</p><div style="margin-top:48px">${tiles('GRATIS', { fill: true, ok: true, maxW: 760 })}</div>`,
  ],
  'k2-torneo': [
    `<div class="k" style="margin-top:auto">Desafíos</div><h1 style="margin-top:28px">El torneo <em>semanal</em>, explicado</h1><p style="margin-top:36px">Gratis, con ranking y una ronda por día.</p>`,
    `<div class="k" style="margin-top:110px">Cómo entrar</div><h2 style="margin-top:28px">Te anotás con un toque</h2>${list(['Entrá a Desafíos en playcripticos.com', 'Creá tu cuenta gratis (usuario y contraseña)', 'Tocá «Inscribirme gratis»', 'Tu nombre aparece en el ranking'])}`,
    `<div class="k" style="margin-top:110px">Las rondas</div><h2 style="margin-top:28px">7 crípticos, uno por día</h2>${list(['Cada ronda abre a las 21 h de Argentina (00:00 UTC)', 'Tenés ese día y el siguiente para jugarla', 'Empieza el lunes y termina el domingo', 'Si arrancás una ronda, el reloj corre'])}`,
    `<div class="k" style="margin-top:110px">Puntaje</div><h2 style="margin-top:28px">Hasta 200 por críptico</h2>${table([['Resolver', '100'], ['Cada pista', '−20'], ['Cada error', '−10'], ['Velocidad (10 s o menos)', '+100'], ['Revelar o rendirse', '0']])}<p style="margin-top:28px;font-size:30px">Resolver vale como mínimo 20. La velocidad baja hasta 0 a los 3 minutos.</p>`,
    `<div class="k" style="margin-top:auto">¿Te animás?</div><h2 style="margin-top:28px">Si empatan, gana quien tardó menos</h2><p style="margin-top:32px">Anotate en Desafíos: playcripticos.com · link en el perfil.</p>`,
  ],
  'k3-duelos': [
    `<div class="k" style="margin-top:auto">Desafíos</div><h1 style="margin-top:28px">Duelos <em>1 contra 1</em></h1><p style="margin-top:36px">Retá a un amigo (o a cualquiera) a ver quién saca más.</p>`,
    `<div class="k" style="margin-top:110px">Paso 1</div><h2 style="margin-top:28px">Elegí a quién retar</h2>${list(['Por usuario, a un amigo de tu lista', 'O con un enlace para cualquiera', '3 o 5 crípticos, dificultad mixta o fija'])}`,
    `<div class="k" style="margin-top:110px">Paso 2</div><h2 style="margin-top:28px">Mandalo por WhatsApp</h2>${list(['El primero que lo acepta es tu rival', 'Cada uno juega cuando puede', 'Los dos resuelven los mismos crípticos'])}`,
    `<div class="k" style="margin-top:110px">Paso 3</div><h2 style="margin-top:28px">Gana quien suma más</h2>${list(['Mismo puntaje que el torneo', 'No ves los puntos del rival hasta el final', 'Vence a las 72 h', 'Revancha con un toque'])}`,
    `<div class="k" style="margin-top:auto">Probalo hoy</div><h2 style="margin-top:28px">¿A quién retarías primero?</h2><p style="margin-top:32px">Etiquetalo acá abajo y mandale el duelo desde playcripticos.com</p>`,
  ],
  'k4-niveles-logros': [
    `<div class="k" style="margin-top:auto">Tu perfil</div><h1 style="margin-top:28px">De <em>Curioso</em> a Leyenda</h1><p style="margin-top:36px">Los 12 niveles y los logros de Play Crípticos.</p>`,
    `<div class="k" style="margin-top:110px">Los 12 niveles</div>${list(['Curioso · Aprendiz · Lector atento', 'Descifrador · Anagramista', 'Ilusionista de letras · Cruzadista', 'Enigmista · Arquitecto de pistas', 'Maestro críptico · Gran arcano', 'Leyenda del crucigrama'], 38)}<p style="margin-top:32px;font-size:32px">Los niveles no bloquean nada: todo se puede jugar desde el día 1.</p>`,
    `<div class="k" style="margin-top:110px">Cómo se sube</div><h2 style="margin-top:28px">Experiencia por jugar bien</h2>${list(['Resolver uno nuevo: 10 + 5 × dificultad', 'Primer críptico de un mecanismo nuevo: 25', 'Cada día que resolvés al menos uno: 5', 'Cada logro: 20', 'El tiempo nunca cuenta'], 36)}`,
    `<div class="k" style="margin-top:110px">Logros</div><h2 style="margin-top:28px">Algunos para ir a buscar</h2>${list(['Racha de 3, 7 y 30 días', '5, 10 y 25 aciertos seguidos', '10 y 50 resueltos sin pistas', 'Los 9 mecanismos dominados', 'Volver después de una pausa'], 38)}`,
    `<div class="k" style="margin-top:auto">¿En qué nivel estás?</div><h2 style="margin-top:28px">Contalo en los comentarios</h2><p style="margin-top:32px">Creá tu cuenta gratis y mirá tu perfil en playcripticos.com</p>`,
  ],
  'k5-gratis-vs-plus': [
    `<div class="k" style="margin-top:auto">Preguntas frecuentes</div><h1 style="margin-top:28px">Gratis y <em>Plus</em>: qué cambia</h1><p style="margin-top:36px">Spoiler: jugar sigue siendo gratis.</p>`,
    `<div class="k" style="margin-top:100px">Comparación</div>${table([['Crípticos sin límite', 'Sí', 'Sí'], ['Diario, torneo y duelos', 'Sí', 'Sí'], ['Perfil, niveles y logros', 'Sí', 'Sí'], ['Sin anuncios', '—', 'Sí'], ['10 Crípticos Plus por día (dif. 4 y 5)', '—', 'Sí'], ['Tu nivel contra la comunidad', '—', 'Sí'], ['Insignia y avatares Plus', '—', 'Sí']], ['', 'Gratis', 'Plus'])}`,
    `<div class="k" style="margin-top:110px">Precio</div><h2 style="margin-top:28px">USD 1,50 por mes<br>o USD 12 por año</h2><p style="margin-top:32px">El anual equivale a USD 1 por mes. Pagás con tarjeta o PayPal; Lemon Squeezy procesa el pago e incluye los impuestos de tu país.</p>`,
    `<div class="k" style="margin-top:110px">Sin letra chica</div>${list(['Cancelás cuando quieras y seguís con Plus hasta el final del período pagado', 'Si te arrepentís dentro de los 10 días del primer pago, te devolvemos ese pago', 'Plus no da puntos, pistas ni tiempo extra en torneos ni duelos'], 38)}`,
    `<div class="k" style="margin-top:auto">Más info</div><h2 style="margin-top:28px">playcripticos.com/es/plus</h2><p style="margin-top:32px">Plus banca el proyecto. Gracias a quienes se suman.</p>`,
  ],
  'k6-en-el-telefono': [
    `<div class="k" style="margin-top:auto">Mientras llega la app</div><h1 style="margin-top:28px">Play Crípticos <em>en tu teléfono</em>, hoy</h1><p style="margin-top:36px">Un ícono en tu pantalla de inicio, sin descargar nada.</p>`,
    `<div class="k" style="margin-top:110px">iPhone (Safari)</div><h2 style="margin-top:28px">Tres toques</h2>${list(['Abrí playcripticos.com en Safari', 'Tocá Compartir (el cuadrado con la flecha)', 'Elegí «Agregar a inicio»'])}`,
    `<div class="k" style="margin-top:110px">Android (Chrome)</div><h2 style="margin-top:28px">Tres toques</h2>${list(['Abrí playcripticos.com en Chrome', 'Tocá el menú ⋮ de arriba a la derecha', 'Elegí «Agregar a la pantalla principal» o «Instalar»'])}`,
    `<div class="k" style="margin-top:110px">Y queda así</div><h2 style="margin-top:28px">Se abre a pantalla completa</h2><div style="margin-top:56px;display:flex;align-items:center;gap:36px">${MARK(200)}<p style="font-size:44px;color:${C.ink}">Crípticos</p></div><p style="margin-top:48px">Con accesos directos a Jugar y a Mi perfil.</p>`,
    `<div class="k" style="margin-top:auto">¿Y la app?</div><h2 style="margin-top:28px">Todavía no está en las tiendas</h2><p style="margin-top:32px">Cuando salga, lo anunciamos acá primero. Seguinos para enterarte.</p>`,
  ],
};

// ── Imágenes del torneo (domingo antes de que abra la primera ronda) ──
const TORNEOS = [['torneo-02-11', '2 al 8 de noviembre'], ['torneo-09-11', '9 al 15 de noviembre'], ['torneo-16-11', '16 al 22 de noviembre']];
const torneoImg = (fechas) => page(1080, 1350, `<div style="padding:96px 88px;display:flex;flex-direction:column;height:100%">
  ${top()}<div class="k" style="margin-top:auto">Hoy 21 h (Argentina)</div>
  <h1 style="margin-top:28px">Arranca el <em>torneo</em> de la semana</h1>
  <p style="margin-top:36px">${esc(fechas)} · 7 crípticos, uno por día · gratis</p>
  <div style="margin-top:48px">${tiles('RANKING', { fill: true, maxW: 860 })}</div>
  <p style="margin-top:48px;font-size:34px">Anotate en Desafíos: playcripticos.com</p>
  <div style="margin-top:48px">${foot('@playcripticos')}</div></div>`);

async function main() {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const shot = async (html, file, w, h, transparent = false) => {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.setContent(html); await p.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, omitBackground: transparent }); await p.close();
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'campana-'));

  if (only === 'todo' || only === 'carruseles') {
    for (const [id, slides] of Object.entries(CAROUSELS)) {
      for (let i = 0; i < slides.length; i++) await shot(frame(slides[i], i + 1, slides.length), path.join(OUT, id, `slide-${String(i + 1).padStart(2, '0')}.png`), 1080, 1350);
      console.log('Carrusel:', id);
    }
  }
  if (only === 'todo' || only === 'imagenes') {
    for (const [id, f] of TORNEOS) await shot(torneoImg(f), path.join(OUT, id + '.png'), 1080, 1350);
    console.log('Imágenes del torneo listas.');
  }
  if (only === 'todo' || only === 'videos') {
    await shot(bgVideo(), path.join(tmp, 'bg.png'), 1080, 1920);
    for (const v of VIDEOS) {
      const src = path.join(REC, v.rec + '.webm');
      if (!fs.existsSync(src)) { console.log('Falta la grabación', src); continue; }
      const slow = v.slow || 1; const len = (v.cut[1] - v.cut[0]) * slow; const OUTRO = 2.6;
      const caps = [];
      for (let i = 0; i < v.caps.length; i++) { const f = path.join(tmp, `${v.id}-c${i}.png`); await shot(capFrame(v.caps[i][2]), f, 1080, 1920, true); caps.push(f); }
      const outro = path.join(tmp, `${v.id}-outro.png`); await shot(outroFrame(v.outro), outro, 1080, 1920);
      fs.writeFileSync(path.join(tmp, 'a.wav'), sound(len + OUTRO, v.caps.map((c) => c[0]), len));
      const inputs = ['-loop', '1', '-t', String(len), '-i', path.join(tmp, 'bg.png'), '-ss', String(v.cut[0]), '-t', String(v.cut[1] - v.cut[0]), '-i', src];
      caps.forEach((c) => inputs.push('-loop', '1', '-t', String(len), '-i', c));
      inputs.push('-loop', '1', '-t', String(OUTRO), '-i', outro, '-i', path.join(tmp, 'a.wav'));
      let g = `[1:v]setpts=${slow}*(PTS-STARTPTS),crop=390:780:0:0,scale=${PHONE.w}:${PHONE.h}:flags=lanczos,unsharp=5:5:0.6,fps=30[ph];[0:v][ph]overlay=${PHONE.x}:${PHONE.y}:shortest=1[b0]`;
      v.caps.forEach((c, i) => { g += `;[b${i}][${i + 2}:v]overlay=0:0:enable='between(t,${c[0]},${Math.min(c[1], len)})'[b${i + 1}]`; });
      const oi = caps.length + 2;
      g += `;[b${caps.length}]fps=30,format=yuv420p,setsar=1[main];[${oi}:v]fps=30,format=yuv420p,setsar=1[end];[main][end]concat=n=2:v=1:a=0[v]`;
      const out = path.join(OUT, v.id + '.mp4'); fs.mkdirSync(OUT, { recursive: true });
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', g, '-map', '[v]', '-map', `${oi + 1}:a`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out]);
      // Portada: el primer subtítulo sobre la pantalla del juego.
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.2', '-i', out, '-frames:v', '1', '-q:v', '3', path.join(OUT, v.id + '-portada.jpg')]);
      console.log('Video:', v.id, (len + OUTRO).toFixed(1) + ' s');
    }
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
