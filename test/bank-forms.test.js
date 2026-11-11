'use strict';

// Banco 1.2: formas flexionadas del español (plurales, femeninos, gerundios,
// participios, presente e imperfecto) como respuestas nuevas, con
// definiciones en la misma forma y evidencia comprobable.

const test = require('node:test');
const assert = require('node:assert/strict');
const lexicon = require('../src/lib/bank/lexicon');
const { bankEngine, FORM_BASE } = require('../src/lib/bank/generate');
const { validateClue } = require('../src/lib/validator');
const bank = require('../src/services/bank');

test('plurales: reglas del español y casos dudosos afuera', () => {
  const cases = { casa: 'casas', camión: 'camiones', árbol: 'árboles', lápiz: 'lápices', papel: 'papeles', pan: 'panes', sofá: 'sofás',
    examen: null, crisis: null, jabalí: null, rey: null, carácter: null };
  for (const [s, p] of Object.entries(cases)) assert.equal(lexicon.pluralEs(s), p, s);
});

test('verbos: se descartan los que cambian la raíz o llevan tilde', () => {
  assert.equal(lexicon.present3Es('cantar'), 'canta');
  assert.equal(lexicon.present3Es('correr'), 'corre');
  for (const v of ['pensar', 'contar', 'volver', 'pedir', 'jugar', 'enviar', 'reunir', 'prohibir', 'ser', 'estar']) assert.equal(lexicon.present3Es(v), null, v);
  assert.equal(lexicon.imperfect3Es('correr'), 'corría');
  assert.equal(lexicon.participleEs('romper'), null);
  assert.equal(lexicon.participleEs('limpiar'), 'limpiado');
  assert.equal(lexicon.gerundEs('leer'), 'leyendo');
});

test('cada forma concuerda: las definiciones de una respuesta derivada están en la misma forma', () => {
  const P = lexicon.derived('es', 'plural');
  const i = P.byText.get('casas');
  const defs = P.definitions(i).map((d) => d.text);
  assert.ok(defs.length > 0);
  assert.ok(defs.every((d) => d.endsWith('s')), defs.join(', '));
  const G = lexicon.derived('es', 'gerund');
  const g = G.byText.get('corriendo');
  assert.ok(G.definitions(g).every((d) => /ndo$/.test(d.text)));
});

test('el motor del banco suma respuestas en forma flexionada y sus pistas validan con evidencia', () => {
  const E = bankEngine('es');
  const answers = E.answers();
  const derived = answers.filter((a) => a >= FORM_BASE);
  assert.ok(derived.length > 3000, `respuestas derivadas: ${derived.length}`);
  const forms = new Set();
  let n = 0;
  // una muestra de cada forma
  const byForm = new Map();
  for (const a of derived) { const k = Math.floor(a / FORM_BASE); if (!byForm.has(k)) byForm.set(k, []); if (byForm.get(k).length < 25) byForm.get(k).push(a); }
  for (const list of byForm.values()) {
    for (const a of list) {
      for (const c of E.candidates(a)) {
        const r = validateClue(c);
        assert.equal(r.errors, 0, `${c.clue_text} → ${c.answer}`);
        assert.ok(bank.verifyEvidence('es', c).ok, `evidencia de ${c.clue_text} → ${c.answer}`);
        assert.ok(c.evidence.every((e) => e.form));
        forms.add(c.evidence[0].form);
        n++;
      }
    }
  }
  assert.ok(n > 30, `candidatos: ${n}`);
  assert.ok(forms.size >= 5, [...forms].join(','));
});
