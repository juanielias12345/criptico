'use strict';

// Validador de crípticos. Recibe un críptico estructurado y devuelve un informe:
//   status: 'verified'  → todo comprobado mecánicamente
//           'asserted'  → sin errores, pero hay afirmaciones semánticas (sinónimos,
//                         dobles definiciones…) que una máquina no puede demostrar
//           'failed'    → hay al menos un error crítico
// El informe guarda cada comprobación con código, nivel y mensaje.

const N = require('../normalize');
const { Solver, walk, mechanismsIn } = require('./wordplay');
const { explain } = require('./explain');
const lexicon = require('../lexicon');
const LANG = { es: require('../lang/es'), en: require('../lang/en') };

const DEFAULT_VARIANT_PHONETICS = { es: { 'es': null }, en: { 'en': null } };
for (const [code, lang, , phon] of require('../../db/reference').VARIANTS) {
  if (DEFAULT_VARIANT_PHONETICS[lang]) DEFAULT_VARIANT_PHONETICS[lang][code] = phon;
}

const ARTICLES = new Set(['EL', 'LA', 'LOS', 'LAS', 'UN', 'UNA', 'LO', 'THE', 'A', 'AN', 'SOME']);

function check(list, level, code, msg, params) {
  list.push({ level, code, msg, ...(params ? { params } : {}) });
}

// Variantes (con sus rasgos fonéticos) en las que debe valer el críptico.
function targetVariants(lang, variant, phonetics) {
  const table = phonetics || DEFAULT_VARIANT_PHONETICS[lang] || {};
  if (variant && table[variant] !== undefined && table[variant] !== null) return { [variant]: table[variant] };
  const out = {};
  for (const [k, v] of Object.entries(table)) if (v !== null) out[k] = v;
  return out;
}

function makeHomophoneCheck(lang, variant, phonetics, notes) {
  return (a, b) => {
    if (lang === 'es') {
      const vars = targetVariants(lang, variant, phonetics);
      const failing = Object.entries(vars).filter(([, f]) => LANG.es.phoneticKey(a, f) !== LANG.es.phoneticKey(b, f));
      if (failing.length === 0) return true;
      notes.push({ a, b, failing: failing.map(([k]) => k) });
      return false;
    }
    if (lang === 'en') {
      const vs = LANG.en.homophoneVariants(a, b);
      if (!vs) return null; // desconocido: afirmación a revisar
      if (vs.includes('en')) return true;
      if (variant && vs.includes(variant)) return true;
      notes.push({ a, b, failing: [variant || 'en'], validIn: vs });
      return false;
    }
    return null;
  };
}

function inClue(cluePhrase, text, lang) {
  const p = N.phrase(text, lang);
  return p.trim() !== '' && cluePhrase.includes(p);
}

