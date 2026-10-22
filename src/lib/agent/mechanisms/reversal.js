'use strict';

// Inversión: un elemento (palabra de la pista, sinónimo o abreviatura) se lee al revés entero.
const { result, leaves } = require('./common');

module.exports = {
  code: 'reversal',
  label: 'Inversión',
  status: 'production',
  ops: ['reverse'],
  indicators: ['reversal'],
  shape: '{ "op":"reverse", "indicator":"<indicador>", "of":{ "op":"lit"|"syn", ... } }',
  rules: [
    'Se identifica la palabra de origen y se invierte completa: no hay inversiones parciales en este mecanismo.',
    'El origen leído al revés da exactamente la respuesta, y no es un palíndromo (invertirlo no cambia nada).',
  ],
  guide: [
    'Buscá una palabra de origen que, leída al revés, sea la respuesta. Puede estar escrita en la pista o llegar por un sinónimo respaldado.',
    'Usá un indicador de inversión de la lista.',
  ],
  check(resolved) {
    const r = result();
    if (!resolved || resolved.op !== 'reverse') { r.error('mechanism_shape', 'El juego de palabras no es una inversión.'); return r; }
    const source = resolved.of && resolved.of.value;
    r.facts = { source, result: resolved.value, partial: false, pieces: leaves(resolved.of) };
    if (!source || [...source].reverse().join('') !== resolved.value) r.error('reversal_mismatch', 'El origen al revés no da la respuesta.');
    if (source === resolved.value) r.error('reversal_palindrome', 'El origen es un palíndromo: invertirlo no cambia nada.');
    if (!resolved.indicator) r.error('indicator_missing', 'Falta el indicador de inversión.');
    return r;
  },
};
