'use strict';

// Datos lingüísticos del español para validar y generar crípticos.
// Las listas son deliberadamente conservadoras: un indicador o una abreviatura
// desconocidos no invalidan la pista, pero quedan como advertencia para revisión.

const abbreviations = {
  // puntos cardinales
  'NORTE': ['N'], 'SUR': ['S'], 'ESTE': ['E'], 'OESTE': ['O'], 'ORIENTE': ['E'], 'OCCIDENTE': ['O'],
  // ajedrez
  'REY': ['R'], 'DAMA': ['D'], 'REINA': ['D'], 'TORRE': ['T'], 'ALFIL': ['A'], 'CABALLO': ['C'], 'PEON': ['P'],
  // números romanos
  'UNO': ['I'], 'CINCO': ['V'], 'DIEZ': ['X'], 'CINCUENTA': ['L'], 'CIEN': ['C'], 'QUINIENTOS': ['D'], 'MIL': ['M'],
  'UNOROMANO': ['I'], 'CINCOROMANO': ['V'], 'DIEZROMANO': ['X'],
  // química
  'OXIGENO': ['O'], 'HIDROGENO': ['H'], 'CARBONO': ['C'], 'NITROGENO': ['N'], 'AZUFRE': ['S'], 'FOSFORO': ['P'],
  'COBALTO': ['CO'], 'COBRE': ['CU'], 'HIERRO': ['FE'], 'ORO': ['AU'], 'PLATA': ['AG'], 'CALCIO': ['CA'],
  'SODIO': ['NA'], 'POTASIO': ['K'], 'ESTAÑO': ['SN'], 'PLOMO': ['PB'], 'HELIO': ['HE'], 'NEON': ['NE'],
  'RADIO': ['RA'], 'TITANIO': ['TI'], 'LITIO': ['LI'], 'BORO': ['B'], 'ARGON': ['AR'], 'URANIO': ['U'],
  // notas musicales (fragmentos completos)
  'NOTA': ['DO', 'RE', 'MI', 'FA', 'SOL', 'LA', 'SI'], 'NOTAMUSICAL': ['DO', 'RE', 'MI', 'FA', 'SOL', 'LA', 'SI'],
  // otras convencionales
  'SANTO': ['S', 'SAN', 'STO'], 'SAN': ['S'], 'SEÑOR': ['SR'], 'SEÑORA': ['SRA'], 'USTED': ['UD', 'VD'],
  'METRO': ['M'], 'KILO': ['K', 'KG'], 'LITRO': ['L'], 'GRAMO': ['G'], 'SEGUNDO': ['S'], 'HORA': ['H'],
  'NUMEROPI': ['PI'], 'PI': ['PI'], 'NADA': ['O'], 'CERO': ['O'],
};

// Nombres de las letras: "pierde la ele" → L.
const letterNames = {
  'A': 'A', 'BE': 'B', 'CE': 'C', 'DE': 'D', 'E': 'E', 'EFE': 'F', 'GE': 'G', 'HACHE': 'H', 'I': 'I',
  'JOTA': 'J', 'KA': 'K', 'ELE': 'L', 'EME': 'M', 'ENE': 'N', 'EÑE': 'Ñ', 'O': 'O', 'PE': 'P', 'CU': 'Q',
  'ERRE': 'R', 'ESE': 'S', 'TE': 'T', 'U': 'U', 'UVE': 'V', 'VE': 'V', 'EQUIS': 'X', 'YE': 'Y', 'ZETA': 'Z', 'ZEDA': 'Z',
};

