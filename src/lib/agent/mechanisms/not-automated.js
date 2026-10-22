'use strict';

// Categorías evaluadas que no se producen automáticamente, y por qué.
// Quedan en la taxonomía para que el panel y el informe lo expliquen; el agente no las pide.
module.exports = [
  { code: 'direct_definition', label: 'Definición directa', status: 'not_a_mechanism',
    why: 'Una definición sola no es un críptico: es una pista de crucigrama común. En el producto, cada críptico lleva definición más juego de palabras; la definición se valida en todos los mecanismos (control B).' },
  { code: 'abbreviation', label: 'Abreviaturas', status: 'component',
    why: 'Una abreviatura es una pieza dentro de una charada, una inserción o una combinación, no un mecanismo propio. Solo se aceptan las de la tabla del idioma, se valida su región y queda registrada en cada críptico que la usa.' },
  { code: 'cryptic_definition', label: 'Definición críptica / juego de palabras', status: 'review_only',
    why: 'Depende de un doble sentido que ningún validador determinista puede comprobar. Nunca se aprueba automáticamente; solo entra por propuestas con revisión humana.' },
  { code: 'regional_wordplay', label: 'Juegos de palabras regionales', status: 'review_only',
    why: 'Exigen confirmar el sentido local de una expresión y el proyecto no tiene todavía una fuente de regionalismos con licencia. Cualquier regionalismo declarado va a revisión humana.' },
];
