'use strict';

// Versión global de los documentos legales (22/10/2026), pedida por los CEO para
// operar en todos los países. La preparan agentes de investigación: no es
// asesoramiento jurídico. Entra como borrador y solo se publica cuando un CEO la
// aprueba desde el panel (la aprobación queda atada al texto exacto).
//
// Los datos del titular no se inventan: mientras OWNER tenga campos vacíos, los
// textos no se cargan en la base y el panel lo avisa.

const NOTE = 'global-2026-10-22';
const UPDATED = '22 de octubre de 2026';

// Datos del titular, tal como los indique un CEO.
const OWNER = {
  // Datos que indicó Juan Ignacio Elías (CEO) el 22/10/2026. Domicilio: solo el país, a su pedido.
  name: 'Juan Ignacio Elías',
  address: 'la República Argentina',
  country: 'la República Argentina',
  email: 'playcripticos@gmail.com',
};

// Documentos que se muestran en el sitio (el resto es de uso interno).
const PUBLIC = ['terms', 'privacy', 'cookies', 'ugc', 'community', 'ip', 'moderation', 'deletion', 'promotions', 'processors'];

const DOCS = {
  terms: `# Términos y condiciones

Última actualización: {{FECHA}}.

Estos términos regulan el uso de Play Crípticos (playcripticos.com y sus aplicaciones). Al usar el sitio o crear una cuenta, los aceptás. Si no estás de acuerdo, no uses el servicio.

## 1. Quién ofrece el servicio
Play Crípticos es un servicio de {{TITULAR}}, con domicilio en {{DOMICILIO}}. Contacto: {{CONTACTO}}.

## 2. Qué es Play Crípticos
Un juego gratuito de crípticos en español: pistas que combinan una definición y un juego de palabras. Se puede jugar sin cuenta. La cuenta es opcional y sirve para guardar tu progreso, tu perfil y proponer crípticos.

## 3. Edad mínima
- Cualquier persona puede jugar sin cuenta.
- Para crear una cuenta tenés que tener al menos 16 años, o la edad mayor que exija la ley de tu país para dar consentimiento sin autorización de tus padres (por ejemplo, 18 años en la India).
- Si tenés menos edad, solo podés crear una cuenta con la autorización de tu madre, padre o tutor, cuando la ley de tu país lo permita.
- Si sabemos que una cuenta pertenece a una persona menor de la edad permitida, la eliminamos.

## 4. Tu cuenta
- Elegí una contraseña segura y no la compartas. Sos responsable de lo que se haga con tu cuenta.
- El nombre de usuario no puede suplantar a otra persona ni ser ofensivo.
- Podés eliminar tu cuenta cuando quieras desde tu perfil.

## 5. Uso permitido
No está permitido:
- automatizar el acceso para copiar el catálogo o sobrecargar el sitio;
- intentar vulnerar la seguridad o acceder a cuentas ajenas;
- usar el sitio para enviar spam, publicidad no pedida o contenido ilegal;
- publicar soluciones del críptico del día con el fin de arruinarle el juego a otras personas;
- infringir las Normas de comunidad.

## 6. Contenido de Play Crípticos
El nombre, el logo, el diseño, el código y los crípticos propios pertenecen a {{TITULAR}} o se usan con licencia. Podés jugar y compartir capturas o enlaces con fines personales. No podés copiar el catálogo ni usarlo con fines comerciales sin permiso escrito. Los crípticos de fuentes externas se muestran con su autor, fuente y licencia.

## 7. Crípticos que propongas
- Al enviar un críptico, declarás que es tuyo o que tenés derecho a compartirlo.
- Nos das una licencia no exclusiva, gratuita, mundial y por tiempo indefinido para publicarlo, corregir errores de forma y mostrarlo en el sitio, las aplicaciones y las redes oficiales, con el nombre público que elijas. Seguís siendo titular de tu obra.
- Toda propuesta la revisa una persona antes de publicarse. Podemos aprobarla, pedir cambios o rechazarla.
- Podés pedir que retiremos un críptico tuyo ya publicado escribiendo a {{CONTACTO}}.
El detalle está en la Política de contenido enviado por usuarios.

## 8. Servicio gratuito y sin garantías
Play Crípticos se ofrece gratis y «tal como está». Hacemos lo posible para que cada críptico sea correcto y el sitio esté disponible, pero puede haber errores, interrupciones o cambios. Podemos modificar, pausar o cerrar funciones en cualquier momento.

## 9. Responsabilidad
En la medida que permita la ley, {{TITULAR}} no responde por daños indirectos derivados del uso del servicio gratuito. Nada de estos términos limita los derechos que te dan las leyes de protección del consumidor de tu país ni la responsabilidad que no puede excluirse por ley (por ejemplo, por dolo o culpa grave).

## 10. Suspensión
Podemos suspender o cerrar una cuenta que incumpla estos términos o las Normas de comunidad. Te avisamos el motivo, salvo que la ley lo impida o exista un riesgo de seguridad, y podés apelar según la Política de moderación.

## 11. Cambios en los términos
Si cambiamos estos términos, publicamos la versión nueva con su fecha. Si el cambio es importante, lo avisamos en el sitio con anticipación razonable. Seguir usando el servicio después de la fecha de vigencia implica aceptar la versión nueva.

## 12. Ley aplicable y reclamos
Estos términos se rigen por las leyes de {{PAIS}}. Si sos consumidor, también te protegen las normas imperativas de tu país de residencia y podés reclamar ante sus tribunales u organismos de defensa del consumidor. Antes de iniciar un reclamo, escribinos a {{CONTACTO}}: intentamos resolverlo en 30 días.

## 13. Contacto y punto de contacto
Para cualquier consulta, incluidas las de autoridades y las previstas en la Ley de Servicios Digitales de la Unión Europea: {{CONTACTO}}. Atendemos en español y en inglés.`,

  privacy: `# Política de privacidad

Última actualización: {{FECHA}}.

Esta política explica qué datos usa Play Crípticos, para qué, con quién los compartimos y cómo ejercer tus derechos, estés en el país que estés.

## 1. Responsable
{{TITULAR}}, con domicilio en {{DOMICILIO}}. Contacto para privacidad: {{CONTACTO}}. Esta misma dirección funciona como contacto del encargado de protección de datos a los efectos de la ley de Brasil (LGPD) y de otras leyes que lo piden.

## 2. Qué datos usamos
- **Jugar sin cuenta:** un identificador aleatorio en una cookie técnica (pid) para no repetirte crípticos y calcular tus estadísticas. No contiene tu nombre, correo ni IP.
- **Preferencias:** país, idioma y tema, guardados en tu navegador solo si marcás «Recordar en este dispositivo».
- **Cuenta (opcional):** nombre de usuario, contraseña guardada con hash (nunca en texto plano), correo si lo das, fecha en que aceptaste los términos.
- **Partidas:** críptico, inicio y fin, intentos, pistas usadas, si se reveló la respuesta y un tiempo activo estimado.
- **Perfil:** tus respuestas escritas, logros e historial, que solo ves vos. El perfil público y los rankings están apagados salvo que los actives.
- **Propuestas y reportes:** el contenido que envíes y el nombre público que elijas.
- **Seguridad:** un hash de tu dirección IP con una sal secreta, nunca la IP en claro.
- **Visitas:** conteos agregados por día, idioma y país elegido, sin cookies ni identificadores. Si tu navegador envía «Do Not Track» o «Global Privacy Control», no se cuentan.

No pedimos ni guardamos datos sensibles (salud, religión, origen, orientación, datos biométricos ni ubicación precisa). Solo usamos el país que vos elegís.

## 3. Para qué y con qué base
| Uso | Base legal |
|---|---|
| Que el juego funcione, no repetir crípticos, tu cuenta y tu perfil | Ejecución del servicio que pedís |
| Seguridad, prevención de abusos y registros de auditoría | Interés legítimo y obligaciones legales |
| Estadísticas agregadas para mejorar el juego | Interés legítimo, sin identificarte |
| Recordar preferencias, perfil público y rankings | Tu consentimiento, que podés retirar cuando quieras |
| Moderar y publicar propuestas | Ejecución del servicio y tu consentimiento al enviarlas |

No vendemos datos personales, no los compartimos para publicidad comportamental y no tomamos decisiones automatizadas que tengan efectos legales sobre vos.

## 4. Con quién compartimos datos
Solo con proveedores que nos prestan servicios técnicos y tratan los datos por cuenta nuestra: alojamiento (Vercel), base de datos (Turso) y repositorio de código (GitHub). El detalle está en el Registro de proveedores. También podemos entregar datos si una autoridad competente lo exige conforme a la ley.

## 5. Dónde se guardan
La base de datos está en São Paulo, Brasil, y el sitio se sirve desde servidores de Vercel. Algunos proveedores son de Estados Unidos. Cuando los datos salen de tu país, usamos las garantías que prevé la ley, como las cláusulas contractuales tipo de los proveedores o tu consentimiento cuando corresponde.

## 6. Cuánto tiempo
- Partidas: hasta 400 días; detalle de eventos de cada partida: 180 días.
- Registros de seguridad: hasta 2 años, sin IP.
- Sesiones: vencen solas (30 días como máximo).
- Cuenta: hasta que la elimines. Al eliminarla, se borran tus datos personales y tus partidas quedan solo en estadísticas anónimas.

## 7. Tus derechos
Según la ley de tu país, podés pedir acceso, corrección, eliminación, portabilidad, oposición o limitación del tratamiento, y retirar tu consentimiento. Desde tu perfil podés descargar tus datos, corregirlos o eliminar tu cuenta. Para lo demás, escribí a {{CONTACTO}}.
- Respondemos dentro del plazo de la ley que te aplique (por ejemplo, 10 días corridos para el acceso en Argentina, 15 días en Brasil, un mes en la Unión Europea y el Reino Unido, 45 días en Estados Unidos).
- No te discriminamos por ejercer tus derechos.
- Podés reclamar ante la autoridad de protección de datos de tu país. Por ejemplo: la Agencia de Acceso a la Información Pública en Argentina, la Agencia Española de Protección de Datos, la ANPD en Brasil, la ICO en el Reino Unido o la autoridad de tu estado en Estados Unidos.

## 8. Menores
Se puede jugar sin cuenta a cualquier edad, sin dar datos personales. Las cuentas son para mayores de 16 años, o de la edad mayor que fije la ley de tu país (18 en la India). No recolectamos a sabiendas datos de menores de 13 años; si nos enteramos de que una cuenta pertenece a alguien menor de la edad permitida, la eliminamos. Si sos madre, padre o tutor y creés que pasó, escribinos.

## 9. Seguridad
Contraseñas con hash, conexiones cifradas, IP con hash, accesos del equipo con roles y registro de auditoría que no se puede alterar. Si ocurre un incidente que afecte tus datos, lo notificamos a la autoridad y a las personas afectadas en los plazos de la ley (por ejemplo, 72 horas a la autoridad en la Unión Europea y el Reino Unido).

## 10. Información adicional por región
- **Unión Europea, Espacio Económico Europeo, Reino Unido y Suiza:** aplicamos el RGPD, el RGPD del Reino Unido y la ley suiza de protección de datos. Las bases legales son las de la sección 3.
- **Estados Unidos (California, Colorado, Virginia, Connecticut, Utah, Texas y otros estados):** en los últimos 12 meses recolectamos identificadores (usuario, correo opcional, identificador de jugador), información de uso del sitio y contenido que enviaste. No vendemos ni «compartimos» datos personales para publicidad, no usamos datos sensibles y respetamos la señal Global Privacy Control. Podés ejercer tus derechos por vos o mediante un agente autorizado.
- **Brasil:** aplicamos la LGPD; el contacto del encargado es {{CONTACTO}}.
- **Argentina:** el titular de los datos personales tiene la facultad de ejercer el derecho de acceso a ellos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3, de la Ley 25.326. La Agencia de Acceso a la Información Pública, en su carácter de órgano de control de la Ley 25.326, atiende las denuncias y reclamos de quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.
- **México:** podés ejercer tus derechos de acceso, rectificación, cancelación y oposición (ARCO) escribiendo a {{CONTACTO}}.
- **Canadá:** aplicamos la PIPEDA y la Ley 25 de Quebec.
- **China, Corea, Japón, India, Singapur y otros países de Asia:** tratamos solo los datos de esta política, con las mismas finalidades, y atendemos los derechos que te reconozca tu ley en {{CONTACTO}}. Si tu ley exige un consentimiento separado para transferir datos fuera del país, te lo pedimos antes de crear la cuenta.
- **Resto del mundo:** te aplican los mismos derechos y garantías de esta política, además de los que te dé tu ley.

## 11. Cambios
Publicamos cada versión con su fecha. Si un cambio afecta cómo usamos tus datos, lo avisamos en el sitio antes de aplicarlo y, si hace falta, te pedimos consentimiento de nuevo.`,

  cookies: `# Política de cookies

Última actualización: {{FECHA}}.

Play Crípticos usa solo cookies y almacenamiento estrictamente necesarios para que el sitio funcione. No usamos cookies de publicidad, de redes sociales ni de analítica de terceros.

| Nombre | Tipo | Para qué | Duración |
|---|---|---|---|
| pid | Cookie propia, técnica | Identificador aleatorio de jugador para no repetirte crípticos y llevar tus estadísticas sin cuenta | 400 días |
| sid | Cookie propia, técnica | Mantener tu sesión iniciada | Hasta 30 días, o 12 horas en el panel del equipo |
| Preferencias | Almacenamiento del navegador | País, idioma y tema | Solo si marcás «Recordar en este dispositivo»; si no, la sesión |

## Visitas
Contamos visitas de forma agregada, sin cookies ni identificadores. Si tu navegador envía «Do Not Track» o «Global Privacy Control», no se cuentan.

## Consentimiento
Como solo usamos elementos estrictamente necesarios para prestar el servicio que pedís, no hace falta un aviso de consentimiento según la normativa europea (artículo 5.3 de la Directiva 2002/58/CE) ni las equivalentes de otros países. Si en el futuro sumamos cookies que no sean necesarias, te vamos a pedir consentimiento antes y vamos a actualizar esta política.

## Cómo borrarlas
Podés borrar cookies y almacenamiento desde la configuración de tu navegador. Si borrás pid, se pierden las estadísticas de juego sin cuenta.

## Contacto
{{CONTACTO}}`,

  ugc: `# Política de contenido enviado por usuarios

Última actualización: {{FECHA}}.

## 1. Qué se puede enviar
Crípticos (pista, respuesta y explicación) desde la página de propuestas, y reportes de errores sobre crípticos publicados.

## 2. Requisitos
Al enviar confirmás que:
- el críptico es tuyo o tenés derecho a compartirlo;
- no copia libros, diarios, sitios ni otras fuentes sin permiso;
- no incluye datos personales de terceros, insultos, discriminación ni contenido ilegal.

## 3. Licencia que nos das
Nos otorgás una licencia no exclusiva, gratuita, mundial y por tiempo indefinido para publicar, adaptar el formato, traducir y mostrar tu críptico en Play Crípticos, sus aplicaciones y sus redes oficiales, con el nombre público que elijas. Seguís siendo titular de tu obra y podés usarla donde quieras. Si pedís que lo retiremos, dejamos de mostrarlo en el sitio en un plazo de 10 días hábiles; lo ya publicado en redes puede quedar en esas publicaciones.

## 4. Revisión humana
Ninguna propuesta se publica sin la aprobación de una persona del equipo. Podemos corregir errores menores de ortografía o formato; si el cambio es de fondo, te consultamos o la rechazamos.

## 5. Rechazo y retiro
Podemos rechazar o retirar una propuesta que no cumpla estas reglas, que genere dudas sobre derechos o que reciba un reclamo fundado. Te informamos el motivo y podés apelar según la Política de moderación.

## 6. Responsabilidad
Sos responsable de lo que enviás. Si un tercero reclama por tu propuesta, la desactivamos mientras se analiza.

## Contacto
{{CONTACTO}}`,

  community: `# Normas de comunidad

Última actualización: {{FECHA}}.

Play Crípticos es un espacio para disfrutar y aprender juegos de palabras. Estas normas valen en el sitio, en las propuestas, en los reportes y en las redes oficiales.

1. **Respeto.** Nada de insultos, acoso, amenazas, discriminación ni discursos de odio.
2. **Sin spoilers.** No publiques la respuesta del críptico del día en comentarios públicos antes de las 21 h (hora de Buenos Aires).
3. **Contenido propio.** Compartí solo crípticos tuyos o con permiso.
4. **Sin spam.** Nada de publicidad no pedida, enlaces engañosos ni cuentas falsas.
5. **Privacidad.** No publiques datos personales tuyos ni de otras personas.
6. **Menores.** Las cuentas son para mayores de 16 años, o de la edad que fije la ley de cada país (ver Términos). No pidas datos ni contactos a menores.
7. **Legalidad.** Nada de contenido ilegal en tu país ni en el nuestro.

## Qué pasa si no se cumplen
Según la gravedad: retiro del contenido, advertencia, suspensión temporal o cierre de la cuenta. Las decisiones quedan registradas y se pueden apelar (ver Política de moderación).

## Reportar
Usá el botón de reporte de cada críptico o escribí a {{CONTACTO}}.`,

  ip: `# Propiedad intelectual y denuncias

Última actualización: {{FECHA}}.

## 1. Contenido de Play Crípticos
El nombre, el logo, el diseño, el código y los crípticos propios son de {{TITULAR}} o se usan con licencia. Las fuentes léxicas del generador se usan según sus licencias, detalladas en la página de créditos.

## 2. Contenido de terceros
Solo publicamos crípticos externos de dominio público, con licencia compatible o con permiso expreso registrado. Junto a la solución se muestran fuente, autor y licencia.

## 3. Cómo denunciar una infracción
Escribí a {{CONTACTO}} con:
- tus datos de contacto y, si actuás por otra persona, la autorización;
- el enlace o identificador del contenido;
- la obra que considerás infringida y por qué sos titular;
- una declaración de buena fe de que el uso no está autorizado y de que la información es exacta.

## 4. Qué hacemos
- Desactivamos de inmediato el contenido denunciado mientras lo revisamos; queda registrado en la auditoría.
- Respondemos en un plazo de 10 días hábiles.
- Si lo publicó un usuario, le avisamos con el motivo y puede responder.
- Si la denuncia es fundada, el contenido no vuelve a publicarse; ante infracciones repetidas, cerramos la cuenta.

## 5. Contranotificación
Quien publicó el contenido puede pedir que se reconsidere, aportando pruebas de su derecho. Si la contranotificación es válida y quien denunció no inicia acciones legales dentro de 14 días hábiles, podemos volver a publicarlo. Este procedimiento sigue los principios de la ley DMCA de Estados Unidos, de la Ley de Servicios Digitales de la Unión Europea y de las normas equivalentes de otros países.`,

  moderation: `# Política de moderación

Última actualización: {{FECHA}}.

## 1. Qué moderamos
Propuestas de crípticos, reportes de errores, nombres de usuario y perfiles públicos y, cuando haya canales conectados, comentarios y mensajes en las redes oficiales.

## 2. Quién decide
Personas del equipo con rol de moderación o superior. Herramientas automáticas y agentes de IA pueden clasificar y detectar señales (posible copia, spam, datos personales) y preparar borradores, pero la decisión de publicar, rechazar o sancionar es siempre de una persona.

## 3. Criterios
Términos y condiciones, Normas de comunidad, Política de contenido enviado por usuarios y Propiedad intelectual. Ante una duda material sobre derechos, se bloquea de forma preventiva.

## 4. Aviso y motivo
Cuando retiramos contenido o sancionamos una cuenta, te informamos la decisión, el motivo, la norma aplicada y cómo apelar, salvo que la ley lo impida.

## 5. Registro
Cada decisión queda en el registro de auditoría con quién la tomó, cuándo y el motivo. Ese registro no se puede borrar ni modificar.

## 6. Apelación
Podés pedir una revisión escribiendo a {{CONTACTO}} dentro de los 30 días. La revisa una persona distinta de la que decidió, cuando sea posible, y respondemos en 15 días hábiles. En la Unión Europea también podés acudir a los órganos de resolución extrajudicial certificados según la Ley de Servicios Digitales.

## 7. Casos que se elevan a los responsables del sitio
Amenazas legales, denuncias de propiedad intelectual, reclamos de privacidad, problemas de seguridad, pedidos de eliminación de datos, acoso, prensa y personas en riesgo.`,

  deletion: `# Eliminación de cuentas y datos

Última actualización: {{FECHA}}.

## 1. Cómo eliminar tu cuenta
Desde «Mi perfil», en ajustes, con el botón «Eliminar cuenta». Se pide confirmación. También podés pedirlo a {{CONTACTO}}.

## 2. Qué se borra
Tu nombre de usuario, correo, contraseña, sesiones, perfil público, logros y preferencias. Tus partidas quedan solo como estadísticas anónimas, sin forma de vincularlas con vos.

## 3. Qué se conserva y por qué
- Registros de seguridad y auditoría, sin tu IP, hasta 2 años, para proteger el sitio y cumplir obligaciones legales.
- Crípticos que propusiste y se publicaron, con el nombre público que elegiste, salvo que pidas retirarlos.

## 4. Plazos
La eliminación es inmediata en la base de producción. Las copias de seguridad del proveedor de base de datos se renuevan en su propio ciclo y se sobrescriben; mientras tanto no se usan para ningún fin.

## 5. Sin cuenta
Si jugás sin cuenta, podés borrar tus datos de juego borrando la cookie pid desde tu navegador.

## 6. Otros derechos
Desde tu perfil podés descargar una copia de tus datos y pedir correcciones. Ver la Política de privacidad.`,

  promotions: `# Concursos y promociones

Última actualización: {{FECHA}}.

Hoy Play Crípticos no organiza concursos, sorteos ni promociones con premios.

Si en el futuro organizamos uno:
- tendrá bases propias publicadas antes de empezar, con organizador, fechas, países habilitados, edad mínima, mecánica, premios y forma de elegir ganadores;
- se habilitará solo en los países cuyas reglas hayamos revisado; algunos países exigen autorización previa o prohíben ciertos sorteos (por ejemplo, Brasil, Italia o la provincia de Quebec), y ahí no se ofrecerá sin cumplir esos requisitos;
- no se pedirá comprar nada para participar;
- los datos de quienes participen se usarán solo para el concurso y se borrarán al terminar, salvo obligación legal;
- en redes sociales se aclarará que la promoción no está patrocinada ni administrada por la red.

Cada concurso necesita la aprobación de un responsable del sitio antes de anunciarse.`,

  consents: `# Avisos y consentimientos específicos

Inventario interno de avisos y casillas del sitio, actualizado al {{FECHA}}.

1. **Crear cuenta:** casilla obligatoria «Tengo 16 años o más (o la edad que exige mi país) y acepto los Términos y la Política de privacidad». Se guarda la fecha de aceptación.
2. **Recordar preferencias:** casilla «Recordar en este dispositivo». Sin marcarla, la preferencia dura la sesión.
3. **Propuestas:** dos casillas obligatorias (autoría o derecho a compartir; aceptación de la licencia). La base rechaza una propuesta sin ellas.
4. **Unir partidas anónimas a una cuenta:** permiso explícito; sin permiso no se unen.
5. **Perfil público y rankings:** apagados por defecto; se activan solo por decisión de la persona.
6. **Do Not Track y Global Privacy Control:** se respetan en el conteo de visitas.

Pendientes para cuando existan:
- Comunicaciones por correo: casilla separada y desmarcada, con baja en cada envío.
- Aplicaciones: avisos del sistema operativo y fichas de privacidad de las tiendas.
- Concursos: aceptación de las bases de cada uno.`,

  contracts: `# Modelo de acuerdo con colaboradores y creadores de crípticos

Partes: {{TITULAR}}, con domicilio en {{DOMICILIO}} («Play Crípticos»), y ____________________ («el Colaborador»).

1. **Objeto:** el Colaborador crea crípticos originales en español para Play Crípticos.
2. **Entregas:** cantidad ______, dificultad ______, plazo ______.
3. **Originalidad:** el Colaborador garantiza que los crípticos son propios y no infringen derechos de terceros.
4. **Derechos:** el Colaborador otorga una licencia no exclusiva, mundial y por tiempo indefinido para publicar, adaptar y traducir los crípticos en el sitio, las aplicaciones y las redes oficiales. Se lo menciona como autor, salvo que pida lo contrario. Conserva el derecho de publicar sus crípticos en otros lugares.
5. **Pago:** ______ (monto, moneda, forma y fecha). Ningún pago se hace sin la aprobación de un responsable del sitio.
6. **Confidencialidad:** el Colaborador no comparte crípticos aún no publicados.
7. **Datos personales:** cada parte trata los datos de la otra solo para cumplir este acuerdo.
8. **Duración y terminación:** ______; cualquiera de las partes puede terminarlo con 30 días de aviso. Los crípticos ya entregados y pagados siguen bajo la licencia del punto 4.
9. **Ley aplicable:** leyes de {{PAIS}}, sin perjuicio de las normas imperativas del país del Colaborador.

Ningún agente firma ni envía este acuerdo. Lo firma un responsable del sitio.`,

  'app-privacy': `# Privacidad de las aplicaciones

Última actualización: {{FECHA}}.

Las aplicaciones de Play Crípticos para iPhone y Android todavía no están publicadas. Cuando lo estén:
- tratarán los mismos datos que el sitio, descritos en la Política de privacidad;
- no incluirán publicidad ni kits de terceros que rastreen entre aplicaciones;
- no pedirán permisos de ubicación, contactos, cámara ni micrófono;
- las notificaciones serán opcionales y se podrán apagar desde el sistema;
- las fichas de privacidad de App Store y Google Play declararán: identificadores (usuario e identificador de jugador), uso del producto y contenido del usuario, sin rastreo y sin compartir con terceros.

Esta política se actualizará antes de publicar cada aplicación.`,

  obligations: `# Matriz de obligaciones por país

Documento interno. Actualizado al {{FECHA}}. Es una investigación de agentes, no asesoramiento jurídico.

Criterio: Play Crípticos aplica en todo el mundo el estándar más exigente común (RGPD europeo) y suma lo específico de cada región.

| Región o país | Norma principal | Qué exige y cómo se cubre |
|---|---|---|
| Unión Europea y EEE | RGPD; Directiva 2002/58/CE; Ley de Servicios Digitales | Bases legales, derechos, plazo de un mes, aviso de incidentes en 72 h, cookies solo necesarias, punto de contacto y apelación. Cubierto en Privacidad, Cookies, Moderación y Términos. |
| España | LOPDGDD | Edad de consentimiento 14 años; Play Crípticos exige 16. Reclamos ante la AEPD. |
| Reino Unido | UK GDPR; Data Protection Act 2018 | Igual que la UE; reclamos ante la ICO. |
| Suiza | nLPD | Información sobre transferencias; cubierto en Privacidad. |
| Estados Unidos | COPPA; leyes estatales (California CCPA/CPRA, Colorado, Virginia, Connecticut, Utah, Texas y otras) | Sin cuentas para menores de 13; aviso de categorías; no vender ni compartir; respetar GPC; 45 días para responder. |
| Canadá | PIPEDA; Ley 25 de Quebec | Responsable identificado, consentimiento y transferencias. |
| Brasil | LGPD | Encargado de datos (contacto), 15 días para el acceso, aviso de incidentes a la ANPD en 3 días hábiles. |
| Argentina | Ley 25.326 | Acceso en 10 días corridos; leyenda de la AAIP; transferencias a países sin nivel adecuado con contratos o consentimiento (ver riesgo R-010). |
| México | LFPDPPP 2025 | Aviso de privacidad y derechos ARCO. |
| Chile | Ley 19.628 y Ley 21.719 (vigente desde diciembre de 2026) | Derechos ampliados y autoridad nueva; revisar antes de su entrada en vigencia. |
| Colombia, Perú, Uruguay y resto de Latinoamérica | Leyes nacionales de datos | Autorización del titular, derechos y transferencias; cubierto por el estándar general. |
| India | DPDP Act 2023 | Consentimiento verificable de padres para menores de 18: cuentas solo para mayores de 18 en la India. |
| China | PIPL | Consentimiento separado para transferir datos fuera del país; Play Crípticos no apunta a ese mercado. |
| Japón, Corea del Sur, Singapur y resto de Asia | APPI, PIPA, PDPA y otras | Finalidades, derechos y transferencias; Corea fija 14 años para consentimiento. |
| Australia y Nueva Zelanda | Privacy Act 1988; Privacy Act 2020 | Principios de privacidad y aviso de incidentes graves. |
| Sudáfrica, Nigeria, Kenia y resto de África | POPIA, NDPA, DPA y otras | Responsable identificado, bases legales y derechos. |
| Medio Oriente | PDPL de Arabia Saudita, ley federal de EAU y otras | Bases legales y transferencias; no es mercado prioritario. |

Pendiente: revisión de un abogado en los países donde se invierta en marketing, y del abogado del país del titular para la ley aplicable.`,

  processors: `# Registro de proveedores que tratan datos

Última actualización: {{FECHA}}.

| Proveedor | Servicio | Datos que trata | Ubicación | Garantía |
|---|---|---|---|---|
| Vercel Inc. | Alojamiento y funciones del sitio | Tráfico web y registros del servidor | Funciones en São Paulo (Brasil); red global | Acuerdo de tratamiento de datos de Vercel con cláusulas contractuales tipo |
| Turso (ChiselStrike Inc.) | Base de datos | Todos los datos del sitio | São Paulo (Brasil) | Acuerdo de tratamiento de datos de Turso |
| GitHub Inc. | Código y tareas automáticas | Código; las tareas acceden a la base para generar crípticos | Estados Unidos | Sin datos personales en el repositorio |

Servicios que usa el equipo y no reciben datos de quienes juegan: Metricool (programación de publicaciones en redes), Google Search Console y Bing Webmaster Tools (estadísticas de búsqueda agregadas) y Anthropic (asistentes de IA del equipo).

Cada proveedor nuevo se agrega a este registro antes de conectarlo.`,

  incidents: `# Procedimiento de respuesta a incidentes

Documento interno. Actualizado al {{FECHA}}.

## 1. Qué es un incidente
Acceso no autorizado, pérdida o alteración de datos, caída prolongada del sitio, publicación no autorizada o filtración de credenciales.

## 2. Pasos
1. **Contener:** cerrar sesiones del equipo, rotar secretos en Vercel y GitHub, desactivar la función afectada.
2. **Evaluar:** qué datos, cuántas personas y de qué países; revisar el registro de auditoría.
3. **Avisar** a los responsables del sitio de inmediato.
4. **Notificar** cuando la ley lo exija: 72 horas a la autoridad en la Unión Europea, el Reino Unido y Suiza; 3 días hábiles a la ANPD en Brasil; «sin demora indebida» en los estados de Estados Unidos y en Canadá; a las personas afectadas cuando el riesgo sea alto.
5. **Corregir** la causa y verificar.
6. **Registrar** el incidente en la tabla.

## 3. Registro
| Fecha | Descripción | Datos afectados | Personas | Medidas | Notificado a | Cerrado |
|---|---|---|---|---|---|---|
| — | Sin incidentes registrados al {{FECHA}} | — | — | — | — | — |`,
};