const indicators = {
  anagram: ['revuelto', 'revuelta', 'revueltos', 'loco', 'loca', 'alocado', 'alocada', 'mezclado', 'mezcla', 'desordenado', 'desorden',
    'agitado', 'roto', 'rota', 'raro', 'rara', 'alterado', 'alterada', 'cambiado', 'confundido', 'confuso',
    'caótico', 'extraño', 'reformado', 'nuevo', 'bailando', 'baila', 'mal', 'malo', 'arreglado', 'transformado',
    'alborotado', 'en desorden', 'con desorden', 'enredado', 'deshecho', 'disparatado', 'lío',
    'desordenada', 'desarmado', 'desarmada', 'gastado', 'gastada', 'distraído', 'distraída', 'torpe', 'averiado',
    'averiada', 'desafinado', 'desafinados', 'enloquecido', 'enloquecida', 'caído', 'caída', 'perdido', 'perdida',
    'derramado', 'derramada'],
  hidden: ['esconde', 'esconden', 'escondido', 'oculta', 'oculto', 'guarda', 'contiene', 'encierra', 'en', 'dentro de',
    'parte de', 'algo de', 'tiene', 'alberga', 'lleva dentro'],
  reversal: ['de vuelta', 'al revés', 'vuelto', 'vueltos', 'vuelve', 'que vuelve', 'que regresan', 'que regresa',
    'regresa', 'retrocede', 'hacia atrás', 'invertido', 'se da vuelta', 'se dan vuelta', 'devuelto', 'volviendo',
    'en retroceso', 'dados vuelta'],
  container: ['guarda', 'guardo', 'guardando', 'contiene', 'encierra', 'abraza', 'rodea', 'recibe', 'toma', 'alberga',
    'envuelve', 'con dentro', 'por dentro', 'que guarda', 'atrapa', 'acoge'],
  insertion: ['en', 'dentro de', 'entre', 'metido en', 'dentro', 'adentro'],
  deletion_first: ['sin principio', 'sin cabeza', 'descabezado', 'descabezada', 'sin comienzo', 'decapitado', 'sin inicio'],
  deletion_last: ['sin fin', 'sin final', 'infinito', 'sin cola', 'corto', 'inacabado', 'sin terminar', 'sin acabar'],
  deletion_letter: ['pierde', 'sin', 'quita', 'perdiendo', 'que pierde', 'le falta', 'sin la', 'pierde la'],
  homophone: ['se oye', 'según se oye', 'suena', 'suena a', 'dicen', 'de oído', 'en voz alta', 'oímos', 'según dicen',
    'que suena', 'se escucha'],
  initials: ['al principio', 'al inicio', 'al comienzo', 'inicialmente', 'iniciales', 'cabezas', 'primeras', 'comienzos de', 'principios de'],
  charade: ['con', 'y', 'más', 'tras', 'después de', 'antes de', 'junto a', 'sobre'],
};

// Palabras de enlace aceptadas entre definición y juego de palabras.
const linkWords = ['para', 'por', 'de', 'del', 'en', 'y', 'es', 'que', 'con', 'da', 'dan', 'hace', 'se', 'a', 'al',
  'el', 'la', 'los', 'las', 'un', 'una', 'lo', 'forma', 'forman', 'son', 'resulta', 'donde', 'como', 'ante', 'o', 'hacia',
  'regala'];

// Rasgos fonéticos por variante. Seseo: Z/C(e,i) suenan como S. Yeísmo: LL suena como Y.
function phoneticKey(word, features = []) {
  let w = word;
  w = w.replace(/CH/g, '§');            // proteger CH antes de quitar la H
  w = w.replace(/H/g, '');              // H muda
  w = w.replace(/§/g, 'CH');
  w = w.replace(/V/g, 'B');             // B y V no se distinguen
  w = w.replace(/QU(?=[EI])/g, 'K');
  w = w.replace(/C(?=[AOU]|[^EIH]|$)/g, 'K');
  w = w.replace(/GU(?=[EI])/g, 'G');
  w = w.replace(/G(?=[EI])/g, 'J');
  w = w.replace(/X(?=[AEIOU])/g, 'KS');
  if (features.includes('seseo')) {
    w = w.replace(/Z/g, 'S').replace(/C(?=[EI])/g, 'S');
  } else {
    w = w.replace(/C(?=[EI])/g, 'Z');
  }
  if (features.includes('yeismo')) w = w.replace(/LL/g, 'Y');
  return w;
}

module.exports = { code: 'es', abbreviations, letterNames, indicators, linkWords, phoneticKey };
