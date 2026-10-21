# Perfil personal del jugador

«Mi perfil» (`/es/perfil`, `/en/profile`) muestra las estadísticas, el historial y la evolución de cada persona. Todo número sale de las partidas y eventos guardados en la base. No hay datos de ejemplo. Cuando la muestra no alcanza para sacar una conclusión, la interfaz lo dice en vez de inventarla.

## Quién es «la persona»

| Situación | Qué partidas cuenta | Dueño de los logros |
| --- | --- | --- |
| Con cuenta | Las de todos los identificadores de jugador vinculados a la cuenta | `u:<id de cuenta>` |
| Sin cuenta | Las del identificador seudónimo de este navegador (cookie `pid`) | `p:<id de jugador>` |

**Vincular partidas anónimas.** Al registrarse o entrar, las partidas que el navegador jugó sin cuenta **no se suman solas**. Primero se muestra el aviso «Tenés N partidas jugadas en este navegador…». Solo se suman con `POST /api/me/link-anonymous` y `{ "confirm": true }`. Al sumarlas, los logros del identificador pasan a la cuenta. Un identificador sin partidas se vincula sin preguntar, porque no hay nada que mezclar.

**Cuenta eliminada.** Sus identificadores quedan marcados con `players.retired_at`. Ningún navegador los puede volver a usar como propios, ni siquiera el mismo. Las partidas quedan anónimas solo para las estadísticas generales del panel.

El modo **práctica** no cuenta para estadísticas, logros, experiencia ni récords.

## Seguimiento de las partidas

El servidor registra en `game_events` estos eventos:

- `start`, `resume` y `restart`
- `guess_wrong`, `guess_repeat` y `guess_correct`
- `hint`, `reveal` y `skip`
- `timeout`, `abandon` (por inactividad) y `error`

Los logros obtenidos se guardan aparte, en `achievements_earned`.

**Datos que se guardan con cada evento:**

- **Respuestas:** se guarda la respuesta normalizada (mayúsculas, sin espacios ni signos), que es lo que la persona ve en su historial.
- **Pistas:** se guarda el número de pista y su tipo (mecanismo, definición, primera letra o letras alternadas). El detalle solo muestra pistas que de verdad se entregaron.

**Sin duplicados.** Si un reenvío o un doble clic repite una acción, no se cuenta dos veces:

- **Respuesta incorrecta repetida:** se compara con la anterior (`last_wrong_key`). Se registra como `guess_repeat` y no suma intento.
- **Pista ya entregada:** el navegador indica qué pista pide (`level`). Si ya se entregó, se devuelve sin sumar.
- **Cierre de la partida:** solo ocurre con `finished_at IS NULL`. Dos respuestas correctas simultáneas cierran la partida una sola vez.
- **Logros:** la clave primaria `(owner, code)` y `INSERT OR IGNORE` impiden obtener uno dos veces.

**Tiempos.** El navegador no envía ningún tiempo:

- **Tiempo hasta resolver:** lo mide el servidor, desde que entregó la pista hasta la respuesta correcta.
- **Tiempo activo:** se estima con latidos que el navegador envía solo con la pestaña visible y actividad reciente. Las pausas se recortan.

**Errores.** Si falla la evaluación de logros, la partida queda guardada igual (se prueba con un corte simulado). El error queda en `error_log`.

## Definiciones de los indicadores

| Indicador | Definición |
| --- | --- |
| Crípticos resueltos | Crípticos **distintos** resueltos al menos una vez. Repetir uno no suma. |
| Partidas jugadas | Todas las partidas empezadas, incluidas las repetidas, abandonadas y en curso. |
| Partidas completadas | Resueltas más reveladas. |
| Partidas resueltas | Partidas con la respuesta correcta, aunque el críptico se repita. |
| Respuestas reveladas | Partidas en las que se pidió la respuesta. No cuentan como resueltas. |
| Abandonadas | Partidas abandonadas o vencidas. |
| Porcentaje de acierto | Resueltas sobre cerradas. Las partidas en curso no cuentan. |
| Tiempo mediano, promedio y mejor | Solo de partidas resueltas, con el tiempo medido por el servidor. |
| Tiempo activo | Suma del tiempo activo de todas las partidas. |
| Racha actual | Días UTC consecutivos con al menos una partida. Sigue viva si se jugó hoy o ayer. |
| Mejor racha | La mayor racha de días. |
| Aciertos seguidos | La mayor serie de partidas resueltas. Se corta con una revelada, abandonada, vencida o con error. |
| Mecanismos dominados | Mecanismos con nivel «dominado» (ver Fortalezas). |

