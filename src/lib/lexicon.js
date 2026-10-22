'use strict';

// Diccionarios de comprobación (listas MIT de palabras). Se cargan bajo demanda
// porque solo los necesitan la validación y el generador, no las partidas.

const { letters } = require('./normalize');

// require con el nombre literal: así el empaquetado de Vercel incluye las listas en la función.
const PACKAGES = { es: () => require('an-array-of-spanish-words'), en: () => require('an-array-of-english-words') };
const cache = {};

function load(lang) {
  if (!cache[lang]) {
    const pkg = PACKAGES[lang];
    if (!pkg) return null;
    const set = new Set();
    for (const w of pkg()) set.add(letters(w, lang));
    cache[lang] = set;
  }
  return cache[lang];
}

function has(lang, word) {
  const set = load(lang);
  if (!set) return false;
  return set.has(letters(word, lang));
}

module.exports = { has, load };
