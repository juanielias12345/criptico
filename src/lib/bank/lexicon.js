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
    if (this.form && this.isDerived(i)) return false;
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
      if (!this.sameNumber(i, j, this.synsets[sid].p)) return;
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

  // En un léxico de formas derivadas (plurales, femeninos, gerundios,
  // participios), una definición tiene que estar en la misma forma que la
  // palabra: plural con plural, gerundio con gerundio. Los sentidos de otras
  // categorías gramaticales solo valen entre palabras sin derivar. En el
  // léxico normal siempre concuerdan.
  sameNumber(i, j, p) {
    if (!this.form) return true;
    const a = this.isDerived(i); const b = this.isDerived(j);
    return this.formPos.has(p) ? a === b : !a && !b;
  }

  isDerived(i) { return Boolean(this.flags && this.flags[i]); }
  isPlural(i) { return this.form === 'plural' && this.isDerived(i); }

  pos(i) { const s = this.senses(i)[0]; return s === undefined ? null : this.synsets[s].p; }
  region(i) { const s = this.senses(i)[0]; return s === undefined ? null : (this.synsets[s].r || null); }
}

// ── formas derivadas del español ──
// Cada léxico derivado cambia el texto de algunas palabras por una forma
// flexionada y conserva sus sentidos, así que las definiciones salen de las
// mismas dos fuentes (wordnet y tesauro) que en el léxico normal. Toda forma
// derivada tiene que figurar además en el diccionario de comprobación.
//
// Sustantivos: solo los de plural sin dudas, y nunca los que suelen ser
// incontables (sustancias, comidas, estados, cualidades, sentimientos,
// procesos y fenómenos: «saludes», «calores» suenan raros).
const PLURAL_NO_LEX = new Set([7, 12, 13, 19, 22, 26, 27]);
const PLURAL_SKIP = new Set(['carácter', 'régimen', 'espécimen', 'gente', 'dinero', 'sed', 'fe', 'sal', 'miel', 'leche', 'arroz']);
const UNACCENT = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' };
// participios irregulares: la forma regular a veces existe pero es arcaica («rompido»)
const IRREGULAR_PARTICIPLE = /(romper|hacer|decir|scribir|^ver|prever|poner|morir|volver|abrir|cubrir|solver|primir|freír|facer|pudrir)$/;

function syllables(t) { return (t.match(/[aeiouáéíóúü]+/g) || []).length; }

function pluralEs(t) {
  if (!/^[a-záéíóúñü]+$/.test(t) || t.length < 3 || PLURAL_SKIP.has(t)) return null;
  const last = t[t.length - 1];
  if ('aeoiuáéó'.includes(last)) return t + 's';
  if ('íú'.includes(last) || 's' === last || 'x' === last || 'y' === last) return null;
  if (last === 'z') return t.slice(0, -1) + 'ces';
  if (!'lrdjn'.includes(last)) return null;
  // aguda con tilde (camión, compás): la tilde se cae en el plural
  const m = t.match(/([áéíóú])([^aeiouáéíóú]*)$/);
  if (m && t.indexOf(m[1]) === t.length - 1 - m[2].length) return t.slice(0, -1 - m[2].length) + UNACCENT[m[1]] + m[2] + 'es';
  if (/[áéíóú]/.test(t)) return t + 'es';            // llana con tilde: árbol → árboles
  if (last === 'n' && syllables(t) > 1) return null;  // examen → exámenes: tilde nueva, se evita
  return t + 'es';                                    // papel, motor, ciudad, reloj, pan
}

// Formas de un adjetivo: masculino y femenino singular (null si varía de forma irregular).
function adjForms(t) {
  if (!/^[a-záéíóúñü]+$/.test(t) || /(or|ón|án|ín|és|n)$/.test(t)) return null;
  if (/o$/.test(t)) return { m: t, f: t.slice(0, -1) + 'a' };
  if (/a$/.test(t)) return null;
  if (/[áéíóú]$/.test(t)) return null;
  return { m: t, f: t };
}
function adjPlural(t) {
  if (/[aeo]$/.test(t)) return t + 's';
  if (/z$/.test(t)) return t.slice(0, -1) + 'ces';
  if (/[lr]$/.test(t) && !/[áéíóú]/.test(t)) return t + 'es';
  return null;
}

function gerundEs(t) {
  if (!/^[a-zñ]+(ar|er|ir)$/.test(t)) return null;
  const stem = t.slice(0, -2);
  if (t.endsWith('ar')) return stem + 'ando';
  return /[aeiou]$/.test(stem) ? stem + 'yendo' : stem + 'iendo';
}
function participleEs(t) {
  if (!/^[a-zñ]+(ar|er|ir)$/.test(t) || IRREGULAR_PARTICIPLE.test(t)) return null;
  const stem = t.slice(0, -2);
  if (t.endsWith('ar')) return stem + 'ado';
  return /[aeiou]$/.test(stem) ? null : stem + 'ido';
}

// Presente e imperfecto, tercera persona del singular (canta, corre; cantaba,
// corría). Se dejan afuera los verbos muy irregulares y los terminados en
// -iar/-uar, que a veces llevan tilde (envía, continúa).
const IRREGULAR_VERB = new Set(['ser', 'estar', 'ir', 'haber', 'tener', 'hacer', 'decir', 'poder', 'poner', 'querer', 'saber', 'venir',
  'ver', 'dar', 'oír', 'caber', 'andar', 'traer', 'valer', 'salir', 'satisfacer', 'errar']);