Cada indicador muestra su definición en la interfaz, en el botón «?».

## Historial y detalle

**Historial**

- Está paginado: 20 partidas por página, como máximo 50.
- **Filtros:** fechas, idioma, dificultad, categoría, mecanismo, resultado, tiempo, uso de pistas y modo. También se puede buscar en el texto de la pista.
- **Orden:** más recientes, más antiguas, más rápidas, más lentas, más pistas o más difíciles.
- **Repeticiones:** cada fila marca si fue la primera resolución de ese críptico o una repetición. Solo la primera da experiencia.

**Detalle de una partida**

- **Respuestas:** las que dio la persona, en orden, con el momento de cada una.
- **Pistas:** cada pista con su momento y si fue antes o después del primer intento.
- **Revelación:** si se reveló, cuándo.
- **Tiempos:** transcurrido, activo y hasta resolver.
- **Solución:** respuesta y explicación, solo si la partida terminó.
- **Origen:** de dónde viene el críptico.
- **Acciones:** practicar ese mecanismo, guardarlo en la biblioteca y compartir el resultado.

**Retención:** los eventos se conservan 180 días (`retention.game_events_days`). En partidas más viejas, el detalle paso a paso avisa que ya no se conserva y se mantienen los totales.

## Evolución

**Gráficos**

- Partidas y resueltas.
- Porcentaje de acierto.
- Tiempo mediano.
- Pistas por partida.
- Días con partidas.
- Desglose por dificultad, por mecanismo y por idioma.

**Período y comparación**

- **Períodos:** 30, 90, 180 o 365 días, o un rango elegido.
- **Agrupación:** por día, semana o mes, elegida sola según el largo del período.
- **Comparación:** con el período anterior del mismo largo.

**Mensajes («Lo que muestran tus datos»).** Aparecen solo con muestra suficiente. Si no la hay, se dice «Todavía no hay datos suficientes…».

| Mensaje | Condición |
| --- | --- |
| Subió o bajó el acierto | ≥ 10 partidas cerradas en cada período y una diferencia de 10 puntos o más |
| Más rápido o más lento en una dificultad | ≥ 5 resueltas de esa dificultad en cada período y una mediana ≤ 85 % o ≥ 125 % de la anterior |
| Menos pistas | ≥ 10 partidas en cada período y al menos 0,5 pistas menos por partida |
| Mecanismo más firme o más lento | Al menos 2 mecanismos con nivel estimado |

**Gráficos accesibles.** Son SVG propios: un solo eje y leyenda cuando hay dos series. Cada punto tiene su etiqueta. «Ver como tabla» muestra los mismos números en una tabla.

## Fortalezas

Para cada mecanismo se muestran partidas, resueltas, porcentaje de acierto, tiempo mediano, pistas y tendencia reciente. La tendencia compara las últimas 10 partidas con las anteriores, y solo se calcula con 5 o más de cada lado.

| Nivel | Condición (partidas cerradas del mecanismo) |
| --- | --- |
| Faltan datos | Menos de 8 |
| Dominado | ≥ 80 % de acierto y ≤ 1 pista por partida |
| Sólido | ≥ 60 % de acierto |
| En desarrollo | ≥ 40 % de acierto |
| Para practicar | Menos de 40 % de acierto |

El tiempo no influye en el nivel. La interfaz aclara que la rapidez no mide la inteligencia.

## Recomendaciones

