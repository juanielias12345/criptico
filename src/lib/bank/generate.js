'use strict';

// Generador del banco de crípticos.
//
// Recorre las respuestas posibles de un idioma en un orden fijo (determinista
// para una versión del generador), arma para cada una todos los juegos de
// palabras que el léxico permite demostrar (palabra oculta, anagrama,
// inversión, eliminación, charada, inserción, doble definición, homófono y
// combinaciones), les asigna una dificultad con reglas explícitas y devuelve
// los que caen en la dificultad pedida.
//
// No llama a servicios externos. Cada pista lleva la evidencia léxica de cada
// definición y cada sinónimo, para que la verificación del lote pueda
// comprobarla de forma independiente antes de publicar.

const crypto = require('crypto');
const N = require('../normalize');
const lexicon = require('./lexicon');
const SURFACE = require('./surface');
const { walk, mechanismsIn } = require('../validator/wordplay');
const LANG = { es: require('../lang/es'), en: require('../lang/en') };

const VERSION = 'bank-1.1';

const CATEGORY_BY_LEX = {
  5: 'animales', 6: 'objetos', 8: 'ciencia', 9: 'cultura', 10: 'lenguaje', 12: 'sentimientos', 37: 'sentimientos',
  13: 'comida', 34: 'comida', 14: 'sociedad', 41: 'sociedad', 21: 'sociedad', 15: 'geografia', 17: 'naturaleza',
  19: 'naturaleza', 20: 'naturaleza', 43: 'naturaleza', 18: 'personas', 27: 'ciencia', 33: 'deportes',
};

// Base de dificultad de cada tipo de juego de palabras (ver docs/BANCO.md).
const BASE = {
  hidden: 1, anagram1: 1, reversal_lit: 1.5, deletion_lit: 1.5, double: 2, anagram2: 2, homophone_lit: 2,
  charade: 2.5, reversal_syn: 3, deletion_syn: 3, homophone_syn: 3.5, container: 3.5, charade3: 4, combo: 4.5,
};

// Palabras que el wordnet clasifica como sustantivos pero no funcionan en una frase nominal.
const INTERJECTIONS = new Set(['hola', 'adiós', 'gracias', 'ojalá', 'bravo', 'vale', 'hello', 'goodbye', 'thanks', 'okay', 'yes', 'no',
  'hey', 'wow', 'bye', 'cheers', 'sorry', 'please']);

const hash = (s) => crypto.createHash('sha1').update(s).digest().readUInt32BE(0);
const pick = (arr, seed) => arr[hash(seed) % arr.length];
const sortKey = (k) => [...k].sort().join('');
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function maskOf(k) {
  let m = 0;
  for (const ch of k) { const c = ch.charCodeAt(0) - 65; m |= 1 << (c >= 0 && c < 26 ? c : 26); }
  return m;
}

// ── Género de sustantivos y concordancia de adjetivos en español ──
const FEM_EXCEPT = new Set(['día', 'mapa', 'problema', 'tema', 'sistema', 'programa', 'idioma', 'clima', 'planeta', 'poeta',
  'drama', 'esquema', 'dilema', 'teorema', 'poema', 'fantasma', 'cometa', 'pijama', 'tranvía', 'sofá', 'dogma', 'enigma',
  'diploma', 'emblema', 'lema', 'síntoma', 'panorama', 'telegrama', 'crucigrama', 'aroma', 'karma', 'carisma', 'idiota',
  'atleta', 'artista', 'pianista', 'guía', 'policía', 'colega', 'astronauta', 'pirata', 'profeta', 'patriota']);
const FEM_NOUNS = new Set(['mano', 'foto', 'moto', 'radio', 'libido', 'flor', 'labor', 'sartén', 'razón', 'imagen', 'virgen']);

function genderEs(t) {
  if (FEM_NOUNS.has(t)) return 'f';
  if (FEM_EXCEPT.has(t)) return null;
  if (/(ción|sión|dad|tad|tud|umbre)$/.test(t)) return 'f';
  if (/a$/.test(t) && !/ma$/.test(t)) return 'f';
  if (/o$/.test(t) || /(or|aje)$/.test(t)) return 'm';
  return null;
}

function adjFormsEs(t) {
  if (/(or|ón|án|ín|és)$/.test(t)) return null;   // varían de forma irregular: se evitan
  if (/o$/.test(t)) return { m: t, f: t.slice(0, -1) + 'a' };
  if (/a$/.test(t)) return null;
  return { m: t, f: t };                           // invariables: verde, azul, feliz…
}

