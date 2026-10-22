# Aspectos legales

Esto es una guía operativa, no asesoramiento legal. Antes de lanzar con usuarios reales conviene que un profesional del país donde se opere revise los textos de privacidad y condiciones (`src/views/content.js`).

## Contenido propio

- El catálogo inicial (`seed/`) fue escrito para este proyecto y no copia pistas de terceros.
- Las listas de palabras usadas para comprobar respuestas (`an-array-of-spanish-words`, `an-array-of-english-words`) tienen licencia MIT.
- El diseño, el nombre y el código son propios. No se usaron textos, logos ni estilos de cripticodeldia.lat ni de otros sitios.

## Contenido de terceros

- Que algo esté visible en Internet no significa que se pueda copiar. Solo se republica con una licencia que lo permita (CC0, dominio público, CC BY, CC BY-SA) o con permiso escrito del titular.
- Con CC BY y CC BY-SA hay que mostrar la atribución que pida el autor; con CC BY-SA, lo derivado se comparte con la misma licencia.
- Guardar el permiso escrito (correo o contrato) fuera del sistema y anotar en la fuente dónde está.
- Ver [FUENTES.md](FUENTES.md) para el circuito técnico.

## Aportes de usuarios

- Al proponer, el usuario confirma que el críptico es suyo o que tiene derecho a compartirlo, y acepta las condiciones (licencia no exclusiva para publicarlo en el sitio). Ambas casillas son obligatorias y la base las exige.
- El sistema marca señales de posible copia (©, nombres de publicaciones conocidas) para que el moderador revise.
- Si alguien reclama derechos: desactivar el críptico desde el panel (queda registrado en la auditoría) y responder al reclamo.

## Datos personales

- Sin cuenta, solo se guarda un identificador anónimo de jugador en una cookie para no repetir crípticos y llevar estadísticas.
- Las IP no se guardan en claro: se usa un hash con sal secreta, solo para antiabuso.
- País e idioma se guardan en el navegador solo si el usuario marca “recordar”; si no, duran la sesión.
- La cuenta es opcional; el correo también. El usuario puede eliminar su cuenta desde su perfil.
- No hay publicidad ni rastreadores de terceros.
- Los plazos de retención se configuran en el panel (`retention.*`).

## Textos legales globales (todos los países, 22/10/2026)

- `src/db/legal-global.js` tiene 15 documentos en español pensados para cualquier país: condiciones, privacidad (UE/Reino Unido/Suiza, EE. UU. por estado, Brasil, Argentina, México, Canadá, Asia), cookies, contenido de usuarios, comunidad, propiedad intelectual, moderación, eliminación de cuentas, promociones, consentimientos, contratos, privacidad de apps, matriz de obligaciones, proveedores e incidentes.
- Edad mínima para crear cuenta: 16 años (18 en la India). Al registrarse, la casilla de aceptación es obligatoria y se guarda `users.terms_accepted_at` (migración 009).
- **Datos del titular:** no se inventan. Mientras `OWNER` (nombre o razón social, domicilio, país y correo de contacto) tenga campos vacíos, los textos no se cargan. Con los datos completos, el siguiente despliegue los carga como borrador (versión nueva, `source_note = global-2026-10-22`).
- **Aprobación:** en el panel, Legal → «Aprobar y publicar los textos globales». Solo un CEO (`approvals.decide`). Cada documento pasa por el circuito normal: pedido de aprobación atado al texto exacto, voto del CEO con su cuenta y publicación con evidencia. Ruta: `POST /api/admin/legal/global/approve`.
- Publicación: las páginas `/es/condiciones`, `/es/privacidad` y `/es/legal/<documento>` leen la versión publicada de la base; el índice está en `/es/legal` y en el pie de página. Los documentos internos quedan vigentes en el panel.
- La matriz por país suma los países hispanohablantes restantes, Brasil, Suiza, India, China, Japón, Corea, Singapur, Sudáfrica, Nigeria, Arabia Saudita, Emiratos, Turquía, Nueva Zelanda y «Resto del mundo». Una fila no significa cumplimiento verificado: los requisitos se cargan solo con fuente oficial.
- Son borradores redactados con investigación de agentes, no asesoramiento jurídico. Conviene que un abogado los revise antes de cerrar la versión definitiva.