Cada recomendación lleva a crípticos publicados que la persona todavía no resolvió y muestra cuántos hay. Las recomendaciones posibles son:

1. **Practicar el mecanismo más débil:** solo si tiene nivel estimado «en desarrollo» o «para practicar».
2. **Probar un mecanismo nunca jugado.**
3. **Subir un nivel de dificultad:** cuando la dificultad actual sale bien, con ≥ 8 partidas y ≥ 75 % de acierto.
4. **Resolver 3 sin pistas:** si en ≥ 10 partidas el promedio es de 1 pista o más.
5. **Jugar una variante regional:** una con 3 o más crípticos propios que la persona no probó.

**Cómo se juegan.** El botón «Jugar» abre `/jugar?mechanism=…`, `?difficulty=…` o `?choice=…`. El juego muestra «Practicando: …» con la opción «Quitar filtro». Se prueba que el críptico que entrega es del mecanismo pedido.

Las recomendaciones se pueden apagar en Ajustes. Con la opción apagada, la API responde `{ disabled: true }`.

## Logros

Cada familia tiene niveles. El código es `familia_umbral` y la condición se muestra exacta.

| Grupo | Familia | Métrica | Niveles |
| --- | --- | --- | --- |
| Primeros pasos | Descifrador | Crípticos distintos resueltos | 1, 10, 50, 100, 500 |
| Precisión | Pulso firme | Resoluciones seguidas | 5, 10, 25 |
| Precisión | Nivel experto | Distintos de dificultad 4 o 5 | 1, 10 |
| Precisión | Sin red | Distintos sin pistas | 10, 50 |
| Dominio | Caja de herramientas | Mecanismos con al menos una resolución | 3, 6, 9 |
| Dominio | Políglota | Idiomas con al menos una resolución | 2, 3 |
| Constancia | Constancia | Mejor racha de días | 3, 7, 30 |
| Constancia | Habitual | Días distintos con partidas | 7, 30, 100 |
| Constancia | Hasta el final | Partidas completadas | 50, 200 |
| Constancia | Regreso | Volver tras 30 días o más sin jugar | 1 |
| Exploración | Explorador | Categorías con al menos una resolución | 5, 10 |
| Exploración | Coleccionista | Categorías (con ≥ 5 crípticos) resueltas completas | 1 |

- **Cuándo se evalúan:** al cerrar cada partida (resuelta, revelada o pasada) y al vincular partidas anónimas.
- **Avisos:** al obtener uno, el juego muestra «Logro nuevo: …». El aviso se puede apagar en Ajustes; sin cuenta, se apaga en este navegador.
- **Diseño:** sin contadores regresivos ni avisos por días sin jugar.
- **Insignias:** son dibujos propios en SVG, con una forma por grupo y un símbolo por familia.

## Experiencia y niveles (opcionales)

| Acción | Experiencia |
| --- | --- |
| Primera resolución de un críptico | 10 + 5 × dificultad (repetirlo da 0) |
| Críptico estudiado (revelado y nunca resuelto) | 2 |
| Primer críptico resuelto de un mecanismo nuevo | 25 |
| Primer críptico resuelto de un idioma nuevo | 50 |
| Primer críptico resuelto de una variante regional nueva | 20 |
| Día con al menos una resolución | 5 |
| Logro obtenido | 20 |

**Niveles.**

- **Cantidad:** hay 12 niveles. El nivel L+1 se alcanza con 50·L·(L+1) puntos.
- **Nombres:** Curioso, Aprendiz, Lector atento, Descifrador, Anagramista, Ilusionista de letras, Cruzadista, Enigmista, Arquitecto de pistas, Maestro críptico, Gran arcano y Leyenda del crucigrama.
- **Qué no hacen:** el tiempo nunca suma y los niveles no bloquean ningún contenido.
- **Ocultarlos:** se pueden ocultar en Ajustes.

## Récords personales

