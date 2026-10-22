'use strict';

// Borradores iniciales preparados por los agentes (22/10/2026). Entran siempre como
// borrador: los documentos legales necesitan revisión profesional y la aprobación
// de un CEO de la versión exacta; las piezas de marketing, su aprobación antes de
// programarse. Nada de esto se publica solo. Los datos que no conocemos quedan
// marcados como [COMPLETAR] en lugar de inventarse.

const HEAD = 'BORRADOR preparado por el equipo legal de agentes de IA de Play Crípticos el 22/10/2026. '
  + 'No es asesoramiento jurídico ni está validado por un abogado. Antes de publicarlo debe revisarlo un profesional '
  + 'de cada país donde se opere y aprobarlo un CEO.\n\n';

const OWNER = '[COMPLETAR: nombre legal del titular del sitio, domicilio y correo de contacto]';

const LEGAL_DRAFTS = [
  ['cookies', `${HEAD}POLÍTICA DE COOKIES Y ALMACENAMIENTO LOCAL

1. Qué usamos
Play Crípticos usa solo cookies y almacenamiento estrictamente necesarios para que el sitio funcione. No usamos cookies publicitarias, de redes sociales ni de analítica de terceros.

2. Detalle
- pid (cookie propia, técnica, 400 días): identificador aleatorio de jugador para no repetirte crípticos y calcular tus estadísticas cuando jugás sin cuenta. No contiene tu nombre, correo ni IP.
- sid (cookie propia, técnica, hasta 30 días o 12 horas en el panel): mantiene tu sesión iniciada. Se borra al cerrar sesión.
- Preferencias (almacenamiento del navegador): país, idioma y tema. Se guardan de forma permanente solo si marcás «Recordar en este dispositivo»; si no, duran la sesión del navegador.
- Panel interno (almacenamiento del navegador, solo para el equipo): filtros y vistas elegidas.

3. Visitas
Contamos visitas de forma agregada por día, idioma y país elegido, sin cookies ni identificadores. Si tu navegador envía «Do Not Track» o «Global Privacy Control», no se cuentan.

4. Consentimiento
Como solo usamos elementos estrictamente necesarios, no mostramos un banner de consentimiento. [REVISAR con abogado: confirmar que esta exención aplica en cada país prioritario (por ejemplo, Directiva 2002/58/CE art. 5.3 en la UE).] Si en el futuro se incorporan cookies no necesarias, se pedirá consentimiento previo y se actualizará esta política.

5. Cómo borrarlas
Podés borrar las cookies y el almacenamiento desde la configuración de tu navegador. Si borrás pid, perdés las estadísticas de juego sin cuenta.

6. Contacto
${OWNER}`],

  ['ugc', `${HEAD}POLÍTICA DE CONTENIDO ENVIADO POR USUARIOS

1. Qué se puede enviar
Crípticos (pista, respuesta y explicación) propuestos desde la página de propuestas, y reportes de errores sobre crípticos publicados.

2. Requisitos para enviar
Al enviar confirmás que:
- el críptico es de tu autoría o tenés derecho a compartirlo;
- no copia contenido de libros, diarios, sitios u otras fuentes sin permiso;
- no incluye datos personales de terceros, insultos, discriminación ni contenido ilegal.

3. Licencia que nos das
Nos otorgás una licencia no exclusiva, gratuita, mundial y por tiempo indefinido para publicar, adaptar el formato, traducir y mostrar tu críptico en Play Crípticos y en sus aplicaciones y redes oficiales, con el nombre público que elijas. Seguís siendo titular de tu obra. [REVISAR con abogado: alcance de la licencia, cesión de derechos de traducción y menciones en redes.]

4. Revisión humana obligatoria
Ninguna propuesta se publica sin la aprobación de una persona del equipo. Podemos editar errores menores de ortografía o formato; si el cambio es de fondo, te consultamos o la rechazamos.

5. Rechazo y retiro
Podemos rechazar o retirar una propuesta que no cumpla estas reglas, que genere dudas de derechos o que reciba un reclamo fundado. Podés pedir que retiremos tu críptico publicado escribiendo a ${OWNER}.

6. Responsabilidad
Sos responsable de lo que enviás. Si recibimos un reclamo de un tercero por tu propuesta, la desactivamos mientras se analiza.`],

  ['community', `${HEAD}NORMAS DE COMUNIDAD

Play Crípticos es un espacio para disfrutar y aprender juegos de palabras. Estas normas valen en el sitio, en las propuestas, en los reportes y en las redes oficiales.

1. Respeto. Nada de insultos, acoso, amenazas, discriminación ni discursos de odio.
2. Sin spoilers. No publiques respuestas del críptico del día en comentarios públicos antes de que termine el día.
3. Contenido propio. Compartí solo crípticos tuyos o con permiso.
4. Sin spam. Nada de publicidad no pedida, enlaces engañosos ni cuentas falsas.
5. Privacidad. No publiques datos personales tuyos o de otras personas.
6. Menores. [COMPLETAR con abogado: edad mínima para crear cuenta en cada país prioritario.]

Qué pasa si no se cumplen
Según la gravedad: retiro del contenido, advertencia, suspensión temporal o cierre de la cuenta. Las decisiones quedan registradas y se pueden apelar (ver Política de moderación).

Reportar
Usá el botón de reporte en cada críptico o escribí a ${OWNER}.`],

  ['ip', `${HEAD}PROPIEDAD INTELECTUAL Y PROCEDIMIENTO DE DENUNCIAS

1. Contenido de Play Crípticos
El nombre, el logo, el diseño, el código y los crípticos propios son de ${OWNER} o se usan con licencia. Las fuentes léxicas del generador se usan según sus licencias, detalladas en la página de créditos.

2. Contenido de terceros
Solo publicamos crípticos externos de dominio público, con licencia compatible o con permiso expreso registrado. Junto a la solución se muestran fuente, autor y licencia.

3. Cómo denunciar una infracción
Escribí a ${OWNER} con:
- tus datos de contacto y, si actuás en nombre de otra persona, la autorización;
- el enlace o identificador del contenido;
- la obra que considerás infringida y por qué sos titular;
- una declaración de buena fe de que el uso no está autorizado.

4. Qué hacemos
- Desactivamos de inmediato el contenido denunciado mientras lo revisamos (queda registrado en la auditoría).
- Respondemos en un plazo de [COMPLETAR: plazo, por ejemplo 10 días hábiles].
- Si quien lo publicó fue un usuario, le avisamos y puede responder.
- Si la denuncia es fundada, el contenido no vuelve a publicarse.

5. Contranotificación
Quien publicó el contenido puede pedir que se reconsidere aportando pruebas de su derecho. [REVISAR con abogado: procedimientos específicos como DMCA en Estados Unidos o la Ley de Servicios Digitales en la UE.]`],

  ['moderation', `${HEAD}POLÍTICA DE MODERACIÓN

1. Qué moderamos
Propuestas de crípticos, reportes de errores y, cuando haya canales conectados, comentarios y mensajes en redes oficiales.

2. Quién decide
Personas del equipo con rol de moderación o superior. Los agentes de IA pueden clasificar, detectar señales (posible copia, spam, datos personales) y preparar borradores de respuesta, pero la decisión de publicar, rechazar o sancionar es siempre humana.

3. Criterios
Normas de comunidad, Política de contenido enviado por usuarios y Propiedad intelectual. Ante una duda material de derechos, se bloquea preventivamente.

4. Registro
Cada decisión queda en el registro de auditoría con quién la tomó, cuándo y el motivo. El registro no se puede borrar ni modificar.

5. Apelación
Podés pedir que se revise una decisión escribiendo a ${OWNER} dentro de los [COMPLETAR: plazo] días. La revisa una persona distinta de la que decidió, cuando sea posible.

6. Casos que se elevan a los CEO
Amenazas legales, denuncias de propiedad intelectual, reclamos de privacidad, problemas de seguridad, pedidos de eliminación de datos, acoso, prensa y usuarios en riesgo.`],

  ['deletion', `${HEAD}ELIMINACIÓN DE CUENTAS Y DATOS

1. Cómo eliminar tu cuenta
Desde «Mi perfil», en la pestaña de ajustes, con el botón «Eliminar cuenta». Se pide confirmación.

2. Qué se borra
Tu nombre de usuario, correo, contraseña, sesiones, perfil público, logros y preferencias. Tus partidas quedan solo como estadísticas anónimas, sin forma de vincularlas a vos.

3. Qué se conserva y por qué
- Registros de seguridad y auditoría, sin tu IP (se guarda un hash que se anonimiza a los 2 años como máximo), para proteger el sitio y cumplir obligaciones legales.
- Crípticos que propusiste y se publicaron, con el nombre público que elegiste, salvo que pidas retirarlos.

4. Otros derechos
Desde tu perfil podés descargar una copia de tus datos y pedir correcciones. También podés escribir a ${OWNER}.

5. Plazos
La eliminación es inmediata en la base de producción. Las copias de seguridad del proveedor de base de datos se renuevan según su propio ciclo. [COMPLETAR: confirmar plazo de retención de copias en Turso.]

6. Sin cuenta
Si jugás sin cuenta, podés borrar tus datos de juego borrando la cookie pid desde tu navegador. [REVISAR: ofrecer también un botón para borrar el historial anónimo.]`],

  ['consents', `${HEAD}AVISOS Y CONSENTIMIENTOS ESPECÍFICOS

Inventario de los avisos y casillas que hoy existen en el sitio, para revisión.

1. Recordar preferencias: casilla «Recordar en este dispositivo» en el diálogo de país e idioma. Sin marcarla, la preferencia dura la sesión.
2. Propuestas: dos casillas obligatorias (autoría o derecho a compartir; aceptación de las condiciones y la licencia). La base de datos rechaza una propuesta sin ellas.
3. Unir partidas anónimas a una cuenta: se pide permiso explícito; sin permiso no se unen.
4. Perfil público y rankings: apagados por defecto; se activan solo por decisión del usuario.
5. Do Not Track / Global Privacy Control: se respetan para el conteo de visitas.

Pendientes [REVISAR con abogado]
- Edad mínima y consentimiento de padres o tutores según cada país.
- Aceptación de los términos al crear una cuenta (hoy implícita).
- Consentimiento para comunicaciones por correo, cuando exista un proveedor de correo.`],

  ['processors', `${HEAD}REGISTRO DE PROVEEDORES QUE TRATAN DATOS

| Proveedor | Servicio | Datos | Ubicación | Base o garantía |
|---|---|---|---|---|
| Vercel Inc. | Hosting y funciones | Tráfico web, registros del servidor | [COMPLETAR: región de funciones; se pidió gru1, São Paulo] | [COMPLETAR: acuerdo de tratamiento de datos de Vercel] |
| Turso (ChiselStrike Inc.) | Base de datos | Todos los datos del sitio | São Paulo (aws-sa-east-1) | [COMPLETAR: acuerdo de tratamiento de datos de Turso] |
| GitHub Inc. | Código y tareas automáticas | Código; las tareas acceden a la base para generar crípticos | Estados Unidos | Sin datos personales en el repositorio |
| Anthropic (Claude) | Agentes que trabajan en el proyecto | Código, documentos y datos agregados que el proyecto comparte | [COMPLETAR] | No se le envían datos personales de usuarios |

Pendientes
- Firmar o aceptar los acuerdos de tratamiento de datos de cada proveedor.
- Evaluar transferencias internacionales según los países prioritarios.
- Agregar aquí cada proveedor nuevo (correo, monitoreo, redes) antes de conectarlo.`],

  ['incidents', `${HEAD}REGISTRO DE INCIDENTES Y PROCEDIMIENTO DE RESPUESTA

1. Qué es un incidente
Acceso no autorizado, pérdida o alteración de datos, caída prolongada del sitio, publicación no autorizada o filtración de credenciales.

2. Detección
Alertas del panel (accesos desde dispositivos nuevos, fallos de tareas, errores), reportes de usuarios y revisiones del equipo.

3. Pasos
1) Contener: revocar sesiones (Equipo → Cerrar sesiones), rotar secretos en Vercel y GitHub, desactivar la función afectada.
2) Evaluar: qué datos y cuántas personas; revisar el registro de auditoría.
3) Avisar a los CEO de inmediato.
4) Notificar a autoridades y personas afectadas cuando la ley lo exija. [COMPLETAR con abogado: plazos por país, por ejemplo 72 horas en la UE.]
5) Corregir la causa y verificar.
6) Registrar el incidente en esta tabla.

4. Registro
| Fecha | Descripción | Datos afectados | Personas | Medidas | Notificado a | Cerrado |
|---|---|---|---|---|---|---|
| — | Sin incidentes registrados al 22/10/2026 | — | — | — | — | — |`],

  ['contracts', `${HEAD}MODELO DE ACUERDO CON COLABORADORES Y CREADORES DE CRÍPTICOS

Partes: ${OWNER} («Play Crípticos») y [COMPLETAR: nombre del colaborador] («el Colaborador»).

1. Objeto: el Colaborador crea crípticos originales para Play Crípticos.
2. Entregas: [COMPLETAR: cantidad, idioma, dificultad y plazos].
3. Originalidad: el Colaborador garantiza que los crípticos son propios y no infringen derechos de terceros.
4. Derechos: [ELEGIR con abogado: cesión de derechos patrimoniales o licencia no exclusiva] para publicar, adaptar y traducir los crípticos en el sitio, las apps y las redes oficiales. Se mencionará al Colaborador como autor, salvo que pida lo contrario.
5. Pago: [COMPLETAR: monto, moneda, forma y fecha]. Ningún pago se hace sin la aprobación de un CEO.
6. Confidencialidad: el Colaborador no comparte crípticos no publicados.
7. Duración y terminación: [COMPLETAR].
8. Ley aplicable y jurisdicción: [COMPLETAR con abogado].

Nota: ningún agente firma este acuerdo ni lo envía. Lo firma un CEO después de la revisión profesional.`],
];


