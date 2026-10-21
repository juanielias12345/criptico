# Play Crípticos — crípticos ilimitados

Plataforma web para jugar crípticos (pistas de palabras cruzadas crípticas) sin límite, en español e inglés, con variantes regionales (es-AR, es-ES, es-MX, en-GB, en-US) y preparada para sumar francés, portugués, italiano y alemán.

El nombre visible se cambia con la variable `SITE_NAME`.

## Qué incluye

- **Juego**: partida rápida e infinita, diario opcional, archivo, modos principiante/intermedio/experto/guiado/con tiempo/temático/práctica/racha y enlace compartido (cada modo se activa o desactiva desde el panel). Validación tolerante a tildes y mayúsculas (la Ñ se distingue de la N), pistas progresivas, revelar, explicación paso a paso generada desde el juego de palabras, siguiente, reiniciar, compartir sin revelar la respuesta y reportar errores.
- **País e idioma independientes**, con buscador, detección del navegador y recuerdo solo con consentimiento.
- **Catálogo propio verificado** (`seed/`), generador por reglas que propone cripticos y los deja en revisión, importación desde fuentes autorizadas y propuestas de la comunidad.
- **Dos circuitos de publicación separados**:
  - Fuentes externas: se publican solas solo si cumplen las 10 condiciones (fuente activa y aprobada, licencia que permite republicar, método autorizado, atribución, sin errores críticos, validación superada, idioma y formato, sin duplicados, procedencia verificable, sin contenido inseguro). Si falla una, va a la cola de revisión.
  - Propuestas de usuarios: **siempre** requieren aprobación manual de un moderador o propietario. La base de datos lo impone con disparadores; no existe ningún camino por reputación.
- **Panel de administración** (`/admin`): tablero, catálogo, generados, propuestas, fuentes, importaciones, reportes, duplicados, idiomas, ajustes, usuarios y roles, tareas y auditoría.
- **Cuentas opcionales**, estadísticas, logros, favoritos y notificaciones.
- **SEO**: sitemap, robots, hreflang, canónicas y datos estructurados.
- **Seguridad**: validación en servidor, SQL parametrizado, sesiones con token aleatorio, CSRF, control de origen, límites por IP con hash, bloqueo por intentos fallidos, cabeceras CSP, secretos solo por variables de entorno y sin contraseñas por defecto.

## Requisitos

Node.js 20 o superior (probado con Node 22).

## Uso local

```bash
npm install
cp .env.example .env           # completar DATABASE_URL=file:./data/criptico.db
npm run db:setup               # crea tablas, idiomas, licencias y catálogo inicial
npm run admin:create           # crea el primer administrador (pide usuario y contraseña)
npm run dev                    # http://localhost:3000
```

En desarrollo no hacen falta `IP_HASH_SALT` ni `CRON_SECRET`; en producción son obligatorias y el servidor no arranca sin ellas.

## Pruebas

```bash
npm test          # 50 pruebas: validador, juego, propuestas, importaciones, seguridad, base y tareas
npm run test:e2e  # 7 pruebas en Chromium: preferencias, juego, móvil, propuesta y aprobación
```

Las pruebas de navegador usan `playwright-core` con un Chromium ya instalado (`CHROMIUM_PATH` si no está en `/opt/pw-browsers/chromium`). Detalle en [docs/PRUEBAS.md](docs/PRUEBAS.md).

## Documentación

- [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md): publicar en Vercel con Turso, variables, dominio, cron, copias de seguridad y actualizaciones.
- [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md): estructura del código y del modelo de datos.
- [docs/CRIPTICOS.md](docs/CRIPTICOS.md): formato del juego de palabras y cómo se valida.
- [docs/FUENTES.md](docs/FUENTES.md): cómo conectar una fuente externa autorizada.
- [docs/LEGAL.md](docs/LEGAL.md): derechos, licencias y textos legales.
