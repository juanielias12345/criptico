'use strict';

// Palabra oculta: la respuesta aparece letra por letra, seguida, dentro de un tramo de la pista.
const { L, N, LANG, result } = require('./common');

module.exports = {
  code: 'hidden',
  label: 'Palabra oculta',
  status: 'production',
  ops: ['hidden'],
  indicators: ['hidden'],
  shape: '{ "op":"hidden", "indicator":"<indicador>", "in":"<tramo exacto de la pista que la contiene>" }',
  rules: [
    'La respuesta aparece literalmente, sin cambiar ni saltar letras, dentro del tramo indicado de la pista.',
    'Se registran el tramo y las posiciones inicial y final (sin contar espacios ni signos).',
    'La respuesta no puede ser una palabra entera de la pista; si queda dentro de una sola palabra, va a revisión.',
  ],
  guide: [
    'Buscá una frase natural en la que la respuesta quede repartida entre el final de una palabra y el principio de la siguiente.',
    'Copiá en "in" exactamente ese tramo de la pista y usá un indicador de ocultamiento de la lista.',
  ],
  check(resolved, { row }) {
    const r = result();
    if (!resolved || resolved.op !== 'hidden') { r.error('mechanism_shape', 'El juego de palabras no es una palabra oculta.'); return r; }
    const seq = L(resolved.in);
    const start = seq.indexOf(resolved.value);
    if (start < 0) { r.error('hidden_absent', 'La respuesta no aparece literalmente en el tramo indicado.'); return r; }
    r.facts = { sequence: resolved.in, start, end: start + resolved.value.length - 1 };
    if (!N.phrase(row.clue_text, LANG).includes(N.phrase(resolved.in, LANG))) r.error('hidden_not_in_clue', 'El tramo no está escrito tal cual en la pista.');
    if (!resolved.indicator) r.error('indicator_missing', 'Falta el indicador de palabra oculta.');
    const ws = N.words(resolved.in, LANG);
    if (ws.includes(resolved.value)) r.error('hidden_whole_word', 'La respuesta está escrita entera en la pista.');
    // ¿cruza palabras?
    let pos = 0; const spans = ws.map((w) => { const s = pos; pos += w.length; return [s, pos - 1]; });
    const inside = spans.some(([a, b]) => start >= a && start + resolved.value.length - 1 <= b);
    r.facts.spans_words = !inside;
    if (inside) r.doubt('hidden_single_word', 'La respuesta queda dentro de una sola palabra de la pista.');
    return r;
  },
};
