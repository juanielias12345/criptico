'use strict';

// Calendario de lanzamiento de 60 días (campaña «lanzamiento-60»).
// Arma, a partir de crípticos reales del catálogo, cada pieza de cada red con
// su texto, sus archivos y el horario que fijó el director de marketing.
// No publica nada: el resultado se carga en el panel y espera aprobación.
// Ver docs/REDES.md.

const CAMPAIGN = 'lanzamiento-60';
const START = '2026-10-26';            // día 0, lunes
const DAYS = 60;
const SITE = 'https://playcripticos.com';
const TZ = 'America/Argentina/Buenos_Aires';   // UTC−3 todo el año

// Horarios del director de marketing (hora de Argentina) y su motivo.
// Redes que usa la marca (22/10/2026, decisión de Juan). X, Threads y WhatsApp quedan fuera.
const NETWORKS = ['instagram', 'facebook', 'tiktok', 'youtube'];

const SLOTS = {
  whatsapp_clue: { time: '08:30', platform: 'whatsapp', why: 'Antes del trabajo: el canal llega como notificación con el primer café.' },
  instagram_clue: { time: '09:00', platform: 'instagram', why: 'Hábito de la mañana, como el Wordle: el feed se revisa en el viaje.' },
  x_clue: { time: '09:00', platform: 'x', why: 'Pico de lectura de X en la mañana.' },
  threads_clue: { time: '09:15', platform: 'threads', why: 'Quince minutos después de Instagram para no competir con la misma cuenta.' },
  facebook_clue: { time: '09:30', platform: 'facebook', why: 'El público adulto de Facebook entra más tarde que el de Instagram.' },
  launch_ig: { time: '12:00', platform: 'instagram', why: 'Anuncio a la hora del almuerzo, cuando más se comparte.' },
  launch_fb: { time: '12:15', platform: 'facebook', why: 'Anuncio a la hora del almuerzo.' },
  launch_x: { time: '12:00', platform: 'x', why: 'Anuncio a la hora del almuerzo.' },
  launch_threads: { time: '12:00', platform: 'threads', why: 'Anuncio a la hora del almuerzo.' },
  instagram_carousel: { time: '13:00', platform: 'instagram', why: 'Los carruseles se guardan en el almuerzo para leer con calma.' },
  facebook_carousel: { time: '13:30', platform: 'facebook', why: 'Media hora después de Instagram.' },
  instagram_weekend: { time: '12:00', platform: 'instagram', why: 'Fin de semana: se juega más tarde y con más tiempo.' },
  facebook_weekend: { time: '12:30', platform: 'facebook', why: 'Fin de semana, después de Instagram.' },
  tiktok_video: { time: '21:00', platform: 'tiktok', why: 'Horario central de video; coincide con la solución del día.' },
  youtube_video: { time: '21:00', platform: 'youtube', why: 'Shorts en horario central.' },
  instagram_reel: { time: '21:00', platform: 'instagram', why: 'Reel con la solución en horario central.' },
  instagram_story: { time: '21:05', platform: 'instagram', why: 'La historia con la solución, justo después del reel.' },
  x_solution: { time: '21:00', platform: 'x', why: 'La solución a la misma hora que en las otras redes (posteo propio: Metricool no responde a un posteo anterior).' },
  threads_solution: { time: '21:15', platform: 'threads', why: 'Solución después de X.' },
  facebook_reel: { time: '21:15', platform: 'facebook', why: 'Reel de la solución después de Instagram.' },
};

