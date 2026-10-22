'use strict';

// Plantillas de superficie por idioma. Cada plantilla usa solo indicadores que
// el validador reconoce y palabras de enlace aceptadas, para que ninguna
// palabra de la pista quede sin función. Los indicadores son invariables (no
// concuerdan en género ni número con lo que modifican) para evitar errores
// gramaticales en español.

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const es = {
  ind: {
    anagramPre: ['mezcla de', 'desorden de', 'lío de'],
    anagramPost: ['en desorden', 'con desorden'],
    anagramPostOne: ['baila'],
    hiddenPre: ['en', 'dentro de', 'algo de', 'parte de'],
    hiddenVerb: ['esconde', 'oculta', 'guarda', 'alberga'],
    reversal: ['al revés', 'de vuelta', 'hacia atrás', 'en retroceso'],
    deleteFirst: ['sin principio', 'sin cabeza', 'sin comienzo', 'sin inicio'],
    deleteLast: ['sin fin', 'sin final', 'sin cola', 'sin terminar'],
    charade: ['con', 'y', 'más', 'junto a'],
    containerOuter: ['guarda', 'contiene', 'encierra', 'abraza', 'rodea', 'atrapa', 'acoge'],
    containerInner: ['dentro de', 'metido en', 'entre'],
    homophone: ['se oye', 'según se oye', 'de oído', 'en voz alta', 'según dicen'],
  },
  and: 'y',
  t: {
    hidden: [
      ({ D, ind, phrase }) => `${cap(D)} ${ind.pre} ${phrase}`,
      ({ d, ind, phrase }) => `${cap(phrase)} ${ind.verb} ${d}`,
    ],
    anagram: [
      ({ d, ind, fodder }) => `${cap(ind.pre)} ${fodder}: ${d}`,
      ({ D, ind, fodder }) => `${cap(D)}: ${fodder} ${ind.post}`,
    ],
    reversal: [
      ({ D, ind, piece }) => `${cap(D)}: ${piece} ${ind}`,
      ({ d, ind, piece }) => `${cap(piece)} ${ind}: ${d}`,
    ],
    deletion: [
      ({ D, ind, piece }) => `${cap(D)}: ${piece} ${ind}`,
      ({ d, ind, piece }) => `${cap(piece)} ${ind}, ${d}`,
    ],
    charade: [
      ({ d, ind, a, b }) => `${cap(a)} ${ind} ${b}: ${d}`,
      ({ D, ind, a, b }) => `${cap(D)}: ${a} ${ind} ${b}`,
    ],
    charade3: [
      ({ d, a, b, c }) => `${cap(a)}, ${b} y ${c}: ${d}`,
      ({ D, a, b, c }) => `${cap(D)}: ${a}, ${b} y ${c}`,
    ],
    containerOuter: [
      ({ d, ind, outer, inner }) => `${cap(outer)} ${ind} ${inner}: ${d}`,
      ({ D, ind, outer, inner }) => `${cap(D)}: ${outer} ${ind} ${inner}`,
    ],
    containerInner: [
      ({ d, ind, outer, inner }) => `${cap(inner)} ${ind} ${outer}: ${d}`,
      ({ D, ind, outer, inner }) => `${cap(D)}: ${inner} ${ind} ${outer}`,
    ],
    double: [
      ({ d1, d2 }) => `${cap(d1)}, ${d2}`,
    ],
    homophone: [
      ({ D, ind, piece }) => `${cap(D)}: ${piece} ${ind}`,
      ({ d, ind, piece }) => `${cap(piece)}, ${ind}: ${d}`,
    ],
    reverseCharade: [
      ({ d, ind, a, b, rind }) => `${cap(a)} ${rind} ${ind} ${b}: ${d}`,
    ],
  },
};

const en = {
  ind: {
    anagramPre: ['shuffle of', 'arrangement of'],
    anagramPost: ['scrambled', 'reformed', 'broken', 'mixed', 'shuffled', 'transformed', 'wildly', 'rebuilt', 'altered', 'twisted'],
    anagramPostOne: ['badly', 'oddly', 'wildly'],
    hiddenPre: ['in', 'within', 'some', 'part of', 'found in', 'inside'],
    hiddenVerb: ['hides', 'contains'],
    reversal: ['sent back', 'turned back', 'returned', 'reversed', 'going back', 'brought back'],
    deleteFirst: ['beheaded', 'topped', 'headless', 'leaderless'],
    deleteLast: ['endless', 'unfinished', 'cut short', 'tailless', 'curtailed'],
    charade: ['and', 'with', 'plus', 'next to'],
    containerOuter: ['holds', 'contains', 'keeps', 'grips', 'swallows', 'embraces', 'boxes'],
    containerInner: ['in', 'inside', 'into', 'within', 'entering'],
    homophone: ['we hear', 'reportedly', 'aloud', 'on the radio', 'by the sound of it', 'it is said'],
  },
  and: 'and',
  t: {
    hidden: [
      ({ D, ind, phrase }) => `${cap(D)} ${ind.pre} ${phrase}`,
      ({ d, ind, phrase }) => `${cap(phrase)} ${ind.verb} ${d}`,
    ],
    anagram: [
      ({ d, ind, fodder }) => `${cap(fodder)} ${ind.post} for ${d}`,
      ({ D, ind, fodder }) => `${cap(D)}: ${fodder} ${ind.post}`,
    ],
    reversal: [
      ({ D, ind, piece }) => `${cap(D)}: ${piece} ${ind}`,
      ({ d, ind, piece }) => `${cap(piece)} ${ind} for ${d}`,
    ],
    deletion: [
      ({ D, ind, piece }) => `${cap(D)}: ${piece} ${ind}`,
      ({ d, ind, piece }) => `${cap(piece)} ${ind} gives ${d}`,
    ],
    charade: [
      ({ d, ind, a, b }) => `${cap(a)} ${ind} ${b} for ${d}`,
      ({ D, ind, a, b }) => `${cap(D)}: ${a} ${ind} ${b}`,
    ],
    charade3: [
      ({ d, a, b, c }) => `${cap(a)}, ${b} and ${c} for ${d}`,
      ({ D, a, b, c }) => `${cap(D)}: ${a}, ${b} and ${c}`,
    ],
    containerOuter: [
      ({ d, ind, outer, inner }) => `${cap(outer)} ${ind} ${inner} for ${d}`,
      ({ D, ind, outer, inner }) => `${cap(D)}: ${outer} ${ind} ${inner}`,
    ],
    containerInner: [
      ({ d, ind, outer, inner }) => `${cap(inner)} ${ind} ${outer} for ${d}`,
      ({ D, ind, outer, inner }) => `${cap(D)}: ${inner} ${ind} ${outer}`,
    ],
    double: [
      ({ d1, d2 }) => `${cap(d1)}, ${d2}`,
    ],
    homophone: [
      ({ D, ind, piece }) => `${cap(D)}: ${piece}, ${ind}`,
      ({ d, ind, piece }) => `${cap(piece)}, ${ind}, for ${d}`,
    ],
    reverseCharade: [
      ({ d, ind, a, b, rind }) => `${cap(a)} ${rind} ${ind} ${b} for ${d}`,
    ],
  },
};

module.exports = { es, en, cap };
