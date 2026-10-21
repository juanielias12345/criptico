'use strict';

// Motor de resolución del juego de palabras.
// Un críptico describe su juego de palabras como un árbol. Cada nodo produce
// letras; `solve(node, target)` intenta demostrar que el árbol produce
// exactamente `target` y devuelve el árbol "resuelto" con el valor concreto
// de cada nodo, que luego sirve para generar la explicación paso a paso.
//
// Nodos admitidos:
//   lit       { text }                       texto tomado literalmente de la pista
//   syn       { from, text }                 sinónimo (afirmación semántica)
//   abbr      { from, text }                 abreviatura convencional
//   letter    { from, text }                 nombre de letra ("ele" → L)
//   concat    { parts:[…], indicator? }       charada
//   anagram   { of:[…], indicator }
//   reverse   { of, indicator }
//   insert    { outer, inner, indicator }     inner dentro de outer
//   delete    { of, remove:'first'|'last'|'middle'|letras, indicator }
//   hidden    { in, indicator }               palabra oculta en un tramo de la pista
//   initials  { in, indicator }               primeras letras de las palabras
//   homophone { of, indicator }               suena como
//   double    { definitions:[…] }             doble definición
//   cryptic   { }                             definición críptica (solo afirmación)

const { letters, words } = require('../normalize');

const sortLetters = (s) => [...s].sort().join('');
const reverseStr = (s) => [...s].reverse().join('');

class Solver {
  constructor(lang, opts = {}) {
    this.lang = lang;
    this.homophoneCheck = opts.homophoneCheck || (() => null);
    this.limit = 20000;          // tope de combinaciones para entradas maliciosas
    this.steps = 0;
  }

  tick() {
    if (++this.steps > this.limit) throw new Error('wordplay_too_complex');
  }

  // Valores posibles de un nodo determinista (sin anagramas dentro).
  values(node) {
    this.tick();
    const L = (t) => letters(t, this.lang);
    switch (node.op) {
      case 'lit': case 'syn': case 'abbr': case 'letter':
        return [L(node.text)];
      case 'concat': {
        let acc = [''];
        for (const p of node.parts) {
          const vs = this.values(p);
          const next = [];
          for (const a of acc) for (const v of vs) next.push(a + v);
          acc = next.slice(0, 500);
        }
        return acc;
      }
      case 'reverse':
        return this.values(node.of).map(reverseStr);
      case 'delete':
        return this.values(node.of).flatMap((v) => applyDelete(v, node.remove, this.lang));
      case 'insert': {
        const out = [];
        for (const o of this.values(node.outer)) for (const i of this.values(node.inner)) {
          for (let k = 1; k < o.length; k++) out.push(o.slice(0, k) + i + o.slice(k));
        }
        return out;
      }
      case 'initials':
        return [words(node.in, this.lang).map((w) => w[0]).join('')];
      case 'hidden': {
        const s = L(node.in); const out = [];
        for (let a = 0; a < s.length; a++) for (let b = a + 2; b <= s.length; b++) out.push(s.slice(a, b));
        return out;
      }
      case 'anagram': case 'homophone': case 'double': case 'cryptic':
        return null; // no deterministas: solo se pueden comprobar contra un objetivo
      default:
        throw new Error('unknown_op:' + node.op);
    }
  }