const MECH = {
  anagram: { name: 'Anagrama', short: 'anagrama', what: 'Las letras de una palabra se reordenan para formar la respuesta.', signals: ['revuelto', 'loco', 'roto', 'alterado', 'desordenado', 'confuso'] },
  hidden: { name: 'Palabra oculta', short: 'palabra oculta', what: 'La respuesta está escrita, letra por letra, dentro de la propia pista.', signals: ['esconde', 'oculta', 'contiene', 'guarda', 'dentro de'] },
  reversal: { name: 'Al revés', short: 'al revés', what: 'Una palabra se lee de atrás para adelante.', signals: ['de vuelta', 'al revés', 'que vuelve', 'que regresa'] },
  charade: { name: 'Suma de partes', short: 'suma de partes', what: 'La respuesta se arma pegando dos o más piezas, una detrás de otra.', signals: ['y', 'con', 'junto a', 'seguido de'] },
  container: { name: 'Una dentro de otra', short: 'una dentro de otra', what: 'Una palabra se mete dentro de otra para formar la respuesta.', signals: ['guarda', 'contiene', 'abraza', 'dentro de'] },
  deletion: { name: 'Quitar letras', short: 'quitar letras', what: 'A una palabra se le saca el principio, el final o una letra.', signals: ['sin principio', 'sin cabeza', 'sin fin', 'pierde'] },
  double_definition: { name: 'Doble definición', short: 'doble definición', what: 'Dos definiciones distintas llevan a la misma palabra.', signals: ['no hay: la pista son dos definiciones seguidas'] },
  homophone: { name: 'Suena como', short: 'suena como', what: 'La respuesta suena igual que otra palabra.', signals: ['se oye', 'suena a', 'dicen', 'de oído'] },
  initials: { name: 'Iniciales', short: 'iniciales', what: 'Se toman las primeras letras de varias palabras.', signals: ['al principio', 'al comienzo', 'primeras letras'] },
};

const WD = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function dateOf(n) {
  const d = new Date(START + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
const iso = (d) => d.toISOString().slice(0, 10);
const human = (d, n) => `${WD[n % 7]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
// Hora de Argentina (UTC−3) a instante UTC.
function utc(date, time) {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCHours(h + 3, m);
  return d.toISOString().replace('.000Z', 'Z');
}
const pick = (arr, n) => arr[n % arr.length];

// Pasos de la explicación que se muestran (sin los «se toma tal cual» ni la respuesta repetida).
function steps(c) {
  const all = JSON.parse(c.explanation);
  const keep = all.filter((s) => !/se toma tal cual|^Respuesta:/.test(s));
  return keep.length ? keep : all;
}
const clueUrl = (c) => `${SITE}/es/c/${c.slug}`;

// ── Textos ──
const HOOK = [
  'Críptico del día 🧩', 'Hoy toca este 🧩', 'El de hoy tiene una trampa linda 🧩', 'Para arrancar el día 🧩',
  'Críptico del día: ¿lo sacás? 🧩', 'Uno para el café 🧩', 'El críptico de hoy 🧩',
];
const ASK = ['¿Lo sacás?', '¿Cuánto tardás?', '¿Lo ves?', '¿Te animás?', '¿Sale en un minuto?'];
const CTA = ['Jugá más en playcripticos.com', 'Hay uno nuevo cada día en playcripticos.com', '¿Te animás a otro? playcripticos.com'];
const TAGS = ['#críptico #crucigrama #juegosdepalabras #acertijos #playcripticos', '#críptico #juegosdepalabras #wordle #español #playcripticos',
  '#críptico #crucigrama #acertijos #anagrama #playcripticos'];

// X admite 280 caracteres en cuentas comunes: se recorta la explicación, nunca el cierre.
const fit280 = (main, tail) => (main.length + tail.length <= 280 ? main + tail : main.slice(0, 279 - tail.length).replace(/\s+\S*$/, '') + '…' + tail);

function captions(c, n) {
  const hook = pick(HOOK, n); const ask = pick(ASK, n + 2); const cta = pick(CTA, n); const tags = pick(TAGS, n);
  const clue = c.clue_text;
  return {
    instagram_clue: `${hook}\n\n«${clue}»\n\n${ask} Dejá tu respuesta en los comentarios, pero tapala con un spoiler: la solución sale a las 21 h en historias.\n\nPista: el número entre paréntesis es la cantidad de letras.\n\n${cta} (enlace en la biografía).\n\n${tags}`,
    facebook_clue: `${hook}\n\n«${clue}»\n\n${ask} La solución sale hoy a las 21 h. Si querés jugar este y muchos más, entrá a ${clueUrl(c)}\n\n${tags.split(' ').slice(0, 3).join(' ')}`,
    x_clue: `${hook}\n\n«${clue}»\n\n${ask} Solución a las 21 h.`,
    threads_clue: `${hook}\n\n«${clue}»\n\n${ask} A las 21 h subo la solución.`,
    whatsapp_clue: `Buen día 👀 Este es el críptico de hoy:\n\n«${clue}»\n\nJugalo acá: ${clueUrl(c)}`,
    x_solution: fit280(`Solución de hoy: ${c.answer} ✅\n\n${steps(c).join(' ')}`, '\n\nMañana a las 9 hay otro. playcripticos.com'),
    threads_solution: `Solución: ${c.answer} ✅\n\n${steps(c).join('\n')}\n\n¿Lo habías sacado?`,
    instagram_story: `Solución del críptico de hoy: ${c.answer}.`,
    video_title: pick(['¿Sacaste el críptico de hoy?', 'Así se resuelve el críptico de hoy', '¿Lo sacás antes que termine el video?'], n),
    video_desc: `«${clue}» Solución y explicación al final. ${pick(CTA, n + 1)} #críptico #juegosdepalabras #acertijos`,
  };
}

