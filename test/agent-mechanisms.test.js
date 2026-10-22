'use strict';

// Agentes por mecanismo: cada validador acepta los casos válidos y rechaza las
// transformaciones incorrectas. Los casos válidos pasan primero por el validador
// general (que rearma la respuesta letra por letra) y después por el del mecanismo;
// los inválidos que el validador general ya no deja pasar se prueban sobre el árbol.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateClue } = require('../src/lib/validator');
const MECH = require('../src/lib/agent/mechanisms');
const llm = require('../src/lib/agent/llm');

const PHON = { 'es-AR': ['seseo', 'yeismo'], 'es-ES': ['yeismo'], 'es-MX': ['seseo', 'yeismo'] };
const solve = (clue, answer, wordplay, definition, variant = 'es-AR') => {
  const r = validateClue({ clue_text: clue, answer, definition, wordplay, language_code: 'es', variant_code: variant }, { phonetics: PHON });
  assert.ok(r.resolved, `el validador general resuelve «${clue}»: ${JSON.stringify(r.checks.filter((c) => c.level === 'error'))}`);
  return r.resolved;
};
const codes = (r) => [...r.errors.map((e) => e.code), ...r.review.map((e) => 'doubt:' + e.code)];
const run = (code, resolved, ctx = {}) => MECH.get(code).check(resolved, { row: { clue_text: ctx.clue || '' }, variant: 'es-AR', phonetics: PHON, ...ctx });

test('taxonomía: diez agentes en producción y las categorías no automatizables explicadas', () => {
  assert.deepEqual(MECH.production(), ['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone', 'double_definition', 'initials', 'combination']);
  const tax = MECH.taxonomy();
  for (const code of ['direct_definition', 'abbreviation', 'cryptic_definition', 'regional_wordplay']) {
    const x = tax.find((t) => t.code === code);
    assert.ok(x && x.status !== 'production' && x.rules[0].length > 40, code);
  }
  for (const m of MECH.modules) {
    assert.ok(m.rules.length >= 2 && m.guide.length >= 1 && m.shape && m.label, m.code);
    // cada agente tiene sus propias instrucciones para el generador
    const sys = llm.generatorSystem(m.code);
    assert.match(sys, new RegExp('especialista en ' + m.label.toLowerCase()));
    for (const r of m.rules) assert.ok(sys.includes(r));
  }
});

test('anagrama: letras exactas, material escrito en la pista e indicador', () => {
  const ok = solve('Ramo revuelto para el sentimiento (4)', 'AMOR', { op: 'anagram', indicator: 'revuelto', of: [{ op: 'lit', text: 'Ramo' }] }, 'el sentimiento');
  const r = run('anagram', ok);
  assert.deepEqual(codes(r), []);
  assert.equal(r.facts.source, 'RAMO');
  // material que no es un literal de la pista
  assert.ok(codes(run('anagram', { ...ok, of: [{ op: 'syn', from: 'rama', text: 'ramo', value: 'RAMO' }] })).includes('anagram_indirect'));
  // letras que no coinciden
  assert.ok(codes(run('anagram', { ...ok, of: [{ op: 'lit', text: 'remo', value: 'REMO' }] })).includes('anagram_letters'));
  // sin indicador
  assert.ok(codes(run('anagram', { ...ok, indicator: '' })).includes('indicator_missing'));
  // casi en el mismo orden
  assert.ok(codes(run('anagram', { op: 'anagram', indicator: 'loco', of: [{ op: 'lit', text: 'caramleo' }], value: 'CARAMELO' })).includes('doubt:anagram_transparent'));
});

test('palabra oculta: aparece literal, se registran las posiciones y no vale la palabra entera', () => {
  const clue = 'Queso solo esconde un animal del bosque (3)';
  const ok = solve(clue, 'OSO', { op: 'hidden', indicator: 'esconde', in: 'queso solo' }, 'un animal del bosque');
  const r = run('hidden', ok, { clue });
  assert.deepEqual(codes(r), []);
  assert.deepEqual([r.facts.start, r.facts.end, r.facts.spans_words], [4, 6, true]);
  assert.ok(codes(run('hidden', { ...ok, value: 'XXX' }, { clue })).includes('hidden_absent'));
  assert.ok(codes(run('hidden', { op: 'hidden', indicator: 'en', in: 'el pasado', value: 'PASADO' }, { clue: 'en el pasado (6)' })).includes('hidden_whole_word'));
  assert.ok(codes(run('hidden', { op: 'hidden', indicator: 'esconde', in: 'el pasado', value: 'ASADO' }, { clue: 'El pasado esconde el plato (5)' })).includes('doubt:hidden_single_word'));
  assert.ok(codes(run('hidden', ok, { clue: 'Otra pista distinta (3)' })).includes('hidden_not_in_clue'));
});