- **Qué se compara:** solo resoluciones **sin pistas** y dentro de la misma dificultad o del mismo mecanismo, porque condiciones distintas no son comparables. Hay un récord por dificultad y otro por mecanismo, sin filas duplicadas aunque haya empates.
- **Otros récords:**
  - Más aciertos seguidos.
  - Mejor racha de días.
  - Más resueltos en una sesión (partidas con menos de 30 minutos entre sí).
  - Mejor porcentaje semanal (mínimo 10 partidas cerradas).
  - Mecanismos resueltos.
- **Ámbitos:** todos los idiomas o uno en particular. Los récords de todos están en «Ranking».

## Objetivos (opcionales)

- **Tipos:**
  - Resolver N.
  - Completar N partidas.
  - Resolver N de un mecanismo.
  - Resolver N sin pistas.
  - Mediana por debajo de N segundos.
  - Jugar N partidas en un idioma.
- **Período:** por día, semana (lunes a domingo, UTC) o mes.
- **Edición:** se pueden editar y borrar. Hay un máximo de 10 por cuenta.
- **Progreso:** se calcula en el momento con las partidas del período. Si un período no se cumple, el siguiente empieza de cero, sin castigo.

## Calendario de actividad

- **Formato:** cuadrícula de semanas por días (UTC), como el de contribuciones de GitHub.
- **Período:** 6 meses, 1 año o 2 años.
- **Leyenda:** cinco intensidades según la cantidad de partidas del día.
- **Accesibilidad:** cada día tiene su etiqueta, y hay una lista de días con partidas como alternativa de texto.
- **Tono:** no muestra mensajes de culpa.

## Biblioteca

- **Secciones:** favoritos, «para reintentar», resueltos y colecciones propias (hasta 50, con 500 crípticos cada una). Se puede filtrar por idioma, dificultad y categoría.
- **Solo referencias:** la biblioteca guarda el id del críptico, no una copia. Si un críptico deja de estar publicado, se muestra «ya no está disponible».
- **Explicaciones:** solo se ven las de crípticos que la persona ya resolvió o reveló.

## Perfil público, compartir y rankings

**Perfil público** (`/es/u/<usuario>`)

- Está **apagado por defecto** y no se indexa.
- Cada dato se activa por separado: nivel, crípticos resueltos, rachas, idiomas, país e insignias elegidas una por una.
- Se puede elegir un nombre público y un avatar (letra y color propios).
- **Nunca se muestran:** correo, historial, respuestas, tiempos, pistas ni sesiones.

**Compartir un resultado** (`/es/r/<token>`)

- **Tarjeta:** muestra la pista, el resultado, la dificultad, el idioma y la marca. El tiempo y la respuesta aparecen solo si la persona los marca.
- **Imagen:** la tarjeta también se puede ver como imagen SVG en `/api/share/<token>.svg`.
- **Privacidad:** el enlace no incluye el nombre ni el id de la partida, y no da acceso al historial.
- **Dejar de compartir:** el enlace deja de funcionar.
- **Límite de uso:** 60 enlaces por hora por IP.
- **Limitación:** algunas redes sociales no muestran vistas previas en formato SVG.

**Rankings** (`/api/leaderboard`)

- Son **voluntarios**: aparecen solo las cuentas que lo activan. Jugar nunca lo requiere.
- **Tablas:**

| Tabla | Qué cuenta | Orden |
| --- | --- | --- |
| Diario sin ayudas | La primera partida del desafío de cada cuenta, resuelta sin pistas | Intentos, después tiempo |
| Diario con pistas | La primera partida del desafío, resuelta con pistas | Pistas, intentos y tiempo |
| Semanal | Crípticos distintos resueltos en la semana UTC, por idioma | Cantidad |

- **Validez:** las resoluciones de menos de 3 segundos no cuentan. Los reinicios no permiten mejorar la marca del diario, porque cuenta la primera partida. Se excluyen las cuentas suspendidas o eliminadas.

## Privacidad y borrado

- **Borrar la cuenta** (`DELETE /api/me/account`) elimina:
  - Logros, objetivos, la lista «para reintentar», colecciones y enlaces compartidos.
  - Favoritos, sesiones y avisos.
  - Las preferencias del perfil: público, nombre, avatar y rankings.