function validateClue(input, opts = {}) {
  const checks = [];
  const lang = N.baseLang(input.language_code || input.language);
  const variant = input.variant_code || input.variant || null;
  const L = LANG[lang];
  const clueText = String(input.clue_text || input.clue || '').trim();
  const answer = String(input.answer || '').trim();
  const answerKey = N.answerKey(answer, lang);
  const surface = N.stripEnumeration(clueText);
  const cluePhrase = N.phrase(surface, lang);
  const accounted = new Set();
  const markAccounted = (t) => N.words(t, lang).forEach((w) => accounted.add(w));

  // ── seguridad y formato ──
  const unsafe = /<[^>]+>|https?:\/\/|www\.|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i;
  for (const [field, val] of [['pista', clueText], ['respuesta', answer], ['definición', input.definition || '']]) {
    if (unsafe.test(val)) check(checks, 'error', 'unsafe_content', `Contenido no permitido (HTML, enlaces o caracteres de control) en ${field}.`);
  }
  if (!L) check(checks, 'error', 'language_unsupported', `El idioma «${lang}» no tiene reglas de validación todavía.`);
  if (surface.length < 5 || clueText.length > 300) check(checks, 'error', 'clue_length', 'La pista debe tener entre 5 y 300 caracteres.');
  if (answerKey.length < 2 || answerKey.length > 40) check(checks, 'error', 'answer_length', 'La respuesta debe tener entre 2 y 40 letras.');
  if (/\d/.test(answer)) check(checks, 'error', 'answer_digits', 'La respuesta no puede contener números.');

  // ── enumeración ──
  const expectedEnum = N.enumerationOf(answer, lang);
  const clueEnum = N.enumerationInClue(clueText);
  const givenEnum = input.enumeration ? String(input.enumeration).replace(/\s+/g, '') : clueEnum;
  if (!clueEnum) check(checks, 'error', 'enumeration_missing', 'La pista debe terminar con la longitud entre paréntesis, por ejemplo (5).');
  else if (clueEnum !== expectedEnum) check(checks, 'error', 'enumeration_mismatch', `La longitud indicada (${clueEnum}) no coincide con la respuesta (${expectedEnum}).`);
  if (givenEnum && clueEnum && givenEnum !== clueEnum) check(checks, 'error', 'enumeration_inconsistent', 'La enumeración declarada no coincide con la de la pista.');
  if (clueEnum === expectedEnum) check(checks, 'ok', 'enumeration_ok', 'La longitud coincide con la respuesta.');

  // ── la respuesta existe en el idioma ──
  if (L) {
    const answerWords = answer.split(/[\s-]+/).filter(Boolean);
    const unknown = answerWords.filter((w) => !lexicon.has(lang, w));
    if (unknown.length === 0) check(checks, 'ok', 'lexicon_ok', 'La respuesta figura en el diccionario del idioma.');
    else if (input.proper_noun) check(checks, 'ok', 'proper_noun', 'Nombre propio declarado: no se busca en el diccionario.');
    else check(checks, 'warning', 'lexicon_unknown', `No encuentro «${unknown.join(' ')}» en el diccionario de ${lang}. Revisá la ortografía.`);
  }

  // ── la respuesta no puede aparecer tal cual en la pista ──
  if (answerKey && cluePhrase.includes(' ' + answerKey + ' ')) {
    check(checks, 'error', 'answer_in_clue', 'La respuesta aparece escrita tal cual en la pista.');
  }

  // ── definición ──
  const def = String(input.definition || '').trim();
  const tree = input.wordplay || null;
  const isDouble = tree && tree.op === 'double';
  if (!def && !isDouble && !(tree && tree.op === 'cryptic')) {
    check(checks, 'error', 'definition_missing', 'Falta indicar qué parte de la pista es la definición.');
  } else if (def) {
    const dp = N.phrase(def, lang);
    if (!cluePhrase.includes(dp)) check(checks, 'error', 'definition_not_in_clue', `La definición «${def}» no aparece en la pista.`);
    else if (cluePhrase.startsWith(dp) || cluePhrase.endsWith(dp)) {
      check(checks, 'ok', 'definition_position', 'La definición está al principio o al final de la pista.');
      markAccounted(def);
    } else {
      check(checks, 'warning', 'definition_middle', 'La definición no está ni al principio ni al final de la pista, como es habitual.');
      markAccounted(def);
    }
  }

  // ── juego de palabras ──
  const assertions = [];
  const homophoneNotes = [];
  let resolved = null;
  if (!tree) {
    check(checks, 'warning', 'no_wordplay', 'No hay desglose estructurado del juego de palabras: no se puede comprobar automáticamente que la pista lleve a la respuesta.');
    assertions.push('wordplay');
  } else if (L) {
    const solver = new Solver(lang, { homophoneCheck: makeHomophoneCheck(lang, variant, opts.phonetics, homophoneNotes) });
    let structuralOk = true;
    try {
      walk(tree, (n) => {
        if (n.indicator) {
          if (!inClue(cluePhrase, n.indicator, lang)) {
            structuralOk = false;
            check(checks, 'error', 'indicator_not_in_clue', `El indicador «${n.indicator}» no aparece en la pista.`);
          } else {
            markAccounted(n.indicator);
            const kinds = n.op === 'delete'
              ? (n.remove === 'first' ? ['deletion_first'] : n.remove === 'last' ? ['deletion_last'] : ['deletion_letter', 'deletion_first', 'deletion_last'])
              : n.op === 'insert' ? ['container', 'insertion'] : n.op === 'concat' ? ['charade'] : n.op === 'reverse' ? ['reversal'] : [n.op === 'initials' ? 'initials' : n.op];
            const known = kinds.some((k) => (L.indicators[k] || []).some((i) => N.phrase(n.indicator, lang).includes(N.phrase(i, lang))));
            if (!known) check(checks, 'warning', 'indicator_unknown', `«${n.indicator}» no está en la lista de indicadores conocidos para este mecanismo.`);
          }
        }
        if (['lit'].includes(n.op)) {
          if (!inClue(cluePhrase, n.text, lang)) { structuralOk = false; check(checks, 'error', 'fragment_not_in_clue', `El fragmento «${n.text}» no aparece en la pista.`); }
          else markAccounted(n.text);
        }
        if (['syn', 'abbr', 'letter'].includes(n.op)) {
          if (!n.from || !inClue(cluePhrase, n.from, lang)) {
            structuralOk = false;
            check(checks, 'error', 'fragment_not_in_clue', `La palabra de origen «${n.from || ''}» no aparece en la pista.`);
          } else markAccounted(n.from);
          if (!n.text || !N.letters(n.text, lang)) { structuralOk = false; check(checks, 'error', 'fragment_empty', 'Hay un fragmento sin letras.'); }
        }
        if (n.op === 'syn') assertions.push(`sinónimo: ${n.from} → ${N.letters(n.text, lang)}`);
        if (n.op === 'abbr') {
          const key = N.letters(n.from, lang);
          const keyNoArt = N.words(n.from, lang).filter((w) => !ARTICLES.has(w)).join('');
          const opts2 = L.abbreviations[key] || L.abbreviations[keyNoArt] || [];
          const val = N.letters(n.text, lang);
          if (opts2.includes(val)) {
            const only = L.variantAbbreviations && (L.variantAbbreviations[key] || L.variantAbbreviations[keyNoArt]);
            if (only && !(variant && only.includes(variant))) {
              structuralOk = false;
              check(checks, 'error', 'abbreviation_variant', `La abreviatura ${n.from} → ${val} solo es habitual en ${only.join(', ')}.`);
            } else check(checks, 'ok', 'abbreviation_ok', `Abreviatura reconocida: ${n.from} → ${val}.`);
          } else {
            assertions.push(`abreviatura: ${n.from} → ${val}`);
            check(checks, 'warning', 'abbreviation_unknown', `La abreviatura ${n.from} → ${val} no está en la tabla del idioma.`);
          }
        }
        if (n.op === 'letter') {
          const key = N.words(n.from, lang).filter((w) => !ARTICLES.has(w)).join('');
          if (L.letterNames[key] !== N.letters(n.text, lang)) {
            structuralOk = false;
            check(checks, 'error', 'letter_name', `«${n.from}» no es el nombre de la letra ${n.text}.`);
          }
        }
        if (n.op === 'hidden' || n.op === 'initials') {
          if (!inClue(cluePhrase, n.in || '', lang)) { structuralOk = false; check(checks, 'error', 'fragment_not_in_clue', `El tramo «${n.in}» no aparece en la pista.`); }
          else markAccounted(n.in);
        }
        if (n.op === 'hidden' && N.words(n.in || '', lang).includes(answerKey)) {
          structuralOk = false;
          check(checks, 'error', 'hidden_not_hidden', 'La palabra oculta aparece completa como palabra suelta: no está escondida.');
        }
        if (n.op === 'double') {
          for (const d of n.definitions || []) {
            if (!inClue(cluePhrase, d, lang)) { structuralOk = false; check(checks, 'error', 'definition_not_in_clue', `La definición «${d}» no aparece en la pista.`); }
            else markAccounted(d);
          }
          if ((n.definitions || []).length < 2) { structuralOk = false; check(checks, 'error', 'double_needs_two', 'Una doble definición necesita dos definiciones.'); }
          assertions.push('doble definición');
        }
        if (n.op === 'cryptic') assertions.push('definición críptica');
        if (n.op === 'delete' && !n.remove) { structuralOk = false; check(checks, 'error', 'delete_missing', 'Falta indicar qué se elimina.'); }
        if (n.op === 'delete' && n.remove_from) {
          // la letra eliminada se nombra en la pista: "pierde la ele", "loses west"
          if (!inClue(cluePhrase, n.remove_from, lang)) { structuralOk = false; check(checks, 'error', 'fragment_not_in_clue', `«${n.remove_from}» no aparece en la pista.`); }
          else {
            markAccounted(n.remove_from);
            const key = N.words(n.remove_from, lang).filter((w) => !ARTICLES.has(w)).join('');
            const val = N.letters(n.remove, lang);
            const ok = L.letterNames[key] === val || (L.abbreviations[key] || []).includes(val);
            if (!ok) { structuralOk = false; check(checks, 'error', 'delete_letter', `«${n.remove_from}» no equivale a ${val}.`); }
          }
        }
      });

      if (structuralOk) {
        resolved = solver.solve(tree, answerKey);
        if (resolved) {
          check(checks, 'ok', 'wordplay_ok', 'El juego de palabras produce exactamente la respuesta.');
          walk(resolved, (n) => {
            if (n.op === 'anagram' && n.source === answerKey) {
              check(checks, 'error', 'anagram_identity', 'El anagrama no cambia el orden de las letras.');
            }
            if (n.op === 'homophone') {
              if (n.verified) check(checks, 'ok', 'homophone_ok', `${n.sounds} y ${n.value} suenan igual en las variantes indicadas.`);
              else { assertions.push(`homófono: ${n.sounds} ~ ${n.value}`); check(checks, 'warning', 'homophone_unverified', `No puedo comprobar que ${n.sounds} y ${n.value} suenen igual.`); }
            }
          });
        } else if (homophoneNotes.length) {
          const h = homophoneNotes[0];
          check(checks, 'error', 'homophone_variant', `${h.a} y ${h.b} no suenan igual en: ${h.failing.join(', ')}. Asigná la variante correcta.`);
        } else {
          check(checks, 'error', 'wordplay_mismatch', 'El juego de palabras no produce la respuesta indicada.');
        }
      }
    } catch (e) {
      check(checks, 'error', 'wordplay_invalid', `Desglose inválido: ${e.message}`);
    }

    // mecanismo declarado vs. árbol
    if (input.mechanism) {
      const present = mechanismsIn(tree);
      const declared = input.mechanism === 'combination' ? null : input.mechanism;
      if (declared && !present.has(declared)) {
        check(checks, 'error', 'mechanism_mismatch', `El mecanismo declarado (${declared}) no coincide con el desglose (${[...present].join(', ')}).`);
      }
    }
  }

  // ── palabras sin explicar ──
  if (L && tree) {
    const link = new Set(L.linkWords.map((w) => N.letters(w, lang)));
    const loose = N.words(surface, lang).filter((w) => !accounted.has(w) && !link.has(w));
    if (loose.length) check(checks, 'warning', 'unexplained_words', `Palabras de la pista que no cumplen función: ${loose.join(', ')}.`);
  }

  // ── explicación libre (propuestas e importaciones) ──
  if (input.explanation_text) {
    const e = N.letters(input.explanation_text, lang);
    if (!e.includes(answerKey)) check(checks, 'warning', 'explanation_no_answer', 'La explicación no menciona la respuesta.');
  }

  // ── dificultad razonable ──
  const est = estimateDifficulty(tree, answerKey, assertions.length);
  if (input.difficulty && Math.abs(Number(input.difficulty) - est) >= 3) {
    check(checks, 'warning', 'difficulty_unusual', `La dificultad asignada (${input.difficulty}) parece poco razonable; estimo ${est}.`);
  }

  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warning').length;
  const status = errors ? 'failed' : assertions.length ? 'asserted' : 'verified';
  const explanation = resolved ? explain(resolved, { lang, definition: def, answer }) : null;
  return { status, errors, warnings, assertions, checks, explanation, estimatedDifficulty: est, mechanisms: tree ? [...mechanismsIn(tree)] : [] };
}

function estimateDifficulty(tree, answerKey, assertionCount) {
  if (!tree) return 3;
  let nodes = 0; let ops = new Set();
  walk(tree, (n) => { nodes++; ops.add(n.op); });
  let d = 1;
  if (nodes > 2) d++;
  if (nodes > 4) d++;
  if (ops.has('insert') || ops.has('delete') || ops.has('homophone')) d++;
  if (assertionCount > 1) d++;
  if (answerKey.length > 9) d++;
  return Math.max(1, Math.min(5, d));
}

module.exports = { validateClue, estimateDifficulty, DEFAULT_VARIANT_PHONETICS };
