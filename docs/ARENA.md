# Duelos, torneos y amigos

Página: `/es/desafios` («Duelos y torneos» en el menú). Jugar exige una cuenta gratis; ver un torneo o un desafío, no.

## Puntaje (igual en duelos y torneos)

| Situación | Puntos |
| --- | --- |
| Resolver | 100, menos 20 por pista y 10 por cada intento errado (mínimo 20) |
| Velocidad | Hasta 100 más: completo si se resuelve en 10 s o menos, baja en línea recta y llega a 0 a los 3 min |
| Revelar, abandonar o vencer | 0 |

Máximo por críptico: 200. El tiempo lo mide el servidor desde que entrega el críptico (el navegador no manda tiempos). Menos de 3 s no suma velocidad (posible respuesta copiada). Una ronda empezada no se puede reiniciar y el reloj sigue aunque se cierre la pestaña.

## Torneo semanal

- Se arma solo el lunes (UTC) la primera vez que alguien entra: 7 crípticos generales en español, dificultades 2, 2, 3, 3, 3, 4, 4, prefiriendo los escritos por el equipo o ya auditados.
- **Inscripción obligatoria** con cuenta, gratis. Al inscribirse, el nombre público (o el usuario) y los puntos aparecen en el ranking público del torneo (`/es/torneos/<slug>`).
- Cada día se abre una ronda a las 00:00 UTC (21 h de Argentina). Se puede jugar ese día y el siguiente, sin pasar del domingo. Así la gente vuelve cada día.
- Ranking: más puntos; si empatan, menos tiempo total en los resueltos; si siguen empatados, quien se inscribió antes.
- La portada del hub muestra el podio de la semana anterior.

## Duelos 1 contra 1

- Se desafía por usuario, a un amigo de la lista (con punto verde si estuvo activo en los últimos 10 min) o con un **enlace abierto** que toma la primera persona con cuenta que lo acepte.
- 3 o 5 crípticos, dificultad mixta o fija. Los dos juegan los mismos, en orden, cada uno cuando puede.
- Quien desafía puede jugar enseguida; quien recibe, después de aceptar. Mientras el duelo sigue, nadie ve los puntos del rival (solo cuántas rondas jugó).
- Vence a las 72 h: las rondas sin jugar valen 0. Si nadie aceptó, vence sin ganador.
- Gana quien suma más; con los mismos puntos, quien tardó menos; si no, empate. Hay revancha con un toque.
- Límite: 30 duelos por cuenta por día.

## Amigos

Solicitud por usuario o con el enlace `/es/desafios?amigo=<usuario>`. Si los dos se piden mutuamente, quedan amigos. Límite: 40 solicitudes por día.

## Compartir

Botones para compartir con el menú del teléfono, WhatsApp o copiar el enlace: el desafío abierto, cómo vas en el torneo («Voy 3° con 640 puntos…») y el resultado de un duelo.

## Cuidado de la cuota de Turso

- Los totales se guardan ya sumados (`tournament_entries`, `duels`): un ranking lee como mucho 50 filas por índice y el puesto propio es un `COUNT` por índice.
- No hay tareas programadas nuevas. El torneo se crea al primer pedido de la semana y los duelos vencidos se cierran al mirarlos.
- La pantalla de un duelo en curso se actualiza cada 20 s solo con la pestaña visible.

## Datos

Tablas en `src/db/migrations/014_arena.sql`: `friendships`, `duels`, `tournaments`, `tournament_entries`, `arena_games` (cada ronda apunta a su partida en `games`, con modo `duel` o `tournament`). Al eliminar una cuenta se borran sus amistades y sus inscripciones, y se cancelan sus duelos abiertos.

## API

| Ruta | Para qué |
| --- | --- |
| `GET /api/tournaments` | Torneo de la semana (y podio de la anterior) |
| `GET /api/tournaments/:slug` | Un torneo con ranking (50) y rondas propias |
| `POST /api/tournaments/:id/register` | Inscribirse |
| `POST /api/tournaments/:id/rounds/:n/start` | Empezar o retomar la ronda `n` (0 a 6) |
| `GET/POST /api/duels` | Mis duelos y récord / crear (`opponent`, `rounds`, `difficulty`) |
| `GET /api/duels/:id-o-token` | Ver un duelo |
| `POST /api/duels/:id/accept`, `/decline`, `/rematch` | Responder, cancelar o pedir revancha |
| `POST /api/duels/:id/rounds/:n/start` | Empezar o retomar una ronda |
| `GET/POST /api/friends`, `POST /api/friends/:u/accept`, `DELETE /api/friends/:u` | Amigos |
| `GET /api/arena/pending` | Rondas y duelos que esperan a la persona |

Después de empezar una ronda se juega con las rutas normales: `/api/game/:id/guess`, `/hint` y `/reveal`.
