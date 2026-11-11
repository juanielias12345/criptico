# Monetización con Google AdSense

Decisión de juan (26/10/2026): el sitio se monetiza con Google AdSense. Jugar, los duelos y los torneos siguen siendo gratis.

## Qué hace el código

- **Nada sin configurar.** Sin la variable `ADSENSE_CLIENT` (ID de editor `ca-pub-…`) no se carga nada de Google.
- **Verificación del sitio.** Con `ADSENSE_CLIENT`, todas las páginas llevan la etiqueta `google-adsense-account` y se sirve `/ads.txt` (`google.com, pub-…, DIRECT, f08c47fec0942fa0`). Así AdSense puede revisar y aprobar el sitio.
- **Anuncios solo con la política publicada.** El script de anuncios se carga recién cuando el ajuste `ads.enabled` está encendido. Se enciende solo cuando un CEO aprueba y publica la nueva **Política de privacidad** y la nueva **Política de cookies** (revisión `anuncios-2026-10-26`, que se carga como borrador en el panel al desplegar). Explican AdSense, sus cookies, el consentimiento en Europa y la opción de excluirse.
- **Dónde.** Solo en páginas con contenido editorial: inicio, explorar, cada críptico indexable, cómo jugar, mecanismos, preguntas frecuentes y artículos. Nunca en las pantallas de juego (jugar, diario, duelos, torneos), el panel, HQ, la cuenta, el perfil, los legales, quiénes somos, contacto, las páginas de error ni ninguna página con `noindex` (ver `AD_PAGES` en `src/services/ads.js`).
- **Anuncios automáticos.** Google elige dónde ubicarlos. Si además se define `ADSENSE_SLOT` (un bloque «display» adaptable), se muestra un bloque fijo marcado «Publicidad» al pie del contenido.
- **Privacidad.** Si el navegador envía «Do Not Track» o «Global Privacy Control», se piden anuncios no personalizados.
- **Seguridad.** Las páginas con anuncios usan la política de seguridad que recomienda Google (scripts con nonce y `strict-dynamic`). El resto del sitio mantiene la política estricta de siempre.
- **Cuota de la base.** El ajuste se lee como mucho una vez cada 5 minutos por instancia.

## Pasos de juan

1. Crear la cuenta en https://adsense.google.com con el dominio `playcripticos.com` y copiar el ID de editor (`ca-pub-` + 16 dígitos).
2. En Vercel → criptico → Settings → Environment Variables, agregar `ADSENSE_CLIENT` con ese ID (Production) y volver a desplegar.
3. En AdSense, pedir la revisión del sitio. AdSense va a encontrar la etiqueta y `/ads.txt`. La aprobación suele tardar de días a semanas.
4. En AdSense → **Privacidad y mensajes**, crear el mensaje de consentimiento para Europa (RGPD, EEE, Reino Unido y Suiza) y el de estados de EE. UU. Es obligatorio para mostrar anuncios a visitantes de esos lugares. Lo muestra el propio script de Google.
5. En el panel → Legal, aprobar los borradores de privacidad y cookies (revisión «anuncios-2026-10-26»). Al publicarse ambos, los anuncios se encienden solos.
6. En AdSense → Anuncios, activar **anuncios automáticos**. Opcional: crear un bloque «display» adaptable y cargar su número en `ADSENSE_SLOT`.

## Revisión de AdSense: «Contenido de poco valor» (10/11/2026)

AdSense rechazó la primera revisión con «Low value content». Diagnóstico: el sitio ofrecía a Google miles de páginas de crípticos generados en serie con unas diez palabras cada una (la pista y nada más), pantallas de juego casi vacías sin JavaScript, poco texto editorial y ninguna página de quiénes somos ni de contacto. Cambios:

- **Artículos** (`/es/articulos`, textos en `src/views/articles.js`): seis artículos largos y originales (método paso a paso, historia, cómo escribir crípticos, glosario, errores comunes, variantes del español), con `Article` en datos estructurados.
- **Quiénes somos** (`/es/quienes-somos`) y **Contacto** (`/es/contacto`, con el correo de los documentos legales), en `src/views/about.js`, enlazados desde el pie.
- **Crípticos generados sin auditar**: se siguen jugando, pero su página sale con `noindex`, fuera del sitemap y de IndexNow, y sin anuncios (`INDEXABLE_SQL` en `src/services/clues.js`). Cuando un CEO los audita («ok»), vuelven al índice solos.
- Cada críptico indexable suma un ejemplo resuelto de su mecanismo; Jugar y Desafíos tienen texto que se lee sin JavaScript.
- Anuncios solo en páginas de contenido (ver «Dónde»).

Para pedir otra revisión: AdSense → Sitios → playcripticos.com → marcar «Confirmo que solucioné los problemas» → «Solicitar revisión». Conviene esperar a que Google rastree las páginas nuevas (Search Console → Inspección de URLs → «Solicitar indexación» para `/es/articulos` y cada artículo) antes de pedirla.

## Recomendaciones

- Empezar con pocos formatos (anuncios automáticos en densidad baja) para no espantar a quien juega; medir retención antes de subir.
- No poner anuncios dentro de la pantalla de una ronda de torneo o duelo (la regla de AdSense pide no ubicarlos donde se puedan tocar sin querer).
- Más tráfico = más ingresos: los torneos semanales, los duelos y compartir resultados existen para traer y retener gente.

## Plan Plus

Además de los anuncios, hay un plan pago opcional (mensual o anual, con PayPal) que los quita y suma beneficios. Ver [PLUS.md](PLUS.md).