  // Devuelve una copia resuelta del nodo que produce `target`, o null.
  solve(node, target) {
    this.tick();
    const L = (t) => letters(t, this.lang);
    switch (node.op) {
      case 'lit': case 'syn': case 'abbr': case 'letter':
        return L(node.text) === target ? { ...node, value: target } : null;
      case 'concat':
        return this.solveSeq(node, node.parts, target);
      case 'anagram': {
        const sub = this.solveAnagramSource(node.of, target);
        return sub ? { ...node, of: sub.parts, source: sub.value, value: target } : null;
      }
      case 'reverse': {
        const r = this.solve(node.of, reverseStr(target));
        return r ? { ...node, of: r, value: target } : null;
      }
      case 'insert': {
        for (let a = 1; a < target.length; a++) {
          for (let b = a + 1; b < target.length; b++) {
            const inner = this.solve(node.inner, target.slice(a, b));
            if (!inner) continue;
            const outer = this.solve(node.outer, target.slice(0, a) + target.slice(b));
            if (outer) return { ...node, inner, outer, value: target };
          }
        }
        return null;
      }
      case 'delete': {
        const vs = this.valuesOrSolveAny(node.of);
        for (const v of vs) {
          if (applyDelete(v, node.remove, this.lang).includes(target)) {
            const of = this.solve(node.of, v);
            if (of) return { ...node, of, value: target };
          }
        }
        return null;
      }
      case 'hidden': {
        const s = L(node.in);
        const idx = s.indexOf(target);
        return idx >= 0 ? { ...node, value: target, position: idx } : null;
      }
      case 'initials': {
        const v = words(node.in, this.lang).map((w) => w[0]).join('');
        return v === target ? { ...node, value: v } : null;
      }
      case 'homophone': {
        const vs = this.values(node.of) || [];
        for (const v of vs) {
          const verdict = this.homophoneCheck(v, target);
          if (verdict !== false && v !== target) {
            const of = this.solve(node.of, v);
            if (of) return { ...node, of, value: target, sounds: v, verified: verdict === true };
          }
        }
        return null;
      }
      case 'double': case 'cryptic':
        return { ...node, value: target };
      default:
        throw new Error('unknown_op:' + node.op);
    }
  }

  solveSeq(node, parts, target) {
    if (parts.length === 0) return target === '' ? { ...node, parts: [], value: '' } : null;
    const [first, ...rest] = parts;
    for (let k = 1; k <= target.length - rest.length; k++) {
      const head = this.solve(first, target.slice(0, k));
      if (!head) continue;
      const tail = this.solveSeq(node, rest, target.slice(k));
      if (tail) return { ...node, parts: [head, ...tail.parts], value: target };
    }
    return null;
  }

  // Fuentes de un anagrama: deben producir valores concretos cuyo multiconjunto
  // de letras coincida con el objetivo.
  solveAnagramSource(parts, target) {
    const want = sortLetters(target);
    let combos = [{ value: '', parts: [] }];
    for (const p of parts) {
      const vs = this.values(p);
      if (!vs) return null;
      const next = [];
      for (const c of combos) for (const v of vs) next.push({ value: c.value + v, parts: [...c.parts, { p, v }] });
      combos = next.slice(0, 500);
    }
    for (const c of combos) {
      if (c.value.length === target.length && sortLetters(c.value) === want) {
        return { value: c.value, parts: c.parts.map(({ p, v }) => this.solve(p, v)) };
      }
    }
    return null;
  }

  valuesOrSolveAny(node) {
    return this.values(node) || [];
  }
}

function applyDelete(v, remove, lang) {
  if (remove === 'first') return [v.slice(1)];
  if (remove === 'last') return [v.slice(0, -1)];
  if (remove === 'middle') {
    if (v.length < 3) return [];
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? [v.slice(0, m) + v.slice(m + 1)] : [v.slice(0, m - 1) + v.slice(m + 1)];
  }
  const r = letters(remove, lang);
  const out = [];
  for (let i = v.indexOf(r); i >= 0; i = v.indexOf(r, i + 1)) out.push(v.slice(0, i) + v.slice(i + r.length));
  return out;
}

// Recorre un árbol y devuelve todos sus nodos.
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node);
  for (const k of ['of', 'outer', 'inner']) {
    if (Array.isArray(node[k])) node[k].forEach((n) => walk(n, fn));
    else if (node[k] && typeof node[k] === 'object') walk(node[k], fn);
  }
  if (Array.isArray(node.parts)) node.parts.forEach((n) => walk(n, fn));
}

// Mecanismo principal declarado por el árbol.
const OP_TO_MECHANISM = {
  anagram: 'anagram', hidden: 'hidden', reverse: 'reversal', insert: 'container', delete: 'deletion',
  concat: 'charade', homophone: 'homophone', double: 'double_definition', initials: 'initials',
  cryptic: 'cryptic_definition', lit: 'charade', syn: 'charade', abbr: 'charade', letter: 'charade',
};

function mechanismsIn(tree) {
  const set = new Set();
  walk(tree, (n) => { if (!['lit', 'syn', 'abbr', 'letter'].includes(n.op)) set.add(OP_TO_MECHANISM[n.op]); });
  if (set.size === 0) set.add('charade');
  return set;
}

module.exports = { Solver, walk, mechanismsIn, OP_TO_MECHANISM, applyDelete, sortLetters };
