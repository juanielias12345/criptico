'use strict';

// Eliminación: a una palabra de origen se le quita exactamente lo que indica la pista.
const { result, L, leaves } = require('./common');
const { applyDelete } = require('../../validator/wordplay');

module.exports = {
  code: 'deletion',
  label: 'Eliminación',
  status: 'production',
  ops: ['delete'],
  indicators: ['deletion_first', 'deletion_last', 'deletion_letter'],
  shape: '{ "op":"delete", "indicator":"<indicador>", "remove":"first"|"last"|"<letras>", "of":{...} }',
  rules: [
    'Se registran la palabra de origen y exactamente lo que se quita: la primera letra, la última o unas letras concretas.',
    'Quitar eso da la respuesta letra por letra; si la eliminación indicada admite más de un resultado, va a revisión.',
  ],
  guide: [
    'Partí de una palabra de origen (en la pista o por sinónimo respaldado) que al quitarle la primera letra, la última o unas letras concretas dé la respuesta.',
    'El indicador de la lista tiene que decir qué se quita (cabeza, cola o la letra nombrada).',
  ],
  check(resolved) {
    const r = result();
    if (!resolved || resolved.op !== 'delete') { r.error('mechanism_shape', 'El juego de palabras no es una eliminación.'); return r; }
    const source = resolved.of && resolved.of.value;
    const outs = source ? applyDelete(source, resolved.remove, 'es') : [];
    const removed = resolved.remove === 'first' ? (source || '').slice(0, 1) : resolved.remove === 'last' ? (source || '').slice(-1) : L(resolved.remove);
    r.facts = { source, remove: resolved.remove, removed, result: resolved.value, pieces: leaves(resolved.of) };
    if (!outs.includes(resolved.value)) r.error('deletion_mismatch', 'Quitar lo indicado no da la respuesta.');
    if (new Set(outs).size > 1) r.doubt('deletion_ambiguous', `La eliminación indicada admite varios resultados: ${[...new Set(outs)].join(', ')}.`);
    if (!removed) r.error('deletion_empty', 'No se elimina nada.');
    if (!resolved.indicator) r.error('indicator_missing', 'Falta el indicador de eliminación.');
    return r;
  },
};
