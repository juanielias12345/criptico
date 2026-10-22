'use strict';

// Inserción: un elemento se mete dentro de otro, que queda partido en dos.
const { result, leaves } = require('./common');

module.exports = {
  code: 'container',
  label: 'Inserción',
  status: 'production',
  ops: ['insert'],
  indicators: ['container', 'insertion'],
  shape: '{ "op":"insert", "indicator":"<indicador>", "outer":{...}, "inner":{...} }',
  rules: [
    'Se identifican el elemento exterior y el insertado; cada uno sale de la pista (literal, sinónimo o abreviatura).',
    'El exterior queda partido en dos tramos no vacíos y el insertado va entre ellos: la longitud y el orden de letras dan la respuesta.',
  ],
  guide: [
    'Elegí un exterior y un interior que, al meter uno en el otro, den la respuesta; cada pieza tiene que estar en la pista o llegar por sinónimo o abreviatura de la tabla.',
    'Usá un indicador de inserción de la lista que deje claro qué va adentro de qué.',
  ],
  check(resolved) {
    const r = result();
    if (!resolved || resolved.op !== 'insert') { r.error('mechanism_shape', 'El juego de palabras no es una inserción.'); return r; }
    const outer = resolved.outer && resolved.outer.value; const inner = resolved.inner && resolved.inner.value;
    const at = outer && inner ? [...Array(outer.length + 1).keys()].find((k) => outer.slice(0, k) + inner + outer.slice(k) === resolved.value) : undefined;
    r.facts = { outer, inner, position: at, result: resolved.value, pieces: leaves(resolved) };
    if (at === undefined) r.error('container_mismatch', 'Insertar el elemento en el exterior no da la respuesta.');
    else if (at === 0 || at === outer.length) r.error('container_not_inside', 'El elemento queda pegado al principio o al final: es una charada, no una inserción.');
    if (!resolved.indicator) r.error('indicator_missing', 'Falta el indicador de inserción.');
    return r;
  },
};
