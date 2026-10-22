# Agente Autónomo de Biblioteca

Pedido del dueño (22/10/2026): completar **100.000 crípticos aprobados, únicos y válidos por cada variante del español**, repartidos entre los mecanismos, sin intervención manual y sin bajar la calidad.

- La meta de cada variante se reparte entre los mecanismos según su **peso**. Por pedido del dueño, los pesos son iguales: con 10 mecanismos, 10.000 por mecanismo y variante.
- Decisión del dueño (22/10/2026): **sin tope diario**. El agente produce hasta la meta y lo frenan solo el presupuesto y la calidad.
- `agent.daily_target_per_variant` > 0 vuelve a poner un tope por día (0 = sin tope).

Código:

| Pieza | Archivo |
|---|---|
| Coordinador | `src/services/library-agent.js` |
| Agentes por mecanismo | `src/lib/agent/mechanisms/` |
| API de Claude | `src/lib/agent/llm.js` |
| Panel | `src/routes/admin-agent.js` y `public/js/admin.js` (`#library`) |
| Línea de comandos | `scripts/library-agent.js` |
| Programación | `.github/workflows/library-agent.yml` |
| Migraciones | `011_library_agent.sql` y `012_library_agent_states.sql` |
| Pruebas | `test/library-agent.test.js` y `test/agent-mechanisms.test.js` |

## Auditoría inicial (22/10/2026)

- **Arquitectura.** Node 22 + Express, con frontend sin compilación. La base es Turso (libSQL), con escrituras atómicas por lote. El panel es `/admin` y se entra con usuario y contraseña; los permisos se verifican en el servidor.
- **Variantes.** Hay 22 variantes en `language_variants`, cada una con sus rasgos fonéticos (seseo, yeísmo).
- **Validador.** `src/lib/validator` rearma la respuesta letra por letra a partir del árbol del juego de palabras. Admite estas operaciones: lit, syn, abbr, letter, concat, anagram, reverse, insert, delete, hidden, initials, homophone, double y cryptic.
- **Generador.** El generador determinista del banco (`bank-1.1`) produce crípticos generales, sin variante.
- **Mecanismos del producto.** La tabla `mechanisms` define 11. Diez se pueden verificar con código. El undécimo, la definición críptica, no se puede verificar.
- **Conteo por variante y mecanismo.** No se puede hacer desde el entorno de desarrollo, porque no llega a Turso. Lo muestra el panel con los datos reales: tabla «Biblioteca real por variante y mecanismo», que sale de `clues` con `status = 'published'` y `variant_code` = la variante.
- **Lo que había antes del agente.** El banco tiene unos 16.700 crípticos generales, sin variante, y unos pocos escritos a mano con variante. Por eso las metas por variante arrancan prácticamente de cero.

## Agentes por mecanismo y taxonomía

Cada mecanismo tiene su módulo en `src/lib/agent/mechanisms/`. El módulo define:

- reglas formales;
- forma del desglose;
- instrucciones propias para el generador (su llamada a la IA lleva solo esas reglas);
- indicadores admitidos;
- un **validador propio** (control M), que corre sobre el árbol ya resuelto y registra los hechos de la operación.

Además, cada agente tiene sus métricas en el panel: estado, aprobados, rechazos, cuarentena, tasa de aprobación y costo por aprobado.

| Agente | Qué comprueba (además de A–F) | Hechos que registra |
|---|---|---|
| Anagrama | El material está escrito en la pista. Las letras coinciden exactamente: no cuentan tildes, espacios ni signos, y la Ñ no es N. Hay indicador. Si el material está casi en el mismo orden que la respuesta, va a revisión. | Material y letras |
| Palabra oculta | La respuesta aparece literal en el tramo, que está escrito en la pista. No vale la palabra entera. Si queda dentro de una sola palabra, va a revisión. | Tramo y posiciones inicial y final |
| Inversión | El origen completo, leído al revés, da la respuesta. No vale un palíndromo. | Origen y resultado; siempre inversión completa |
| Inserción | El exterior queda partido en dos tramos no vacíos. Si queda pegado al borde, es una charada. | Exterior, insertado y posición |
| Eliminación | Se quita exactamente lo indicado. Si admite varios resultados, va a revisión. | Origen, lo eliminado y resultado |
| Charada | Hay al menos dos piezas hoja que unidas dan la respuesta. Ninguna es casi la respuesta entera. | Componentes y abreviaturas |
| Homófono | Suenan igual con los rasgos de la variante. Si depende del seseo, solo vale en variantes con seseo. Si depende del yeísmo, va siempre a revisión, porque no es general en ninguna región. | Rasgo fonético necesario |
| Doble definición | Hay dos definiciones respaldadas, de **sentidos distintos**, y ninguna repite a la otra. | Sentidos del léxico |
| Iniciales | El tramo tiene tres palabras o más, está en la pista y sus iniciales dan la respuesta. | Tramo y palabras |
| Combinación | Hay dos operaciones o más; cada una se reproduce y lleva su indicador. | Principal, secundarios y orden |