// El diccionario no distingue tildes, así que «pensa» pasaría por «pensá»
// (voseo): para descartar los verbos que cambian la raíz (piensa, cuenta,
// vuelve, pide) se exige además la tercera persona del plural regular
// («cantan», «corren»), que no choca con ninguna otra forma.
function present3Es(t) {
  if (!/^[a-zñ]{2,}(ar|er|ir)$/.test(t) || IRREGULAR_VERB.has(t) || /[iu]ar$/.test(t) || /uir$/.test(t)) return null;
  const stem = t.slice(0, -2);
  if (/[aeo]h?[iu][^aeiou]*$/.test(stem)) return null;   // reúne, prohíbe, aísla: tilde
  const ar = t.endsWith('ar');
  if (!mitWords.has('es', stem + (ar ? 'an' : 'en'))) return null;
  return stem + (ar ? 'a' : 'e');
}
function imperfect3Es(t) {
  if (!/^[a-zñ]{2,}(ar|er|ir)$/.test(t) || ['ser', 'ir', 'ver'].includes(t)) return null;
  const stem = t.slice(0, -2);
  return stem + (t.endsWith('ar') ? 'aba' : 'ía');
}

const isAdj = (p) => p === 'a' || p === 's';
const FORMS = {
  // plural: sustantivos y adjetivos (casas, perros, blancos, verdes)
  plural: { pos: new Set(['n', 'a', 's']), derive(base, i, t, p) {
    if (p === 'n') return PLURAL_NO_LEX.has(base.synsets[base.senses(i)[0]].x) ? null : pluralEs(t);
    if (isAdj(p)) { const f = adjForms(t); return f ? adjPlural(f.m) : null; }
    return null;
  } },
  // femenino de adjetivos (blanca); los invariables (verde) quedan igual y concuerdan con todos
  feminine: { pos: new Set(['a', 's']), derive(base, i, t, p) { const f = isAdj(p) && adjForms(t); return f ? f.f : null; } },
  feminine_plural: { pos: new Set(['a', 's']), derive(base, i, t, p) { const f = isAdj(p) && adjForms(t); return f ? adjPlural(f.f) : null; } },
  gerund: { pos: new Set(['v']), derive(base, i, t, p) { return p === 'v' ? gerundEs(t) : null; } },
  participle: { pos: new Set(['v']), derive(base, i, t, p) { return p === 'v' ? participleEs(t) : null; } },
  present3: { pos: new Set(['v']), derive(base, i, t, p) { return p === 'v' ? present3Es(t) : null; } },
  imperfect3: { pos: new Set(['v']), derive(base, i, t, p) { return p === 'v' ? imperfect3Es(t) : null; } },
};

function deriveForm(base, form) {
  const rule = FORMS[form];
  const words = base.words.map((w) => w.slice());
  const flags = new Uint8Array(words.length);
  const baseText = new Array(words.length);
  base.words.forEach((w, i) => {
    const t = w[0];
    if (t.includes(' ') || /^[A-ZÁÉÍÓÚÑ]/.test(t) || !w[2].length) return;
    // la categoría que decide la forma: la del primer sentido, o si no la del
    // primer sentido que el léxico derivado flexiona («blanco» es primero sustantivo)
    let p = base.pos(i);
    if (!rule.pos.has(p)) { const s0 = w[2].find((sid) => rule.pos.has(base.synsets[sid].p)); p = s0 === undefined ? p : base.synsets[s0].p; }
    const d = rule.derive(base, i, t, p);
    if (!d || !mitWords.has('es', d)) return;
    const dup = d === t ? undefined : base.byText.get(d);
    if (dup !== undefined) {
      // el wordnet trae algunas formas flexionadas como lema propio: se apartan
      // para que la forma derivada sea la única; si es un lema real, se respeta
      if (!base.inflected(dup)) return;
      words[dup] = [d + ' (forma)', -9, words[dup][2]];
    }
    words[i] = [d, Math.round((w[1] - (d === t ? 0 : 0.2)) * 100) / 100, w[2]];
    flags[i] = 1; baseText[i] = t;
  });
  const thes = {};
  if (base.thes) for (const [t, set] of base.thes) { const i = base.byText.get(t); thes[i !== undefined ? words[i][0] : t] = [...set]; }
  const L = new Lexicon('es', { sources: base.sources, words, synsets: base.synsets, pron: base.pron, thes });
  L.form = form; L.formPos = rule.pos; L.flags = flags; L.baseText = baseText; L.singular = baseText;
  return L;
}

function derived(lang, form) {
  if (lang !== 'es' || !FORMS[form]) return null;
  const key = lang + ':' + form;
  if (!cache[key]) { const base = load(lang); cache[key] = base ? deriveForm(base, form) : null; }
  return cache[key];
}
const plural = (lang) => derived(lang, 'plural');
const FORM_NAMES = Object.keys(FORMS);

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

module.exports = { load, derived, plural, FORM_NAMES, pluralEs, gerundEs, participleEs, present3Es, imperfect3Es, adjForms, adjPlural, available, stemClash, sameFamily };
