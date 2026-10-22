# SEO: posicionamiento en Google

## Qué hace el sitio

- Cada página se arma en el servidor: Google lee el texto sin ejecutar JavaScript.
- Títulos y descripciones propios para inicio, jugar, diario, archivo, ayuda y la guía (`SEO` en `src/routes/pages.js`, textos en `src/views/guide.js`).
- `canonical`, `og:*`, `robots.txt` y `sitemap.xml` con todas las páginas fijas, la guía y los crípticos publicados.
- Datos estructurados: WebSite + Organization en el inicio, CreativeWork + BreadcrumbList en cada críptico, Article + BreadcrumbList en la guía.
- `/` redirige con 301 a `/es` mientras haya un solo idioma de interfaz.
- Guía de mecanismos (`/es/mecanismos` y una página por mecanismo): explicación, ejemplo resoluble, palabras indicadoras (salen de `src/lib/lang/es.js`) y enlaces a crípticos para practicar.
- Cada críptico enlaza a su mecanismo y a seis crípticos del mismo tipo.
- Sin desplazamiento horizontal desde 360 px. El diálogo de país solo se abre solo en Jugar y Diario; en las páginas a las que se llega desde Google (inicio, críptico, guía) no tapa el contenido.
- En producción de Vercel el dominio canónico es siempre https://playcripticos.com aunque `SITE_URL` falte o sea *.vercel.app, y criptico.vercel.app redirige con 301 al dominio propio (salvo /api/).
- Search Console verificado el 22/10/2026 con `public/googlee415e1c5deea6c8b.html` y Bing Webmaster con `public/BingSiteAuth.xml`: no borrar esos archivos.
- IndexNow (Bing, Yandex, Seznam, Naver): la tarea diaria `indexnow` manda las páginas nuevas a api.indexnow.org; la clave está en `public/f976081f456136a4fab4599b0fb1881f.txt` (pública por diseño). La primera vez manda las páginas fijas, la guía y hasta 10.000 crípticos. Solo corre con el dominio público.
- El Organization del inicio lista los perfiles oficiales (Instagram, Facebook, YouTube) en `sameAs`. TikTok queda afuera mientras la cuenta conectada sea personal.
- `GOOGLE_SITE_VERIFICATION` (variable de entorno) agrega la etiqueta de verificación de Search Console.

## Lo que depende de una persona

1. Search Console: verificar `playcripticos.com` (registro TXT en el DNS o la variable `GOOGLE_SITE_VERIFICATION` en Vercel) y enviar `https://playcripticos.com/sitemap.xml`.
2. Bing Webmaster Tools: importar el sitio desde Search Console (también alimenta a DuckDuckGo y Yahoo).
3. Enlace al sitio en la biografía de todas las redes.
4. Enlaces desde otros sitios: solo pedidos genuinos (asociaciones de crucigramistas, blogs de juegos de palabras, docentes de lengua). Nada de compra de enlaces ni intercambios masivos.

## Expectativas

Nadie puede garantizar el primer puesto. «Críptico» también es un adjetivo del diccionario, así que la búsqueda «crípticos» mezcla definiciones con juegos. Los objetivos medibles son la marca («play crípticos»), «crucigrama críptico», «crípticos en español», «juego de crípticos», «críptico del día» y las búsquedas de cada mecanismo. Los cambios se miden en Search Console a partir de 2 a 6 semanas de indexado.