class Engine {
  constructor(lang, opts = {}) {
    this.lang = lang;
    this.L = lexicon.load(lang);
    if (!this.L) throw new Error('lexicon_missing:' + lang);
    this.S = SURFACE[lang];
    this.R = LANG[lang];
    this.opts = { minAnswerZipf: 2.2, minPieceZipf: 3.4, alternatives: 2, ...opts };
    this.pieceCache = new Map();
    this.defCache = new Map();
  }

  // ── índices ──
  get fodder() {
    if (this._fodder) return this._fodder;
    const L = this.L;
    const bySorted = new Map(); const list = [];
    L.words.forEach((w, i) => {
      if (!L.single(i) || L.zipf(i) < 3.2 || !L.checkable(i) || L.inflected(i)) return;
      const k = L.key(i);
      if (k.length < 3) return;
      const s = sortKey(k);
      if (!bySorted.has(s)) bySorted.set(s, []);
      bySorted.get(s).push(i);
      list.push({ i, k, m: maskOf(k), s });
    });
    this._fodder = { bySorted, list };
    return this._fodder;
  }

  // Frases de dos palabras para esconder respuestas:
  //   inglés: adjetivo o sustantivo + sustantivo ("silent night", "river bank")
  //   español: sustantivo + adjetivo concordado ("casa blanca") o sustantivo + de + sustantivo
  get phraseIndex() {
    if (this._phrase) return this._phrase;
    const L = this.L;
    const first = new Map(); const second = new Map(); const nounEnd = new Map(); const nounStart = new Map();
    const addTo = (map, key, item) => { if (!map.has(key)) map.set(key, []); map.get(key).push(item); };
    const nouns = []; const adjs = [];
    L.words.forEach((w, i) => {
      if (!L.single(i) || !L.checkable(i) || L.inflected(i) || L.key(i).length < 3) return;
      if (INTERJECTIONS.has(L.text(i))) return;
      const p = L.pos(i);
      if (p === 'n' && L.zipf(i) >= 3.6) nouns.push(i);
      if (p === 'a' && L.zipf(i) >= 3.9) adjs.push(i);
    });
    const ends = (map, text, k, z, g) => { for (let s = 1; s <= Math.min(8, k.length); s++) addTo(map, k.slice(-s), { text, k, z, g }); };
    const starts = (map, text, k, z, g) => { for (let s = 1; s <= Math.min(8, k.length); s++) addTo(map, k.slice(0, s), { text, k, z, g }); };
    if (this.lang === 'en') {
      for (const a of adjs) ends(first, L.text(a), L.key(a), L.zipf(a), null);
      for (const n of nouns) if (L.zipf(n) >= 4.2) ends(first, L.text(n), L.key(n), L.zipf(n) - 0.2, null);
      for (const n of nouns) starts(second, L.text(n), L.key(n), L.zipf(n), null);
    } else {
      for (const n of nouns) {
        const g = genderEs(L.text(n));
        if (g) ends(first, L.text(n), L.key(n), L.zipf(n), g);
        ends(nounEnd, L.text(n), L.key(n), L.zipf(n), null);
        starts(nounStart, L.text(n), L.key(n), L.zipf(n), null);
      }
      for (const a of adjs) {
        const f = adjFormsEs(L.text(a));
        if (!f) continue;
        for (const g of ['m', 'f']) starts(second, f[g], N.letters(f[g], 'es'), L.zipf(a), g);
      }
      for (const m of [first, second, nounEnd, nounStart]) for (const v of m.values()) v.sort((x, y) => y.z - x.z);
    }
    for (const m of [first, second]) for (const v of m.values()) v.sort((x, y) => y.z - x.z);
    this._phrase = { first, second, nounEnd, nounStart };
    return this._phrase;
  }

  get homophones() {
    if (this._homo) return this._homo;
    const L = this.L; const map = new Map();
    const add = (key, i, variant) => { const kk = key + '|' + (variant || ''); if (!map.has(kk)) map.set(kk, []); map.get(kk).push(i); };
    L.words.forEach((w, i) => {
      if (!L.single(i) || L.zipf(i) < 3 || !L.checkable(i) || L.inflected(i)) return;
      if (this.lang === 'es') {
        const k = L.key(i);
        add(this.R.phoneticKey(k, ['yeismo']) + '/' + this.R.phoneticKey(k, ['seseo', 'yeismo']), i, null);
        add(this.R.phoneticKey(k, ['seseo', 'yeismo']), i, 'es-AR');
      } else {
        for (const p of L.pron[L.text(i)] || []) add(p, i, /\bR\b|ER/.test(p) ? 'en-US' : null);
      }
    });
    this._homo = map;
    return map;
  }

