# Centro de control (panel de administración)

El panel vive en `/admin`. Toda cifra sale de la base de datos: si no hay datos, el panel muestra «Sin información» y nunca rellena con valores inventados. Cada permiso se comprueba en el servidor, en cada ruta, independientemente de lo que muestre la interfaz.

## Secciones

| Sección | Ruta | Qué muestra |
|---|---|---|
| Resumen | `#dashboard` | Indicadores del período con comparación contra el período anterior de igual duración, evolución diaria (u horaria en «Hoy» y «24 h»), idiomas, países y variantes, estado de tareas e importaciones, alertas abiertas. Los roles sin `analytics.read` ven solo sus tareas pendientes. |
| Alertas | `#alerts` | Alertas por gravedad y estado; marcar como vista, resolver, reabrir, revisar ahora. |
| Regiones e idiomas | `#geo` | Países elegidos, idiomas y variantes jugados, preferencia de las cuentas y evolución de los cinco países principales. |
| Embudo y retención | `#funnel` | Embudo de ocho pasos, D1/D7/D30, sesiones y cohortes semanales, por identificador de jugador o solo por cuentas registradas. |
| Rendimiento de crípticos | `#cluestats` | Resolución, abandono, revelado, tiempos y pistas por críptico, con siete órdenes y la marca «Revisar». |
| Exportaciones | `#exports` | Nueve informes CSV según el rol. |
| Usuarios | `#players`, `#player/:id` | Tabla con búsqueda, filtros, orden, paginación en el servidor y elección de columnas. La ficha tiene seis pestañas: resumen, historial de partidas, rendimiento, contribuciones, actividad reciente e historial administrativo. |
| Partidas | `#games`, `#game/:id` | Búsqueda por id, jugador, críptico, estado, modo, idioma, variante, país, fechas y tipo de cuenta. El detalle incluye la línea de eventos. |
| Privacidad | `#privacy` | Solicitudes de acceso, corrección y eliminación. |
| Estadísticas del catálogo | `#catstats` | Crípticos por estado, origen, idioma, variante, dificultad y mecanismo. |
| Estado de fuentes | `#importstats` | Resultado de cada fuente externa: publicados solos o a mano, en revisión, duplicados, descartados, errores y fallos seguidos. |

Las secciones anteriores siguen funcionando igual: catálogo, nuevo críptico, generados, reportes, duplicados, fuentes, elementos importados, sincronizaciones, moderación de propuestas, idiomas, reglas, equipo, tareas y auditoría.

## Definiciones de los indicadores

Todas las fechas se calculan en UTC. Los períodos disponibles son: hoy, últimas 24 h, 7, 30 y 90 días, este mes, mes anterior y personalizado (hasta tres años). El período de comparación tiene la misma duración y termina donde empieza el elegido.

| Indicador | Definición |
|---|---|
| Usuarios registrados | Cuentas de jugador creadas hasta el fin del período, sin contar las eliminadas. |
| Nuevos registros | Cuentas de jugador creadas dentro del período. |
| Jugadores activos | Identificadores de jugador distintos con al menos una partida iniciada en el período. Un identificador corresponde a un navegador, no a una persona. |
| Registrados que jugaron | Cuentas distintas que jugaron en el período. |
| DAU / WAU / MAU | Identificadores distintos con partidas en las últimas 24 h, 7 o 30 días hasta el fin del período (o hasta ahora, si el período no terminó). |
| Visitas / visitantes nuevos | Contadores agregados por día, idioma de interfaz y país elegido, sin ningún identificador. No se cuentan los navegadores con «Do Not Track» o «Global Privacy Control». «Visitantes nuevos» suma una vez por **página de entrada** (llegada desde afuera del sitio o escribiendo la dirección) de un navegador sin preferencias guardadas. Hasta el 26/10/2026 sumaba en **cada página vista** sin preferencias, por eso los datos anteriores están inflados. |
| Iniciadas | Partidas en las que se mostró un críptico. |
| Completadas | Resueltas más reveladas. |
| Resueltas correctamente | Terminadas con la respuesta correcta y sin revelar. |
| Tasa de resolución | Resueltas ÷ iniciadas. |
| Tasa de abandono | Abandonadas ÷ partidas cerradas. No incluye las que siguen en curso. |
| Tiempo medio / mediana hasta resolver | Tiempo entre el inicio y la respuesta correcta en las partidas resueltas. |
| Mediana de tiempo activo | Tiempo activo estimado de las partidas resueltas (ver más abajo). |
| Pistas por partida | Pistas pedidas ÷ partidas iniciadas. |
| Errores técnicos | Filas de `error_log` en el período. |
| Importados automáticamente | Elementos externos con estado `auto_published` en el período. |