**Evaluados y no automatizados** (se ven en el panel, en «Taxonomía»):

- **Definición directa.** Sola no es un críptico, pero se valida en todos los mecanismos (control B).
- **Abreviaturas.** Son un componente, no un mecanismo. Solo se aceptan las de la tabla del idioma, se valida su región y quedan registradas.
- **Definición críptica y juegos de palabras regionales.** No hay validador determinista ni fuente de regionalismos con licencia, así que nunca se aprueban solos.

La explicación pública sale del árbol que el validador resolvió, nunca de un texto del modelo: el agente no puede justificar una respuesta con una regla inventada.

## Estados de un candidato

`generated` → `validating` → `approved` | `needs_review` | `rejected` | `quarantined` | `failed`.

- **generated**: se registra apenas el generador lo propone.
- **validating**: está pasando los controles.
- **approved**: pasó todo. Se guarda publicado y es **lo único que cuenta para la meta**.
- **needs_review**: hay una duda. Se guarda en revisión (no se juega).
- **rejected**: no llega al catálogo.
- **quarantined**: el revisor sospecha una copia, o un administrador lo retiró con el botón «Retirar» del panel. No se juega y queda con el motivo.
- **failed**: hubo un error técnico (evaluación, revisión sin respuesta, proceso cortado). No llega al catálogo.

## Cuotas, concurrencia y presupuesto

- **Pesos.** `agent.mechanism_weights` reparte la meta. Un peso 0 saca un mecanismo de la producción.
- **Faltante.** Cada mecanismo tiene su faltante, y lo que le falta a uno no lo compensa otro. Con un tope diario, rige además la cuota del día.
- **Concurrencia.** `agent.concurrency` (de 1 a 8) es la cantidad de variantes que se procesan a la vez, cada una con un solo lote en curso. Empieza en 1: se sube desde el panel después del piloto.
- **Reserva de presupuesto.** Antes de cada llamada se reserva el costo máximo posible, así que ni con varias variantes a la vez se pasa del presupuesto.
- **Sin duplicados entre lotes simultáneos.** Los lotes que corren a la vez comparten la lista de juegos de palabras ya tomados.
- **Dónde se cambian.** Pesos, tope diario y concurrencia se cambian desde el panel; el presupuesto, en «Reglas y funciones». Todo exige el permiso `settings.write`.

## Qué cuenta y qué no (detalle)

- Cuenta solo un críptico **aprobado**: superó todos los controles A–F. Se guarda publicado, con `variant_code` = la variante.
- `needs_review`: se guarda en revisión (no se juega) y **no cuenta** hasta que una persona lo apruebe.
- `rejected`: no llega al catálogo; queda solo su registro auditable.
- La meta de cada variante es independiente: el faltante de una variante o de un mecanismo **no se compensa** con otra.
- Los crípticos generales (sin variante, del banco `bank-1.1` y los escritos a mano) se informan aparte y no suman a ninguna variante.
- Si un críptico aprobado se modifica, un trigger de la base invalida la aprobación y lo devuelve a revisión.

## Variantes

Salen de `language_variants` (español activo). Hoy son 22: es-AR, es-BO, es-CL, es-CO, es-CR, es-CU, es-DO, es-EC, es-ES, es-GQ, es-GT, es-HN, es-MX, es-NI, es-PA, es-PE, es-PR, es-PY, es-SV, es-US, es-UY y es-VE. El agente no crea variantes: si se activa o desactiva una, la toma o la deja en la siguiente ejecución. Meta total: 22 × 100.000 = **2.200.000 aprobados**.

## Cómo trabaja un lote

