# Arquitectura

## Tecnología

- **Node.js + Express 5**, sin paso de compilación. Las páginas públicas se renderizan en el servidor (buenas para SEO) y un script liviano (`public/js/app.js`) agrega la interacción.
- **libSQL** (`@libsql/client`): archivo SQLite en local y en pruebas, Turso en producción. Todas las consultas son parametrizadas.
- **Vercel**: `api/index.js` exporta la app; `vercel.json` redirige todo a esa función salvo los archivos estáticos de `public/`.

## Carpetas

```
api/index.js              entrada para Vercel
src/
  app.js                  cabeceras de seguridad, CSRF, origen, errores
  bootstrap.js, server.js arranque (Vercel / servidor propio)
  config.js               variables de entorno; en producción exige las obligatorias
  i18n.js                 rutas y textos por idioma de interfaz
  db/                     conexión, migraciones SQL y datos de referencia
  lib/
    normalize.js          normalización de respuestas (tildes, Ñ, enumeraciones)
    lang/es.js, en.js     abreviaturas, indicadores, fonética y variantes regionales
    validator/            resolución del juego de palabras y explicación automática
    generator/            generador de crípticos por reglas (propone y deja en revisión)
    bank/                 generador del banco: léxico, superficies y evidencia (solo lotes, nunca partidas)
    lexicon.js            listas de palabras (MIT) para comprobar respuestas
  services/               lógica: juego, catálogo, propuestas, importación, auth, tareas…
  routes/                 páginas, API pública y API del panel
  views/                  plantillas HTML y textos de ayuda/privacidad/condiciones
public/                   CSS, JS, panel (admin.html), íconos y manifiesto
scripts/                  db-setup, create-admin, bank.js (lotes) y lexicon/build.py (arma el léxico)
data/lexicon/             léxicos comprimidos por idioma y sus licencias
seed/                     catálogo propio verificado (ES y EN)
test/                     pruebas con node:test; test/e2e en Chromium
```

## Datos

Tablas principales (ver `src/db/migrations/001_init.sql`; las del centro de control — eventos de partida, resúmenes diarios, visitas agregadas, alertas y solicitudes de datos — están en `002_panel.sql` y se describen en [PANEL.md](PANEL.md)):

- `languages`, `language_variants`: idiomas y variantes; fr/pt/it/de ya existen desactivados.
- `clues`: el catálogo. `origin` indica de dónde viene (`original`, `generated`, `external`, `community`) y `status` su estado (`draft`, `review`, `published`, `disabled`, `archived`). Cada cambio queda en `clue_events`.
- `submissions` y `submission_events`: propuestas de usuarios con su historial (`pending`, `in_review`, `needs_changes`, `approved`, `published`, `rejected`).
- `sources`, `licenses`, `import_runs`, `import_items`: fuentes externas, licencias y cada elemento importado con las condiciones evaluadas.
- `games`, `daily_challenges`, `favorites`, `notifications`, `players`, `users`, `sessions`.
- `bank_targets`, `generation_batches`, `clue_audits`: metas por idioma y dificultad, lotes reanudables y auditoría por muestra (ver [BANCO.md](BANCO.md), migración `004_bank.sql`).
- `settings`, `audit_log`, `jobs`, `job_runs`, `error_log`, `rate_limits`, `duplicate_flags`, `clue_reports`.

## Reglas que impone la base

Además de la lógica de la aplicación, disparadores en SQLite impiden:

- publicar un críptico con errores de validación o sin validar;
- publicar uno de la comunidad si su propuesta no fue aprobada por un moderador o propietario;
- publicar uno externo si la fuente no está aprobada, no permite republicar o su licencia no lo permite;
- publicar uno solo de referencia o con permiso sin verificar, o de una fuente con revisión legal rechazada o permiso vencido.

Así, ni un error de programación ni una edición directa pueden saltarse los dos circuitos de publicación.

## Selección de crípticos

`services/game.js` elige un críptico publicado del idioma y la variante elegidos (los de la variante primero, luego los generales del idioma), evita los últimos jugados por ese jugador (`game.recent_window`) y, si se agotan, avisa y recicla. Con catálogos grandes sortea por una clave aleatoria fija (`clues.shuffle`) con índice, sin recorrer la tabla. El país es independiente: solo personaliza avisos y estadísticas, no cambia el idioma.

## Sesiones y seguridad

- Cookie `sid` con token aleatorio; en la base solo se guarda su hash SHA-256. `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- Todas las escrituras exigen JSON, la cabecera `x-csrf-token` y, si hay `Origin`, que sea el mismo sitio.
- Contraseñas con scrypt; bloqueo de 15 minutos tras 5 intentos fallidos.
- Las IP se guardan como hash con sal (`IP_HASH_SALT`).
- Límites de uso por IP guardados en la base (sirven entre instancias de Vercel).
- CSP sin scripts ni estilos en línea.

## Tareas

`services/jobs.js` define tareas con intervalo y bloqueo por arrendamiento (`jobs.locked_until`). `tick()` corre las vencidas; lo llama Vercel Cron o, en servidor propio, un temporizador interno. `recover_stuck` libera bloqueos vencidos y marca ejecuciones colgadas.

## Perfil personal

Servicio `src/services/profile.js`, API `src/routes/profile.js` (montada antes de `routes/api`), migración `003_profile.sql` y la interfaz `public/js/profile.js`, que se carga solo en «Mi perfil». La resolución del jugador de cada pedido (`resolvePlayer` en `src/app.js`) decide qué identificador usa la API y nunca une partidas anónimas sin permiso. Detalle en [PERFIL.md](PERFIL.md).