Las variaciones se muestran en % para cantidades y en puntos para tasas. Si el período anterior no tiene datos, no se muestra comparación.

### Estados de una partida

| Estado | Cuándo |
|---|---|
| `started` (iniciada) | Se mostró el críptico. |
| `in_progress` (en curso) | Hubo al menos un intento o una pista. |
| `solved` (completada correctamente) | Respuesta correcta. |
| `revealed` (completada tras revelar) | La persona pidió ver la respuesta. |
| `abandoned` (abandonada) | Pasó a otro críptico (`end_reason = skipped`) o no hubo actividad durante `analytics.abandon_minutes` (30 por defecto, `end_reason = inactivity`). |
| `expired` (expirada) | Se agotó el tiempo del modo contrarreloj. |
| `error` (interrumpida por error) | Quedó inactiva después de un error del servidor (`end_reason = server_error`). |

Cerrar la pestaña no abandona la partida en el acto. La clasificación por inactividad la hacen la tarea `analytics_rollup` y el propio panel cuando recalcula. Si la persona vuelve a una partida marcada como abandonada por inactividad, la partida se reanuda (evento `resume`).

### Medidas de tiempo

- **Transcurrido**: desde el inicio hasta el cierre o, si sigue abierta, hasta la última actividad.
- **Activo estimado**: suma de los intervalos entre acciones, con cada intervalo limitado a `analytics.active_gap_seconds` (120 s). El navegador envía una señal cada 30 s solo si la pestaña está visible y hubo uso en el último minuto, así que una pausa larga no cuenta como juego.
- **Hasta resolver**: el transcurrido de una partida resuelta.
- **Hasta abandonar**: el transcurrido de una partida abandonada.

### Sin duplicados

Repetir la misma respuesta incorrecta se registra como `guess_repeat` y no suma intentos. Cada pista lleva su número de nivel, así que un doble clic o un reintento de red no cuenta dos veces. Una partida cerrada no puede volver a cerrarse: el cierre es una actualización condicionada a `finished_at IS NULL`.

### Embudo

Cuenta los identificadores de jugador creados en el período (sin los de cuentas del equipo, desde el 26/10/2026) y, para cada paso, cuántos lo alcanzaron alguna vez: iniciaron, respondieron, pidieron pista, completaron, jugaron otro, volvieron otro día y crearon cuenta. Cada paso se mide sobre quienes iniciaron, porque los pasos no ocurren necesariamente en orden. El primer paso, «navegadores nuevos», sale del contador agregado de visitas y no está ligado a identificadores.

### Retención

Una cohorte es la semana (empezando el lunes) del primer día con partidas. Los días son **UTC**: para quien juega en América, la medianoche UTC cae a la tarde o la noche (21:00 en Argentina), así que una sola sesión que cruza esa hora cuenta como «volvió al día siguiente». `scripts/audit-funnel.js` compara D1 UTC con D1 en hora local (ver docs/CRECIMIENTO-PRODUCTO.md). Las cuentas del equipo no cuentan (desde el 26/10/2026). D1 es la proporción que volvió a jugar al día siguiente, D7 la que volvió dentro de los 7 días y D30 dentro de los 30. Cada valor considera solo a quienes ya cumplieron esa ventana; las ventanas que aún no se cumplieron se muestran con «—». Con la unidad «identificadores de jugador», una persona sin cuenta en dos dispositivos cuenta dos veces. La unidad «cuentas registradas» representa personas identificadas.

Una **sesión** agrupa las partidas de la misma unidad separadas por menos de 30 minutos.

### Rendimiento de crípticos y la marca «Revisar»

Un críptico se marca para revisión cuando:

- tiene al menos `alerts.clue_wrong_answer_reports` reportes abiertos de respuesta o explicación incorrecta, o
- tiene al menos `alerts.clue_min_plays` partidas y una resolución menor a `alerts.clue_solve_rate_min` %.

La marca solo pide que alguien mire la respuesta y la explicación. Nada se retira ni se modifica automáticamente, porque un críptico difícil no está necesariamente mal.

## Alertas

