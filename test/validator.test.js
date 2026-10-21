'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/lib/normalize');
const { validateClue } = require('../src/lib/validator');
const { generate } = require('../src/lib/generator');
const es = require('../seed/clues.es.json');
const en = require('../seed/clues.en.json');

const v = (c, lang) => validateClue({ ...c, clue_text: c.clue, language_code: lang, variant_code: c.variant || null });

test('normalización: mayúsculas, espacios, signos y tildes; la Ñ es distinta de la N', () => {
  assert.equal(N.answerKey('  Panamá! ', 'es'), 'PANAMA');
  assert.equal(N.answerKey('sar-tén', 'es'), 'SARTEN');
  assert.equal(N.answerKey('año', 'es'), 'AÑO');
  assert.notEqual(N.answerKey('año', 'es'), N.answerKey('ano', 'es'));
  assert.equal(N.answerKey('pingüino', 'es'), 'PINGUINO');
  assert.equal(N.answerKey('café', 'en'), 'CAFE');
  assert.equal(N.answerKey('ñ', 'es'), 'Ñ', 'Ñ descompuesta (n + tilde combinable) también se reconoce');
  assert.equal(N.enumerationOf('CASA MIENTO', 'es'), '4,6');
  assert.equal(N.enumerationOf('AÑO', 'es'), '3');
});

test('todo el catálogo semilla supera la validación sin errores ni avisos', () => {
  for (const [list, lang] of [[es, 'es'], [en, 'en']]) {
    for (const c of list) {
      const r = v(c, lang);
      const issues = r.checks.filter((x) => x.level !== 'ok');
      assert.equal(r.errors, 0, `${c.clue}: ${JSON.stringify(issues)}`);
      assert.equal(issues.length, 0, `${c.clue}: ${JSON.stringify(issues)}`);
      assert.ok(['verified', 'asserted'].includes(r.status));
      assert.ok(r.explanation && r.explanation.length >= 2, 'tiene explicación generada');
      assert.ok(r.explanation.at(-1).includes(c.answer.toUpperCase()), 'la explicación termina en la respuesta');
    }
  }
  assert.ok(es.length >= 40 && en.length >= 35);
});

test('una respuesta incorrecta no pasa: el juego de palabras no la produce (#25)', () => {
  const r = validateClue({ clue_text: 'Ramo revuelto para el sentimiento (4)', answer: 'MORA', definition: 'el sentimiento', language_code: 'es',
    wordplay: { op: 'anagram', indicator: 'revuelto', of: [{ op: 'lit', text: 'ramo' }] } });
  assert.equal(r.status, 'verified', 'MORA sí es anagrama de RAMO: la mecánica cuadra');
  const bad = validateClue({ clue_text: 'Ramo revuelto para el sentimiento (4)', answer: 'ODIO', definition: 'el sentimiento', language_code: 'es',
    wordplay: { op: 'anagram', indicator: 'revuelto', of: [{ op: 'lit', text: 'ramo' }] } });
  assert.equal(bad.status, 'failed');
  assert.ok(bad.checks.some((c) => c.code === 'wordplay_mismatch'));
});

test('detecta enumeración incorrecta, respuesta en la pista, definición ausente e indicador inexistente', () => {
  const base = { answer: 'AMOR', definition: 'el sentimiento', language_code: 'es', wordplay: { op: 'anagram', indicator: 'revuelto', of: [{ op: 'lit', text: 'ramo' }] } };
  assert.ok(validateClue({ ...base, clue_text: 'Ramo revuelto para el sentimiento (5)' }).checks.some((c) => c.code === 'enumeration_mismatch'));
  assert.ok(validateClue({ ...base, clue_text: 'Ramo revuelto para el sentimiento' }).checks.some((c) => c.code === 'enumeration_missing'));
  assert.ok(validateClue({ ...base, clue_text: 'Ramo revuelto: amor (4)', definition: 'amor' }).checks.some((c) => c.code === 'answer_in_clue'));
  assert.ok(validateClue({ ...base, clue_text: 'Ramo revuelto para la pasión (4)' }).checks.some((c) => c.code === 'definition_not_in_clue'));
  assert.ok(validateClue({ ...base, clue_text: 'Ramo loco para el sentimiento (4)' }).checks.some((c) => c.code === 'indicator_not_in_clue'));
});

test('palabra oculta que aparece completa no se considera oculta', () => {
  const r = validateClue({ clue_text: 'El oso guarda un animal (3)', answer: 'OSO', definition: 'un animal', language_code: 'es',
    wordplay: { op: 'hidden', indicator: 'guarda', in: 'El oso' } });
  assert.ok(r.checks.some((c) => c.code === 'hidden_not_hidden'));
});

test('homófonos regionales: CASA/CAZA vale con seseo (es-AR) y no en España ni como general', () => {
  const c = es.find((x) => x.answer === 'CASA');
  assert.equal(v(c, 'es').errors, 0);
  const spain = v({ ...c, variant: 'es-ES' }, 'es');
  assert.equal(spain.status, 'failed');
  assert.ok(spain.checks.some((x) => x.code === 'homophone_variant'));
  const general = v({ ...c, variant: null }, 'es');
  assert.equal(general.status, 'failed', 'para todas las variantes no vale');
  const farther = en.find((x) => x.answer === 'FARTHER');
  assert.equal(v({ ...farther, variant: 'en-US' }, 'en').status, 'failed', 'FATHER/FARTHER no es homófono en inglés americano');
});

test('abreviaturas propias de una variante: TA = thanks solo en inglés británico', () => {
  const c = en.find((x) => x.answer === 'STAIN');
  assert.equal(v(c, 'en').errors, 0);
  assert.ok(v({ ...c, variant: 'en-US' }, 'en').checks.some((x) => x.code === 'abbreviation_variant'));
});

test('un desglose malicioso o enorme no cuelga el validador', () => {
  const deep = { op: 'concat', parts: Array.from({ length: 30 }, () => ({ op: 'insert', indicator: 'en', outer: { op: 'lit', text: 'abcdefgh' }, inner: { op: 'lit', text: 'ab' } })) };
  const t0 = Date.now();
  const r = validateClue({ clue_text: 'abcdefgh ab en algo (4)', answer: 'ABCD', definition: 'algo', language_code: 'es', wordplay: deep });
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(r.status, 'failed');
});

test('el generador solo entrega crípticos que el validador acepta', () => {
  for (const lang of ['es', 'en']) {
    const out = generate(lang, { seed: 3, limit: 60 });
    assert.ok(out.length >= 30, `${lang}: ${out.length}`);
    for (const c of out) {
      const r = validateClue({ ...c, clue_text: c.clue, language_code: lang });
      assert.equal(r.errors, 0, c.clue);
      assert.match(c.clue, /\(\d+\)$/);
    }
  }
});
