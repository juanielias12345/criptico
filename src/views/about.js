'use strict';

// Páginas institucionales: quiénes somos y contacto. Lo que dicen tiene que seguir
// siendo cierto: si cambia cómo se hacen o se revisan los crípticos, se cambia acá.
// Nunca nombrar un país concreto: la marca es de todo el mundo hispanohablante.

const es = {
  about: {
    title: 'Quiénes somos',
    seoTitle: 'Quiénes somos: el proyecto detrás de Play Crípticos | Play Crípticos',
    description: 'Play Crípticos es un proyecto independiente para jugar y aprender crípticos escritos en español. Cómo nacimos, cómo hacemos y revisamos cada pista y cómo se financia el sitio.',
    lead: 'Un proyecto independiente para que cualquier hispanohablante pueda jugar y aprender crípticos escritos directamente en su idioma.',
    body: [
      ['h2', 'Por qué existe Play Crípticos'],
      ['p', 'El crucigrama críptico es uno de los pasatiempos de palabras más ingeniosos que existen, pero casi todo lo que hay está en inglés. Y un críptico no se puede traducir: un anagrama, una palabra oculta o un homófono solo funcionan en el idioma en que fueron escritos. Play Crípticos nació para llenar ese hueco con un sitio pensado desde el principio en español, para hispanohablantes de cualquier región.'],
      ['p', 'Queremos que cualquiera pueda empezar sin saber nada, aprender las reglas jugando y llegar a disfrutar de las pistas difíciles. Por eso el sitio combina el juego con [lecciones](help), una [guía de mecanismos](guide), [artículos](articles) y una explicación paso a paso de cada solución.'],
      ['h2', 'Cómo hacemos los crípticos'],
      ['p', 'Cada críptico tiene uno de cuatro orígenes, y siempre se indica cuál:'],
      ['ul', [
        '**Escritos por el equipo.** Pistas originales, pensadas y revisadas por personas.',
        '**Generados y validados.** Nuestro generador arma pistas a partir de diccionarios abiertos y reglas de construcción, sin copiar pistas de ningún lado. Un validador comprueba que el juego de palabras dé exactamente la respuesta, que la definición esté en un extremo y que cada sinónimo figure en las fuentes léxicas. Una muestra de cada lote se revisa a mano.',
        '**Propuestos por la comunidad.** Cualquiera puede [proponer un críptico](contribute). Una persona del equipo lo revisa antes de publicarlo y aparece con el nombre que eligió quien lo propuso.',
        '**De fuentes con permiso.** Solo publicamos pistas externas cuando son de dominio público, tienen una licencia compatible o su autor dio permiso, y mostramos siempre la fuente.',
      ]],
      ['p', 'Seguimos las reglas de juego limpio de la tradición críptica: definición precisa al principio o al final, indicadores honestos y ninguna palabra de más. Si encontrás una pista con un error, podés reportarla desde la partida y la revisamos. El detalle de las fuentes y licencias está en [Fuentes y créditos](credits).'],
      ['h2', 'Español de todas partes'],
      ['p', 'El español se habla distinto en cada región, y eso afecta a los crípticos: lo que suena igual en un lugar puede no sonar igual en otro, y una palabra cotidiana para unos es rara para otros. Las pistas de uso general usan palabras y sonidos comunes a todo el idioma; las que dependen de una variante se marcan y se muestran a quien juega con esa variante. Lo explicamos en [este artículo](articles/cripticos-y-variantes-del-espanol).'],
      ['h2', 'Cómo se financia'],
      ['p', 'Jugar es y va a seguir siendo gratis, sin límite y sin registro obligatorio. El sitio se sostiene con publicidad de Google AdSense en algunas páginas de contenido y con [Plus](plus), un plan opcional que quita los anuncios y suma crípticos exclusivos. Plus no da ninguna ventaja en duelos ni torneos. Cómo tratamos los datos y las cookies está explicado en la [política de privacidad](privacy).'],
      ['h2', 'Hablemos'],
      ['p', 'Leemos todos los mensajes: sugerencias, errores en una pista, propuestas para docentes o simplemente un saludo. Encontrás cómo escribirnos en la página de [contacto](contact).'],
    ],
  },
  contact: {
    title: 'Contacto',
    seoTitle: 'Contacto | Play Crípticos',
    description: 'Cómo comunicarte con Play Crípticos: correo, redes sociales, reportes de errores en una pista, propuestas de crípticos y consultas sobre privacidad o Plus.',
    lead: 'Respondemos en español, normalmente en pocos días hábiles.',
    // {email} se reemplaza por el correo de contacto (el mismo de los documentos legales).
    body: [
      ['h2', 'Correo'],
      ['p', 'Para cualquier consulta, escribinos a {email}. Contanos con el mayor detalle posible qué necesitás; si es sobre un críptico concreto, incluí la pista o el enlace a su página.'],
      ['h2', 'Un error en una pista'],
      ['p', 'Lo más rápido es reportarlo desde la partida, con el botón «Informar un error» que aparece al resolver o revelar la solución. El reporte nos llega con el críptico ya identificado.'],
      ['h2', 'Proponer un críptico'],
      ['p', 'Si escribiste una pista, mandala desde [Proponer](contribute). Una persona del equipo la revisa y te avisamos si se publica o si hace falta un cambio. Antes de escribirla, te puede servir el artículo [cómo escribir un buen críptico](articles/como-escribir-un-buen-criptico).'],
      ['h2', 'Privacidad, datos y Plus'],
      ['p', 'Para ejercer tus derechos sobre tus datos personales (acceso, corrección, borrado o portabilidad), escribinos al mismo correo; también podés borrar tu cuenta desde [tu perfil](profile). Las consultas sobre pagos o cancelaciones de [Plus](plus) también llegan al mismo correo. Los detalles están en la [política de privacidad](privacy) y en las [condiciones de uso](terms).'],
      ['h2', 'Redes sociales'],
      ['p', 'Publicamos crípticos y consejos todos los días como @playcripticos en Instagram, Facebook y YouTube.'],
    ],
  },
};

module.exports = { es };
