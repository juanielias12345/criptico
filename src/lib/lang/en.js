'use strict';

// English linguistic data for validating and generating cryptic clues.

const abbreviations = {
  'NORTH': ['N'], 'SOUTH': ['S'], 'EAST': ['E'], 'WEST': ['W'],
  'KING': ['K', 'R'], 'QUEEN': ['Q', 'ER', 'R'], 'BISHOP': ['B'], 'KNIGHT': ['N', 'K'],
  'ONE': ['I', 'A'], 'FIVE': ['V'], 'TEN': ['X'], 'FIFTY': ['L'], 'HUNDRED': ['C'], 'THOUSAND': ['M', 'K'],
  'OXYGEN': ['O'], 'HYDROGEN': ['H'], 'CARBON': ['C'], 'NITROGEN': ['N'], 'IRON': ['FE'], 'GOLD': ['AU', 'OR'],
  'SILVER': ['AG'], 'COPPER': ['CU'], 'TIN': ['SN'], 'LEAD': ['PB'], 'SODIUM': ['NA'], 'HELIUM': ['HE'],
  'RIVER': ['R'], 'BORN': ['B', 'NE'], 'SON': ['S'], 'DAUGHTER': ['D'], 'MALE': ['M'], 'FEMALE': ['F'],
  'LARGE': ['L'], 'SMALL': ['S'], 'NOTHING': ['O'], 'LOVE': ['O'], 'ZERO': ['O'], 'DUCK': ['O'],
  'THANKS': ['TA'], 'POINT': ['N', 'S', 'E', 'W'], 'QUIET': ['P', 'SH'], 'LOUD': ['F'], 'SOFT': ['P'],
  'ARTIST': ['RA'], 'DOCTOR': ['DR', 'MO', 'MD'], 'SAILOR': ['AB', 'TAR'], 'STREET': ['ST'], 'SAINT': ['ST', 'S'],
  'TIME': ['T'], 'HOUR': ['H'], 'MINUTE': ['M', 'MIN'], 'SECOND': ['S'], 'CENT': ['C'], 'POUND': ['L', 'LB'],
};

// Abbreviations only conventional in some varieties.
const variantAbbreviations = {
  'THANKS': ['en-GB'],
};

const letterNames = {
  'AY': 'A', 'BEE': 'B', 'CEE': 'C', 'DEE': 'D', 'EE': 'E', 'EF': 'F', 'GEE': 'G', 'AITCH': 'H', 'EYE': 'I',
  'JAY': 'J', 'KAY': 'K', 'EL': 'L', 'EM': 'M', 'EN': 'N', 'OH': 'O', 'PEE': 'P', 'CUE': 'Q', 'AR': 'R',
  'ESS': 'S', 'TEE': 'T', 'YOU': 'U', 'VEE': 'V', 'EX': 'X', 'WHY': 'Y', 'ZED': 'Z', 'ZEE': 'Z',
};

const indicators = {
  anagram: ['shuffle', 'shuffled', 'arrangement', 'arranged', 'reformed', 'wrecked', 'scrambled', 'transformed',
    'wildly', 'oddly', 'mixed', 'broken', 'confused', 'crazy', 'mad', 'new', 'novel', 'strange', 'awful',
    'badly', 'messy', 'twisted', 'unusual', 'upset', 'ruined', 'rebuilt', 'altered', 'changed', 'mangled'],
  hidden: ['partly', 'some', 'some of', 'seen in', 'in', 'within', 'hides', 'hiding', 'hidden in', 'held by',
    'contains', 'concealed', 'part of', 'inside', 'found in', 'among'],
  reversal: ['turned over', 'turned back', 'sent back', 'returned', 'back', 'backwards', 'reversed', 'going back',
    'brought back', 'retiring', 'in retreat', 'recalled', 'on the way back', 'reflected'],
  container: ['holds', 'holding', 'contains', 'containing', 'keeps', 'grips', 'swallows', 'embraces', 'around',
    'about', 'outside', 'circling', 'with', 'running through', 'boxes', 'nursing'],
  insertion: ['in', 'inside', 'into', 'within', 'entering', 'held by', 'kept by', 'running through'],
  deletion_first: ['beheaded', 'topped', 'headless', 'without its leader', 'leaderless', 'losing its head', 'not starting'],
  deletion_last: ['cut short', 'endless', 'curtailed', 'unfinished', 'almost', 'nearly', 'mostly', 'tailless'],
  deletion_letter: ['loses', 'losing', 'without', 'dropping', 'drops', 'lacking', 'leaving', 'missing'],
  homophone: ['we hear', 'it sounds', 'sounds', 'sounds like', 'by the sound of it', 'on the radio', 'reportedly',
    'it is said', "it's said", 'so to speak', 'aloud', 'heard', 'as americans say', 'in speech', 'said'],
  initials: ['initially', 'at first', 'first of all', 'leaders', 'heads', 'to begin with', 'starts', 'firstly'],
  charade: ['and', 'with', 'before', 'after', 'by', 'then', 'on', 'plus', 'next to', 'following'],
};

