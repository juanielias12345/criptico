'use strict';

// Utilidades compartidas por los agentes de mecanismo.

const N = require('../../normalize');
const { walk } = require('../../validator/wordplay');

const LANG = 'es';
const LEAVES = new Set(['lit', 'syn', 'abbr', 'letter']);
const L = (t) => N.letters(t || '', LANG);

// Hallazgos de un control de mecanismo: errores (rechazo), dudas (revisión) y hechos registrados.
function result() {
  const out = { errors: [], review: [], facts: {} };
  out.error = (code, msg) => out.errors.push({ code, msg });
  out.doubt = (code, msg) => out.review.push({ code, msg });
  return out;
}

// Abreviaturas usadas en el árbol resuelto, con su interpretación.
function abbreviations(tree) {
  const out = [];
  walk(tree, (n) => { if (n.op === 'abbr') out.push({ from: n.from, text: n.text }); });
  return out;
}

// Piezas hoja del árbol resuelto en orden: qué aporta cada palabra de la pista.
function leaves(tree) {
  const out = [];
  walk(tree, (n) => { if (LEAVES.has(n.op)) out.push({ op: n.op, from: n.from || n.text, value: n.value || L(n.text) }); });
  return out;
}

const isLeaf = (n) => Boolean(n && LEAVES.has(n.op));

module.exports = { LANG, LEAVES, L, N, walk, result, abbreviations, leaves, isLeaf };