  // ── respuestas ──
  answers() {
    if (this._answers) return this._answers;
    const L = this.L; const out = [];
    L.words.forEach((w, i) => {
      const t = L.text(i); const k = L.key(i);
      if (!L.single(i) || k.length < 4 || k.length > 12) return;
      if (L.zipf(i) < this.opts.minAnswerZipf || !L.checkable(i) || L.inflected(i)) return;
      if (!this.defs(i).length) return;
      if (this.lang === 'en' && !/^[a-z]+$/.test(t)) return;
      out.push(i);
    });
    out.sort((a, b) => (hash(VERSION + this.lang + L.text(a)) - hash(VERSION + this.lang + L.text(b))) || (a - b));
    this._answers = out;
    return out;
  }

  defs(i) {
    if (!this.defCache.has(i)) this.defCache.set(i, this.L.definitions(i, { minZipf: 3, maxRank: 1 }));
    return this.defCache.get(i);
  }

  // Formas de obtener las letras `k` como pieza: sinónimo de una palabra que se
  // escribe así, o abreviatura convencional.
  pieces(k, answerText) {
    const ck = k;
    if (!this.pieceCache.has(ck)) {
      const out = [];
      const L = this.L;
      if (k.length >= 3) {
        for (const j of L.withKey(k)) {
          if (!L.single(j) || L.zipf(j) < this.opts.minPieceZipf || !L.checkable(j) || L.inflected(j)) continue;
          const d = L.definitions(j, { minZipf: 3.3, maxRank: 0, maxWords: 2 }).find((x) => x.kind === 'syn' || x.z >= 4);
          if (d) out.push({ op: 'syn', from: d.text, text: L.text(j), word: L.text(j), z: Math.min(L.zipf(j), d.z), ev: { word: L.text(j), def: d.text, kind: d.kind, synset: d.synset } });
        }
      }
      if (k.length <= 2) {
        for (const [from, vals] of Object.entries(this.R.abbreviations)) {
          if (!vals.includes(k) || from.length < 3) continue;
          if (this.R.variantAbbreviations && this.R.variantAbbreviations[from]) continue;
          const shown = this.abbrWord(from);
          if (shown) out.push({ op: 'abbr', from: shown, text: k, word: k, z: 4, ev: null });
        }
      }
      this.pieceCache.set(ck, out.sort((a, b) => b.z - a.z).slice(0, 4));
    }
    return this.pieceCache.get(ck).filter((p) => !p.from || (!lexicon.sameFamily(p.from, answerText) && !lexicon.stemClash(p.from, answerText)));
  }

  // Forma escrita de una clave de abreviatura ("OXIGENO" → "oxígeno").
  abbrWord(key) {
    if (!this._abbrWords) {
      this._abbrWords = new Map();
      this.L.words.forEach((w, i) => { if (this.L.single(i)) { const k = this.L.key(i); if (!this._abbrWords.has(k)) this._abbrWords.set(k, this.L.text(i)); } });
    }
    if (!/^[A-ZÑ]+$/.test(key) || ['UNOROMANO', 'CINCOROMANO', 'DIEZROMANO', 'NOTAMUSICAL', 'NUMEROPI', 'NOTA', 'PI', 'POINT', 'LOVE', 'DUCK', 'NOTHING'].includes(key)) return null;
    return this._abbrWords.get(key) || null;
  }

