'use strict';

// Léxico del generador (data/lexicon/<idioma>.json.gz, ver scripts/lexicon/build.py).
// Solo lo usan el generador y la verificación de lotes: ninguna partida lo carga.
//
// Formato: words = [texto, frecuencia zipf, [sentidos por orden de uso]],
//          synsets = {id, p: categoría, x: archivo léxico, w: palabras, h: hiperónimos, r: región}

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const N = require('../normalize');
const mitWords = require('../lexicon');

const DIR = path.join(__dirname, '..', '..', '..', 'data', 'lexicon');
const cache = {};

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, k) => k);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Dos palabras de la misma familia o casi iguales ("color"/"colour",
// "correr"/"corredor") no pueden definirse una con la otra.
function stemClash(a, b) {
  const x = N.letters(a, 'es'); const y = N.letters(b, 'es');
  if (!x || !y) return true;
  if (editDistance(x, y) <= 2 && Math.min(x.length, y.length) >= 4) return true;
  return sameFamily(x, y);
}

// Misma raíz: una contiene a la otra o comparten el comienzo.
function sameFamily(a, b) {
  const x = N.letters(a, 'es'); const y = N.letters(b, 'es');
  if (!x || !y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  const n = Math.min(5, Math.max(4, Math.min(x.length, y.length) - 1));
  return x.slice(0, n) === y.slice(0, n);
}

class Lexicon {
  constructor(lang, raw) {
    this.lang = lang;
    this.sources = raw.sources;
    this.words = raw.words;
    this.synsets = raw.synsets;
    this.pron = raw.pron || {};
    this.thes = raw.thes ? new Map(Object.entries(raw.thes).map(([t, v]) => [t, new Set(v)])) : null;
    this.depthCache = new Map();
    this.byText = new Map();
    this.byKey = new Map();          // letras normalizadas → índices de palabra
    this.words.forEach((w, i) => {
      this.byText.set(w[0], i);
      const k = N.letters(w[0], lang);
      if (!this.byKey.has(k)) this.byKey.set(k, []);
      this.byKey.get(k).push(i);
    });
  }

  text(i) { return this.words[i][0]; }
  zipf(i) { return this.words[i][1]; }
  senses(i) { return this.words[i][2]; }
  key(i) { return N.letters(this.words[i][0], this.lang); }
  single(i) { return !this.words[i][0].includes(' '); }

  // La palabra existe en el diccionario de comprobación del validador.
  checkable(i) {
    return this.words[i][0].split(' ').every((w) => mitWords.has(this.lang, w));
  }

  rank(i, sid) { return this.senses(i).indexOf(sid); }

  confirmed(i, j) {
    const a = this.thes.get(this.text(i)); const b = this.thes.get(this.text(j));
    return Boolean((a && a.has(j)) || (b && b.has(i)));
  }

  // Profundidad de un sentido en la jerarquía: los hiperónimos muy generales
  // ("entidad", "cambio", "cualidad") no sirven como definición.
  depth(sid) {
    if (this.depthCache.has(sid)) return this.depthCache.get(sid);
    this.depthCache.set(sid, 0);
    const h = this.synsets[sid].h;
    const d = h.length ? 1 + Math.min(...h.map((x) => this.depth(x))) : 0;
    this.depthCache.set(sid, d);
    return d;
  }

  // Formas flexionadas que el diccionario trae como lema propio (plurales,
  // femeninos de adjetivos): se evitan como respuesta y como definición
  // porque suelen arrastrar errores de concordancia.
  inflected(i) {
    const t = this.text(i);
    if (t.includes(' ')) return false;
    const has = (x) => this.byText.has(x);
    if (/[^s]s$/.test(t) && (has(t.slice(0, -1)) || (t.endsWith('es') && has(t.slice(0, -2))))) return true;
    if (this.lang === 'es' && t.endsWith('a') && this.pos(i) === 'a' && has(t.slice(0, -1) + 'o')) return true;
    return false;
  }

  // Concordancia de forma entre respuesta y definición.
  agrees(i, j) {
    const a = this.text(i); const d = this.text(j);
    if (this.lang === 'en') {
      const first = d.split(' ')[0];
      for (const suf of ['ing', 'ed']) if (first.endsWith(suf) !== a.endsWith(suf)) return false;
      return true;
    }
    if (this.pos(i) === 'a' && this.pos(j) === 'a') {
      const g = (t) => (/o$/.test(t) ? 'm' : /a$/.test(t) ? 'f' : null);
      const ga = g(a); const gd = g(d.split(' ')[0]);
      if (ga && gd && ga !== gd) return false;
    }
    return true;
  }

  // Definiciones defendibles de una palabra, con la evidencia que las respalda.
  //   syn: comparten un sentido. Se exige que sea el sentido principal de la
  //        definición y uno de los dos primeros de la respuesta, o que compartan
  //        al menos dos sentidos (sinonimia fuerte).
  //   hyp: hiperónimo ("rosa" → "flor") del sentido principal de la respuesta.
  definitions(i, { minZipf = 3, maxWords = 3, maxRank = 1 } = {}) {
    const out = [];
    const seen = new Set();
    const mine = this.senses(i);
    const add = (j, kind, sid, rankA, rankD, shared, own) => {
      const t = this.text(j);
      if (j === i || seen.has(t)) return;
      if (this.zipf(j) < minZipf || t.split(' ').length > maxWords) return;
      if (stemClash(t, this.text(i))) return;
      if (!this.checkable(j) || this.inflected(j) || !this.agrees(i, j)) return;
      seen.add(t);
      out.push({ text: t, word: j, kind, synset: this.synsets[sid].id, sense: own, lex: this.synsets[own].x, rankA, rankD, shared, z: this.zipf(j) });
    };
    mine.forEach((sid, rankA) => {
      if (rankA > maxRank) return;
      const s = this.synsets[sid];
      for (const j of s.w) {
        const other = this.senses(j);
        const rankD = other.indexOf(sid);
        const shared = other.filter((x) => mine.includes(x)).length;
        // En español el wordnet arrastra ruido de traducción: una sinonimia solo
        // se acepta si también la registra el tesauro (dos fuentes independientes).
        const strong = this.thes
          ? (rankA <= 1 && this.confirmed(i, j))
          : (rankD === 0 && rankA <= 1);
        if (strong || (!this.thes && shared >= 2)) add(j, 'syn', sid, rankA, rankD, shared, sid);
      }
      if (rankA === 0 && s.p === 'n') {
        for (const h of s.h) {
          if (this.depth(h) < 5) continue;
          for (const j of this.synsets[h].w) {
            if (this.senses(j)[0] !== h || this.zipf(j) < minZipf + 0.5) continue;
            if (this.thes && !this.confirmed(i, j)) continue;
            add(j, 'hyp', h, rankA, 0, 0, sid);
          }
        }
      }
    });
    // primero las más directas y frecuentes
    return out.sort((a, b) => (a.rankA - b.rankA) || ((a.kind === 'syn' ? 0 : 1) - (b.kind === 'syn' ? 0 : 1)) || (b.z - a.z));
  }

  // Comprueba de forma independiente que `def` define a la palabra `answer`
  // según el léxico (lo usa la verificación de lotes).
  supports(answer, def) {
    const i = this.byText.get(String(answer).toLowerCase());
    if (i === undefined) return null;
    const d = this.definitions(i, { minZipf: 0, maxRank: 9 }).find((x) => x.text === String(def).toLowerCase());
    return d || null;
  }

  // Palabras por letras exactas (anagramas, inversiones, piezas de charadas).
  withKey(k) { return this.byKey.get(k) || []; }

  pos(i) { const s = this.senses(i)[0]; return s === undefined ? null : this.synsets[s].p; }
  region(i) { const s = this.senses(i)[0]; return s === undefined ? null : (this.synsets[s].r || null); }
}

function load(lang) {
  if (!cache[lang]) {
    const file = path.join(DIR, `${lang}.json.gz`);
    if (!fs.existsSync(file)) return null;
    cache[lang] = new Lexicon(lang, JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')));
  }
  return cache[lang];
}

function available(lang) {
  return fs.existsSync(path.join(DIR, `${lang}.json.gz`));
}

module.exports = { load, available, stemClash, sameFamily };