const linkWords = ['to', 'for', 'as', 'is', 'in', 'of', 'from', 'and', 'that', "that's", 'it', "it's", 'gives',
  'makes', 'make', 'a', 'an', 'the', 'be', 'being', 'with', 'or', 'so', 'by', 'this', 'are', 'was', 'into', 's'];

// Curated homophone sets. Each entry lists the varieties where it holds.
// en = all varieties; en-GB = non-rhotic British; en-US = American flapping.
const homophones = [
  { words: ['KNIGHT', 'NIGHT'], variants: ['en'] },
  { words: ['FLOUR', 'FLOWER'], variants: ['en'] },
  { words: ['MAIL', 'MALE'], variants: ['en'] },
  { words: ['PAIR', 'PEAR', 'PARE'], variants: ['en'] },
  { words: ['SEW', 'SO', 'SOW'], variants: ['en'] },
  { words: ['WEIGHT', 'WAIT'], variants: ['en'] },
  { words: ['WHOLE', 'HOLE'], variants: ['en'] },
  { words: ['BARE', 'BEAR'], variants: ['en'] },
  { words: ['SEA', 'SEE'], variants: ['en'] },
  { words: ['SUN', 'SON'], variants: ['en'] },
  { words: ['TAIL', 'TALE'], variants: ['en'] },
  { words: ['RIGHT', 'WRITE', 'RITE'], variants: ['en'] },
  { words: ['PIECE', 'PEACE'], variants: ['en'] },
  { words: ['BREAK', 'BRAKE'], variants: ['en'] },
  { words: ['STEAL', 'STEEL'], variants: ['en'] },
  { words: ['PLAIN', 'PLANE'], variants: ['en'] },
  { words: ['FATHER', 'FARTHER'], variants: ['en-GB'] },
  { words: ['CAUGHT', 'COURT'], variants: ['en-GB'] },
  { words: ['SAUCE', 'SOURCE'], variants: ['en-GB'] },
  { words: ['LADDER', 'LATTER'], variants: ['en-US'] },
  { words: ['WRITER', 'RIDER'], variants: ['en-US'] },
  { words: ['METAL', 'MEDAL', 'METTLE'], variants: ['en-US'] },
];

function homophoneVariants(a, b) {
  for (const h of homophones) {
    if (h.words.includes(a) && h.words.includes(b)) return h.variants;
  }
  return cmuVariants(a, b);
}

// Respaldo con el CMU Pronouncing Dictionary (pronunciación estadounidense):
// misma transcripción fonémica = homófonos. Si interviene una R, la igualdad
// puede no valer en el inglés británico no rótico, así que se limita a en-US.
function cmuVariants(a, b) {
  let L = null;
  try { L = require('../bank/lexicon').load('en'); } catch { return null; }
  if (!L) return null;
  const pa = L.pron[String(a).toLowerCase()] || []; const pb = L.pron[String(b).toLowerCase()] || [];
  const same = pa.find((p) => pb.includes(p));
  if (!same) return null;
  return /\bR\b|ER/.test(same) ? ['en-US'] : ['en'];
}

module.exports = { code: 'en', abbreviations, variantAbbreviations, letterNames, indicators, linkWords, homophones, homophoneVariants };