  // ── construcción de candidatos ──
  candidates(i) {
    const L = this.L; const A = L.text(i); const K = L.key(i);
    const defs = this.defs(i);
    const plans = [];
    const def0 = defs.filter((d) => d.rankA === 0);
    const defFor = (salt, opts = {}) => {
      const pool = defs.filter((d) => (opts.secondary ? d.rankA >= 1 || d.kind === 'hyp' : d.rankA === 0));
      return pool.length ? pool[hash(A + salt) % Math.min(pool.length, 3)] : null;
    };
    const both = (salt, fn) => {
      const d0 = defFor(salt); const d1 = defFor(salt, { secondary: true });
      if (d0) fn(d0, 0); if (d1 && (!d0 || d1.text !== d0.text)) fn(d1, 1);
    };

    // Palabra oculta
    for (const hid of this.hiddenPhrases(K, A)) {
      both('h' + hid.phrase, (d) => plans.push({ type: 'hidden', d, phrase: hid.phrase, z: hid.z }));
    }

    // Anagramas
    const fodder = this.fodder; const alt = this.opts.alternatives;
    let nA = 0;
    for (const j of fodder.bySorted.get(sortKey(K)) || []) {
      const t = L.text(j);
      if (L.key(j) === K || lexicon.sameFamily(t, A)) continue;
      both('a1' + t, (d) => plans.push({ type: 'anagram1', d, fodder: [t], z: L.zipf(j) }));
      if (++nA >= alt) break;
    }
    const two = this.twoWordAnagram(K, A);
    if (two) both('a2', (d) => plans.push({ type: 'anagram2', d, fodder: two.words, z: two.z }));

    // Inversión
    const rev = [...K].reverse().join('');
    if (rev !== K) {
      for (const j of L.withKey(rev)) {
        if (!L.single(j) || L.zipf(j) < 3.3 || !L.checkable(j) || L.inflected(j)) continue;
        const t = L.text(j);
        both('rl' + t, (d) => plans.push({ type: 'reversal_lit', d, piece: { op: 'lit', text: t, word: t }, z: L.zipf(j) }));
        const p = this.pieces(rev, A).find((x) => x.op === 'syn' && x.word === t);
        if (p) both('rs' + t, (d) => plans.push({ type: 'reversal_syn', d, piece: p, z: p.z }));
        if (plans.filter((x) => x.type === 'reversal_lit').length >= alt) break;
      }
    }

    // Eliminación de la primera o la última letra
    for (const c of ALPHA + (this.lang === 'es' ? 'Ñ' : '')) {
      for (const [k2, remove] of [[c + K, 'first'], [K + c, 'last']]) {
        for (const j of L.withKey(k2)) {
          if (!L.single(j) || L.zipf(j) < 3.5 || !L.checkable(j) || L.inflected(j)) continue;
          const t = L.text(j);
          if (plans.filter((p) => p.type === 'deletion_lit').length >= alt * 2) break;
          both('dl' + t, (d) => plans.push({ type: 'deletion_lit', d, remove, piece: { op: 'lit', text: t, word: t }, z: L.zipf(j) }));
          const p = this.pieces(k2, A).find((x) => x.op === 'syn' && x.word === t);
          if (p) both('ds' + t, (d) => plans.push({ type: 'deletion_syn', d, remove, piece: p, z: p.z }));
          break;
        }
      }
    }

    // Charadas de dos y tres piezas
    for (let s = 1; s < K.length; s++) {
      const a = this.pieces(K.slice(0, s), A); const b = this.pieces(K.slice(s), A);
      for (const pa of a.slice(0, alt)) for (const pb of b.slice(0, alt)) {
        if (pa.op === 'abbr' && pb.op === 'abbr') continue;
        if (pa.word === pb.word) continue;
        both('c' + s, (d) => plans.push({ type: 'charade', d, a: pa, b: pb, z: Math.min(pa.z, pb.z) }));
      }
    }
    if (K.length >= 7) {
      let found = 0;
      for (let s = 1; s < K.length - 1 && found < alt; s++) {
        for (let u = s + 1; u < K.length && found < alt; u++) {
          const a = this.pieces(K.slice(0, s), A)[0]; const b = this.pieces(K.slice(s, u), A)[0]; const c = this.pieces(K.slice(u), A)[0];
          if (!a || !b || !c) continue;
          if ([a, b, c].filter((p) => p.op === 'abbr').length > 1) continue;
          if (new Set([a.word, b.word, c.word]).size < 3) continue;
          found++;
          both('c3' + s + '.' + u, (d) => plans.push({ type: 'charade3', d, parts: [a, b, c], z: Math.min(a.z, b.z, c.z) }));
        }
      }
    }

    // Inserción: una pieza dentro de otra
    let ins = 0;
    for (let x = 1; x < K.length - 1 && ins < 2 * alt; x++) {
      for (let y = x + 1; y < K.length && ins < 2 * alt; y++) {
        const inner = this.pieces(K.slice(x, y), A)[0];
        const outerKey = K.slice(0, x) + K.slice(y);
        if (!inner || outerKey.length < 3) continue;
        const outer = this.pieces(outerKey, A).find((p) => p.op === 'syn');
        if (!outer || outer.word === inner.word) continue;
        ins++;
        both('i' + x + y, (d) => plans.push({ type: 'container', d, outer, inner, z: Math.min(outer.z, inner.z) }));
      }
    }

    // Combinación: inversión dentro de una charada
    let nC = 0;
    for (let s = 3; s < K.length - 2 && nC < alt; s++) {
      const revA = [...K.slice(0, s)].reverse().join('');
      const a = this.pieces(revA, A).find((p) => p.op === 'syn');
      const b = this.pieces(K.slice(s), A).find((p) => p.op === 'syn');
      if (a && b && revA !== K.slice(0, s) && a.word !== b.word) {
        both('rc' + s, (d) => plans.push({ type: 'combo', d, a, b, z: Math.min(a.z, b.z) }));
        nC++;
      }
    }

    // Doble definición: dos sentidos distintos de la respuesta
    const senses = new Map();
    for (const d of defs) if (d.kind === 'syn' && !senses.has(d.sense)) senses.set(d.sense, d);
    const ds = [...senses.values()];
    for (let u = 0; u < ds.length; u++) {
      for (let v = u + 1; v < ds.length; v++) {
        const d1 = ds[u]; const d2 = ds[v];
        if (d1.lex === d2.lex || lexicon.stemClash(d1.text, d2.text)) continue;
        const shareSense = L.senses(d1.word).some((s) => L.senses(d2.word).includes(s));
        if (shareSense) continue;
        plans.push({ type: 'double', d: d1, d2, z: Math.min(d1.z, d2.z), rankAdj: d2.rankA });
        u = ds.length; break;
      }
    }

    // Homófonos
    for (const h of this.homophoneMates(i)) {
      both('hl' + h.text, (d) => plans.push({ type: 'homophone_lit', d, piece: { op: 'lit', text: h.text, word: h.text }, variant: h.variant, z: h.z }));
      const p = this.pieces(h.key, A).find((x) => x.op === 'syn' && x.word === h.text);
      if (p) both('hs' + h.text, (d) => plans.push({ type: 'homophone_syn', d, piece: p, variant: h.variant, z: p.z }));
      break;
    }

    void def0;
    return plans.map((p) => this.render(i, p)).filter(Boolean);
  }

