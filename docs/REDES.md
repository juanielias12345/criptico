# Redes: calendario de lanzamiento de 60 días

El calendario empieza el **lunes 26/10/2026 (día 0)** y termina el **jueves 24/12/2026 (día 59)**. Son 808 publicaciones en Instagram, Facebook, X, Threads, TikTok, YouTube Shorts y el canal de WhatsApp. Todas siguen el manual de marca ([MARCA.md](MARCA.md)).

## Qué hay cada día

- **Críptico del día:** imagen 1080 × 1350, publicada a la mañana en Instagram, Facebook, X, Threads y WhatsApp. Sale de 63 crípticos originales nuevos, validados por el validador y publicados en el catálogo (`seed/clues.es.json`), así que el enlace `playcripticos.com/es/c/<slug>` existe.
- **Solución:**
  - video vertical de 16 s: pista, cuenta regresiva, respuesta y explicación. Se publica en TikTok, YouTube Shorts y como reel de Instagram y Facebook;
  - historia de Instagram;
  - posteo en X y en Threads.
- **Lunes, miércoles y viernes:** carrusel. Hay 4 ya diseñados, 9 lecciones («Cómo funciona: anagrama»…) y 13 «Así se resuelve».
- **Sábado y domingo:** «Dos para el finde» y sus soluciones.
- **Día 0:** anuncio de lanzamiento en Instagram, Facebook, X y Threads.

## Horarios del director de marketing

Hora de Argentina (UTC−3). Se pueden ajustar con los datos reales de Metricool cuando haya historial.

| Red | Pieza | Hora | Motivo |
|---|---|---|---|
| WhatsApp | Críptico | 08:30 | Antes del trabajo, con el primer café |
| Instagram | Críptico | 09:00 | Hábito de la mañana, como el Wordle |
| X | Críptico | 09:00 | Pico de lectura de X a la mañana |
| Threads | Críptico | 09:15 | Después de Instagram, para no competir |
| Facebook | Críptico | 09:30 | El público de Facebook entra más tarde |
| Instagram y Facebook | Lanzamiento (día 0) | 12:00 / 12:15 | Hora del almuerzo |
| Instagram y Facebook | Carrusel (lun., mié., vie.) | 13:00 / 13:30 | Se guardan en el almuerzo |
| Instagram y Facebook | Finde (sáb. y dom.) | 12:00 / 12:30 | El fin de semana se juega más tarde |
| TikTok, Shorts y reel de Instagram | Video | 21:00 | Horario central de video |
| Instagram | Historia con la solución | 21:05 | Justo después del reel |
| X | Solución | 21:00 | Misma hora que el resto (posteo propio) |
| Threads y reel de Facebook | Solución | 21:15 | Después de X e Instagram |

## Panel: «Redes: 60 días»

- **Calendario:** 60 carpetas, una por día, agrupadas por semana, con cuántas piezas están para aprobar, aprobadas, programadas o publicadas. Desde ahí se puede aprobar la semana entera.
- **Carpeta del día:** cada pieza aparece separada por red, con la imagen o el video, el texto, el horario y su motivo. Se puede:
  - aprobar una pieza o el día entero;
  - pedir cambios;
  - copiar el texto;
  - descargar cada archivo, o el día completo en un .zip con todos los archivos y un `textos.txt`.
- **Aprobación:** queda atada a la versión exacta que se vio. Si alguien cambió el texto después de abrir la carpeta, esa pieza no se aprueba (`stale_version`). Cada aprobación crea su pedido y su voto en la bandeja y en la auditoría.

## Programación en Metricool

- Al aprobarse una pieza, el servidor la programa en Metricool por la API oficial (`POST https://app.metricool.com/api/v2/scheduler/posts`), en la red y el horario de la pieza. La tarea `social_schedule` reintenta lo que haya quedado pendiente.
- «Programada» exige el identificador que devuelve Metricool, que queda guardado como evidencia. Si Metricool responde con error, la pieza sigue «aprobada» y el error se ve en la carpeta.
- El canal de WhatsApp no tiene API de programación: esas piezas se publican a mano. Después se marca la pieza como publicada pegando el enlace.

**Para conectarlo:**

1. La API de Metricool necesita el plan **Advanced** o superior.
2. En Metricool, ir a Configuración de la cuenta → API y copiar el token. El `userId` y el `blogId` aparecen en la dirección del navegador al abrir la marca.
3. Cargar en Vercel las variables `METRICOOL_USER_TOKEN`, `METRICOOL_USER_ID` y `METRICOOL_BLOG_ID` y volver a publicar.
4. Conectar en Metricool cada red de @playcripticos.

Sin estos pasos, lo aprobado queda listo y se puede descargar y publicar a mano.

## Volver a generar

`node scripts/social/render.js` arma `data/social/plan.json` y dibuja los archivos en `public/social/`. Usa Chromium y ffmpeg. Con `--plan-only` solo arma el plan; con `--days 0-6` dibuja solo esos días.

Las piezas que ya están en la base no se pisan. Si cambia un texto, se edita desde el panel, y eso invalida la aprobación anterior.

Los archivos de `public/social/` se sirven con `noindex` y están excluidos en `robots.txt`.