// ── Selección de crípticos ──
// Los del día salen de los 63 originales nuevos; carruseles y fin de semana, de los 41 anteriores.
function assign(clues) {
  const newer = clues.slice(41);
  const older = clues.slice(0, 41);
  // Rampa: la primera semana, los más fáciles y variados; después se mezclan.
  const byDiff = [...newer].sort((a, b) => a.difficulty - b.difficulty);
  const easy = byDiff.filter((c) => c.difficulty === 1);
  const rest = byDiff.filter((c) => c.difficulty > 1);
  const daily = [];
  const seenMech = new Set();
  // Semana 1: siete fáciles de mecanismos distintos si se puede.
  for (const c of easy) if (daily.length < 7 && !seenMech.has(c.mechanism)) { daily.push(c); seenMech.add(c.mechanism); }
  for (const c of easy) if (daily.length < 7 && !daily.includes(c)) daily.push(c);
  // Resto: alterna fácil y más difícil, y rota los mecanismos para no repetir el mismo juego dos días seguidos.
  const queues = (list) => {
    const by = {};
    for (const c of list) (by[c.mechanism] = by[c.mechanism] || []).push(c);
    const out = []; const keys = Object.keys(by).sort((x, y) => by[y].length - by[x].length);
    while (out.length < list.length) for (const k of keys) if (by[k].length) out.push(by[k].shift());
    return out;
  };
  const e2 = queues(easy.filter((c) => !daily.includes(c))); const r2 = queues(rest);
  const next = (q) => { const last = daily[daily.length - 1]; const i = q.findIndex((c) => !last || c.mechanism !== last.mechanism); return q.splice(i < 0 ? 0 : i, 1)[0]; };
  while (daily.length < DAYS && (e2.length || r2.length)) {
    if (r2.length) daily.push(next(r2));
    if (daily.length < DAYS && e2.length) daily.push(next(e2));
  }
  // Ejemplo de cada mecanismo para las lecciones (los anteriores al lanzamiento, en orden).
  const lessonExample = {};
  for (const m of Object.keys(MECH)) lessonExample[m] = older.find((c) => c.mechanism === m && !Object.values(lessonExample).includes(c))
    || newer.find((c) => c.mechanism === m && !daily.slice(0, DAYS).includes(c)) || newer.find((c) => c.mechanism === m);
  const used = new Set(Object.values(lessonExample));
  const pool = older.filter((c) => !used.has(c));
  const stepByStep = pool.splice(0, 13);
  const weekend = pool.splice(0, 16);
  return { daily: daily.slice(0, DAYS), spare: newer.filter((c) => !daily.slice(0, DAYS).includes(c)), lessonExample, stepByStep, weekend };
}