  hiddenPhrases(K, A, max = 3) {
    const { first, second, nounEnd, nounStart } = this.phraseIndex;
    const found = [];
    const ok = (f, g) => !lexicon.sameFamily(f.text, A) && !lexicon.sameFamily(g.text, A) && f.text !== g.text;
    const consider = (phrase, z, words) => {
      if (found.some((x) => x.words.some((w) => words.includes(w)))) return;
      found.push({ phrase, z, words });
    };
    for (let s = 1; s < K.length; s++) {
      const x = K.slice(0, s); const y = K.slice(s);
      const fs = first.get(x); const ss = second.get(y);
      if (fs && ss) {
        let tries = 0;
        for (const f of fs) {
          if (++tries > 60) break;
          const g = ss.find((c) => (this.lang !== 'es' || c.g === f.g) && ok(f, c) && !(f.k === x && c.k === y)
            && f.k.length + c.k.length - K.length >= 2);
          if (!g) continue;
          const z = Math.min(f.z, g.z) + (f.k.length > x.length && g.k.length > y.length ? 0.3 : 0);
          consider(`${f.text} ${g.text}`, z, [f.text, g.text]);
          break;
        }
      }
      // sustantivo + de + sustantivo: la respuesta atraviesa el "de"
      if (this.lang === 'es' && s + 2 < K.length && K.slice(s, s + 2) === 'DE') {
        const y2 = K.slice(s + 2);
        const fe = nounEnd.get(x); const gs = nounStart.get(y2);
        if (fe && gs) {
          const f = fe.find((c) => c.k.length > x.length);
          const g = f && gs.find((c) => c.k.length > y2.length && ok(f, c));
          if (f && g) consider(`${f.text} de ${g.text}`, Math.min(f.z, g.z) - 0.6, [f.text, g.text]);
        }
      }
    }
    return found.sort((p, q) => q.z - p.z).slice(0, max);
  }

