# Activación y retención de jugadores

Cambios de producto para que más visitantes empiecen a jugar, más jugadores creen cuenta y más vuelvan al día siguiente, y cómo medirlos. El diagnóstico completo, la estrategia y el plan de experimentos están en el documento del proyecto «Play Crípticos: activación y retención».

## Qué cambió (26/10/2026)

| Cambio | Antes | Ahora | Interruptor (Panel → Reglas) |
|---|---|---|---|
| Inicio directo | En «Jugar» y en el diario, la primera visita abría un diálogo de país e idioma y el críptico no aparecía hasta elegir. | Empieza enseguida con la sugerencia del navegador (por ejemplo, `es-AR` + Argentina). Un aviso arriba del críptico dice en qué variante juega y permite cambiarla. La sugerencia dura la sesión: no se recuerda en el navegador sin que la persona lo elija. | `growth.direct_start` |
| Invitación a crear cuenta | No existía en el juego. | Tarjeta debajo de «Otro críptico» cuando la persona sin cuenta resuelve su 3.er críptico de la sesión. Una vez por sesión; «Ahora no» la calla 14 días en ese navegador (o la sesión, si no eligió recordar preferencias). Lleva a `/es/cuenta?via=post_solve`, con el registro primero. | `growth.signup_prompt`, `growth.signup_prompt_after` |
| Siguiente paso al resolver | Solo «Otro críptico» y compartir. | Una sola tarjeta: si todavía no jugó el diario de hoy, «Te falta el desafío de hoy» (una vez por sesión). Al terminar el diario, «El próximo desafío llega a las HH:MM de tu hora (en X h Y min)». | `growth.next_step` |
| Medición | «Navegadores nuevos» sumaba en cada página vista sin preferencias; el equipo contaba en embudo y retención. | Solo la página de entrada; el equipo queda afuera. Contadores de invitaciones y errores de registro. | — |

Prioridad de la tarjeta: diario terminado → invitación a cuenta → diario pendiente. Nunca hay más de una ni ventanas emergentes.

Lo que promete la invitación es lo que el producto hace hoy: historial, rachas y logros guardados y visibles en cualquier dispositivo (las partidas previas de ese navegador se suman solo si la persona acepta en su perfil), torneo semanal y duelos (exigen cuenta). Solo pide usuario y contraseña; el correo es opcional.

## Cómo revertir

Cada cambio de interfaz se apaga desde el panel (`PUT /api/admin/settings/<clave>` con `false`) sin desplegar. `/api/meta` se cachea 60 segundos, así que el cambio llega en a lo sumo un minuto. La migración `018_growth.sql` solo agrega una tabla y una columna; no borra ni reescribe datos.

## Eventos de la interfaz (`ui_events_daily`)

Contadores por día y tipo, sin identificadores. El navegador los envía con `POST /api/ui-event` (no se envían con «No rastrear» ni GPC; tope de 300 por hora por IP con hash). Se borran con el mismo plazo que las visitas (`retention.traffic_days`).

| Tipo | Cuándo |
|---|---|
| `prefs_auto` | «Jugar» o el diario empezaron con la sugerencia del navegador. |
| `signup_prompt_shown` / `_click` / `_dismiss` | La invitación se mostró / tocaron «Crear cuenta gratis» / tocaron «Ahora no». |
| `daily_nudge_shown` / `_click` | El aviso del diario pendiente se mostró / lo abrieron. |
| `daily_next_shown` | Al terminar el diario se mostró cuándo llega el próximo. |
| `next_after_solve` | «Otro críptico» después de terminar uno (resuelto o revelado). |
| `signup_completed`, `signup_completed_post_solve` | Lo suma el servidor al crear la cuenta (desde la página de cuenta o desde la invitación). |
| `signup_error_<código>` | Lo suma el servidor cuando el registro falla (`weak_password`, `user_exists`, `accept_required`, `invalid_username`…). |

La columna `users.signup_via` guarda `post_solve` si la cuenta vino de la invitación. El panel muestra todo en «Embudo y retención → Invitaciones y siguientes pasos».

## Auditoría con datos reales

`scripts/audit-funnel.js` (workflow «Auditoría de embudo», manual) lee la base de producción **solo para leer** e imprime totales y proporciones: embudo recalculado sin el equipo, D1 por día UTC frente a D1 en hora local, retención por ventana 1–3 y 1–7 días, D1 según la primera experiencia, distribución de partidas, tiempo hasta la segunda sesión, modos, origen y errores. Nunca imprime identificadores ni datos personales. La hora local se aproxima por el país elegido (sin país: Argentina).

## Cómo leer los resultados

Con el tráfico actual no hay muestra para una prueba A/B fiable por visitante (el contador de visitas no tiene identificadores). Se compara antes y después con fechas documentadas, mirando:

- Inicio: jugadores nuevos ÷ visitantes nuevos, por día, comparando solo días posteriores al 26/10 (la definición de visitante cambió ese día).
- Registro: cuentas nuevas ÷ jugadores nuevos, y `signup_completed_post_solve ÷ signup_prompt_shown`.
- Retorno: D1 local y vuelta en 1–7 días de las cohortes antes y después, con al menos dos semanas por lado.
- Protección: partidas por jugador, tasa de resolución, «Otro críptico» después de resolver; si caen, se apaga el interruptor.
