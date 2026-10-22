'use strict';

// Iniciales (acróstico): la respuesta sale de las primeras letras de palabras seguidas de la pista.
const { result, N, LANG } = require('./common');

module.exports = {
  code: 'initials',
  label: 'Iniciales',
  status: 'production',
  ops: ['initials'],
  indicators: ['initials'],
  shape: '{ "op":"initials", "indicator":"<indicador>", "in":"<tramo de la pista>" }',
  rules: [
    'Las iniciales de las palabras del tramo, en orden, dan exactamente la respuesta.',
    'El tramo tiene al menos tres palabras y está escrito tal cual en la pista.',
  ],
  guide: [
    'Escribí una frase natural cuyas palabras seguidas empiecen con las letras de la respuesta, en orden, e indicá con la lista que se toman las iniciales.',
  ],
  check(resolved, { row }) {
    const r = result();
    if (!resolved || resolved.op !== 'initials') { r.error('mechanism_shape', 'El juego de palabras no es de iniciales.'); return r; }
    const ws = N.words(resolved.in, LANG);
    r.facts = { sequence: resolved.in, words: ws, result: ws.map((w) => w[0]).join('') };
    if (r.facts.result !== resolved.value) r.error('initials_mismatch', 'Las iniciales no dan la respuesta.');
    if (ws.length < 3) r.error('initials_short', 'Hacen falta al menos tres palabras.');
    if (!N.phrase(row.clue_text, LANG).includes(N.phrase(resolved.in, LANG))) r.error('initials_not_in_clue', 'El tramo no está escrito tal cual en la pista.');
    if (!resolved.indicator) r.error('indicator_missing', 'Falta el indicador de iniciales.');
    return r;
  },
};