  twoWordAnagram(K, A) {
    const { list, bySorted } = this.fodder;
    const want = sortKey(K); const wantMask = maskOf(K);
    const counts = {}; for (const ch of K) counts[ch] = (counts[ch] || 0) + 1;
    let best = null;
    for (const f of list) {
      if (f.k.length < 3 || f.k.length > K.length - 3) continue;
      if ((f.m & ~wantMask) !== 0) continue;
      const c = { ...counts }; let ok = true;
      for (const ch of f.k) { if (!c[ch]) { ok = false; break; } c[ch]--; }
      if (!ok) continue;
      let rest = ''; for (const ch of Object.keys(c).sort()) rest += ch.repeat(c[ch]);
      const mates = bySorted.get(rest);
      if (!mates) continue;
      for (const j of mates) {
        const t1 = this.L.text(f.i); const t2 = this.L.text(j);
        if (t1 === t2 || lexicon.sameFamily(t1, A) || lexicon.sameFamily(t2, A)) continue;
        if (sortKey(f.k + this.L.key(j)) !== want) continue;
        const z = Math.min(this.L.zipf(f.i), this.L.zipf(j));
        if (!best || z > best.z) best = { words: [t1, t2], z };
      }
    }
    return best;
  }

  homophoneMates(i) {
    const L = this.L; const K = L.key(i); const out = [];
    const keys = [];
    if (this.lang === 'es') {
      keys.push([this.R.phoneticKey(K, ['yeismo']) + '/' + this.R.phoneticKey(K, ['seseo', 'yeismo']), null]);
      keys.push([this.R.phoneticKey(K, ['seseo', 'yeismo']), 'es-AR']);
    } else {
      for (const p of L.pron[L.text(i)] || []) keys.push([p, /\bR\b|ER/.test(p) ? 'en-US' : null]);
    }
    for (const [k, variant] of keys) {
      for (const j of this.homophones.get(k + '|' + (variant || '')) || []) {
        const kj = L.key(j);
        if (kj === K || lexicon.stemClash(L.text(j), L.text(i))) continue;
        out.push({ text: L.text(j), key: kj, z: L.zipf(j), variant });
      }
      if (out.length) break;
    }
    return out.sort((a, b) => b.z - a.z);
  }