test('inversión: el origen completo al revés da la respuesta; un palíndromo no vale', () => {
  const ok = solve('Amor de vuelta en la capital italiana (4)', 'ROMA', { op: 'reverse', indicator: 'de vuelta', of: { op: 'lit', text: 'amor' } }, 'la capital italiana');
  const r = run('reversal', ok);
  assert.deepEqual(codes(r), []);
  assert.deepEqual([r.facts.source, r.facts.result, r.facts.partial], ['AMOR', 'ROMA', false]);
  assert.ok(codes(run('reversal', { op: 'reverse', indicator: 'al revés', of: { op: 'lit', text: 'oso', value: 'OSO' }, value: 'OSO' })).includes('reversal_palindrome'));
  assert.ok(codes(run('reversal', { ...ok, of: { op: 'lit', text: 'mora', value: 'MORA' } })).includes('reversal_mismatch'));
});

test('inserción: exterior partido en dos y el insertado adentro', () => {
  const ok = solve('Peso que guarda al rey: un recluso (5)', 'PRESO', { op: 'insert', indicator: 'guarda', outer: { op: 'lit', text: 'peso' }, inner: { op: 'abbr', from: 'rey', text: 'R' } }, 'un recluso');
  const r = run('container', ok);
  assert.deepEqual(codes(r), []);
  assert.deepEqual([r.facts.outer, r.facts.inner, r.facts.position], ['PESO', 'R', 1]);
  // pegado al borde: es una charada, no una inserción
  assert.ok(codes(run('container', { op: 'insert', indicator: 'guarda', outer: { op: 'lit', value: 'PESO' }, inner: { op: 'abbr', value: 'S' }, value: 'PESOS' })).includes('container_not_inside'));
  assert.ok(codes(run('container', { ...ok, value: 'PROSE' })).includes('container_mismatch'));
});

test('eliminación: se registra exactamente lo que se quita; eliminaciones ambiguas a revisión', () => {
  const ok = solve('Saludo sin principio forma una onda en el mar (3)', 'OLA', { op: 'delete', indicator: 'sin principio', remove: 'first', of: { op: 'syn', from: 'saludo', text: 'HOLA' } }, 'una onda en el mar');
  const r = run('deletion', ok);
  assert.deepEqual(codes(r), []);
  assert.deepEqual([r.facts.source, r.facts.removed, r.facts.result], ['HOLA', 'H', 'OLA']);
  assert.ok(codes(run('deletion', { ...ok, remove: 'last' })).includes('deletion_mismatch'));
  // quitar una A de ANANA da ANNA de dos maneras distintas… y NANA también: ambigua
  assert.ok(codes(run('deletion', { op: 'delete', indicator: 'sin a', remove: 'a', of: { op: 'lit', value: 'ANANA' }, value: 'NANA' })).includes('doubt:deletion_ambiguous'));
});

test('charada: dos o más piezas justificadas que unidas dan la respuesta', () => {
  const ok = solve('Astro rey y cubo de juego para un militar (7)', 'SOLDADO', { op: 'concat', parts: [{ op: 'syn', from: 'astro rey', text: 'SOL' }, { op: 'syn', from: 'cubo de juego', text: 'DADO' }] }, 'un militar');
  const r = run('charade', ok);
  assert.deepEqual(codes(r), []);
  assert.equal(r.facts.components.length, 2);
  assert.ok(codes(run('charade', { op: 'concat', parts: [{ op: 'syn', value: 'SOLDADO' }], value: 'SOLDADO' })).includes('charade_parts'));
  assert.ok(codes(run('charade', { ...ok, value: 'SOLDADOS' })).includes('charade_mismatch'));
  assert.ok(codes(run('charade', { op: 'concat', parts: [{ op: 'lit', value: 'SOLDAD' }, { op: 'letter', value: 'O' }], value: 'SOLDADO' })).includes('doubt:charade_trivial'));
});

