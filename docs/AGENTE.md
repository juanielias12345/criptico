# Agente Autónomo de Biblioteca

Pedido del dueño (22/10/2026): sumar **3.000 crípticos nuevos aprobados por día en cada variante del español**, hasta **100.000 aprobados por variante**, sin intervención manual y sin bajar la calidad. La cuota de cada variante se reparte **en partes iguales entre los mecanismos** (con 10 mecanismos: 300 por mecanismo y por día).

Código: `src/services/library-agent.js` (agente), `src/lib/agent/llm.js` (API de Claude), `src/routes/admin-agent.js` (panel), `scripts/library-agent.js` (línea de comandos), `.github/workflows/library-agent.yml` (programación), migración `011_library_agent.sql`, pruebas `test/library-agent.test.js`.

## Qué cuenta y qué no

- Cuenta solo un críptico **aprobado**: superó todos los controles A–F. Se guarda publicado, con `variant_code` = la variante.
- `needs_review`: se guarda en revisión (no se juega) y **no cuenta** hasta que una persona lo apruebe.
- `rejected`: no llega al catálogo; queda solo su registro auditable.
- La meta de cada variante es independiente: el faltante de una variante o de un mecanismo **no se compensa** con otra.
- Los crípticos generales (sin variante, del banco `bank-1.1` y los escritos a mano) se informan aparte y no suman a ninguna variante.
- Si un críptico aprobado se modifica, un trigger de la base invalida la aprobación y lo devuelve a revisión.

## Variantes

Salen de `language_variants` (español activo). Hoy son 22: es-AR, es-BO, es-CL, es-CO, es-CR, es-CU, es-DO, es-EC, es-ES, es-GQ, es-GT, es-HN, es-MX, es-NI, es-PA, es-PE, es-PR, es-PY, es-SV, es-US, es-UY y es-VE. El agente no crea variantes: si se activa o desactiva una, la toma o la deja en la siguiente ejecución. Meta diaria total = 22 × 3.000 = **66.000 aprobados por día**.

## Cómo trabaja un lote

1. **Planificación.** Calcula el faltante del día de cada mecanismo en la variante y arma hasta 100 pedidos (20 en el piloto o en una prueba controlada) repartidos por turnos entre los mecanismos con faltante. Cada pedido tiene una respuesta del léxico (cada variante recorre la lista desde un punto propio), sus definiciones respaldadas por el léxico, el mecanismo y una dificultad que rota de 1 a 5.
2. **Generación.** El generador (`agent.generator_model`, por defecto Claude Opus 5.5) escribe en partes de 12 pedidos, con salida JSON validada por esquema. Puede devolver «skip» si el mecanismo no sale natural: no se fuerza.
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