  // ── superficie, árbol, dificultad ──
  render(i, plan) {
    const L = this.L; const S = this.S; const A = L.text(i); const K = L.key(i);
    const seed = `${VERSION}|${A}|${plan.type}|${plan.d.text}`;
    const tmpl = (name) => pick(S.t[name], seed + name);
    const ind = (name) => pick(S.ind[name], seed + 'i' + name);
    const d = plan.d.text;
    const ctx = { d, D: d };
    let wordplay; let surface; const evidence = [{ role: 'definition', word: A, def: d, kind: plan.d.kind, synset: plan.d.synset }];
    const pieceNode = (p) => (p.op === 'lit' ? { op: 'lit', text: p.text } : p.op === 'abbr' ? { op: 'abbr', from: p.from, text: p.text } : { op: 'syn', from: p.from, text: p.text });
    const pieceShown = (p) => (p.op === 'lit' ? p.text : p.from);
    const addEv = (p) => { if (p.op === 'syn') evidence.push({ role: 'piece', ...p.ev }); };
    let score = BASE[plan.type];
    let definition = d;

    switch (plan.type) {
      case 'hidden': {
        const i2 = { pre: ind('hiddenPre'), verb: ind('hiddenVerb') };
        const t = hash(seed) % 2;
        surface = S.t.hidden[t]({ ...ctx, ind: i2, phrase: plan.phrase });
        wordplay = { op: 'hidden', indicator: t === 0 ? i2.pre : i2.verb, in: plan.phrase };
        break;
      }
      case 'anagram1': case 'anagram2': {
        const fodder = plan.fodder.join(` ${S.and} `);
        const pre = ind('anagramPre');
        const post = plan.fodder.length === 1 && hash(seed + 'one') % 3 === 0 ? ind('anagramPostOne') : ind('anagramPost');
        const t = this.lang === 'en' ? hash(seed) % 2 : hash(seed) % 2;
        surface = S.t.anagram[t]({ ...ctx, ind: { pre, post }, fodder });
        const usesPre = surface.toLowerCase().includes(pre) && this.lang === 'es' && t === 0;
        wordplay = { op: 'anagram', indicator: usesPre ? pre : post, of: plan.fodder.map((w) => ({ op: 'lit', text: w })) };
        break;
      }
      case 'reversal_lit': case 'reversal_syn': {
        const r = ind('reversal');
        surface = tmpl('reversal')({ ...ctx, ind: r, piece: pieceShown(plan.piece) });
        wordplay = { op: 'reverse', indicator: r, of: pieceNode(plan.piece) };
        addEv(plan.piece);
        break;
      }
      case 'deletion_lit': case 'deletion_syn': {
        const r = ind(plan.remove === 'first' ? 'deleteFirst' : 'deleteLast');
        surface = tmpl('deletion')({ ...ctx, ind: r, piece: pieceShown(plan.piece) });
        wordplay = { op: 'delete', indicator: r, remove: plan.remove, of: pieceNode(plan.piece) };
        addEv(plan.piece);
        break;
      }
      case 'charade': {
        const r = ind('charade');
        surface = tmpl('charade')({ ...ctx, ind: r, a: pieceShown(plan.a), b: pieceShown(plan.b) });
        wordplay = { op: 'concat', indicator: r, parts: [pieceNode(plan.a), pieceNode(plan.b)] };
        [plan.a, plan.b].forEach(addEv);
        score += [plan.a, plan.b].filter((p) => p.op === 'abbr').length * 0.5;
        break;
      }
      case 'charade3': {
        const [a, b, c] = plan.parts;
        surface = tmpl('charade3')({ ...ctx, a: pieceShown(a), b: pieceShown(b), c: pieceShown(c) });
        wordplay = { op: 'concat', parts: plan.parts.map(pieceNode) };
        plan.parts.forEach(addEv);
        break;
      }
      case 'container': {
        const outerFirst = hash(seed + 'c') % 2 === 0;
        const r = ind(outerFirst ? 'containerOuter' : 'containerInner');
        surface = tmpl(outerFirst ? 'containerOuter' : 'containerInner')({ ...ctx, ind: r, outer: pieceShown(plan.outer), inner: pieceShown(plan.inner) });
        wordplay = { op: 'insert', indicator: r, outer: pieceNode(plan.outer), inner: pieceNode(plan.inner) };
        [plan.outer, plan.inner].forEach(addEv);
        if (plan.inner.op === 'syn') score += 0.5;
        break;
      }
      case 'combo': {
        const r = ind('charade'); const rr = ind('reversal');
        surface = S.t.reverseCharade[0]({ ...ctx, ind: r, rind: rr, a: pieceShown(plan.a), b: pieceShown(plan.b) });
        wordplay = { op: 'concat', indicator: r, parts: [{ op: 'reverse', indicator: rr, of: pieceNode(plan.a) }, pieceNode(plan.b)] };
        [plan.a, plan.b].forEach(addEv);
        break;
      }
      case 'double': {
        surface = S.t.double[0]({ d1: d, d2: plan.d2.text });
        wordplay = { op: 'double', definitions: [d, plan.d2.text] };
        evidence.push({ role: 'definition', word: A, def: plan.d2.text, kind: plan.d2.kind, synset: plan.d2.synset });
        definition = null;
        score += plan.rankAdj ? 1 : 0;
        break;
      }
      case 'homophone_lit': case 'homophone_syn': {
        const r = ind('homophone');
        surface = tmpl('homophone')({ ...ctx, ind: r, piece: pieceShown(plan.piece) });
        wordplay = { op: 'homophone', indicator: r, of: pieceNode(plan.piece) };
        addEv(plan.piece);
        break;
      }
      default: return null;
    }

    // Reglas de dificultad (documentadas en docs/BANCO.md)
    const z = L.zipf(i);
    if (plan.type !== 'double') score += plan.d.rankA >= 1 ? 1 : plan.d.kind === 'hyp' ? 0.5 : 0;
    score += z >= 4.5 ? -0.5 : z < 3 ? 1 : z < 3.5 ? 0.5 : 0;
    if (K.length > 9) score += 0.5;
    if (plan.z < 4) score += 0.25;
    const difficulty = Math.max(1, Math.min(5, Math.round(score)));

    // Ninguna palabra de contenido puede repetirse ni delatar la respuesta, y la
    // definición no puede ser de la misma familia que una pieza ("mención"/"mencionar").
    const words = N.words(surface, this.lang);
    if (words.includes(K)) return null;
    const content = words.filter((w) => w.length > 3);
    if (new Set(content).size !== content.length) return null;
    const defWords = N.words(definition || '', this.lang).filter((w) => w.length > 3);
    const rest = content.filter((w) => !defWords.includes(w));
    if (defWords.some((a) => rest.some((b) => lexicon.sameFamily(a, b)))) return null;

    const mechs = [...mechanismsIn(wordplay)];
    const mechanism = plan.type === 'combo' ? 'combination' : mechs[0];
    const secondary = new Set(mechs.filter((m) => m !== mechanism));
    walk(wordplay, (n) => { if (n.op === 'abbr') secondary.add('abbreviation'); if (n.op === 'syn') secondary.add('synonym'); });
    if (plan.d.rankA >= 1) secondary.add('misleading_definition');
    if (plan.variant) secondary.add('regional');

    const variant = plan.variant || this.regionVariant([i, ...evidence.filter((e) => e.role === 'piece').map((e) => L.byText.get(e.word))]);
    const sense = L.synsets[L.senses(i)[0]];
    const clue = {
      clue_text: `${surface} (${N.enumerationOf(A, this.lang)})`,
      answer: A.toUpperCase(),
      definition,
      wordplay,
      mechanism,
      mechanisms_secondary: [...secondary],
      difficulty,
      score: Math.round(score * 100) / 100,
      quality: Math.round(plan.z * 100) / 100,
      category: CATEGORY_BY_LEX[sense.x] || 'general',
      language_code: this.lang,
      variant_code: variant,
      evidence,
      dedup_key: this.dedupKey(K, mechanism, wordplay),
      generator_version: VERSION,
    };
    clue.hints = hintsFor(clue, this.lang);
    return clue;
  }

