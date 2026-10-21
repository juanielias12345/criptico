'use strict';

// Vocabulario curado para el generador. Cada palabra tiene definiciones
// revisadas a mano: el generador solo combina piezas cuyo sentido ya fue
// comprobado, y el validador verifica la mecánica de cada resultado.

const es = {
  words: {
    AMOR: ['cariño', 'pasión'], RAMO: ['conjunto de flores'], MORA: ['fruta del bosque'],
    SACO: ['bolsa grande'], OCAS: ['gansos'], ODIO: ['rencor'], OIDO: ['sentido auditivo'],
    SOLAR: ['relativo al sol'], RALOS: ['poco espesos'], RATO: ['momento breve'], TRAPO: ['paño viejo'],
    PARTO: ['alumbramiento'], TOPAR: ['encontrarse con'], PELOTA: ['balón'], MONJA: ['religiosa'],
    JAMON: ['fiambre de cerdo'], MEDICO: ['doctor'], DECIMO: ['ordinal tras el noveno'], RISA: ['carcajada'],
    SARI: ['vestido indio'], LOMA: ['colina'], MALO: ['perverso'], SOPA: ['plato caldoso'], PASO: ['zancada'],
    POSA: ['se queda quieta para la foto'], LAGO: ['masa de agua dulce'], ALGO: ['un poco'], ROSA: ['flor con espinas'],
    OSAR: ['atreverse'], RASO: ['tela lisa y brillante'], META: ['objetivo'], TEMA: ['asunto'], SOL: ['astro rey'],
    MAR: ['agua salada'], PAN: ['alimento horneado'], SAL: ['condimento blanco'], RED: ['malla'], OSO: ['plantígrado'],
    ALA: ['extremidad de un ave'], OLA: ['onda marina'], ARTE: ['expresión creativa'], RATA: ['roedor'],
    DADO: ['cubo de juego'], CASA: ['hogar'], SACA: ['extrae'], CAPA: ['prenda de abrigo'], MANO: ['extremidad con dedos'],
    MONA: ['simia'], TORO: ['astado'], ROTO: ['quebrado'], ORO: ['metal precioso'], NIDO: ['casa del pájaro'],
    AROMA: ['perfume'], RIO: ['corriente de agua'], CARTA: ['mensaje escrito'], SOLO: ['sin compañía'], SOLDADO: ['militar'],
    PIRATA: ['corsario'], HOLA: ['saludo'], CAPAZ: ['competente'], PERLA: ['joya marina'], PERA: ['fruta de agua'],
    BAR: ['taberna'], BARCO: ['embarcación'], AMA: ['quiere'], PESO: ['carga'], PRESO: ['recluso'], MATO: ['asesino'],
    MANTO: ['capa larga'], VER: ['mirar'], SOLA: ['sin nadie'], ASA: ['agarradera'], LANA: ['fibra de oveja'],
    NADA: ['ausencia total'], ANDA: ['camina'], ROMANA: ['de Roma'], TELA: ['tejido'], LATE: ['palpita'],
    SALTO: ['brinco'], ARCO: ['arma de flechas'], ORCA: ['cetáceo blanco y negro'], CORO: ['grupo de cantantes'],
    ROCA: ['piedra grande'], CARO: ['costoso'], RAMA: ['parte del árbol'], AMAR: ['querer'],
    LIMA: ['herramienta para alisar'], SAPO: ['anfibio'], POSAR: ['quedarse quieto para la foto'],
    PASAR: ['cruzar'], CENA: ['comida de la noche'], CANTO: ['acción de cantar'],
    TACON: ['parte alta del zapato'], TOCAN: ['palpan'], RENO: ['ciervo del norte'], SECO: ['sin agua'],
    MOTA: ['partícula'], TOMA: ['agarra'], MATAR: ['quitar la vida'], TRAMA: ['argumento de una obra'],
  },
  abbr: { O: 'oxígeno', N: 'norte', S: 'sur', E: 'este', R: 'rey', I: 'uno', V: 'cinco', X: 'diez', C: 'carbono',
    CO: 'cobalto', FE: 'hierro', AU: 'oro', NA: 'sodio', CA: 'calcio', K: 'potasio', T: 'torre', D: 'dama', P: 'peón', H: 'hidrógeno' },
  indicators: {
    // indicadores invariables, antepuestos, para no romper la concordancia de género
    anagram: ['mezcla de', 'desorden de', 'lío de'],
    reversal: ['de vuelta', 'al revés', 'hacia atrás'],
    hidden: ['esconde', 'oculta', 'contiene', 'guarda'],
    deletion_first: ['sin principio', 'sin cabeza'],
    deletion_last: ['sin fin', 'sin final'],
    charade: ['y', 'con'],
  },
  link: 'para', colon: ':', anagramBefore: true,
  // forma con tildes para mostrar
  accents: { JAMON: 'JAMÓN', OIDO: 'OÍDO', DECIMO: 'DÉCIMO', MEDICO: 'MÉDICO', TACON: 'TACÓN', PLANTIGRADO: 'PLANTÍGRADO' },
};

