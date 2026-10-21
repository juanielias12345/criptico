# Sistema de diseño de Play Crípticos

Todo vive en `public/css/app.css` (sitio) y `public/css/admin.css` (panel), sin paso de compilación.

## Identidad
- Marca: cuadrado bermellón con un triángulo de «play» y un casillero vacío adentro (la letra que falta). Nombre «Play Crípticos», con «Play» en itálica bermellón.
- Papel marfil, tinta casi negra y un único acento bermellón. Verde solo para «correcto»; ocre para «todavía no» y pistas.
- Tipografías propias del sitio (OFL, en `public/fonts`): Fraunces para pistas y títulos, Instrument Sans para la interfaz.

## Tokens
Colores (`--paper`, `--sheet`, `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--accent`, `--ok`, `--near`, `--danger` y sus `-soft`),
tipografía (`--t-xs` … `--t-hero`, `--t-clue`), espaciado (`--s-1` … `--s-9`), radios, bordes, elevación, anchos y movimiento
(`--d-1` … `--d-4`). El tema oscuro redefine los mismos tokens con `prefers-color-scheme` y con `data-theme`.

## Reglas
- La CSP no permite `style=""` en el HTML del servidor: los valores dinámicos se ponen desde JS con `style.setProperty`.
- `prefers-reduced-motion` desactiva animaciones; `forced-colors` y la impresión tienen reglas propias.
- Ningún número de la portada es inventado: salen de la base (crípticos publicados, idiomas y variantes activas).
- Los ejemplos de la portada y las 7 lecciones son crípticos del catálogo validado (`test/content.test.js` lo comprueba).
- Importaciones externas y propuestas de usuarios están separadas en el panel; las propuestas siempre requieren aprobación manual.
