'use strict';

// Generador de crípticos por reglas. No usa servicios externos: combina el
// vocabulario curado con plantillas por idioma y pasa cada candidato por el
// validador. Lo que no supera la validación se descarta.

const DATA = require('./data');
const { validateClue } = require('../validator');
const { sortLetters } = require('../validator/wordplay');

const reverse = (s) => [...s].reverse().join('');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Generador pseudoaleatorio determinista para que los lotes sean reproducibles.
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

function candidates(lang, seed = 1) {
  const D = DATA[lang];
  if (!D) return [];
  const rand = rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const words = Object.keys(D.words);
  const def = (w) => pick(D.words[w]);
  const out = [];
  const n = (w) => `(${w.length})`;
  const shown = (w) => D.accents[w] || w;          // forma con tildes
  const low = (w) => shown(w).toLowerCase();

  for (const A of words) {
    const dA = def(A);
    // Anagramas
    for (const B of words) {
      if (B !== A && B.length === A.length && sortLetters(B) === sortLetters(A)) {
        const ind = pick(D.indicators.anagram);
        const surface = D.anagramBefore ? `${cap(ind)} ${low(B)}` : `${cap(low(B))} ${ind}`;
        out.push({
          clue: `${surface} ${D.link} ${dA} ${n(A)}`, answer: shown(A), definition: dA, mechanism: 'anagram',
          wordplay: { op: 'anagram', indicator: ind, of: [{ op: 'lit', text: low(B) }] },
        });
      }
    }
    // Inversiones
    for (const B of words) {
      if (B !== A && reverse(B) === A) {
        const ind = pick(D.indicators.reversal);
        out.push({
          clue: `${cap(low(B))} ${ind}${D.colon} ${dA} ${n(A)}`, answer: shown(A), definition: dA, mechanism: 'reversal',
          wordplay: { op: 'reverse', indicator: ind, of: { op: 'lit', text: low(B) } },
        });
      }
    }
    // Eliminaciones (primera o última letra)
    for (const B of words) {
      if (B.length === A.length + 1 && B.slice(1) === A) {
        const ind = pick(D.indicators.deletion_first);
        out.push({
          clue: `${cap(def(B))} ${ind}${D.colon} ${dA} ${n(A)}`, answer: shown(A), definition: dA, mechanism: 'deletion',
          wordplay: { op: 'delete', indicator: ind, remove: 'first', of: { op: 'syn', from: def(B), text: B } },
        });
      }
      if (B.length === A.length + 1 && B.slice(0, -1) === A) {
        const ind = pick(D.indicators.deletion_last);
        out.push({
          clue: `${cap(def(B))} ${ind}${D.colon} ${dA} ${n(A)}`, answer: shown(A), definition: dA, mechanism: 'deletion',
          wordplay: { op: 'delete', indicator: ind, remove: 'last', of: { op: 'syn', from: def(B), text: B } },
        });
      }
    }
    // Charadas: palabra + palabra o palabra + abreviatura
    for (let k = 1; k < A.length; k++) {
      const left = A.slice(0, k); const right = A.slice(k);
      const piece = (s) => (D.words[s] ? { op: 'syn', from: def(s), text: s } : D.abbr[s] ? { op: 'abbr', from: D.abbr[s], text: s } : null);
      const L = piece(left); const R = piece(right);
      if (L && R && (L.op === 'syn' || R.op === 'syn') && left.length + right.length >= 4) {
        const ind = pick(D.indicators.charade);
        out.push({
          clue: `${cap(L.from)} ${ind} ${R.from} ${D.link} ${dA} ${n(A)}`, answer: shown(A), definition: dA, mechanism: 'charade',
          wordplay: { op: 'concat', indicator: ind, parts: [L, R] },
        });
      }
    }
    // Palabras ocultas entre dos palabras del vocabulario
    if (A.length >= 4) {
      for (let k = 1; k < A.length; k++) {
        const head = A.slice(0, k); const tail = A.slice(k);
        const w1 = words.find((w) => w !== A && w.length > head.length && w.endsWith(head));
        const w2 = words.find((w) => w !== A && w !== w1 && w.length > tail.length && w.startsWith(tail));
        if (w1 && w2 && sortLetters(w1) !== sortLetters(A) && sortLetters(w2) !== sortLetters(A)) {
          const ind = pick(D.indicators.hidden);
          const phrase = `${low(w1)} ${low(w2)}`;
          out.push({
            clue: `${cap(phrase)} ${ind} ${dA} ${n(A)}`, answer: shown(A), definition: dA, mechanism: 'hidden',
            wordplay: { op: 'hidden', indicator: ind, in: phrase },
          });
          break;
        }
      }
    }
  }
  return out;
}

// Devuelve solo los candidatos que el validador acepta sin errores.
function generate(lang, { seed = 1, limit = 50 } = {}) {
  const out = [];
  for (const c of candidates(lang, seed)) {
    const report = validateClue({ ...c, clue_text: c.clue, language_code: lang });
    if (report.errors === 0) out.push({ ...c, difficulty: report.estimatedDifficulty, category: 'general', report });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { generate, candidates };
