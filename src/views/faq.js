'use strict';

// Preguntas frecuentes: respuestas cortas y verificables sobre qué es Play Crípticos.
// Las usan la página /es/preguntas-frecuentes (con FAQPage en datos estructurados) y /llms.txt.
// Cada respuesta tiene que seguir siendo cierta: si cambia el producto, se cambia acá.
// {play}, {daily}, {help}, {guide}, {plus}, {contribute}, {arena} se reemplazan por la ruta.

module.exports = {
  es: {
    title: 'Preguntas frecuentes sobre los crípticos y Play Crípticos',
    seoTitle: 'Preguntas frecuentes: qué es un críptico y cómo se juega | Play Crípticos',
    description: 'Qué es un críptico, en qué se diferencia de un crucigrama, cómo se juega en Play Crípticos, si es gratis, si hace falta registrarse y desde qué países se puede jugar.',
    lead: 'Respuestas directas a lo que más nos preguntan sobre los crípticos y sobre el sitio.',
    items: [
      ['¿Qué es Play Crípticos?',
        'Play Crípticos es un sitio web para resolver crípticos en español: pistas de crucigrama críptico con una sola respuesta. Se juega en el navegador, gratis y sin límite, con ayudas progresivas, la explicación de cada solución y un críptico del día igual para todos.'],
      ['¿Qué es un críptico?',
        'Un críptico es una pista de crucigrama que esconde la respuesta dos veces. Una parte es una definición normal, al principio o al final de la pista. El resto es un juego de letras (un anagrama, una palabra oculta, una inversión, una suma de partes…) que lleva a la misma palabra. El número entre paréntesis indica cuántas letras tiene.'],
      ['¿En qué se diferencia de un crucigrama común?',
        'En un crucigrama común la pista es solo una definición. En un críptico la pista también contiene las instrucciones para armar la palabra, así que la respuesta se puede comprobar: cuando la definición y el juego de letras coinciden, sabés que es la correcta.'],
      ['¿Cómo se resuelve un críptico?',
        'Primero buscá la definición en un extremo de la pista. Después buscá una palabra indicadora («revuelto», «esconde», «al revés», «sin»…) que diga qué mecanismo se usa, y aplicalo a las letras del resto. La guía {help} enseña el método paso a paso y la guía de mecanismos {guide} explica cada tipo con ejemplos.'],
      ['¿Es gratis?',
        'Sí. Jugar es gratuito, sin límite de crípticos y sin necesidad de registrarse. Existe un plan opcional, Play Crípticos Plus {plus}, que quita los anuncios y suma crípticos exclusivos, sin dar ventajas en los desafíos.'],
      ['¿Hace falta crear una cuenta?',
        'No para jugar. Una cuenta gratuita sirve para guardar el progreso entre dispositivos, ver estadísticas y logros, participar en duelos y torneos y proponer crípticos propios.'],
      ['¿Qué es el críptico del día?',
        'Es un críptico nuevo cada día, el mismo para todos los jugadores. Se puede compartir el resultado sin revelar la respuesta y repasar los días anteriores en {daily}.'],
      ['¿Qué pasa si me trabo?',
        'Cada críptico tiene ayudas progresivas: primero el mecanismo y su palabra indicadora, después la definición, luego la primera letra y por último la mitad de las letras. También podés ver la solución con la explicación completa de cómo se arma.'],
      ['¿Desde qué países se puede jugar?',
        'Desde cualquier país. Los crípticos están en español neutro y algunos usan vocabulario o pronunciación de una región (España, México y otras variantes del español); esos llevan la variante indicada y se pueden filtrar.'],
      ['¿Quién escribe los crípticos?',
        'Los crípticos salen del equipo editorial, de un banco que se valida automáticamente letra por letra antes de publicarse y de propuestas de la comunidad, que se revisan a mano antes de aparecer. Podés mandar el tuyo en {contribute}.'],
      ['¿Hay niveles de dificultad?',
        'Sí, del 1 al 5. Los primeros niveles usan mecanismos simples y definiciones directas; los más altos combinan mecanismos y definiciones más engañosas.'],
      ['¿Se puede jugar con amigos?',
        'Sí. En {arena} hay duelos con un enlace para desafiar a otra persona y un torneo semanal con inscripción y tabla de puntos.'],
      ['¿Hay una aplicación para el celular?',
        'Por ahora Play Crípticos funciona en el navegador del celular y se puede agregar a la pantalla de inicio como una aplicación. Todavía no hay versiones publicadas en Google Play ni en la App Store.'],
    ],
  },
};