const ownerReady = () => ['name', 'address', 'country', 'email'].every((k) => String(OWNER[k] || '').trim());

function fill(text) {
  return text.replace(/\{\{TITULAR\}\}/g, OWNER.name).replace(/\{\{DOMICILIO\}\}/g, OWNER.address)
    .replace(/\{\{PAIS\}\}/g, OWNER.country).replace(/\{\{CONTACTO\}\}/g, OWNER.email).replace(/\{\{FECHA\}\}/g, UPDATED);
}

// Revisión del 22/10/2026: origen de las visitas y de los jugadores nuevos.
// Se arma sobre el texto global ya cargado y entra como borrador para aprobación.
const ORIGIN_NOTE = 'origen-2026-10-22';
function swap(text, from, to) {
  if (!text.includes(from)) throw new Error('legal-global: no encontré el texto a reemplazar: ' + from.slice(0, 60));
  return text.replace(from, to);
}
const REVISIONS = {
  privacy: (t) => {
    t = swap(t, '- **Visitas:** conteos agregados por día, idioma y país elegido, sin cookies ni identificadores. Si tu navegador envía «Do Not Track» o «Global Privacy Control», no se cuentan.',
      '- **Visitas:** conteos agregados por día, idioma, país elegido y origen de la visita (por ejemplo, Instagram, Google o enlace directo, y la campaña si el enlace la indica), sin cookies ni identificadores. Si tu navegador envía «Do Not Track» o «Global Privacy Control», no se cuentan.\n'
      + '- **Cómo llegaste:** cuando empezás a jugar por primera vez o creás una cuenta, guardamos de dónde vino esa visita: el sitio que te trajo (solo el dominio, por ejemplo instagram.com), la campaña del enlace si la tiene y la primera página que abriste. Mientras navegás, ese dato queda en el almacenamiento de sesión de tu navegador y se borra al cerrar la pestaña. No seguimos lo que hacés en otros sitios. Si tu navegador envía «Do Not Track» o «Global Privacy Control», no se guarda.');
    t = swap(t, '| Estadísticas agregadas para mejorar el juego | Interés legítimo, sin identificarte |',
      '| Estadísticas agregadas para mejorar el juego | Interés legítimo, sin identificarte |\n| Saber por qué canales llegan los jugadores (redes, buscadores, enlaces) | Interés legítimo; podés oponerte con «Do Not Track», «Global Privacy Control» o escribiéndonos |');
    return t;
  },
  cookies: (t) => {
    t = swap(t, 'Play Crípticos usa solo cookies y almacenamiento estrictamente necesarios para que el sitio funcione.',
      'Play Crípticos usa cookies y almacenamiento estrictamente necesarios para que el sitio funcione, y un dato propio de origen de la visita que se borra al cerrar la pestaña.');
    t = swap(t, '| Preferencias | Almacenamiento del navegador | País, idioma y tema | Solo si marcás «Recordar en este dispositivo»; si no, la sesión |',
      '| Preferencias | Almacenamiento del navegador | País, idioma y tema | Solo si marcás «Recordar en este dispositivo»; si no, la sesión |\n| Origen | Almacenamiento de sesión del navegador | De dónde vino tu visita (dominio y campaña del enlace) para saber por qué canal llegan los jugadores | Hasta cerrar la pestaña |');
    t = swap(t, 'Como solo usamos elementos estrictamente necesarios para prestar el servicio que pedís, no hace falta un aviso de consentimiento',
      'El dato de origen es una medición de audiencia propia: queda solo en nuestras estadísticas, no se cruza con otros sitios, dura hasta cerrar la pestaña y no se guarda si tu navegador pide no ser rastreado. El resto son elementos estrictamente necesarios para prestar el servicio que pedís. Por eso no usamos un aviso de consentimiento');
    return t;
  },
};

module.exports = { NOTE, ORIGIN_NOTE, REVISIONS, OWNER, PUBLIC, DOCS, ownerReady, fill };