La tarea `alerts_scan` corre cada hora y también se puede lanzar con «Revisar ahora». Todos los umbrales son ajustes `alerts.*` en «Reglas y funciones».

| Regla | Ajuste |
|---|---|
| Errores técnicos por hora | `alerts.errors_per_hour` (20) |
| Fallos de base de datos en 24 h | cualquiera |
| Tareas con 2 o más fallos seguidos | — |
| Fuentes que no responden | `alerts.source_failures` (3) |
| Caída de la resolución (7 días contra los 28 anteriores) | `alerts.solve_rate_drop_points` (15), con muestra mínima `alerts.min_sample` (20) |
| Aumento de abandonos | `alerts.abandon_rate_rise_points` (15), misma muestra mínima |
| Crípticos sospechosos | ver «Revisar» |
| Propuestas acumuladas o antiguas | `alerts.pending_submissions_max` (25), `alerts.pending_submission_days` (7) |
| Intentos fallidos de acceso al panel por hora | `alerts.failed_admin_logins_per_hour` (10) |

Si una condición persiste, la misma alerta se actualiza (`dedupe_key`) en lugar de duplicarse. Una alerta resuelta se reabre si la condición vuelve a darse más de un día después. Las alertas de errores, base de datos, seguridad, resolución y abandono que no se repiten en 7 días se cierran solas.

## Roles y permisos

| Permiso | Superadministrador (`owner`) | Administrador de contenido (`editor`) | Moderador (`moderator`) | Analista (`analyst`) |
|---|:-:|:-:|:-:|:-:|
| Estadísticas (`analytics.read`) | ✓ | ✓ | | ✓ |
| Fichas de usuario y partidas (`players.read`, `games.read`) | ✓ | | | ✓ |
| Correos electrónicos (`players.pii`) | ✓ | | | |
| Suspender o reactivar cuentas (`players.manage`) | ✓ | | | |
| Privacidad y anonimizar (`privacy.manage`) | ✓ | | | |
| Ver alertas / gestionarlas | ✓ / ✓ | ✓ / | | ✓ / |
| Exportar (`export.data`) / con correos (`export.pii`) | ✓ / ✓ | ✓ / | | ✓ / |
| Catálogo, fuentes, importaciones | ✓ | ✓ | lectura del catálogo | lectura del catálogo |
| Moderar propuestas | ✓ | | ✓ | |
| Errores informados por jugadores | ✓ | ✓ | ✓ | |
| Equipo, reglas, auditoría | ✓ | | | |

Además:

- La auditoría (`audit_log`) es de solo agregado. Un disparador de la base rechaza cualquier `UPDATE`, y solo la limpieza por antigüedad puede borrar filas.
- Ningún rol ve contraseñas, tokens ni sesiones, porque las respuestas del servidor no los incluyen.
- Las cuentas del equipo no se anonimizan desde «Usuarios»: se desactivan desde «Equipo».

## Privacidad y conservación de datos

- **IP**: nunca se guarda completa. Las sesiones guardan un hash con sal (`IP_HASH_SALT`), que se borra a los 30 días.
- **Ubicación**: no se infiere. País e idioma son siempre los elegidos por la persona, y el panel los presenta como datos distintos.
- **Accesos registrados**: ver una ficha con correo queda en la auditoría (`user.view_pii`). Cada exportación también, con filas, filtros y si incluyó datos personales.
- **Derechos de la persona**: desde su perfil puede descargar sus datos (`GET /api/me/export`) y pedir correcciones. Si borra la cuenta, se anonimiza en el acto.
- **Anonimización**: usuario `eliminado-xxxxxxxx`, sin correo, nombre, contraseña, país ni preferencias. Se cierran las sesiones, se borran favoritos y notificaciones, y se quita el nombre de autor de sus propuestas. Las partidas quedan solo con su identificador seudónimo, por eso las estadísticas agregadas no cambian.
- **Conservación**:

| Dato | Ajuste | Por defecto |
|---|---|---|
| Partidas | `retention.games_days` | 400 días |
| Eventos de partida | `retention.game_events_days` | 180 días |
| Visitas agregadas | `retention.traffic_days` | 730 días |
| Auditoría | `retention.audit_days` | 730 días |
| Alertas resueltas | — | 180 días |

La tarea `cleanup` las aplica.
- **CSV**: las celdas que empiezan con `= + - @` se protegen contra fórmulas de hoja de cálculo.