const en = {
  words: {
    LISTEN: ['pay attention'], SILENT: ['quiet'], TINSEL: ['festive decoration'], ENLIST: ['join up'],
    EVIL: ['wicked'], LIVE: ['exist'], VILE: ['disgusting'], VEIL: ['face covering'], STAR: ['celebrity'],
    RATS: ['rodents'], ARTS: ['crafts'], DRAWER: ['sliding compartment'], REWARD: ['prize'], PART: ['portion'],
    TRAP: ['snare'], RAPT: ['absorbed'], STOP: ['halt'], POTS: ['pans'], SPOT: ['notice'], TOPS: ['summits'],
    POST: ['mail'], NIGHT: ['darkness'], THING: ['object'], HEART: ['core organ'], EARTH: ['world'],
    LEMON: ['citrus fruit'], MELON: ['large fruit'], DIRECTOR: ['film boss'], CREDITOR: ['lender'],
    TEACHER: ['educator'], CHEATER: ['swindler'], GARDEN: ['plot for plants'], DANGER: ['risk'], RANGED: ['roamed'],
    NURSE: ['carer'], RUNES: ['ancient letters'], PLUG: ['stopper'], GULP: ['swallow'], STRAW: ['drinking tube'],
    WARTS: ['skin growths'], DEVIL: ['demon'], LIVED: ['existed'], REPAID: ['paid back'], TIME: ['hour'],
    EMIT: ['give off'], ITEM: ['article'], MITE: ['tiny creature'], SALT: ['seasoning'], LAST: ['final'],
    CAR: ['vehicle'], PET: ['animal companion'], CARPET: ['floor covering'], TON: ['heavy weight'], CARTON: ['box'],
    SIN: ['wrong'], RAIN: ['shower'], BRAIN: ['mind'], PAN: ['criticise'], TRY: ['attempt'], PANTRY: ['larder'],
    SIDE: ['team'], WALK: ['stroll'], LET: ['allowed'], STARLET: ['young actress'], SEA: ['ocean'], SON: ['male child'],
    SEASON: ['time of year'], PAR: ['standard'], DON: ['put on'], PARDON: ['forgive'], BAR: ['pub'], GAIN: ['profit'],
    BARGAIN: ['good deal'], CAN: ['tin'], DID: ['performed'], CANDID: ['frank'], FOR: ['in favour of'], GET: ['obtain'],
    FORGET: ['fail to remember'], HAT: ['cap'], RED: ['crimson'], HATRED: ['loathing'], MAN: ['fellow'], AGE: ['era'],
    MANAGE: ['cope'], WHEAT: ['grain'], HEAT: ['warmth'], PLANT: ['factory'], PLAN: ['scheme'], GRACE: ['elegance'],
    RACE: ['contest'], LOOP: ['circuit'], POOL: ['swimming place'], SPAT: ['quarrel'], TAPS: ['faucets'], PAST: ['history'],
    KEEN: ['eager'], KNEE: ['leg joint'], LIMES: ['green fruits'], SMILE: ['grin'], SLIME: ['goo'], MILES: ['long distances'],
    ANGER: ['rage'], RANGE: ['scope'], ROT: ['decay'], TOR: ['rocky hill'], PIN: ['fastener'], NIP: ['pinch'],
  },
  abbr: { N: 'north', S: 'south', E: 'east', W: 'west', R: 'river', B: 'born', I: 'one', T: 'time', L: 'large',
    O: 'nothing', C: 'carbon', K: 'king', Q: 'queen', M: 'male', F: 'female', H: 'hydrogen', D: 'daughter' },
  indicators: {
    anagram: ['wildly', 'reformed', 'scrambled', 'shuffled', 'mixed', 'broken', 'transformed'],
    reversal: ['sent back', 'turned back', 'returned', 'reversed'],
    hidden: ['hides', 'partly', 'seen in', 'contains'],
    deletion_first: ['beheaded', 'topped', 'without its leader'],
    deletion_last: ['cut short', 'endless', 'unfinished'],
    charade: ['and', 'with'],
  },
  link: 'for', colon: ':', anagramBefore: false, accents: {},
};

module.exports = { es, en };
