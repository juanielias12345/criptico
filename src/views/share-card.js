'use strict';

// Tarjeta para compartir un resultado (SVG). No incluye nombre, correo ni identificadores:
// solo el críptico y lo que la persona eligió mostrar.

const { esc } = require('./layout');

const TXT = {
  es: { solved: 'Resuelto', revealed: 'Respuesta revelada', abandoned: 'Sin resolver', expired: 'Tiempo agotado', error: 'Sin resolver',
    difficulty: 'Dificultad', time: 'Tiempo', no_hints: 'Sin pistas', answer: 'Respuesta', play: 'Jugá en', lang: { es: 'Español', en: 'Inglés' } },
  en: { solved: 'Solved', revealed: 'Answer revealed', abandoned: 'Not solved', expired: 'Time up', error: 'Not solved',
    difficulty: 'Difficulty', time: 'Time', no_hints: 'No hints', answer: 'Answer', play: 'Play at', lang: { es: 'Spanish', en: 'English' } },
};

function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

// Parte la pista en renglones de hasta ~30 caracteres.
function wrap(text, max = 30) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}

function cardText(c, lang) {
  const T = TXT[lang];
  return {
    result: T[c.result] || T.abandoned,
    meta: [`${T.difficulty} ${c.difficulty}/5`, T.lang[c.language] || c.language.toUpperCase(), c.variant || null, c.time_ms ? `${T.time} ${fmtTime(c.time_ms)}` : null,
      c.no_hints ? T.no_hints : null].filter(Boolean).join(' · '),
    answer: c.answer ? `${T.answer}: ${c.answer}` : null,
  };
}

function svg(c, lang, config) {
  const x = cardText(c, lang);
  const lines = wrap(c.clue);
  const host = String(config.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const ok = c.result === 'solved';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${esc(x.result + ' — ' + c.clue)}">
  <rect width="1200" height="630" fill="#f4ede1"/>
  <rect x="40" y="40" width="1120" height="550" fill="#fbf8f1" stroke="#1a1712" stroke-width="2"/>
  <rect x="80" y="84" width="56" height="56" fill="#d8432a"/>
  <path d="M98 96 124 112 98 128z" fill="#fbf8f1"/>
  <text x="156" y="124" font-family="Georgia, 'Times New Roman', serif" font-size="34" fill="#1a1712"><tspan fill="#d8432a" font-style="italic">Play</tspan> Crípticos</text>
  <text x="1120" y="124" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="${ok ? '#2b654b' : '#8a5c0c'}">${esc((ok ? '✓ ' : '') + x.result)}</text>
  ${lines.map((l, i) => `<text x="80" y="${250 + i * 64}" font-family="Georgia, 'Times New Roman', serif" font-size="52" fill="#1a1712">${esc(l)}</text>`).join('\n  ')}
  <text x="80" y="${250 + lines.length * 64 + 20}" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#5a5247">${esc(x.meta)}</text>
  ${x.answer ? `<text x="80" y="${250 + lines.length * 64 + 66}" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="#1a1712">${esc(x.answer)}</text>` : ''}
  <text x="80" y="550" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#5a5247">${esc(TXT[lang].play + ' ' + host)}</text>
</svg>`;
}

module.exports = { svg, cardText, fmtTime };
