# Pruebas

```bash
npm test          # unidad e integración (servidor real + base temporal)
npm run test:e2e  # navegador Chromium sin interfaz
```

Último resultado (21/10/2026, Node 22, Linux): **50/50** en `npm test` y **7/7** en `npm run test:e2e`.

## Cobertura de las 25 pruebas obligatorias

| # | Prueba | Dónde |
| --- | --- | --- |
| 1 | Primera visita y elección de idioma | e2e “primera visita: diálogo con detección…” |
| 2 | Cambiar el país no cambia el idioma | e2e “primera visita…”, game “país e idioma son independientes” |
| 3 | Cambiar el idioma no cambia el país | ídem |
| 4 | Inicio de partida | game “inicio de partida”, e2e “jugar…” |
| 5 | Respuestas correctas e incorrectas | game “validación de respuestas…”, e2e “jugar…” |
| 6 | Explicaciones | game “validación… y explicación”, e2e “jugar…” y “revelar…” |
| 7 | Modo infinito sin límite diario | game “modo infinito sin límite diario” |
| 8 | Sin repeticiones innecesarias | game “…sin repeticiones innecesarias” |
| 9 | Móviles | e2e “móvil: sin desplazamiento horizontal” (360 × 740) |
| 10 | Importación desde fuente autorizada | imports “importación desde una fuente autorizada” |
| 11 | Bloqueo sin permisos claros | imports “no se puede aprobar…”, “sin permisos claros…”, “la base impide…” |
| 12 | Publicación automática externa | imports “importación… con publicación automática” |
| 13 | Envío de un críptico | submissions “envío de una propuesta”, e2e “proponer…” |
| 14 | La propuesta queda pendiente | ídem |
| 15 | Sin aprobación manual no se publica | submissions “una propuesta no puede publicarse sin aprobación manual” |
| 16 | Aprobar, rechazar, pedir correcciones | submissions “aprobación manual publica…”, e2e “proponer… y aprobarlo” |
| 17 | Duplicados | admin-security “detección de duplicados”, submissions “controles automáticos” |
| 18 | Seguridad del panel | admin-security “seguridad del panel”, “CSRF y origen”, “bloqueo…”, “inyección SQL…”, “cabeceras”, e2e “panel sin sesión” |
| 19 | Errores de conexión con fuentes | imports “errores de conexión…”, “credencial faltante y robots.txt” |
| 20 | Recuperación de tareas programadas | admin-security “tareas programadas: bloqueo, recuperación… y reintento” |
| 21 | Sin credenciales en el código | admin-security “sin credenciales en el código”, “en producción faltan variables…” |
| 22 | Consistencia de la base | admin-security “consistencia de la base” |
| 23 | Caracteres especiales y acentos | game “tildes y Ñ”, “páginas públicas… caracteres especiales”, validator “normalización” |
| 24 | Sin crípticos en un idioma | game “sin contenido en un idioma o variante” |
| 25 | No publicar soluciones incorrectas | validator “una respuesta incorrecta no pasa”, admin-security “gestión del catálogo”, submissions “aprobar por error…” |

## Problemas que encontraron las pruebas y se corrigieron

- El enlace para compartir y el archivo usaban la respuesta en la dirección (`/es/c/amor-es`). Ahora la dirección sale del texto de la pista.
- Las eliminaciones de letras (“sin”, “pierde”) necesitaban indicar de qué palabra salen (`remove_from`).

## Limitaciones conocidas

- Las pruebas de navegador usan solo Chromium; no se probó en Safari ni Firefox.
- No se probó contra Turso real ni en Vercel: falta crear esas cuentas. El código usa el mismo cliente (`@libsql/client`) que en las pruebas.
- Los homófonos en inglés dependen de una tabla curada; los que no estén en ella quedan como “sin verificar” y van a revisión humana.
