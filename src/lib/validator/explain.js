'use strict';

// Genera la explicación paso a paso a partir del árbol ya resuelto por el
// solver. Como sale del mismo árbol que se verificó, la explicación siempre
// coincide con la pista y con la respuesta.

const T = {
  es: {
    definition: (d) => `Definición: «${d}».`,
    double: (a, b) => `Doble definición: «${a}» y «${b}» describen la misma palabra.`,
    cryptic: () => 'Definición críptica: toda la pista describe la respuesta con un juego de sentido.',
    lit: (t, v) => `«${t}» se toma tal cual: ${v}.`,
    syn: (f, v) => `«${f}» → ${v}.`,
    abbr: (f, v) => `«${f}» se abrevia ${v}.`,
    letter: (f, v) => `«${f}» es la letra ${v}.`,
    anagram: (i, s, v) => `«${i}» indica un anagrama: las letras de ${s} se reordenan en ${v}.`,
    reverse: (i, s, v) => `«${i}» indica lectura al revés: ${s} → ${v}.`,
    insert: (i, inner, outer, v) => `«${i}» indica que ${inner} va dentro de ${outer}: ${v}.`,
    delete: (i, s, what, v) => `«${i}» indica quitar ${what} a ${s}: ${v}.`,
    hidden: (i, ph, v) => `«${i}» indica una palabra oculta: en «${ph}» se esconde ${v}.`,
    initials: (i, ph, v) => `«${i}» indica tomar las iniciales de «${ph}»: ${v}.`,
    homophone: (i, s, v) => `«${i}» indica un homófono: ${s} suena igual que ${v}.`,
    concat: (parts, v) => `Se unen ${parts.join(' + ')} = ${v}.`,
    what: { first: 'la primera letra', last: 'la última letra', middle: 'la letra central' },
    letterWhat: (l, from) => from ? `la ${l} («${from}»)` : `la ${l}`,
    result: (a) => `Respuesta: ${a}.`,
  },
  en: {
    definition: (d) => `Definition: "${d}".`,
    double: (a, b) => `Double definition: "${a}" and "${b}" both describe the answer.`,
    cryptic: () => 'Cryptic definition: the whole clue describes the answer with a twist of meaning.',
    lit: (t, v) => `"${t}" is used as written: ${v}.`,
    syn: (f, v) => `"${f}" → ${v}.`,
    abbr: (f, v) => `"${f}" is abbreviated ${v}.`,
    letter: (f, v) => `"${f}" is the letter ${v}.`,
    anagram: (i, s, v) => `"${i}" signals an anagram: the letters of ${s} rearranged give ${v}.`,
    reverse: (i, s, v) => `"${i}" signals a reversal: ${s} → ${v}.`,
    insert: (i, inner, outer, v) => `"${i}" signals ${inner} placed inside ${outer}: ${v}.`,
    delete: (i, s, what, v) => `"${i}" signals removing ${what} from ${s}: ${v}.`,
    hidden: (i, ph, v) => `"${i}" signals a hidden word: ${v} is hidden in "${ph}".`,
    initials: (i, ph, v) => `"${i}" signals taking the first letters of "${ph}": ${v}.`,
    homophone: (i, s, v) => `"${i}" signals a homophone: ${s} sounds like ${v}.`,
    concat: (parts, v) => `Put together ${parts.join(' + ')} = ${v}.`,
    what: { first: 'the first letter', last: 'the last letter', middle: 'the middle letter' },
    letterWhat: (l, from) => from ? `${l} ("${from}")` : `${l}`,
    result: (a) => `Answer: ${a}.`,
  },
};

function explain(tree, { lang, definition, answer }) {
  const t = T[lang] || T.en;
  const steps = [];

  function visit(n) {
    switch (n.op) {
      case 'lit': steps.push(t.lit(n.text, n.value)); return n.value;
      case 'syn': steps.push(t.syn(n.from, n.value)); return n.value;
      case 'abbr': steps.push(t.abbr(n.from, n.value)); return n.value;
      case 'letter': steps.push(t.letter(n.from, n.value)); return n.value;
      case 'anagram': {
        const src = n.of.map(visit).join(' + ');
        steps.push(t.anagram(n.indicator, src, n.value)); return n.value;
      }
      case 'reverse': { const s = visit(n.of); steps.push(t.reverse(n.indicator, s, n.value)); return n.value; }
      case 'insert': {
        const inner = visit(n.inner); const outer = visit(n.outer);
        steps.push(t.insert(n.indicator, inner, outer, n.value)); return n.value;
      }
      case 'delete': {
        const s = visit(n.of);
        const what = t.what[n.remove] || t.letterWhat(String(n.remove).toUpperCase(), n.remove_from);
        steps.push(t.delete(n.indicator, s, what, n.value)); return n.value;
      }
      case 'hidden': steps.push(t.hidden(n.indicator, n.in, n.value)); return n.value;
      case 'initials': steps.push(t.initials(n.indicator, n.in, n.value)); return n.value;
      case 'homophone': { const s = visit(n.of); steps.push(t.homophone(n.indicator, s, n.value)); return n.value; }
      case 'concat': {
        const parts = n.parts.map(visit);
        if (parts.length > 1) steps.push(t.concat(parts, n.value));
        return n.value;
      }
      case 'double': steps.push(t.double(n.definitions[0], n.definitions[1])); return n.value;
      case 'cryptic': steps.push(t.cryptic()); return n.value;
      default: return n.value;
    }
  }

  if (definition && tree.op !== 'double') steps.push(t.definition(definition));
  visit(tree);
  steps.push(t.result(String(answer).toUpperCase()));
  return steps;
}

module.exports = { explain };