test('homófono: vale la pronunciación de la variante; el yeísmo va a revisión', () => {
  const tree = (a, b) => ({ op: 'homophone', indicator: 'suena a', of: { op: 'syn', value: a }, sounds: a, value: b, verified: true });
  // h muda y b/v: igual en todo el español
  assert.deepEqual(codes(run('homophone', tree('VACA', 'BACA'), { variant: 'es-ES' })), []);
  // depende del seseo: vale en es-AR, no en es-ES
  assert.deepEqual(codes(run('homophone', tree('CAZA', 'CASA'), { variant: 'es-AR' })), []);
  assert.ok(codes(run('homophone', tree('CAZA', 'CASA'), { variant: 'es-ES' })).includes('homophone_variant'));
  // depende del yeísmo: no es general, nunca se aprueba solo
  assert.ok(codes(run('homophone', tree('CALLO', 'CAYO'), { variant: 'es-AR' })).includes('doubt:homophone_regional_unverified'));
  // se escriben igual, o no suenan igual
  assert.ok(codes(run('homophone', tree('CASA', 'CASA'))).includes('homophone_same_spelling'));
  assert.ok(codes(run('homophone', tree('MESA', 'CASA'))).includes('homophone_mismatch'));
  // con el validador general: BACA / VACA
  const ok = solve('Portaequipajes del coche, que suena a rumiante (4)', 'BACA', { op: 'homophone', indicator: 'suena a', of: { op: 'syn', from: 'rumiante', text: 'VACA' } }, 'Portaequipajes del coche');
  assert.equal(run('homophone', ok).facts.feature_needed, 'ninguno');
});

test('doble definición: dos sentidos distintos, ninguna repite a la otra', () => {
  const L = { supports: (w, d) => ({ 'entidad financiera': { synset: 's1', sense: 1 }, 'asiento': { synset: 's2', sense: 2 }, 'asiento largo': { synset: 's2', sense: 2 } }[d] || null) };
  const slot = { answerText: 'banco' };
  assert.deepEqual(codes(run('double_definition', { op: 'double', definitions: ['Entidad financiera', 'asiento'], value: 'BANCO' }, { L, slot })), []);
  assert.ok(codes(run('double_definition', { op: 'double', definitions: ['asiento', 'asiento largo'], value: 'BANCO' }, { L, slot })).includes('double_repeated'));
  const L2 = { supports: () => ({ synset: 's1', sense: 1 }) };
  assert.ok(codes(run('double_definition', { op: 'double', definitions: ['entidad financiera', 'casa de dinero'], value: 'BANCO' }, { L: L2, slot })).includes('double_same_sense'));
  assert.ok(codes(run('double_definition', { op: 'double', definitions: ['entidad financiera'], value: 'BANCO' }, { L, slot })).includes('double_count'));
  assert.ok(codes(run('double_definition', { op: 'double', definitions: ['entidad financiera', 'pez'], value: 'BANCO' }, { L, slot })).includes('doubt:double_unsupported'));
});

test('iniciales: al menos tres palabras escritas en la pista', () => {
  const clue = 'Agua salada: al principio, mira arenas remotas (3)';
  const ok = solve(clue, 'MAR', { op: 'initials', indicator: 'al principio', in: 'mira arenas remotas' }, 'Agua salada');
  assert.deepEqual(codes(run('initials', ok, { clue })), []);
  assert.ok(codes(run('initials', { op: 'initials', indicator: 'al principio', in: 'mira arenas', value: 'MA' }, { clue: 'al principio mira arenas (2)' })).includes('initials_short'));
  assert.ok(codes(run('initials', { ...ok, value: 'MAX' }, { clue })).includes('initials_mismatch'));
});

test('combinación: cada paso se reproduce; se registran el principal y los secundarios', () => {
  const ok = solve('Acera porteña: mirar los años sin final (6)', 'VEREDA',
    { op: 'concat', parts: [{ op: 'syn', from: 'mirar', text: 'VER' }, { op: 'delete', indicator: 'sin final', remove: 'last', of: { op: 'syn', from: 'los años', text: 'EDAD' } }] }, 'Acera porteña');
  const r = run('combination', ok);
  assert.deepEqual(codes(r), []);
  assert.equal(r.facts.primary, 'charade');
  assert.deepEqual(r.facts.secondary, ['deletion']);
  assert.deepEqual(r.facts.order.map((x) => x.op), ['delete', 'concat']);
  assert.ok(codes(run('combination', { op: 'reverse', indicator: 'vuelve', of: { op: 'lit', value: 'AMOR' }, value: 'ROMA' })).includes('combination_single'));
  assert.ok(codes(run('combination', { op: 'concat', parts: [{ op: 'syn', value: 'VER' }, { op: 'delete', remove: 'last', of: { op: 'syn', value: 'EDAD' }, value: 'EDA' }], value: 'VEREDA' })).includes('indicator_missing'));
});
