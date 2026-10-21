# Despliegue en Vercel

La aplicación corre en Vercel como una función de Node (`api/index.js`) y guarda los datos en **Turso** (libSQL, compatible con SQLite). Vercel no tiene disco persistente, por eso la base no puede ser un archivo local en producción.

## 1. Crear la base en Turso

1. Crear una cuenta en <https://turso.tech> (tiene plan gratuito).
2. Con la CLI de Turso:
   ```bash
   turso db create cripta
   turso db show cripta --url          # → libsql://cripta-<usuario>.turso.io
   turso db tokens create cripta       # → token de acceso
   ```
   También se puede hacer desde el panel web de Turso. Conviene crear la base en la región más cercana a la de las funciones de Vercel.

## 2. Importar el repositorio en Vercel

1. En Vercel: **Add New → Project** e importar el repositorio de GitHub.
2. Framework preset: **Other**. No hace falta cambiar el comando de build ni la carpeta: `vercel.json` ya define `npm run vercel-build`.
3. Antes del primer despliegue, cargar las variables del paso 3.

## 3. Variables de entorno (Project → Settings → Environment Variables)

| Variable | Obligatoria | Valor |
| --- | --- | --- |
| `DATABASE_URL` | Sí | URL `libsql://…` de Turso |
| `DATABASE_AUTH_TOKEN` | Sí (Turso) | Token de `turso db tokens create` |
| `SITE_URL` | Sí | URL pública sin barra final, por ejemplo `https://cripta.app` |
| `IP_HASH_SALT` | Sí | Cadena aleatoria de 16+ caracteres |
| `CRON_SECRET` | Sí | Cadena aleatoria de 16+ caracteres; Vercel la envía al cron |
| `NODE_ENV` | Recomendada | `production` (Vercel ya la define) |
| `SITE_NAME` | No | Nombre visible (por defecto “Cripta”) |
| `EDITORIAL_NAME` | No | Firma del catálogo propio |
| `SOURCE_<NOMBRE>_TOKEN` | No | Credenciales de fuentes externas, una por fuente |

Para generar secretos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Ningún secreto va en el código ni en el repositorio. `.env` está en `.gitignore`.

## 4. Migraciones

En cada despliegue, `npm run vercel-build` ejecuta `scripts/db-setup.js`, que aplica las migraciones pendientes (`src/db/migrations/`), carga idiomas, licencias y ajustes por defecto, y agrega los crípticos del catálogo inicial que falten. Es idempotente: no borra ni duplica datos. En producción el servidor no migra al arrancar.

## 5. Crear el primer administrador

No hay usuario ni contraseña por defecto. Desde tu computadora, con las variables de Turso:

```bash
DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... npm run admin:create
```

El script pide usuario y contraseña (mínimo 10 caracteres, que no contenga el usuario ni sea una clave común). También acepta `ADMIN_USERNAME` y `ADMIN_PASSWORD` como variables para automatizarlo. Luego se entra en `https://<tu-dominio>/admin`.

## 6. Dominio y HTTPS

En Vercel: **Settings → Domains → Add**, seguir las indicaciones de DNS (registro A o CNAME). Vercel emite y renueva el certificado HTTPS solo. Después actualizar `SITE_URL` al dominio final y volver a desplegar, para que sitemap, canónicas y hreflang usen esa dirección.

## 7. Tareas programadas

`vercel.json` define un cron que llama a `/api/cron/tick` con `Authorization: Bearer $CRON_SECRET`. Cada llamada ejecuta las tareas vencidas (importar fuentes, crear el desafío diario, generar candidatos, limpieza y recuperación de ejecuciones colgadas), con bloqueo para que no se pisen.

- **Plan Hobby**: Vercel solo permite crons diarios, por eso el horario es `0 6 * * *` (06:00 UTC). El desafío diario igual se crea solo cuando alguien lo pide, así que no depende del cron.
- **Más frecuencia**: en plan Pro cambiar el horario a, por ejemplo, `*/15 * * * *`. O usar un servicio externo (cron-job.org, GitHub Actions) que llame cada 15 minutos a:
  ```bash
  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<tu-dominio>/api/cron/tick
  ```

## 8. Copias de seguridad

- Turso guarda historial y permite restaurar a un momento anterior según el plan (ver `turso db create --from-db ... --timestamp`).
- Copia manual en un archivo SQL:
  ```bash
  turso db shell cripta .dump > backup-$(date +%F).sql
  ```
  Conviene programarla (por ejemplo semanal) y guardar las copias fuera de Turso.
- Para restaurar en una base nueva: `turso db create cripta-restaurada` y `turso db shell cripta-restaurada < backup.sql`.

## 9. Registros y monitoreo

- Errores del servidor: **Vercel → Project → Logs** (y la tabla `error_log`, visible en el tablero del panel).
- Ejecuciones de tareas e importaciones: panel → *Tareas* e *Importaciones*.
- Acciones de administración: panel → *Auditoría*.

## 10. Actualizaciones

Cada push a la rama principal despliega una versión nueva; los pull requests generan vistas previas. Para cambiar el esquema, agregar un archivo nuevo en `src/db/migrations/` con número siguiente (`002_...sql`); nunca editar uno ya aplicado. Antes de desplegar: `npm test` y `npm run test:e2e`.

Importante: las vistas previas usan las mismas variables que se configuren para el entorno *Preview*. Para no tocar los datos reales, usar otra base de Turso en *Preview*.

## Servidor propio (alternativa)

También funciona en cualquier servidor con Node 20+: `npm ci && npm run db:setup && npm start`, con `INTERNAL_SCHEDULER=1` para que las tareas corran sin cron externo, detrás de un proxy con HTTPS (Nginx, Caddy). Con un archivo local (`DATABASE_URL=file:./data/criptico.db`) hay que respaldar ese archivo.
