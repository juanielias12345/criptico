# Pruebas

```bash
npm test          # unidad e integración (servidor real + base temporal)
npm run test:e2e  # navegador Chromium sin interfaz
```

Último resultado (22/10/2026, Node 22, Linux): **118/118** en `npm test` y **17/17** en `npm run test:e2e`. También corren en GitHub Actions (flujo «Pruebas») en cada cambio de `main`.

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

## Panel de administración: las 20 pruebas pedidas

| # | Prueba | Dónde |
| --- | --- | --- |
| 1–3 | Registro, país e idioma elegidos | panel «#1 #2 #3 registro de cuenta…» |
| 4, 5, 7 | Partida iniciada, resuelta y tiempo correcto | panel «#4 #5 #7…» |
| 6 | Partida no resuelta según su estado real (abandono por inactividad, reanudación, error, revelada, pasada) | panel «#6…» |
| 8, 19 | Pistas, revelaciones e intentos repetidos sin duplicar | panel «#8 #19…» |
| 9, 10 | Indicadores = registros; filtros por país, idioma, variante y período | panel «#9 #10…» |
| 11 | Correo visible solo para roles autorizados | panel «#11…», e2e «el rol analista no ve correos ni acciones» |
| 12 | Una persona no ve estadísticas privadas de otra | panel «#12…» |
| 13 | Moderador o analista no ejecutan acciones de superadministrador | panel «#13…» |
| 14, 15 | Propuestas siempre con aprobación manual | panel «#14 #15…» |
| 16 | Exportaciones con permisos y auditadas | panel «#16…» |
| 17 | Solicitudes de datos y estadísticas agregadas que se mantienen | panel «#17…» |
| 18 | Panel en escritorio y móvil | e2e «#18 panel de administración en escritorio y móvil» |
| 20 | Alertas con umbrales, sin duplicados; tareas que se recuperan | panel «#20…» |

## Perfil personal: las 16 pruebas pedidas

Resultado al publicar: `npm test` 77/77 y `npm run test:e2e` 14/14 (dos corridas seguidas sin fallos).

| # | Prueba | Dónde |
| --- | --- | --- |
| 1–3 | Partida guardada, tiempo coherente, intentos asociados a la partida correcta | perfil «#1 #2 #3…» |
| 4, 5 | Pistas registradas con orden y momento; revelada ≠ resuelta | perfil «#4 #5…» |
| 6, 7 | Historial y gráficos coinciden con los registros | perfil «#6 #7…» |
| 8 | Logros según su condición (incluida la racha de días) | perfil «#8 #9 #10…» y «#8 condición de racha…» |
| 9, 10 | Récords sin duplicar; repetir un críptico no suma únicos ni experiencia | perfil «#8 #9 #10…» |
| 11 | El perfil público, la tarjeta compartida y los rankings no exponen datos privados | perfil «#11…» (dos pruebas) |
| 12 | Vincular partidas anónimas requiere autorización | perfil «#12…» y e2e «#13 perfil personal…» |
| 13 | Escritorio y móvil | e2e «#13 perfil personal en escritorio y móvil…» |
| 14 | Cortes de conexión (reenvíos simultáneos, fallo al evaluar logros) no corrompen el resultado | perfil «#14…» |
| 15 | El borrado de datos se aplica (incluido el acceso desde el mismo navegador) | perfil «#15…» |
| 16 | Las recomendaciones llevan a crípticos jugables y se pueden apagar | perfil «#16…» y e2e «práctica dirigida…» |
| — | Rendimiento con 3000 partidas, uso de índices y paginado | perfil «rendimiento…» |

Problemas que encontró la revisión y se corrigieron:

- Una cuenta eliminada podía volver a ver sus partidas desde el mismo navegador sin sesión. Se agregó `players.retired_at`.
- La interfaz escribía «null» en lugares vacíos.
- El mapa de fortalezas no tomaba el color de cada nivel.
- Los ejes de los gráficos mostraban valores como 1,3 o 3,8 para conteos.
- En móvil, el historial ocupaba demasiado.
- Una prueba del panel fallaba a veces por una condición de carrera.