// Investigación inicial por jurisdicción (22/10/2026), con fuentes oficiales consultadas ese día.
// Son hallazgos en borrador: no afirman cumplimiento y todos necesitan revisión de un abogado local.
const JURISDICTION_FINDINGS = [
  { code: 'AR', priority: 1, risk: 'Alto: la base está en Brasil y el hosting en EE. UU., países que Argentina no considera adecuados.',
    requirements: [
      'Ley 25.326 art. 9: medidas técnicas y organizativas de seguridad y confidencialidad.',
      'Art. 14: acceso del titular, respuesta en 10 días corridos; art. 16: rectificación o supresión en 5 días hábiles.',
      'Art. 21 y AAIP: inscripción de bases de datos en el Registro Nacional de Bases de Datos Personales (verificar si aplica a este sitio).',
      'Informar antes de recolectar: finalidad, destinatarios, identidad y domicilio del responsable, derechos; leyenda visible (Res. AAIP 14/2018).',
      'Art. 12: transferencias internacionales solo a países adecuados. Brasil y EE. UU. no están en la lista (Disp. 60/2016, Res. AAIP 34/2019); hace falta consentimiento expreso o cláusulas contractuales modelo (Disp. 60/2016, Res. 198/2023).',
    ].join('\n'),
    sources: [
      'https://www.argentina.gob.ar/normativa/nacional/64790/texto',
      'https://www.argentina.gob.ar/aaip/datospersonales/responsables/obligaciones',
      'https://www.argentina.gob.ar/transferencias-internacionales',
    ].join('\n'),
    docs: 'privacy, processors, terms, deletion',
    action: 'Abogado: decidir mecanismo de transferencia (cláusulas modelo con Turso y Vercel), inscripción en el registro y leyenda de la AAIP.' },
  { code: 'MX', priority: 2, risk: 'Medio: ley nueva de 2025 con autoridad nueva; el aviso de privacidad actual no tiene todos los elementos.',
    requirements: [
      'Nueva LFPDPPP publicada en el DOF el 20/03/2025; autoridad: Secretaría Anticorrupción y Buen Gobierno (art. 2 fr. XV y art. 38).',
      'Arts. 14 a 16: aviso de privacidad con identidad y domicilio del responsable, datos tratados, finalidades, opciones para limitar uso, medios ARCO y cómo se comunican cambios; aviso simplificado en recolección electrónica.',
      'Art. 7: consentimiento (tácito válido con aviso puesto a disposición), revocable.',
      'Art. 31: respuesta a solicitudes ARCO en 20 días hábiles y ejecución en 15.',
      'Arts. 35 y 36: transferencias con aviso y cláusula de aceptación, salvo excepciones.',
    ].join('\n'),
    sources: ['https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf'].join('\n'),
    docs: 'privacy, processors, deletion',
    action: 'Preparar aviso de privacidad para México (completo y simplificado) y procedimiento ARCO con plazos.' },
  { code: 'ES', priority: 3, risk: 'Medio: edad mínima de 14 años para consentir y reglas de cookies.',
    requirements: [
      'LOPDGDD (Ley Orgánica 3/2018) art. 7: los mayores de 14 años consienten por sí; por debajo hace falta el consentimiento de padres o tutores.',
      'LSSI (Ley 34/2002) art. 22.2: cookies con consentimiento informado, salvo las estrictamente necesarias para un servicio pedido por el usuario (las de este sitio parecen de ese tipo; confirmar).',
      'LSSI art. 10: datos del prestador accesibles (nombre, correo, NIF) para prestadores establecidos en España.',
      'Se aplica además el RGPD (ver EU).',
    ].join('\n'),
    sources: ['https://www.boe.es/buscar/doc.php?id=BOE-A-2018-16673', 'https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758'].join('\n'),
    docs: 'privacy, cookies, terms, consents',
    action: 'Definir edad mínima para crear cuenta y confirmar con abogado que las cookies actuales están exentas.' },
  { code: 'EU', priority: 3, risk: 'Medio: el RGPD se aplica a quien ofrece servicios a personas en la UE aunque no esté establecido allí.',
    requirements: [
      'RGPD art. 3.2: se aplica al responsable no establecido en la UE que ofrece servicios a personas en la Unión.',
      'Art. 8.1: consentimiento propio desde los 16 años (los Estados pueden bajarlo hasta 13).',
      'Art. 27: designar un representante en la UE, salvo tratamiento ocasional y de bajo riesgo (evaluar).',
      'Directiva 2002/58/CE (ePrivacy): cookies no necesarias con consentimiento.',
    ].join('\n'),
    sources: ['https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A02016R0679-20160504'].join('\n'),
    docs: 'privacy, cookies, processors, incidents',
    action: 'Abogado: decidir si hace falta representante en la UE y base legal de cada tratamiento.' },
  { code: 'US', priority: 4, risk: 'Bajo a medio: sitio de público general; COPPA aplica si se sabe que se recogen datos de menores de 13.',
    requirements: [
      'COPPA (16 CFR 312), reforma vigente desde el 23/06/2025 con cumplimiento obligatorio desde el 22/04/2026.',
      'Sitios de público general: obligaciones solo con conocimiento efectivo de que se recogen datos personales de menores de 13 años.',
      'Si se sabe que un usuario es menor de 13: consentimiento verificable de padres, límites de retención y consentimiento separado para compartir con terceros.',
      'Leyes estatales de privacidad (por ejemplo California): no investigadas todavía; suelen tener umbrales de ingresos o volumen.',
    ].join('\n'),
    sources: ['https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule',
      'https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data'].join('\n'),
    docs: 'privacy, terms, community, app-privacy',
    action: 'Pedir fecha de nacimiento o edad mínima al crear cuenta y no dirigir contenido a menores de 13.' },
];