1. **Planificación.** Calcula el faltante de cada mecanismo (meta de biblioteca y, si hay, tope del día) en la variante y arma hasta 100 pedidos (20 en el piloto o en una prueba controlada) repartidos por turnos entre los mecanismos con faltante. Cada pedido tiene una respuesta del léxico (cada variante recorre la lista desde un punto propio), sus definiciones respaldadas por el léxico, el mecanismo y una dificultad que rota de 1 a 5.
2. **Generación.** El agente de cada mecanismo (`agent.generator_model`, por defecto Claude Opus 5.5, con las instrucciones de ese mecanismo) escribe en partes de hasta 12 pedidos del mismo mecanismo, con salida JSON validada por esquema. Puede devolver «skip» si el mecanismo no sale natural: no se fuerza.
3. **Controles deterministas** (código, no IA):
   - **A. Lógica:** el validador del proyecto resuelve el árbol del juego de palabras letra por letra contra la respuesta. También comprueba la enumeración, los indicadores, las abreviaturas, la posición de la definición, las palabras sin función y los homófonos con la fonética de la variante. Verifica que el mecanismo sea el pedido y busca **otras respuestas igual de válidas** en el léxico (anagramas y palabras ocultas alternativas con la misma definición).
   - **B. Lingüística:** todas las palabras de la pista están en el diccionario. La definición y cada sinónimo usado están respaldados por el léxico (dos fuentes independientes, ver docs/BANCO.md). La definición es una de las admitidas.
   - **C. Regional:** la variante existe en la base. Un regionalismo declarado no tiene fuente que lo respalde, así que va a revisión.
   - **D. Duplicados:**
     - pista idéntica;
     - mismo juego de palabras en **cualquier** variante (índice único);
     - pista casi igual para la misma respuesta;
     - respuesta ya usada 6 veces, o 2 con el mismo mecanismo, en la variante más los generales;
     - plantilla repetida en el día (tope: 2 % de la meta).
   - **E. Integridad:** pista, respuesta, explicación paso a paso (sale del árbol verificado), definición y metadatos completos; derechos `original`; procedencia registrada.
4. **F. Evaluación final independiente.** Otro modelo (`agent.reviewer_model`, por defecto Claude Sonnet 5.5) revisa lo que pasó A–E. Evalúa si resuelve sin saltos, si es justa, si la superficie es natural, si es apropiada para la variante, si hay otra respuesta y si parece copiada. Solo «ok» con todo en verdadero aprueba. Si el revisor resultó ser el mismo modelo que el generador (por ejemplo, por un desvío de modelo de la API), no hay aprobación.
5. **Escritura atómica.** Se guardan en una sola operación los crípticos, su historial (`clue_events`), un registro por candidato (`agent_candidates`, con el resultado de cada control, los motivos, los modelos, la versión y el costo), el lote y el cursor. Después se relee la base y el lote pasa a «verificado».
6. **Auditoría humana por muestra.** El 2 % de lo aprobado va a «Auditar muestra», igual que el banco. Si se rechaza más del 20 % de la muestra, el lote completo vuelve a revisión.

## Umbrales de calidad (ajustes `agent.*`)

| Situación | Acción |
|---|---|
| Lote con más de 60 % de rechazos, más de 50 % de duplicados, menos de 5 % de aprobación o más de US$ 0,50 por aprobado | El próximo lote de esa variante es una **prueba controlada** (20 pedidos) y se registra una alerta. |
| La prueba controlada (o el piloto inicial de 20) también falla | **Variante pausada** con alerta crítica. Un administrador la reanuda desde el panel. |
| Un mecanismo con 15 o más candidatos en el día, sin aprobados y con más de 80 % de rechazos | Se suspende ese mecanismo en la variante por el resto del día (acción correctiva en el informe). |
| 3 lotes seguidos con error en una variante | Variante pausada con alerta. |

Ninguna puntuación compensa un control obligatorio: basta un error lógico, un duplicado o un problema de derechos para que no se apruebe.

## Costos y límites

- **Presupuesto diario** `agent.daily_budget_usd`. **Está en 0: con 0 el agente no llama a la IA y queda «bloqueado».** Hay además un tope por variante: `agent.variant_budget_usd`, que con 0 reparte el diario en partes iguales.
- Antes de cada llamada se calcula el costo máximo posible: tokens de entrada estimados más `max_tokens` de salida, con los precios de `agent.prices_usd_per_mtok`. Si no alcanza el presupuesto, no se llama. El gasto real sale de los tokens que informa la API y se suma después de cada llamada, aunque el lote falle.
- Los precios cargados son los de la tabla publicada por Anthropic, consultada el 22/10/2026, en dólares por millón de tokens de entrada / salida:
  - Opus 5.5: 4 / 20.
  - Sonnet 5.5: 2 / 10.
  - Haiku 5.5: 0,10 / 0,50.

  Si cambian, se corrigen en ese ajuste. Un modelo sin precio detiene el agente.
