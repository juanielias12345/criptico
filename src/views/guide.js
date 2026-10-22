'use strict';

// Guía de mecanismos: una página por mecanismo, escrita para quien busca en
// Google cómo se resuelve un anagrama, una palabra oculta, etc. Cada ejemplo
// está verificado a mano: el juego de palabras da la respuesta y la definición
// está en un extremo de la pista.

const P = (...parts) => parts.map((p) => (Array.isArray(p) ? p : [p, '']));

const es = {
  title: 'Mecanismos de los crípticos',
  seoTitle: 'Mecanismos de los crípticos: anagramas, palabras ocultas y más | Play Crípticos',
  description: 'Guía de los nueve mecanismos del crucigrama críptico en español: cómo reconocer cada uno, qué palabras lo indican y ejemplos resueltos paso a paso.',
  lead: 'Todo críptico tiene una definición y un juego de palabras. El juego de palabras usa uno de estos mecanismos. Aprender a reconocerlos es la forma más rápida de mejorar.',
  indicators_t: 'Palabras que lo indican',
  indicators_note: 'Estas son las palabras que nuestro validador reconoce. No son las únicas: cualquier palabra con el mismo sentido puede cumplir la función.',
  example_t: 'Ejemplo resuelto',
  more_t: 'Practicá con estos crípticos',
  all_t: 'Ver todos en el archivo',
  others_t: 'Otros mecanismos',
  related_t: 'Más crípticos con este mecanismo',
  guide_link: 'Cómo se resuelve, con ejemplos →',
  abbr: {
    slug: 'abreviaturas',
    title: 'Abreviaturas en los crípticos',
    seoTitle: 'Abreviaturas en los crípticos: lista con símbolos y letras | Play Crípticos',
    description: 'Lista de abreviaturas que usan los crípticos en español: puntos cardinales, ajedrez, números romanos, símbolos químicos, notas musicales y nombres de las letras.',
    lead: 'Muchas pistas usan una palabra para aportar solo una o dos letras: «norte» vale N, «cien» vale C, «oro» vale AU. Estas son las equivalencias más comunes, las mismas que acepta nuestro validador.',
    tip: 'Cuando una pieza del juego de palabras parece demasiado larga para la respuesta, probá reemplazarla por su abreviatura. Suele pasar en las inserciones y en las charadas.',
    groups: [
      ['Puntos cardinales', [['norte', 'N'], ['sur', 'S'], ['este, oriente', 'E'], ['oeste, occidente', 'O']]],
      ['Ajedrez', [['rey', 'R'], ['dama, reina', 'D'], ['torre', 'T'], ['alfil', 'A'], ['caballo', 'C'], ['peón', 'P']]],
      ['Números romanos', [['uno', 'I'], ['cinco', 'V'], ['diez', 'X'], ['cincuenta', 'L'], ['cien', 'C'], ['quinientos', 'D'], ['mil', 'M']]],
      ['Símbolos químicos', [['oxígeno', 'O'], ['hidrógeno', 'H'], ['carbono', 'C'], ['nitrógeno', 'N'], ['azufre', 'S'], ['fósforo', 'P'], ['potasio', 'K'], ['boro', 'B'], ['uranio', 'U'],
        ['cobalto', 'CO'], ['cobre', 'CU'], ['hierro', 'FE'], ['oro', 'AU'], ['plata', 'AG'], ['calcio', 'CA'], ['sodio', 'NA'], ['estaño', 'SN'], ['plomo', 'PB'],
        ['helio', 'HE'], ['neón', 'NE'], ['radio', 'RA'], ['titanio', 'TI'], ['litio', 'LI'], ['argón', 'AR']]],
      ['Notas musicales', [['nota', 'DO, RE, MI, FA, SOL, LA o SI']]],
      ['Unidades y tratamientos', [['metro', 'M'], ['kilo', 'K o KG'], ['litro', 'L'], ['gramo', 'G'], ['segundo', 'S'], ['hora', 'H'], ['santo', 'S, SAN o STO'],
        ['señor', 'SR'], ['señora', 'SRA'], ['usted', 'UD o VD'], ['nada, cero', 'O'], ['número pi', 'PI']]],
      ['Nombres de las letras', [['be', 'B'], ['ce', 'C'], ['de', 'D'], ['efe', 'F'], ['ge', 'G'], ['hache', 'H'], ['jota', 'J'], ['ka', 'K'], ['ele', 'L'], ['eme', 'M'],
        ['ene', 'N'], ['eñe', 'Ñ'], ['pe', 'P'], ['cu', 'Q'], ['erre', 'R'], ['ese', 'S'], ['te', 'T'], ['uve, ve', 'V'], ['equis', 'X'], ['ye', 'Y'], ['zeta, zeda', 'Z']]],
    ],
    word_t: 'Palabra', abbr_t: 'Vale',
  },
  mechs: {
    anagram: {
      slug: 'anagrama', ind: ['anagram'],
      seoTitle: 'Anagramas en crípticos: cómo reconocerlos y resolverlos | Play Crípticos',
      description: 'Qué es un anagrama en un crucigrama críptico, qué palabras lo anuncian (revuelto, loco, roto…) y un ejemplo resuelto paso a paso.',
      intro: [
        'En un anagrama la respuesta usa exactamente las mismas letras que una palabra o frase de la pista, en otro orden. Es el mecanismo más común y el mejor para empezar.',
        'Siempre hay una palabra que avisa que las letras se desordenan: «revuelto», «loco», «roto», «mezclado», «raro». La palabra que se reordena suele estar justo al lado de ese indicador.',
        'Para resolverlo, contá las letras de las palabras que rodean al indicador y compará con el número entre paréntesis. Si coinciden, escribí esas letras y buscá una palabra que encaje con la definición del otro extremo.',
      ],
      example: { parts: P('Ramo ', ['revuelto', 'ind'], ' para ', ['el sentimiento', 'def'], [' (4)', 'enum']), answer: 'AMOR', hint: 'RAMO tiene cuatro letras, como la respuesta.',
        steps: ['«el sentimiento» es la definición.', '«revuelto» indica que las letras de RAMO se reordenan.', 'RAMO → AMOR.'] },
    },
    hidden: {
      slug: 'palabra-oculta', ind: ['hidden'],
      seoTitle: 'Palabra oculta en crípticos: cómo encontrarla | Play Crípticos',
      description: 'Cómo detectar una palabra oculta en un crucigrama críptico: los indicadores (esconde, guarda, parte de…) y un ejemplo resuelto.',
      intro: [
        'La respuesta está escrita, letra por letra y en orden, dentro de la pista. Casi siempre ocupa el final de una palabra y el principio de la siguiente.',
        'Los indicadores hablan de algo que está adentro: «esconde», «guarda», «contiene», «parte de», «algo de».',
        'Un truco: leé la pista en voz baja sin espacios. Cuando sepas la longitud, recorré las letras de a una hasta que aparezca una palabra que coincida con la definición.',
      ],
      example: { parts: P('Queso solo ', ['esconde', 'ind'], ' ', ['un animal del bosque', 'def'], [' (3)', 'enum']), answer: 'OSO', hint: 'Fijate en las letras de «queso solo», sin el espacio.',
        steps: ['«un animal del bosque» es la definición.', '«esconde» avisa que la respuesta está escrita dentro de la pista.', 'quesO SOlo → OSO.'] },
    },
    reversal: {
      slug: 'inversion', ind: ['reversal'],
      seoTitle: 'Inversiones en crípticos: palabras al revés | Play Crípticos',
      description: 'Cómo funciona la inversión en un crucigrama críptico: una palabra leída al revés. Indicadores habituales y un ejemplo resuelto.',
      intro: [
        'Una palabra, leída de atrás para adelante, da la respuesta. A veces la palabra está escrita en la pista; otras, hay que deducirla primero a partir de una definición.',
        'Los indicadores sugieren movimiento hacia atrás: «al revés», «de vuelta», «que vuelve», «retrocede», «hacia atrás».',
        'Cuando veas uno, probá dar vuelta la palabra más cercana. Si no sale nada, pensá en sinónimos cortos de esa palabra y dalos vuelta.',
      ],
      example: { parts: P('Amor ', ['que vuelve', 'ind'], ' a ', ['la capital italiana', 'def'], [' (4)', 'enum']), answer: 'ROMA', hint: 'Leé AMOR de derecha a izquierda.',
        steps: ['«la capital italiana» es la definición.', '«que vuelve» indica que AMOR se lee al revés.', 'AMOR → ROMA.'] },
    },
    container: {
      slug: 'insercion', ind: ['container', 'insertion'],
      seoTitle: 'Inserción en crípticos: una palabra dentro de otra | Play Crípticos',
      description: 'Cómo resolver una inserción (o contenedor) en un crucigrama críptico: una pieza dentro de otra, sus indicadores y un ejemplo paso a paso.',
      intro: [
        'Una pieza se mete dentro de otra. La pista dice cuál envuelve («guarda», «abraza», «rodea», «contiene») o cuál entra («en», «dentro de», «metido en»).',
        'Las piezas suelen ser cortas: abreviaturas, símbolos químicos, notas musicales o números romanos. Por eso conviene tener a mano esas equivalencias.',
        'Separá la pista en tres partes: lo que envuelve, lo que entra y la definición. Después probá abrir la palabra de afuera en distintos lugares hasta que aparezca la respuesta.',
      ],
      example: { parts: P('Cobalto ', ['guarda', 'ind'], ' un naipe: ', ['asunto', 'def'], [' (4)', 'enum']), answer: 'CASO', hint: 'El símbolo químico del cobalto es CO. ¿Qué naipe tiene dos letras?',
        steps: ['«asunto» es la definición.', 'Cobalto es CO y un naipe puede ser el AS.', '«guarda» indica que CO envuelve a AS: C(AS)O → CASO.'] },
    },
    deletion: {
      slug: 'eliminacion', ind: ['deletion_first', 'deletion_last', 'deletion_letter'],
      seoTitle: 'Eliminación en crípticos: quitar letras | Play Crípticos',
      description: 'Cómo funciona la eliminación en un crucigrama críptico: palabras sin cabeza, sin final o que pierden una letra. Indicadores y ejemplo.',
      intro: [
        'A una palabra se le saca una parte: la primera letra, la última o una letra que la pista nombra.',
        '«Sin cabeza», «descabezado» o «sin principio» quitan la primera letra. «Sin fin», «sin cola» o «corto» quitan la última. «Pierde» o «sin» seguidos de una letra quitan esa letra.',
        'Primero encontrá la palabra completa, que muchas veces aparece tal cual en la pista. Después aplicá el recorte y compará con la definición.',
      ],
      example: { parts: P('Brisa ', ['sin cabeza', 'ind'], ' en ', ['la carcajada', 'def'], [' (4)', 'enum']), answer: 'RISA', hint: 'Sacale la primera letra a BRISA.',
        steps: ['«la carcajada» es la definición.', '«sin cabeza» indica que se quita la primera letra.', 'BRISA − B → RISA.'] },
    },
    charade: {
      slug: 'charada', ind: ['charade'],
      seoTitle: 'Charadas en crípticos: la respuesta por piezas | Play Crípticos',
      description: 'Qué es una charada en un crucigrama críptico: la respuesta se arma uniendo piezas en orden. Cómo reconocerla y un ejemplo resuelto.',
      intro: [
        'La respuesta se arma pegando dos o más piezas en orden, como en un juego de construcción. Cada pieza tiene su propia pequeña definición.',
        'Las palabras de unión son simples: «con», «y», «más», «tras», «junto a». A veces no hay ninguna y las piezas van una al lado de la otra.',
        'Resolvé cada pieza por separado, con palabras cortas, y probá unirlas. Si la suma da una palabra que encaja con la definición, la encontraste.',
      ],
      example: { parts: P('Estrella ', ['con', 'ind'], ' cubo de juego para ', ['un militar', 'def'], [' (7)', 'enum']), answer: 'SOLDADO', hint: 'Una estrella de tres letras y un cubo con puntos.',
        steps: ['«un militar» es la definición.', 'La estrella es el SOL y el cubo de juego es un DADO.', 'SOL + DADO → SOLDADO.'] },
    },
    homophone: {
      slug: 'homofono', ind: ['homophone'],
      seoTitle: 'Homófonos en crípticos: palabras que suenan igual | Play Crípticos',
      description: 'Cómo resolver un homófono en un crucigrama críptico: palabras que suenan igual y se escriben distinto. Indicadores y ejemplo.',
      intro: [
        'La respuesta suena igual que otra palabra pero se escribe distinto: ola y hola, vaca y baca, tubo y tuvo.',
        'Los indicadores hablan del oído: «se oye», «suena», «según dicen», «de oído», «en voz alta».',
        'En español abundan con la hache muda, la b y la v, la ll y la y, y la s, la c y la z en América. Leé la pista en voz alta y pensá cómo se escribiría de otra manera.',
      ],
      example: { parts: P('Ola que ', ['se oye', 'ind'], ' como ', ['saludo', 'def'], [' (4)', 'enum']), answer: 'HOLA', hint: 'La hache no suena.',
        steps: ['«saludo» es la definición.', '«se oye» indica una palabra que suena igual.', 'OLA suena como HOLA.'] },
    },
    double_definition: {
      slug: 'doble-definicion', ind: [],
      seoTitle: 'Doble definición en crípticos | Play Crípticos',
      description: 'Qué es una doble definición en un crucigrama críptico: dos significados de una misma palabra, sin indicador. Cómo detectarla y ejemplo.',
      intro: [
        'La pista son dos definiciones, una al lado de la otra, que llevan a la misma palabra con dos significados distintos.',
        'No tiene indicador. Suele ser una pista corta, de dos a cuatro palabras, con un enlace mínimo como «o», «y» o una coma.',
        'Cuando una pista breve no parece tener juego de letras, probá pensar cada mitad por separado y buscá la palabra que sirva para las dos.',
      ],
      example: { parts: P(['Asiento', 'def'], ' o ', ['entidad financiera', 'def'], [' (5)', 'enum']), answer: 'BANCO', hint: 'Una palabra para sentarse en la plaza y para guardar el dinero.',
        steps: ['«Asiento» es una definición.', '«entidad financiera» es la otra.', 'Las dos llevan a BANCO.'] },
    },
    initials: {
      slug: 'iniciales', ind: ['initials'],
      seoTitle: 'Iniciales en crípticos: las primeras letras | Play Crípticos',
      description: 'Cómo resolver un críptico de iniciales: la respuesta sale de las primeras letras de varias palabras. Indicadores y ejemplo resuelto.',
      intro: [
        'Se toman las primeras letras de varias palabras seguidas y, juntas, forman la respuesta.',
        'El indicador lo dice sin rodeos: «al principio», «iniciales», «cabezas», «comienzos de».',
        'Cuando lo veas, anotá la primera letra de cada palabra cercana. Como la cantidad de palabras suele coincidir con la longitud de la respuesta, el número entre paréntesis te ayuda a saber dónde cortar.',
      ],
      example: { parts: P('Ocho sapos observan, ', ['al principio', 'ind'], ', ', ['al animal del bosque', 'def'], [' (3)', 'enum']), answer: 'OSO', hint: 'Tomá la primera letra de las tres primeras palabras.',
        steps: ['«al animal del bosque» es la definición.', '«al principio» indica que se usan las iniciales.', 'Ocho Sapos Observan → OSO.'] },
    },
  },
};

module.exports = { es };