// Carruseles de lunes, miércoles y viernes.
function carouselSchedule() {
  const lessons = ['anagram', 'hidden', 'homophone', 'reversal', 'double_definition', 'charade', 'deletion', 'container', 'initials'];
  const existing = [
    { deck: 'c01-que-es-un-criptico', title: '¿Qué es un críptico?', slides: 6 },
    { deck: 'c02-cinco-trucos', title: 'Cinco trucos para empezar', slides: 7 },
    { deck: 'c04-escondido-a-la-vista', title: 'Escondido a la vista', slides: 5 },
    { deck: 'c03-desafio-rioplatense', title: 'Desafío rioplatense', slides: 5 },
  ];
  const order = [];
  for (let n = 0; n < DAYS; n++) if ([0, 2, 4].includes(n % 7)) order.push(n);
  // 26 lugares: 4 ya diseñados, 9 lecciones y 13 «así se resuelve», alternados.
  const kinds = [];
  existing.forEach((e) => kinds.push({ kind: 'existing', ...e }));
  let li = 0; let si = 0;
  while (kinds.length < order.length) {
    if (li < lessons.length && (kinds.length % 2 === 0 || si >= 13)) kinds.push({ kind: 'lesson', mech: lessons[li++] });
    else kinds.push({ kind: 'steps', index: si++ });
  }
  return order.map((n, i) => ({ n, ...kinds[i] }));
}

