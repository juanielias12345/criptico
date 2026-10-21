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
