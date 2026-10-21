'use strict';

// Detección de duplicados.
//  - Exacto: misma pista normalizada y misma respuesta (huella SHA-256, índice único).
//  - Semántico: misma respuesta y pista muy parecida (Jaccard de palabras con
//    contenido), o mismo mecanismo con el mismo material de partida.

const N = require('../lib/normalize');
const { sha256 } = require('./util');
const { walk } = require('../lib/validator/wordplay');

const STOP = new Set(['EL', 'LA', 'LOS', 'LAS', 'UN', 'UNA', 'DE', 'DEL', 'EN', 'Y', 'QUE', 'CON', 'POR', 'PARA', 'A', 'AL', 'ES', 'SE', 'LO',
  'THE', 'AN', 'OF', 'TO', 'IN', 'AND', 'FOR', 'IS', 'AS', 'IT', 'ON', 'BY', 'OR', 'S']);

function fingerprint(lang, clueText, answer) {
  const base = N.baseLang(lang);
  return sha256(`${base}|${N.words(N.stripEnumeration(clueText), base).join(' ')}|${N.answerKey(answer, base)}`);
}

function contentWords(text, lang) {
  return new Set(N.words(N.stripEnumeration(text), lang).filter((w) => !STOP.has(w)));
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Material de partida del juego de palabras (letras de fragmentos literales y fuentes).
function material(tree, lang) {
  if (!tree) return null;
  const bits = [];
  walk(tree, (n) => {
    if (n.op === 'lit') bits.push(N.letters(n.text, lang));
    if (['syn', 'abbr'].includes(n.op)) bits.push(N.letters(n.text, lang));
    if (n.op === 'hidden' || n.op === 'initials') bits.push(N.letters(n.in, lang));
    if (n.op !== 'lit' && !['syn', 'abbr', 'letter'].includes(n.op)) bits.push('#' + n.op);
  });
  return bits.sort().join('|');
}

async function findDuplicates(db, { language_code, clue_text, answer, wordplay, excludeId }, threshold = 0.6) {
  const lang = N.baseLang(language_code);
  const fp = fingerprint(lang, clue_text, answer);
  const key = N.answerKey(answer, lang);
  const out = [];
  const exact = await db.get('SELECT id FROM clues WHERE fingerprint = ? AND id IS NOT ?', [fp, excludeId || null]);
  if (exact) out.push({ clue_id: exact.id, kind: 'exact', similarity: 1 });
  const candidates = await db.all(
    'SELECT id, clue_text, wordplay FROM clues WHERE language_code = ? AND answer_key = ? AND id IS NOT ? LIMIT 200',
    [lang, key, excludeId || null]);
  const mine = contentWords(clue_text, lang);
  const myMat = material(wordplay, lang);
  for (const c of candidates) {
    if (exact && c.id === exact.id) continue;
    let sim = jaccard(mine, contentWords(c.clue_text, lang));
    const theirs = c.wordplay ? material(JSON.parse(c.wordplay), lang) : null;
    if (myMat && theirs && myMat === theirs) sim = Math.max(sim, 0.9);
    if (sim >= threshold) out.push({ clue_id: c.id, kind: 'semantic', similarity: Math.round(sim * 100) / 100 });
  }
  return { fingerprint: fp, matches: out };
}

async function recordDuplicateFlags(db, subjectKind, subjectId, matches) {
  for (const m of matches) {
    await db.run('INSERT INTO duplicate_flags(subject_kind, subject_id, clue_id, similarity, kind) VALUES (?,?,?,?,?)',
      [subjectKind, subjectId, m.clue_id, m.similarity, m.kind]);
  }
}

module.exports = { fingerprint, findDuplicates, recordDuplicateFlags, jaccard };