function buildPlan(clues) {
  const A = assign(clues);
  const caro = carouselSchedule();
  const days = [];
  const renders = [];   // qué archivo dibujar y con qué datos
  for (let n = 0; n < DAYS; n++) {
    const d = dateOf(n); const date = iso(d); const c = A.daily[n];
    const dir = `/social/d${String(n).padStart(2, '0')}`;
    const cap = captions(c, n);
    const pieces = [];
    const add = (slotKey, format, title, body, assets, extra = {}) => {
      const s = SLOTS[slotKey];
      if (!NETWORKS.includes(s.platform)) return;
      pieces.push({ id: `l60-d${String(n).padStart(2, '0')}-${slotKey}`, day: n, date, slot: slotKey, platform: s.platform, format, title, body,
        assets, time: s.time, scheduled_at: utc(date, s.time), schedule_note: s.why, link: extra.link || null, alt_text: extra.alt || null,
        hashtags: extra.hashtags || null, manual: s.platform === 'whatsapp', ...extra.more });
    };
    const label = `Críptico del día · ${human(d, n)}`;
    renders.push({ kind: 'clue', path: `${dir}/criptico.png`, clue: c, label, n });
    renders.push({ kind: 'solution', path: `${dir}/solucion.png`, clue: c, label: `Solución · ${human(d, n)}`, steps: steps(c) });
    renders.push({ kind: 'video', path: `${dir}/video.mp4`, clue: c, steps: steps(c), title: cap.video_title });
    const alt = `Imagen con el críptico del día: «${c.clue_text}». Fondo marfil y casilleros vacíos para la respuesta.`;
    add('whatsapp_clue', 'mensaje', `Día ${n} · WhatsApp · críptico`, cap.whatsapp_clue, [`${dir}/criptico.png`], { link: clueUrl(c), alt });
    add('instagram_clue', 'imagen', `Día ${n} · Instagram · críptico`, cap.instagram_clue, [`${dir}/criptico.png`], { alt });
    add('x_clue', 'post', `Día ${n} · X · críptico`, cap.x_clue, [`${dir}/criptico.png`], { alt });
    add('threads_clue', 'post', `Día ${n} · Threads · críptico`, cap.threads_clue, [`${dir}/criptico.png`], { alt });
    add('facebook_clue', 'imagen', `Día ${n} · Facebook · críptico`, cap.facebook_clue, [`${dir}/criptico.png`], { link: clueUrl(c), alt });
    if (n === 0) {
      renders.push({ kind: 'launch', path: `${dir}/lanzamiento.png` });
      const t = 'Hoy arranca Play Crípticos 🧩\n\nCrípticos en español, gratis y sin límite: cada pista esconde una palabra, con ayudas si te trabás y la explicación de cada solución.\n\nTodos los días a las 9 hay un críptico nuevo acá, y a las 21 la solución.\n\nEmpezá en playcripticos.com';
      const la = 'Anuncio: «Hoy arranca Play Crípticos». Crípticos en español, gratis y sin límite.';
      add('launch_ig', 'imagen', 'Día 0 · Instagram · lanzamiento', t + '\n\n#críptico #juegosdepalabras #acertijos #playcripticos', [`${dir}/lanzamiento.png`], { alt: la });
      add('launch_fb', 'imagen', 'Día 0 · Facebook · lanzamiento', t, [`${dir}/lanzamiento.png`], { alt: la, link: SITE });
      add('launch_x', 'post', 'Día 0 · X · lanzamiento', 'Hoy arranca Play Crípticos: crípticos en español, gratis y sin límite. Uno nuevo cada día a las 9. playcripticos.com', [`${dir}/lanzamiento.png`], { alt: la });
      add('launch_threads', 'post', 'Día 0 · Threads · lanzamiento', 'Hoy arranca Play Crípticos 🧩 Crípticos en español, gratis y sin límite. Cada mañana uno nuevo; cada noche, la solución. playcripticos.com', [`${dir}/lanzamiento.png`], { alt: la });
    }
    const car = caro.find((x) => x.n === n);
    if (car) {
      let files = []; let title; let text;
      if (car.kind === 'existing') {
        files = Array.from({ length: car.slides }, (_, i) => `/social/carruseles/${car.deck}/slide-${String(i + 1).padStart(2, '0')}.png`);
        title = car.title;
        text = `${car.title} 🔤\n\nDeslizá para verlo paso a paso y guardalo para cuando te trabes.\n\n${pick(CTA, n)} (enlace en la biografía).\n\n${pick(TAGS, n + 1)}`;
      } else if (car.kind === 'lesson') {
        const m = MECH[car.mech]; const ex = A.lessonExample[car.mech];
        const k = 6;
        for (let i = 1; i <= k; i++) files.push(`${dir}/carrusel-${String(i).padStart(2, '0')}.png`);
        renders.push({ kind: 'lesson', dir, mech: car.mech, m, ex, steps: steps(ex) });
        title = `Cómo funciona: ${m.short}`;
        text = `Cómo funciona: ${m.short} 💡\n\n${m.what}\n\nEn el carrusel te mostramos cómo reconocerlo y un ejemplo resuelto. Guardalo para la próxima vez que te trabes.\n\n${pick(CTA, n + 2)} (enlace en la biografía).\n\n${pick(TAGS, n)}`;
      } else {
        const ex = A.stepByStep[car.index];
        for (let i = 1; i <= 5; i++) files.push(`${dir}/carrusel-${String(i).padStart(2, '0')}.png`);
        renders.push({ kind: 'steps', dir, ex, steps: steps(ex) });
        title = 'Así se resuelve';
        text = `Así se resuelve 💡\n\n«${ex.clue_text}»\n\nPensalo antes de deslizar: en la última imagen está la respuesta y por qué.\n\n${pick(CTA, n + 1)} (enlace en la biografía).\n\n${pick(TAGS, n + 2)}`;
      }
      const alt = `Carrusel «${title}» de Play Crípticos.`;
      add('instagram_carousel', 'carrusel', `Día ${n} · Instagram · carrusel: ${title}`, text, files, { alt });
      add('facebook_carousel', 'carrusel', `Día ${n} · Facebook · carrusel: ${title}`, text.replace(' (enlace en la biografía)', ''), files, { alt, link: SITE });
    }
    if (n % 7 === 5 || n % 7 === 6) {
      const w = Math.floor(n / 7); const pair = A.weekend.slice(w * 2, w * 2 + 2);
      if (pair.length === 2) {
        const sat = n % 7 === 5;
        const file = `${dir}/${sat ? 'finde' : 'finde-soluciones'}.png`;
        renders.push({ kind: sat ? 'weekend' : 'weekend_solutions', path: file, pair, label: sat ? 'Dos para el finde' : 'Soluciones del finde' });
        const text = sat
          ? `Dos para el finde 🧩\n\n1. «${pair[0].clue_text}»\n2. «${pair[1].clue_text}»\n\n¿Cuál te salió primero? Las soluciones, mañana a las 12.\n\n${pick(TAGS, n)}`
          : `Soluciones del finde ✅\n\n1. ${pair[0].answer}: ${steps(pair[0]).join(' ')}\n2. ${pair[1].answer}: ${steps(pair[1]).join(' ')}\n\n¿Cuántas sacaste? ${pick(CTA, n)}`;
        const alt = sat ? `Dos crípticos para el fin de semana: «${pair[0].clue_text}» y «${pair[1].clue_text}».` : `Soluciones: ${pair[0].answer} y ${pair[1].answer}.`;
        add('instagram_weekend', 'imagen', `Día ${n} · Instagram · ${sat ? 'dos para el finde' : 'soluciones del finde'}`, text, [file], { alt });
        add('facebook_weekend', 'imagen', `Día ${n} · Facebook · ${sat ? 'dos para el finde' : 'soluciones del finde'}`, text, [file], { alt, link: SITE });
      }
    }
    const valt = `Video: el críptico «${c.clue_text}», una cuenta regresiva y la solución ${c.answer} explicada.`;
    add('tiktok_video', 'video', `Día ${n} · TikTok · video`, `${cap.video_title} ${cap.video_desc}`, [`${dir}/video.mp4`], { alt: valt });
    add('youtube_video', 'video', `Día ${n} · YouTube Shorts · video`, `${cap.video_title}\n\n${cap.video_desc}`, [`${dir}/video.mp4`], { alt: valt, more: { video_title: cap.video_title } });
    add('instagram_reel', 'reel', `Día ${n} · Instagram · reel`, `${cap.video_title} 🧩\n\n${cap.video_desc}`, [`${dir}/video.mp4`], { alt: valt });
    add('instagram_story', 'historia', `Día ${n} · Instagram · historia con la solución`, cap.instagram_story, [`${dir}/solucion.png`], { alt: `Solución: ${c.answer}. ${steps(c).join(' ')}`, link: clueUrl(c) });
    add('x_solution', 'post', `Día ${n} · X · solución`, cap.x_solution, [], {});
    add('threads_solution', 'post', `Día ${n} · Threads · solución`, cap.threads_solution, [], {});
    add('facebook_reel', 'reel', `Día ${n} · Facebook · reel`, `${cap.video_title}\n\n${cap.video_desc}`, [`${dir}/video.mp4`], { alt: valt });
    days.push({ n, date, weekday: WD[n % 7], label: human(d, n), clue: { slug: c.slug, clue: c.clue_text, answer: c.answer, mechanism: c.mechanism }, pieces });
  }
  return { campaign: CAMPAIGN, start: START, timezone: TZ, site: SITE, networks: NETWORKS, slots: Object.fromEntries(Object.entries(SLOTS).filter(([, v]) => NETWORKS.includes(v.platform))), days, renders, spare: A.spare.map((c) => c.slug) };
}

module.exports = { buildPlan, CAMPAIGN, START, DAYS, NETWORKS, SLOTS, MECH, steps };
