'use strict';

// Normalización de respuestas y textos por idioma.
// Regla general: se ignoran mayúsculas, espacios, guiones y puntuación.
// Las tildes se ignoran solo cuando no cambian la letra en ese idioma:
// en español Á→A y Ü→U, pero Ñ es una letra distinta (AÑO ≠ ANO).

const KEEP = {
  es: new Set(['Ñ']),
  en: new Set(),
  fr: new Set(),
  pt: new Set(),
  it: new Set(),
  de: new Set(),
};

const GERMAN_EXPANSIONS = { 'Ä': 'AE', 'Ö': 'OE', 'Ü': 'UE', 'ß': 'SS' };

function baseLang(lang) {
  return String(lang || 'es').toLowerCase().split('-')[0];
}

// Devuelve solo letras en mayúsculas, plegando diacríticos según el idioma.
function letters(text, lang) {
  const base = baseLang(lang);
  const keep = KEEP[base] || new Set();
  let out = '';
  for (const ch of String(text || '').normalize('NFC').toUpperCase()) {
    if (base === 'de' && GERMAN_EXPANSIONS[ch]) { out += GERMAN_EXPANSIONS[ch]; continue; }
    if (keep.has(ch)) { out += ch; continue; }
    const folded = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const f of folded) if (/[A-Z]/.test(f) || keep.has(f)) out += f;
  }
  return out;
}

// Normaliza la respuesta de un jugador para compararla con answer_key.
function answerKey(text, lang) {
  return letters(text, lang);
}

// Palabras de un texto (para comprobar que los fragmentos aparecen en la pista).
function words(text, lang) {
  return String(text || '')
    .split(/[\s\-–—.,;:!?¡¿()"'«»“”‘’…/]+/u)
    .map((w) => letters(w, lang))
    .filter(Boolean);
}

// Texto normalizado con separadores de palabra, para búsquedas de frases.
function phrase(text, lang) {
  return ' ' + words(text, lang).join(' ') + ' ';
}

// Enumeración a partir de la respuesta canónica: "CASA MIENTO" → "4,6".
function enumerationOf(answer, lang) {
  const parts = String(answer).trim().split(/(\s+|-)/);
  let out = '';
  for (const p of parts) {
    if (/^\s+$/.test(p)) out += ',';
    else if (p === '-') out += '-';
    else if (p) out += String(letters(p, lang).length);
  }
  return out;
}

// Extrae la enumeración final de una pista: "… (3,4)" → "3,4".
function enumerationInClue(clue) {
  const m = String(clue).match(/\(([\d,\- ]+)\)\s*$/);
  return m ? m[1].replace(/\s+/g, '') : null;
}

function stripEnumeration(clue) {
  return String(clue).replace(/\s*\(([\d,\- ]+)\)\s*$/, '');
}

function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

module.exports = { letters, answerKey, words, phrase, enumerationOf, enumerationInClue, stripEnumeration, slugify, baseLang };
