'use strict';

// Homófono: la respuesta suena igual que una palabra de la pista en la pronunciación de la variante.
// Lo que suena igual en todo el español (h muda, b/v) se aprueba; lo que depende del seseo,
// solo en variantes con seseo; lo que depende del yeísmo (no es general en ninguna región) va a revisión.
const { result } = require('./common');
const es = require('../../lang/es');

module.exports = {
  code: 'homophone',
  label: 'Homófono',
  status: 'production',
  ops: ['homophone'],
  indicators: ['homophone'],
  shape: '{ "op":"homophone", "indicator":"<indicador>", "of":{ "op":"lit", "text":"<palabra de la pista>" } }',
  rules: [
    'La respuesta y la palabra de la pista se escriben distinto y suenan igual con los rasgos fonéticos de la variante.',
    'Se registra qué rasgo hace falta: ninguno (h muda, b/v), seseo o yeísmo.',
    'Si depende del yeísmo, o de un rasgo que la variante no tiene, no se aprueba automáticamente.',
  ],
  guide: [
    'Buscá una palabra que suene exactamente igual que la respuesta en la variante (h muda, b/v; con seseo, s/c/z) y escribila en la pista con un indicador de sonido de la lista.',
    'No confundas parecido de letras con igualdad de sonido.',
  ],
  check(resolved, { variant, phonetics }) {
    const r = result();
    if (!resolved || resolved.op !== 'homophone') { r.error('mechanism_shape', 'El juego de palabras no es un homófono.'); return r; }
    const a = resolved.sounds; const b = resolved.value;
    const features = (phonetics && phonetics[variant]) || [];
    const key = (f) => [es.phoneticKey(a, f), es.phoneticKey(b, f)];
    const eq = (f) => { const [x, y] = key(f); return x === y; };
    let needs = null;
    if (eq([])) needs = 'ninguno';
    else if (eq(['seseo'])) needs = 'seseo';
    else if (eq(['yeismo'])) needs = 'yeismo';
    else if (eq(['seseo', 'yeismo'])) needs = 'seseo+yeismo';
    r.facts = { sounds_like: a, answer: b, feature_needed: needs, variant_features: features };
    if (a === b) r.error('homophone_same_spelling', 'Se escriben igual: no es un homófono.');
    if (!needs) { r.error('homophone_mismatch', 'No suenan igual.'); return r; }
    if (needs.includes('seseo') && !features.includes('seseo')) r.error('homophone_variant', 'Solo suenan igual con seseo, y esta variante no sesea.');
    if (needs.includes('yeismo')) r.doubt('homophone_regional_unverified', 'Depende del yeísmo, que no es general en toda la región: necesita revisión humana.');
    if (!resolved.verified) r.doubt('homophone_unverified', 'El validador no pudo comprobar la igualdad de sonido.');
    if (!resolved.indicator) r.error('indicator_missing', 'Falta el indicador de homófono.');
    return r;
  },
};
