'use strict';

// Anagrama: las letras de palabras escritas en la pista se reordenan para formar la respuesta.
// Tildes, espacios y signos no cuentan; la Ñ es una letra distinta de la N.
const { L, result, isLeaf } = require('./common');

module.exports = {
  code: 'anagram',
  label: 'Anagrama',
  status: 'production',
  ops: ['anagram'],
  indicators: ['anagram'],
  shape: '{ "op":"anagram", "indicator":"<indicador de la pista>", "of":[{ "op":"lit", "text":"<palabras de la pista>" }] }',
  rules: [
    'El material del anagrama son palabras que están escritas en la pista («lit»): no se anagrama un sinónimo.',
    'Las letras del material y de la respuesta coinciden exactamente (multiconjunto); tildes, espacios y signos no cuentan, la Ñ no equivale a N.',
    'Hay un indicador de anagrama de la lista y el material no está ya en el orden de la respuesta.',
  ],
  guide: [
    'Elegí como material una palabra o expresión natural cuya suma de letras sea exactamente la de la respuesta.',
    'Escribí el material tal cual en la pista y poné un indicador de desorden de la lista junto a él.',
    'Evitá material que comparta casi todas sus letras en el mismo orden que la respuesta.',
  ],
  check(resolved) {
    const r = result();
    if (!resolved || resolved.op !== 'anagram') { r.error('mechanism_shape', 'El juego de palabras no es un anagrama.'); return r; }
    const of = Array.isArray(resolved.of) ? resolved.of : [resolved.of];
    if (!of.every((p) => p && p.op === 'lit')) r.error('anagram_indirect', 'El material del anagrama tiene que estar escrito en la pista, no ser un sinónimo.');
    if (!resolved.indicator) r.error('indicator_missing', 'Falta el indicador de anagrama.');
    const source = of.map((p) => L(p.text)).join('');
    const target = resolved.value;
    r.facts = { fodder: of.map((p) => p.text), source, target, sorted: [...target].sort().join('') };
    if ([...source].sort().join('') !== [...target].sort().join('')) r.error('anagram_letters', 'Las letras del material no coinciden con las de la respuesta.');
    // material casi en el mismo orden: no hay anagrama real
    let same = 0; for (let k = 0; k < Math.min(source.length, target.length); k++) if (source[k] === target[k]) same++;
    if (target.length >= 4 && same / target.length >= 0.75) r.doubt('anagram_transparent', 'El material está casi en el mismo orden que la respuesta.');
    if (of.some((p) => !isLeaf(p))) r.facts.nested = true;
    return r;
  },
};