- Los errores transitorios (429, 5xx, red) se reintentan con espera creciente (el SDK reintenta 2 veces y el agente, 3). Una clave rechazada o un pedido inválido detienen el ciclo como «bloqueado».
- **Estimación (sin medir: la medición real sale del piloto):**
  - Una llamada al generador por 12 pedidos: unos 2.000 tokens de entrada y de 4.000 a 10.000 de salida (incluye el razonamiento del modelo). Con Opus 5.5 son de US$ 0,09 a 0,21 por llamada, es decir, de US$ 0,008 a 0,018 por candidato.
  - La revisión cuesta unos US$ 0,002 por candidato.
  - Con 30 % a 50 % de aprobación, sale de US$ 0,02 a 0,07 por aprobado. Para 66.000 aprobados por día serían de **US$ 1.300 a 4.600 por día**. Con Sonnet 5.5 como generador, el costo baja más o menos a la mitad.

- **Para la meta completa** (2.200.000 aprobados) serían de **US$ 44.000 a 154.000**, estimado sin medir. Desde el primer lote real, el panel muestra el costo medido por aprobado y la proyección con ese dato.

## Límite de capacidad (importante)

El agente aprueba solo lo que puede verificar.

- El léxico tiene unas **5.700 respuestas con definiciones respaldadas**. Con el tope de 6 pistas por respuesta, el techo es de unas **34.000 pistas por variante**: no alcanza para las 100.000.
- La meta diaria de un mecanismo como el homófono no se va a cumplir en español: casi no hay pares de homófonos verificables.
- El agente lo informa como déficit en vez de forzarlo.

Para acercarse a la meta hace falta:

- ampliar el léxico (más respuestas y más sinónimos confirmados por dos fuentes);
- sumar una fuente de regionalismos con licencia, para aprobar vocabulario regional;
- o revisar a mano lo que queda en `needs_review`.

## Programación

- GitHub Actions **«Agente de biblioteca»** (`.github/workflows/library-agent.yml`) corre **cada hora a los :07 UTC** y también se puede lanzar a mano. GitHub puede demorar los horarios unos minutos.
- Cada ejecución trabaja hasta 50 minutos. Retoma el ciclo del día desde el último lote confirmado, cierra con su informe los ciclos de días anteriores y actualiza el informe del día.
- Ejecuciones simultáneas: las evita el grupo de concurrencia de la Action y, además, un **bloqueo en la base** (`agent_control.lease_*`, con vencimiento de 15 minutos por si un proceso muere).
- Recuperación: un lote «en curso» de un proceso cortado se verifica si su escritura llegó a la base, y si no, se abandona. El cursor solo avanza con la escritura atómica, así que no se duplica ni se pierde nada.
- Secretos de GitHub: `DATABASE_URL`, `DATABASE_AUTH_TOKEN` (ya están) y **`ANTHROPIC_API_KEY` (falta)**.

## Panel: Catálogo → Agente Autónomo de Biblioteca

- **Estado:** activo, pausado, detenido, bloqueado (falta la clave o el presupuesto) o con errores.
- Última y próxima ejecución, con enlace a la ejecución de GitHub.
- **Ciclo de hoy:** inicio, última actividad, fin, meta, candidatos, aprobados, en revisión, rechazados, duplicados, porcentaje de aprobación, costo medido y costo por aprobado.
- **Tabla por variante:** cumplimiento, avance hacia las 100.000 y detalle por mecanismo, con el motivo del déficit y las acciones correctivas.
- Últimos candidatos con los controles A–F (✓, ✗ o · si no llegó), alertas, historial de ciclos con su informe e historial de lotes.
- **Controles:**
  - Pausar: termina el lote en curso y no empieza otro.
  - Reanudar.
  - Detener: corta el ciclo de hoy hasta que alguien lo reanude.
  - Pausar o reanudar una variante.

  Solo los puede usar el superadministrador (permiso `agent.control`).
- Las reglas (metas, mecanismos, presupuesto, modelos, umbrales, precios) se cambian en **Reglas y funciones** (claves `agent.*`), con el permiso `settings.write`. El agente las lee pero no tiene forma de escribirlas, ni de tocar permisos.

## Informe diario

Se guarda en `agent_cycles.report` y se ve en el panel, en «Historial de ciclos → Informe». Por variante incluye:

- meta;
- candidatos, aprobados, pendientes, rechazados y duplicados;
- cumplimiento real;
- costo y tiempo medio por lote;
- errores, problemas de calidad (motivos de rechazo) y acciones correctivas;
- avance por mecanismo;
- biblioteca acumulada y lo que falta para 100.000;
- el **motivo del déficit**, si no llegó a 3.000.

Al cambiar el día, el ciclo anterior se cierra como «cumplido», «incumplido», «bloqueado» o «detenido», y un incumplimiento genera una alerta.

## Línea de comandos

```
node scripts/library-agent.js status
node scripts/library-agent.js run --minutes 50
```