  regionVariant(idx) {
    let r = null;
    for (const i of idx) {
      if (i === undefined || i === null) continue;
      const reg = this.L.region(i);
      if (reg && r && reg !== r) return 'conflict';
      if (reg) r = reg;
    }
    return r ? `en-${r}` : null;
  }

  // Huella del juego de palabras: misma respuesta, mismo mecanismo y mismo
  // material de partida = misma pista, aunque cambie la redacción.
  dedupKey(K, mechanism, wordplay) {
    const bits = [];
    walk(wordplay, (n) => {
      if (n.op === 'lit' || n.op === 'syn' || n.op === 'abbr') bits.push(N.letters(n.text, this.lang));
      if (n.op === 'hidden') bits.push(N.letters(n.in, this.lang));
      if (n.op === 'double') bits.push(...n.definitions.map((x) => N.letters(x, this.lang)).sort());
      if (!['lit', 'syn', 'abbr', 'letter'].includes(n.op)) bits.push('#' + n.op);
    });
    return `${this.lang}|${K}|${mechanism}|${bits.join('.')}`;
  }

  // Candidatos de una respuesta para una dificultad, ordenados por calidad.
  // Primero un candidato por mecanismo (variedad) y después las alternativas.
  forDifficulty(i, difficulty, max = 3, perMechanism = 2) {
    if (!this._cand || this._cand.i !== i) this._cand = { i, list: this.candidates(i) };
    const all = this._cand.list.filter((c) => c.difficulty === difficulty && c.variant_code !== 'conflict');
    all.sort((a, b) => b.quality - a.quality || (a.dedup_key < b.dedup_key ? -1 : 1));
    const out = []; const count = {}; const keys = new Set();
    for (let round = 1; round <= perMechanism && out.length < max; round++) {
      for (const c of all) {
        if (out.length >= max) break;
        if (keys.has(c.dedup_key) || (count[c.mechanism] || 0) >= round) continue;
        count[c.mechanism] = (count[c.mechanism] || 0) + 1; keys.add(c.dedup_key); out.push(c);
      }
    }
    return out;
  }
}

// Pistas progresivas: tipo de juego, indicador, definición, primera letra y patrón.
function hintsFor(clue, lang) {
  const out = [{ kind: 'mechanism', mechanism: clue.mechanism }];
  let indicator = null;
  walk(clue.wordplay, (n) => { if (!indicator && n.indicator) indicator = n.indicator; });
  if (indicator) out.push({ kind: 'indicator', text: indicator });
  out.push({ kind: 'definition', text: clue.definition || (clue.wordplay.definitions || [])[0] || null });
  const key = N.answerKey(clue.answer, lang);
  out.push({ kind: 'first_letter', letter: key[0] });
  out.push({ kind: 'pattern', pattern: [...key].map((ch, k) => (k % 2 === 0 ? ch : '_')).join('') });
  return out;
}

const engines = {};
function engine(lang) {
  if (!engines[lang]) engines[lang] = new Engine(lang);
  return engines[lang];
}

module.exports = { Engine, engine, VERSION, hintsFor, genderEs, adjFormsEs, BASE };
