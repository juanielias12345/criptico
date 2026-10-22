'use strict';

// Combinación: más de una operación (por ejemplo, una charada con una pieza invertida).
// Cada paso lo resuelve el validador por separado; se registran el orden, el principal y los secundarios.
const { result, walk } = require('./common');
const { OP_TO_MECHANISM } = require('../../validator/wordplay');

const STEP = new Set(['anagram', 'reverse', 'insert', 'delete', 'hidden', 'initials', 'homophone', 'concat']);

module.exports = {
  code: 'combination',
  label: 'Combinación',
  status: 'production',
  ops: ['concat', 'insert', 'reverse', 'delete', 'anagram'],
  indicators: ['reversal', 'anagram', 'container', 'insertion', 'deletion_first', 'deletion_last', 'charade'],
  shape: 'combinación: una charada o inserción que contiene otro mecanismo (inversión, anagrama, eliminación)',
  rules: [
    'Dos o más operaciones distintas; cada una se reproduce por separado y el resultado final es la respuesta.',
    'El mecanismo principal es la operación exterior; los demás se guardan como secundarios, en el orden en que se aplican.',
    'Una operación que no se pueda reproducir rechaza la pista.',
  ],
  guide: [
    'Combiná a lo sumo dos operaciones de forma clara (por ejemplo, charada con una pieza invertida, o inserción de una abreviatura en un sinónimo).',
    'Cada operación lleva su propio indicador de la lista.',
  ],
  check(resolved) {
    const r = result();
    if (!resolved) { r.error('mechanism_shape', 'Sin desglose.'); return r; }
    const steps = [];
    // de adentro hacia afuera: orden en que se aplican
    const visit = (n) => {
      if (!n || typeof n !== 'object') return;
      for (const k of ['of', 'outer', 'inner']) { if (Array.isArray(n[k])) n[k].forEach(visit); else visit(n[k]); }
      (n.parts || []).forEach(visit);
      if (STEP.has(n.op)) steps.push({ op: n.op, mechanism: OP_TO_MECHANISM[n.op], value: n.value });
    };
    visit(resolved);
    const mechs = [...new Set(steps.map((s) => s.mechanism))];
    const primary = OP_TO_MECHANISM[resolved.op];
    r.facts = { primary, secondary: mechs.filter((m) => m !== primary), order: steps };
    if (mechs.length < 2) r.error('combination_single', 'Solo hay una operación: no es una combinación.');
    if (steps.some((s) => !s.value)) r.error('combination_step', 'Una de las operaciones no se pudo reproducir.');
    if (steps.length > 3) r.doubt('combination_complex', 'Demasiadas operaciones encadenadas.');
    let n = 0; walk(resolved, (x) => { if (x.indicator) n++; });
    if (n < steps.filter((s) => s.op !== 'concat').length) r.error('indicator_missing', 'Falta el indicador de alguna operación.');
    return r;
  },
};
