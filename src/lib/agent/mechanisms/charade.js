'use strict';

// Charada: la respuesta se arma uniendo dos o más piezas, cada una salida de la pista.
const { result, leaves, isLeaf } = require('./common');

module.exports = {
  code: 'charade',
  label: 'Charada',
  status: 'production',
  ops: ['concat'],
  indicators: ['charade'],
  shape: '{ "op":"concat", "parts":[{...},{...}] } (piezas lit, syn, abbr o letter)',
  rules: [
    'Dos o más piezas, cada una literal de la pista, sinónimo respaldado por el léxico, abreviatura de la tabla o nombre de letra.',
    'Unidas en orden dan exactamente la respuesta; ninguna pieza es casi la respuesta entera.',
    'Las abreviaturas usadas se registran con su interpretación.',
  ],
  guide: [
    'Partí la respuesta en piezas que tengan sentido propio (palabras, sinónimos, abreviaturas de la tabla) y escribí una frase natural con ellas en orden.',
    'No inventes piezas: cada una tiene que poder justificarse con la pista.',
  ],
  check(resolved) {
    const r = result();
    if (!resolved || resolved.op !== 'concat') { r.error('mechanism_shape', 'El juego de palabras no es una charada.'); return r; }
    const parts = resolved.parts || [];
    r.facts = { components: leaves(resolved), result: resolved.value };
    if (parts.length < 2) r.error('charade_parts', 'Una charada necesita al menos dos piezas.');
    if (!parts.every(isLeaf)) r.error('mechanism_shape', 'Las piezas de una charada simple son palabras, sinónimos, abreviaturas o letras.');
    if (parts.map((p) => p.value).join('') !== resolved.value) r.error('charade_mismatch', 'Las piezas unidas no dan la respuesta.');
    if (parts.some((p) => p.value && p.value.length >= resolved.value.length - 1)) r.doubt('charade_trivial', 'Una pieza es casi la respuesta entera.');
    return r;
  },
};
