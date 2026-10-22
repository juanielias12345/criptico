'use strict';

// Doble definición: dos definiciones independientes, de sentidos distintos, de la misma respuesta.
const { result, N, LANG } = require('./common');

module.exports = {
  code: 'double_definition',
  label: 'Doble definición',
  status: 'production',
  ops: ['double'],
  indicators: [],
  shape: '{ "op":"double", "definitions":["<definición 1>","<definición 2>"] } (las dos de la lista dada)',
  rules: [
    'Exactamente dos definiciones, cada una respaldada por el léxico para la respuesta.',
    'Corresponden a sentidos distintos de la palabra: una no repite a la otra (ni la misma palabra ni la misma raíz ni el mismo sentido).',
  ],
  guide: [
    'Elegí dos definiciones de la lista que correspondan a significados distintos de la respuesta y unilas en una frase natural, con a lo sumo una palabra de enlace.',
  ],
  check(resolved, { L, slot }) {
    const r = result();
    if (!resolved || resolved.op !== 'double') { r.error('mechanism_shape', 'El juego de palabras no es una doble definición.'); return r; }
    const defs = resolved.definitions || [];
    if (defs.length !== 2) { r.error('double_count', 'Hacen falta exactamente dos definiciones.'); return r; }
    const sup = defs.map((d) => L.supports(slot.answerText, String(d).toLowerCase()));
    r.facts = { definitions: defs, senses: sup.map((s) => (s ? s.synset : null)) };
    sup.forEach((s, k) => { if (!s) r.doubt('double_unsupported', `«${defs[k]}» no define la respuesta según el léxico.`); });
    const [a, b] = defs.map((d) => N.words(d, LANG));
    if (a.join(' ') === b.join(' ') || a.some((w) => w.length >= 4 && b.some((x) => x.length >= 4 && x.slice(0, 4) === w.slice(0, 4)))) r.error('double_repeated', 'Una definición repite a la otra.');
    if (sup[0] && sup[1] && sup[0].sense === sup[1].sense) r.error('double_same_sense', 'Las dos definiciones corresponden al mismo sentido de la palabra.');
    return r;
  },
};