## Modelo de datos (migración `002_panel.sql`)

- `users`: rol `analyst` y columnas `timezone`, `email_verified_at`, `last_active_at` y `deleted_at`.
- `games`: columnas `status`, `end_reason`, `last_activity_at`, `active_ms`, `wrong_attempts`, `last_wrong_key` y `error_count`. Los datos anteriores se completan al migrar.
- `game_events`: un evento por hecho relevante. Los tipos son `start`, `resume`, `guess_wrong`, `guess_repeat`, `guess_correct`, `hint`, `reveal`, `skip`, `timeout`, `abandon`, `error` y `restart`.
- `player_days`: días con actividad por identificador, para retención y embudo.
- `stats_daily`: resumen por día, idioma, país, variante y modo. Lo recalcula `analytics_rollup` cada hora, y también el panel si el último cálculo tiene más de 10 minutos; «Recalcular ahora» lo fuerza.
- `traffic_daily`: visitas agregadas, sin identificadores.
- `alerts` y `data_requests`.
- Índices nuevos sobre fechas, estados y claves de filtro.

La migración corre sola al iniciar: no hay que ejecutar nada a mano.

## API (todas bajo `/api/admin`, con sesión de equipo y token CSRF en escrituras)

- `GET /panel/meta`
- `GET /analytics/overview|geo|funnel|retention|clues|catalog|imports`
- `POST /analytics/refresh`
- `GET /players`, `GET /players/:id`, `GET /players/:id/games|performance|contributions|timeline|admin-history`
- `POST /players/:id/suspend|reactivate|anonymize` (anonimizar exige `{ "confirm": "ELIMINAR" }`)
- `GET /games`, `GET /games/:id`
- `GET /alerts`, `POST /alerts/scan`, `POST /alerts/:id`
- `GET /privacy/requests`, `POST /privacy/requests/:id`
- `GET /export/:informe.csv`, donde el informe es `users`, `games`, `daily`, `countries`, `languages`, `clues`, `retention`, `imports` o `submissions`

Los listados paginan en el servidor (`page`, `per` hasta 100). Los filtros comunes son `period`, `from`, `to`, `country`, `lang` y `variant`.

## Variables de entorno

No hay variables nuevas. El panel usa las existentes:

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Base de datos. |
| `DATABASE_AUTH_TOKEN` | Credencial de Turso. |
| `IP_HASH_SALT` | Sal del hash de IP. |
| `SITE_URL` | Dirección pública del sitio. |
| `SITE_NAME` | Nombre del sitio. |
| `CRON_SECRET` | Protege el llamado de las tareas programadas. |

## Despliegue

1. Subir a `main`; Vercel despliega solo.
2. La migración `002` se aplica al primer arranque.
3. Para crear un analista u otro integrante: «Equipo» → Agregar integrante, o la acción de GitHub «Crear administrador».

En el plan Hobby de Vercel el cron corre una vez por día. Por eso el panel recalcula los resúmenes y clasifica las partidas inactivas al abrirse, si el último cálculo tiene más de 10 minutos. Las alertas por hora dependen de que alguien abra el panel o pulse «Revisar ahora», salvo que el plan permita un cron más frecuente.

## Qué depende de servicios o credenciales externas

- **Verificación de correo**: la columna existe y el panel la muestra, pero enviar el correo de verificación requiere un proveedor de correo, que no está configurado. Hasta entonces, todas las cuentas figuran como «no verificado».
- **Copias de seguridad**: las gestiona Turso, y el panel no tiene acceso a su estado.
- **Alertas cada hora y limpieza frecuente**: necesitan un cron más frecuente (plan de pago de Vercel o un cron externo que llame `/api/cron/tick` con `CRON_SECRET`).
- **Dominio y `SITE_URL`**: se configuran en Vercel.
- **Fuentes externas**: cada fuente necesita su propia autorización y licencia. Si usa credencial, va en una variable de entorno con el nombre que indique la fuente.

## Pruebas

- `npm test`: 64 pruebas, incluidas las 13 de `test/panel.test.js`, que cubren los puntos 1 a 17, 19 y 20 de la lista pedida.
- `npm run test:e2e`: 12 pruebas en Chromium. El punto 18 recorre todas las secciones del panel en escritorio (1440 px) y en móvil (375 px), sin errores ni desbordes. Otra prueba verifica que el analista no ve correos ni acciones.