// Primeras piezas del plan de lanzamiento (22/10/2026). Los carruseles tienen diseño real
// (PNG en data/marketing, generados con las fuentes y colores de la marca) y quedan en la
// bandeja para que un CEO apruebe la versión exacta. Los guiones de video quedan «en
// producción»: no hay video filmado ni editado todavía, y así se muestra.
const slides = (deck, n) => Array.from({ length: n }, (_, i) => `marketing/${deck}/slide-${String(i + 1).padStart(2, '0')}.png`);
const RIGHTS_OWN = 'Diseño propio con las fuentes del sitio (Fraunces e Instrument Sans, licencia OFL). Crípticos del catálogo propio de Play Crípticos. Sin imágenes de terceros.';
const HASH_ES = '#crípticos #juegosdepalabras #acertijos #crucigramas #español';
const CONTENT_PIECES = [
  { id: 'mk-c01', title: '¿Qué es un críptico? (carrusel de presentación)', campaign: 'Lanzamiento · semana 1', objective: 'Explicar el juego y llevar a la primera partida',
    audience: 'Aficionados a crucigramas y juegos de palabras en español', country: 'AR', language: 'es', platform: 'Instagram', format: 'carrusel',
    idea: 'Resolver juntos un críptico real en 5 pasos.', body: '¿Nunca resolviste un críptico? Es un crucigrama con trampa: cada pista se lee de dos maneras. Te mostramos cómo sacar el primero en 5 pasos 👉\n\nJugá gratis y sin registrarte en playcripticos.com',
    cta: 'Jugá gratis en playcripticos.com', hashtags: HASH_ES, link: 'https://playcripticos.com/es/jugar',
    alt_text: 'Seis diapositivas que explican un críptico: la pista «Ramo revuelto para el sentimiento (4)», su definición, el anagrama de RAMO y la respuesta AMOR.',
    assets: slides('c01-que-es-un-criptico', 6), rights: RIGHTS_OWN, metric: 'Guardados y clics al sitio; partidas iniciadas desde Instagram', scheduled_at: '2026-11-03T21:00:00.000Z', ready: true },
  { id: 'mk-c02', title: '5 trucos que esconden los crípticos', campaign: 'Lanzamiento · semana 1', objective: 'Enseñar los mecanismos y generar guardados',
    audience: 'Personas que ya juegan crucigramas o Wordle', country: 'AR', language: 'es', platform: 'Instagram', format: 'carrusel',
    idea: 'Una diapositiva por mecanismo, con un ejemplo real del catálogo.', body: 'Anagramas, palabras ocultas, inversiones, charadas y dobles definiciones: los 5 trucos que vas a encontrar en casi todos los crípticos. Guardalo para tu próxima partida.',
    cta: 'Guardalo y probá en playcripticos.com', hashtags: HASH_ES, link: 'https://playcripticos.com/es/ayuda',
    alt_text: 'Siete diapositivas: anagrama (PARTO), palabra oculta (OSO), inversión (ROMA), charada (SOLDADO) y doble definición (GATO).',
    assets: slides('c02-cinco-trucos', 7), rights: RIGHTS_OWN, metric: 'Guardados por alcance; visitas a la guía', scheduled_at: '2026-11-05T21:00:00.000Z', ready: true },
  { id: 'mk-c03', title: 'Desafío: 3 crípticos bien rioplatenses', campaign: 'Lanzamiento · semana 2', objective: 'Comentarios y alcance local',
    audience: 'Público de Argentina y Uruguay', country: 'AR', language: 'es', platform: 'Instagram', format: 'carrusel',
    idea: 'Tres pistas con palabras locales; respuestas al final.', body: 'Tres crípticos con sabor rioplatense. ¿Cuántos sacás sin mirar la última diapositiva? Contanos en comentarios (sin spoilers 🙊).',
    cta: 'Más en playcripticos.com', hashtags: HASH_ES + ' #argentina', link: 'https://playcripticos.com/es/jugar',
    alt_text: 'Cinco diapositivas con tres pistas (COLECTIVO, MATE, OLA) y las respuestas al final.',
    assets: slides('c03-desafio-rioplatense', 5), rights: RIGHTS_OWN, metric: 'Comentarios por publicación', scheduled_at: '2026-11-10T21:00:00.000Z', ready: true },
  { id: 'mk-c04', title: 'Escondido a la vista: palabras ocultas', campaign: 'Lanzamiento · semana 2', objective: 'Enganchar con un mecanismo fácil',
    audience: 'Principiantes', country: null, language: 'es', platform: 'Instagram', format: 'carrusel',
    idea: 'Tres palabras ocultas, respuestas al final.', body: 'La respuesta está escrita en la pista. ¿La ves? Tres palabras ocultas para empezar el día.',
    cta: 'Jugá en playcripticos.com', hashtags: HASH_ES, link: 'https://playcripticos.com/es/jugar',
    alt_text: 'Cinco diapositivas con tres pistas de palabras ocultas (ARTE, GAFAS, OSO) y las respuestas al final.',
    assets: slides('c04-escondido-a-la-vista', 5), rights: RIGHTS_OWN, metric: 'Alcance y compartidos', scheduled_at: '2026-11-12T21:00:00.000Z', ready: true },
  { id: 'mk-r01', title: 'Reel: resolvé un críptico en 15 segundos', campaign: 'Lanzamiento · semana 1', objective: 'Alcance en video vertical',
    audience: 'Público general hispanohablante', country: null, language: 'es', platform: 'Instagram Reels / TikTok', format: 'reel',
    idea: 'Grabación de pantalla del juego real resolviendo «Ramo revuelto para el sentimiento (4)».',
    script: '0-2 s: texto «¿Podés resolver esto?» sobre la pista.\n2-6 s: se marca «el sentimiento» (definición).\n6-11 s: las letras de RAMO se mezclan en pantalla.\n11-14 s: aparece AMOR en verde.\n14-15 s: «Jugá gratis: playcripticos.com».\nAudio: música sin derechos de autor de la biblioteca de la plataforma. Subtítulos quemados en pantalla.',
    body: '15 segundos, un críptico. ¿Llegaste antes que el video?', cta: 'Link en la bio', hashtags: HASH_ES, link: 'https://playcripticos.com/es/jugar',
    rights: 'Grabación de pantalla del sitio propio; música a elegir de la biblioteca con licencia de la plataforma.', metric: 'Retención a 3 s y reproducciones completas', scheduled_at: '2026-11-04T22:00:00.000Z', ready: false },
  { id: 'mk-r02', title: 'Reel: ¿por qué se llama «críptico»?', campaign: 'Lanzamiento · semana 2', objective: 'Posicionar la marca como referente en español',
    audience: 'Curiosos de la lengua', country: null, language: 'es', platform: 'Instagram Reels / TikTok / YouTube Shorts', format: 'reel',
    idea: 'Explicación breve a cámara o con texto animado sobre el origen del género en los diarios británicos y su llegada al español.',
    script: '0-3 s: «En Inglaterra hay gente que resuelve esto todos los días en el diario.»\n3-10 s: mostrar una pista en inglés del catálogo («Pay attention to silent arrangement (6)» → LISTEN).\n10-20 s: «En español casi no había. Por eso hicimos Play Crípticos.»\n20-25 s: partida en el sitio.\n[VERIFICAR antes de producir: fecha del primer críptico publicado en un diario británico, con fuente.]',
    body: 'De los diarios británicos a tu celular, en español.', cta: 'Probalo en playcripticos.com', hashtags: HASH_ES, link: 'https://playcripticos.com/es',
    rights: 'Sin material de terceros; cualquier imagen de diario histórico requiere licencia.', metric: 'Seguidores nuevos por reel', scheduled_at: '2026-11-11T22:00:00.000Z', ready: false },
  { id: 'mk-r03', title: 'Reel: el mate y el jaque mate', campaign: 'Lanzamiento · semana 3', objective: 'Humor local y compartidos',
    audience: 'Argentina y Uruguay', country: 'AR', language: 'es', platform: 'Instagram Reels / TikTok', format: 'reel',
    idea: 'Doble definición: «Infusión rioplatense que pone fin a la partida de ajedrez (4)».',
    script: '0-3 s: alguien ceba un mate frente a un tablero de ajedrez.\n3-8 s: aparece la pista en pantalla.\n8-12 s: «Infusión… y fin de la partida» → MATE.\n12-15 s: «¿Jugamos?» + playcripticos.com.',
    body: 'Dos definiciones, una palabra. ¿La sacaste?', cta: 'Jugá en playcripticos.com', hashtags: HASH_ES + ' #mate', link: 'https://playcripticos.com/es/jugar',
    rights: 'Requiere filmación propia (persona con consentimiento de imagen firmado) o animación propia.', metric: 'Compartidos', scheduled_at: '2026-11-17T22:00:00.000Z', ready: false },
  { id: 'mk-a01', title: 'Artículo: cómo resolver tu primer críptico', campaign: 'SEO · base', objective: 'Tráfico orgánico de búsquedas «qué es un críptico» y «cómo resolver crípticos»',
    audience: 'Personas que buscan en Google', country: null, language: 'es', platform: 'Sitio web (blog)', format: 'article',
    idea: 'Guía completa con ejemplos del catálogo; enlaza a las 7 lecciones.',
    body: 'Cómo resolver tu primer críptico\n\nUn críptico es una pista de crucigrama que se puede leer de dos maneras. Una parte es una definición común, como en cualquier crucigrama. La otra es un juego de palabras que, siguiendo una pequeña instrucción, lleva a la misma respuesta. Cuando las dos coinciden, sabés que acertaste.\n\n1. Buscá la definición en un extremo\nLa definición casi siempre está al principio o al final de la pista. En «Ramo revuelto para el sentimiento (4)», la definición es «el sentimiento».\n\n2. Encontrá el indicador\nHay palabras que avisan qué hacer con las letras: «revuelto», «loco» o «roto» suelen indicar un anagrama; «esconde» o «en» indican una palabra oculta; «de vuelta» o «que regresa», una inversión.\n\n3. Aplicá la instrucción\nRAMO revuelto da AMOR, que es un sentimiento de 4 letras. Listo.\n\nLos mecanismos más comunes\n- Anagrama: «Trapo roto en el alumbramiento (5)» → PARTO.\n- Palabra oculta: «Queso solo esconde un animal del bosque (3)» → OSO.\n- Inversión: «Amor de vuelta en la capital italiana (4)» → ROMA.\n- Charada: «Astro rey y cubo de juego para un militar (7)» → SOL + DADO = SOLDADO.\n- Doble definición: «Felino que sirve para levantar un coche (4)» → GATO.\n\nConsejos\n- Leé la pista ignorando su sentido aparente: casi siempre es una trampa.\n- El número entre paréntesis es tu mejor aliado.\n- Si te trabás, pedí una pista: en Play Crípticos se revelan de a poco.\n\nSeguí aprendiendo con las 7 lecciones de playcripticos.com/es/ayuda o jugá directamente en playcripticos.com/es/jugar.',
    cta: 'Jugá tu primer críptico', link: 'https://playcripticos.com/es/ayuda', rights: 'Texto propio; ejemplos del catálogo propio.', metric: 'Visitas orgánicas y partidas iniciadas desde el artículo', ready: true },
  { id: 'mk-n01', title: 'Newsletter de lanzamiento', campaign: 'Lanzamiento · semana 1', objective: 'Avisar a quienes se registren con correo',
    audience: 'Usuarios registrados que aceptaron recibir correos', country: null, language: 'es', platform: 'Correo', format: 'newsletter',
    idea: 'Correo corto con el críptico de la semana y novedades.',
    body: 'Asunto: Tu críptico de la semana 🧩\n\nHola:\n\nPlay Crípticos ya está abierto: crípticos ilimitados en español y en inglés, gratis y sin publicidad.\n\nEl de esta semana: «Saga fascinante esconde anteojos españoles (5)».\n¿Lo sacaste? La respuesta está en el sitio.\n\nNovedades:\n- Tu perfil guarda tu historial, tus logros y tus récords.\n- 7 lecciones para aprender los trucos.\n\nNos vemos en playcripticos.com\n\nPara dejar de recibir estos correos: [enlace de baja del proveedor].',
    cta: 'Resolvelo en playcripticos.com', link: 'https://playcripticos.com/es/jugar', rights: 'Texto propio.', metric: 'Aperturas y clics',
    blocked: 'No hay proveedor de correo ni lista de suscriptores con consentimiento (tarea T-007).', ready: false },
];

module.exports = { LEGAL_DRAFTS, JURISDICTION_FINDINGS, CONTENT_PIECES };