## Banco de crípticos por idioma y dificultad (`test/bank.test.js` y e2e «banco…»)

Resultado al publicar: `npm test` 93/93 y `npm run test:e2e` 16/16.

| # | Prueba | Dónde |
| --- | --- | --- |
| 1 | Idiomas documentados y léxico con licencias | bank «#1…» |
| 2 | Metas independientes por idioma y dificultad | bank «#2…» |
| 3 | Los lotes existen de verdad en la base antes de darse por verificados | bank «#3…» y e2e «banco…» |
| 4 | Sin duplicados; reanudar continúa donde quedó | bank «#4…» |
| 5 | Rechazados, pendientes, sin permiso o con licencia vencida no cuentan | bank «#5…» y «#5b…» |
| 6, 8 | Un críptico generado se juega en todos los modos, con pista de indicador, explicación y estadísticas | bank «#6/#8…» y e2e «banco…» |
| 7 | Créditos y atribución de fuentes | bank «#7…» y e2e «banco…» |
| 10 | Un fallo de escritura o una caída a mitad de lote no deja registros a medias | bank «#10…» |
| 11 | Permisos del panel y exportaciones | bank «#11…» |
| 12 | Una muestra con demasiados rechazos suspende el lote | bank «#12…» |
| 13 | Jugar no carga el generador; el sorteo usa índice | bank «#13…» y «sorteo rápido…» |
| — | Matriz en escritorio y móvil, lote corto desde el panel, cola de auditoría | e2e «banco…» y «#18 panel…» |

Problemas que encontró la revisión y se corrigieron:

- Los avisos del panel desaparecían al instante porque la vista se volvía a dibujar después de mostrarlos. Ahora se muestran después del redibujo.
- La cola de auditoría mostraba «[object HTMLDivElement]» en lugar de las tarjetas.

## Empresa (`test/company.test.js` y e2e «empresa…»)

- Vectores TOTP de la RFC 6238; el secreto se guarda cifrado; un código usado no vuelve a servir.
- Invitación de un CEO: un solo uso, mismos permisos que el otro CEO; crear un `owner` de forma directa se rechaza.
- Inicio de sesión con MFA: sin código, código incorrecto, código de recuperación de un solo uso, alerta por dispositivo nuevo y cierre de otras sesiones.
- Recuperación: otro integrante genera el enlace; nadie puede generarse uno propio; usarlo quita MFA y cierra sesiones.
- Aprobaciones: voto atado a versión y hash; editar invalida; política de los dos CEO para montos sobre el umbral; aprobar y rechazar la misma versión abre un conflicto y pausa.
- Ajustes de seguridad y cambios sobre un CEO pasan por la bandeja y se aplican al aprobarse.
- Auditoría: la base rechaza borrar y modificar.
- Contenido: programar exige aprobación; un cambio la invalida; «publicada» exige enlace.
- Legal: sin aprobación del hash exacto la base rechaza aprobar o publicar.
- Tareas: completar exige evidencia y, en nivel 3, aprobación.
- Política de MFA obligatoria.
- Navegador: invitar desde «Equipo», aceptar sin sesión, activar MFA, volver a entrar con código; todas las pantallas de la empresa en escritorio y móvil sin errores ni desbordes.

## Redes: 60 días (`test/social.test.js`)

| Qué se prueba | Prueba |
|---|---|
| 60 días del 26/10 al 24/12, todas las redes, horario en hora argentina, textos de X ≤ 280, un críptico distinto por día | «el plan…» |
| Cada imagen y video del plan existe de verdad | «cada archivo…» |
| Los crípticos del día están publicados en el catálogo | «los crípticos del día…» |
| El calendario se carga una sola vez, en edición, sin aprobación | «el calendario se carga…» |
| Aprobar un día solo aprueba la versión vista; con pedido y voto registrados | «aprobar un día…» |
| Pedir cambios exige comentario; un analista no aprueba | «pedir cambios…» |
| Metricool: pedido por red, identificador como evidencia, error no marca como programada, nada sin aprobar se programa | «Metricool…» |
| Los archivos se sirven pero no se indexan | «los archivos de redes…» |