- **Después del borrado:** los identificadores de jugador quedan retirados.
- **Exportar** (`GET /api/me/export`): incluye los eventos de las partidas, el perfil, los logros, los objetivos y la biblioteca.

## Rendimiento

- **Índices:**
  - `games(player_id, status, finished_at)`
  - `games(player_id, clue_id)`
  - `games(daily_date, mode)`
  - `player_days(player_id, day)` (resumen diario que ya mantiene el seguimiento)
- **Agregados:** las rachas y el calendario se calculan con `player_days`, no recorriendo todas las partidas. La mediana se obtiene con `ORDER BY … LIMIT/OFFSET`.
- **Paginado:** el historial y la biblioteca se piden por página.
- **Prueba de carga:** con 3000 partidas, el resumen, el historial, la evolución, las fortalezas y los récords responden cada uno en menos de 3 segundos.

## API

Todo lo que empieza con `/api/me/` responde solo con los datos de la cuenta o del navegador.

| Método y ruta | Uso |
| --- | --- |
| `GET /api/me/profile` | Resumen, cuenta, nivel, logros recientes y `link_offer` |
| `GET /api/me/history` | Historial (`page`, `per`, filtros, `sort`) |
| `GET /api/me/games/:id` | Detalle de una partida |
| `POST /api/me/games/:id/share` | Crear o actualizar el enlace (`show_time`, `show_answer`) |
| `DELETE /api/me/games/:id/share` | Dejar de compartir |
| `GET /api/me/evolution` | Series y comparación (`days`, `from`, `to`, `unit`) |
| `GET /api/me/strengths` | Fortalezas por mecanismo |
| `GET /api/me/records` | Récords (`lang`) |
| `GET /api/me/calendar` | Días con partidas (`days`) |
| `GET /api/me/achievements` | Logros con condición, fecha y progreso |
| `GET /api/me/recommendations` | Recomendaciones (`choice`) |
| `POST /api/me/link-anonymous` | Sumar las partidas del navegador (`confirm: true`) |
| `PUT /api/me/profile` | Perfil público, nombre, avatar, qué compartir, preferencias y rankings |
| `GET`, `POST /api/me/goals` | Listar y crear objetivos |
| `PUT`, `DELETE /api/me/goals/:id` | Editar y borrar un objetivo |
| `GET /api/me/library` | Biblioteca (`tab`: `favorites`, `retry`, `solved` o `collection:<id>`) |
| `POST`, `DELETE /api/me/retry/:clueId` | Agregar o quitar de «para reintentar» |
| `GET`, `POST /api/me/collections` | Listar y crear colecciones |
| `PATCH`, `DELETE /api/me/collections/:id` | Renombrar y borrar una colección |
| `POST /api/me/collections/:id/items` | Agregar un críptico a una colección |
| `DELETE /api/me/collections/:id/items/:clueId` | Quitar un críptico de una colección |
| `GET /api/leaderboard` | Rankings (`board`: `clean`, `assisted` o `weekly`; `lang`, `date`) |
| `GET /api/u/:usuario` | Perfil público |
| `GET /api/share/:token` | Tarjeta compartida en JSON |
| `GET /api/share/:token.svg` | Tarjeta compartida como imagen |

## Código

| Archivo | Contenido |
| --- | --- |
| `src/db/migrations/003_profile.sql` | Tablas e índices del perfil (solo agrega, no reconstruye) |
| `src/services/profile.js` | Cálculos, reglas, logros y rankings |
| `src/routes/profile.js` | API |
| `src/views/profile-text.js` | Textos en español e inglés, incluidas las definiciones |
| `src/views/share-card.js` | Tarjeta SVG |
| `public/js/profile.js` | Interfaz: pestañas, gráficos, calendario e insignias |
| `src/routes/pages.js` | Páginas del perfil, del perfil público y del resultado compartido |
| `test/profile.test.js` | Pruebas del servidor |
| `test/e2e/browser.test.js` | Pruebas en navegador, escritorio y móvil |
