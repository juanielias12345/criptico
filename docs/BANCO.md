# Banco de crípticos: 10.000 por idioma y dificultad

Meta: **10.000 crípticos publicados por cada combinación de idioma activo y dificultad**, con un objetivo independiente para cada celda. Hoy hay 2 idiomas activos y 5 dificultades, así que la meta total es de 2 × 5 × 10.000 = **100.000**. Si se activa un idioma nuevo, se suman sus 5 celdas sin tocar lo ya hecho.

Solo cuentan para la meta los crípticos **publicados**: validados, sin dudas y con los derechos habilitados. Los pendientes, rechazados, duplicados o en cuarentena no cuentan nunca.

## Idiomas

La lista sale de las tablas `languages` y `language_variants`. Cada idioma tiene reglas propias de validación (`src/lib/lang/<código>.js`), su léxico del generador (`data/lexicon/<código>.json.gz`) y textos de interfaz.

### es (español), activo

- Variantes: `es-AR` (Argentina y Río de la Plata), `es-ES` (España), `es-MX` (México). Un críptico sin variante vale para todas.
- Particularidades:
  - Las tildes no cuentan al comparar respuestas (CAMIÓN = CAMION), pero la Ñ es una letra distinta (AÑO ≠ ANO).
  - Los homófonos dependen de la variante. Con seseo, «casa» y «caza» suenan igual en es-AR y es-MX, pero no en buena parte de España. Con yeísmo, «valla» y «vaya» suenan igual en todas. El validador comprueba cada variante, y el generador solo marca como general un homófono que vale en todas; si no, lo asigna a `es-AR`.
  - Los indicadores que se usan no concuerdan en género ni en número («mezcla de», «al revés», «sin principio»), para que no haya errores de concordancia.
  - Las frases para palabras ocultas concuerdan sustantivo y adjetivo («casa blanca», «amo fácil»), o bien usan sustantivo + de + sustantivo.
- Léxico: wordnet del Multilingual Central Repository 3.0, con las relaciones de WordNet 3.0. **Cada sinónimo debe confirmarlo además el tesauro OpenThesaurus**: el wordnet en español tiene ruido de traducción automática y dos fuentes independientes lo filtran.
- Vocabulario regional: el léxico no marca regionalismos del español, así que los crípticos generados quedan sin variante. Los regionalismos se cargan a mano o por fuentes externas con variante declarada.

### en (inglés), activo

- Variantes: `en-GB` y `en-US`.
- Particularidades:
  - Abreviaturas propias de una variante, como TA = thanks (solo en-GB).
  - Vocabulario regional: WordNet marca palabras como británicas o estadounidenses («lorry», «faucet»), y el generador asigna la variante que corresponde.
  - Homófonos: hay una lista curada y, además, el CMU Pronouncing Dictionary (pronunciación estadounidense). Si en la pronunciación interviene una R, el homófono se limita a en-US, porque el inglés británico no rótico puede diferir.
- Léxico: Princeton WordNet 3.0. Los homófonos salen del CMU Pronouncing Dictionary.

### fr, pt, it, de (desactivados)

Ya tienen variantes cargadas (`fr-FR`, `pt-BR`, `pt-PT`, `it-IT`, `de-DE`) y normalización de respuestas (el alemán expande Ä→AE y ß→SS). Para activarlos hacen falta tres cosas:

1. Reglas de validación en `src/lib/lang/<código>.js`.
2. Plantillas de superficie nativas en `src/lib/bank/surface.js` (nunca traducciones de las españolas o inglesas).
3. Un léxico de licencia compatible en `data/lexicon/`.

Activar un idioma desde el panel crea sus 5 metas automáticamente.

## Dificultades

| Nivel | Nombre | Qué suele tener |
|---|---|---|
| 1 | Muy fácil | Palabra oculta o anagrama de una sola palabra, definición directa, respuesta muy común. |
| 2 | Fácil | Anagrama de dos palabras, inversión o eliminación sobre una palabra escrita en la pista, homófono simple. |
| 3 | Intermedio | Charadas, dobles definiciones, inversiones o eliminaciones de un sinónimo. |
| 4 | Difícil | Inserciones, charadas con abreviaturas, definiciones por un sentido secundario de la palabra. |
| 5 | Experto | Combinaciones (inversión dentro de una charada, inserción de sinónimos), sentidos secundarios y respuestas poco frecuentes. |

El generador calcula un puntaje con reglas explícitas (`src/lib/bank/generate.js`):

1. **Base por mecanismo:**
   - 1: oculta y anagrama simple.
   - 1,5: inversión o eliminación de una palabra escrita.
   - 2: doble definición, anagrama de dos palabras y homófono literal.
   - 2,5: charada.
   - 3: inversión o eliminación de un sinónimo.
   - 3,5: homófono de un sinónimo e inserción.
   - 4: charada de tres piezas.
   - 4,5: combinación.
2. **Ajustes que suman:**
   - +1 si la definición usa un sentido secundario de la respuesta.
   - +0,5 si la definición es un hiperónimo («flor» por ROSA).
   - +0,5 por cada abreviatura.
   - +0,5 si la respuesta es poco común; +1 si es rara.
   - +0,5 si la respuesta tiene más de 9 letras.
3. **Ajuste que resta:** −0,5 si la respuesta es muy común.

El puntaje se redondea al nivel más cercano entre 1 y 5. El validador además estima la dificultad por su cuenta: si las dos estimaciones difieren en 3 niveles o más, el críptico queda pendiente.

## Campos de cada críptico

| Pedido | Columna |
|---|---|
| Identificador | `id`, `slug` (la URL pública no revela la respuesta) |
| Idioma y variante | `language_code`, `variant_code` (NULL = todas) |
| Texto de la pista, respuesta | `clue_text`, `answer`, `answer_key` |
| Explicación paso a paso | `explanation` (sale del mismo árbol que se verificó) |
| Mecanismo principal y secundarios | `mechanism`, `mechanisms_secondary` |
| Dificultad, categoría | `difficulty`, `category` |
| Longitud de la respuesta | `answer_length`, `enumeration` |
| Pistas progresivas | `hints`: tipo de juego, indicador, definición, primera letra y patrón |
| Autor | `author_name` (NULL = desconocido; nunca se inventa) |
| Fuente y URL | `source_id`, `source_url`, `source_title`, `source_accessed_at` |
| Estado de derechos | `rights_status`: original, licensed, public_domain, permission, reference_only, unverified |
| Licencia y atribución | `license_id`, `attribution` |
| Fecha de creación | `created_at`, `published_at` |
| Estado de validación | `validation_status`, `validation_errors`, `validation` (cada comprobación), `evidence` (respaldo léxico) |
| Historial de modificaciones | tabla `clue_events` (creación, ediciones con diferencias, cambios de estado, auditoría) |
| Huella de deduplicación | `fingerprint` (texto + respuesta) y `dedup_key` (respuesta + mecanismo + material) |

Además: `batch_id` (el lote que lo creó), `generator_version`, `audit_status` y `shuffle` (una clave aleatoria fija para sortear rápido).

## Cómo se genera un lote

`src/services/bank.js` hace estos pasos para cada celda:

1. **Arriendo.** Toma la celda con `lease_until`, para que dos procesos no la trabajen a la vez. Una celda pausada no corre.
2. **Recuperación.** Si quedó un lote a medias, revisa la base:
   - si sus registros están guardados, lo verifica y lo completa;
   - si no, lo marca abandonado.
3. **Candidatos.** Recorre las respuestas del léxico en un orden fijo, desde el último cursor confirmado.
   - Para cada respuesta arma todos los juegos de palabras que el léxico permite demostrar y se queda con los de la dificultad pedida.
   - Toma como máximo uno por mecanismo y por respuesta en cada celda.
4. **Validación.** Cada candidato pasa por el mismo validador que los crípticos escritos a mano. Este comprueba:
   - que el juego de palabras produce exactamente la respuesta;
   - la enumeración;
   - que los indicadores sean conocidos;
   - que la definición esté al principio o al final;
   - que no haya palabras sin función;
   - que la respuesta exista en el diccionario;
   - los homófonos de cada variante;
   - que no haya contenido inseguro;
   - que la dificultad sea razonable.
5. **Evidencia léxica independiente.** Cada definición y cada sinónimo se vuelve a buscar en el léxico, sin confiar en lo que dijo el generador.
6. **Duplicados.** Se descartan:
   - el mismo juego de palabras (`dedup_key`);
   - la misma pista y respuesta (`fingerprint`);
   - pistas casi iguales para la misma respuesta (similitud ≥ 0,6);
   - una respuesta ya usada 6 veces, o 2 veces con el mismo mecanismo.

   Así no entran variaciones superficiales.
7. **Escritura atómica.** Los crípticos, su historial, los contadores del lote y el cursor nuevo se guardan en una sola operación. Si falla, no se guarda nada y el cursor no se mueve.
   - Si la conexión se corta después de escribir, el reintento detecta que ya se guardó.
   - Si otro proceso guardó el mismo juego de palabras entretanto, el índice único lo impide: esos candidatos se cuentan como duplicados y se reintenta sin ellos.
8. **Verificación.** Se relee la base. El lote pasa a «verificado» solo si los registros existen y coinciden con lo esperado. Hasta entonces no se da por terminado.
9. **Muestra para auditoría.** Se separa el 2 % de lo publicado, con un mínimo de 3 crípticos.

Durante una partida no se genera nada ni se llama a ningún servicio externo: el juego solo lee crípticos ya guardados.

### Criterio de publicación (decisión del dueño, 21/10/2026)

Se publica automáticamente solo lo que cumple las tres condiciones:

- **cero errores**;
- **cero advertencias**;
- **toda la evidencia léxica comprobada**.

Cualquier duda deja el críptico **pendiente** de revisión humana. La opción está en el ajuste `bank.autopublish_strict`: en `false`, todo lo generado queda pendiente.

### Auditoría por muestra

En el panel, **Banco por idioma y dificultad → Auditar muestra**:

- **Correcto** marca el críptico como auditado.
- **Rechazar** lo retira de las partidas.
- Si se rechaza más del 20 % de la muestra revisada de un lote (con al menos 3 revisados), **el lote completo vuelve a revisión**. El porcentaje se ajusta en `bank.audit_max_reject_rate`.

Un lote también se puede suspender a mano.

## Contenido externo

- Se prioriza el contenido original.
- Lo externo solo se publica si la fuente es de dominio público, tiene una licencia compatible o dio permiso expreso, y además:
  - la fuente está aprobada por un administrador;
  - la revisión legal no está rechazada;
  - el permiso no venció.

  Las cuatro condiciones las exige la propia base con triggers, no solo la interfaz.
- Cada fuente guarda:
  - autor («desconocido» si no se sabe), título, sitio y URL;
  - fecha de acceso y titular de derechos;
  - licencia, permiso y su evidencia;
  - texto de atribución;
  - condiciones de adaptación y restricciones comerciales;
  - estado de revisión legal y vencimiento del permiso.
- Sin permiso verificado, el contenido queda en `unverified` (cuarentena) y nunca se publica.
- Si la fuente solo permite enlazar (`reference_only`), se guarda la referencia sin copiar la pista.
- Nunca se eluden CAPTCHAs, inicios de sesión ni límites de acceso: las fuentes se leen solo por los métodos autorizados (feed, API, CSV o carga manual).
- La atribución se muestra junto a la solución: fuente con enlace, autor o «autor desconocido», y licencia.
- Los crípticos generados muestran «Creado por el generador de Play Crípticos», con un enlace a la página de créditos.
- Las propuestas de usuarios siguen pasando siempre por aprobación humana (trigger `clues_community_requires_human`).

## Fuentes léxicas del generador

| Fuente | Uso | Licencia |
|---|---|---|
| Princeton WordNet 3.0 | Sinónimos, hiperónimos y sentidos en inglés; relaciones para el español | WordNet 3.0 License (permisiva, con aviso de copyright) |
| Multilingual Central Repository 3.0 (wordnet en español) | Sinónimos y sentidos en español | CC BY 3.0 |
| OpenThesaurus – Tesauro Español (LibreOffice) | Confirmación de sinónimos en español | LGPL 2.1 |
| CMU Pronouncing Dictionary 0.7a | Homófonos en inglés | BSD |
| wordfreq 3.1 | Frecuencia de uso (orden y dificultad) | Datos CC BY-SA 4.0 |
| an-array-of-spanish-words, an-array-of-english-words | Comprobar que la respuesta existe | MIT |

El archivo `data/lexicon/<código>.json.gz` es una compilación derivada de estas fuentes, que se distribuye con sus licencias y atribuciones. Se reconstruye con `scripts/lexicon/build.py`; en la cabecera del script están las URL exactas.

Las pistas no copian texto de ninguna fuente: usan relaciones entre palabras (hechos léxicos) y plantillas propias. Los créditos públicos están en `/es/creditos` y `/en/credits`.

## Panel: matriz idioma × dificultad

La sección está en **Catálogo → Banco por idioma y dificultad**. Cada celda muestra:

| Dato | Definición |
|---|---|
| Meta | Objetivo de la celda (10.000 por defecto, editable). |
| Generados | Candidatos que produjo el generador en todos los lotes, más los crípticos de la celda que entraron por otras vías. |
| Validados | Crípticos de la celda sin errores críticos. |
| Publicados | Disponibles para jugar. Es lo único que cuenta para la meta; se separan originales y generados, externos y de la comunidad. |
| Pendientes | En revisión o borrador. |
| Rechazados | Descartados por el validador en los lotes, más los desactivados. |
| Duplicados descartados | Por juego de palabras, huella, similitud o sobreuso de una respuesta. |
| Permiso sin verificar | En cuarentena (`unverified` o `reference_only`). |
| Avance real | Publicados ÷ meta. |
| Última ejecución, estado | Arriendo, pausa, «sin más candidatos», «meta cumplida» o error, más el historial de lotes. |

- **Filtros:** idioma, dificultad, origen, autor (o «desconocido»), fuente, licencia, estado y mecanismo.
- **Acciones según el rol:**

| Acción | Quién |
|---|---|
| Ver la matriz | superadministrador, administrador de contenido, moderador y analista |
| Generar un lote corto, pausar, cambiar la meta, suspender un lote | superadministrador y administrador de contenido |
| Auditar | superadministrador, administrador de contenido y moderador |
| Revisar, corregir, aprobar, rechazar o despublicar crípticos | catálogo, con el permiso `catalog.write` |
| Exportar la matriz y el catálogo completo a CSV | quien tenga `export.data` |

## Cómo se ejecuta

- **GitHub Actions → «Banco de crípticos»** (`.github/workflows/bank.yml`). Corre cada 6 horas y también a mano, con idioma, dificultades, cantidad de lotes y tamaño. Usa los secretos `DATABASE_URL` y `DATABASE_AUTH_TOKEN`. Cada ejecución continúa desde el último lote confirmado de cada celda y deja la tabla de avance en el resumen de la ejecución.
- **Línea de comandos:**
  - `node scripts/bank.js status` muestra la matriz.
  - `node scripts/bank.js run --lang es --difficulty 1,2 --batches 5 --size 400 --concurrency 2 --minutes 50` corre lotes.
- **Panel:** el botón «Generar un lote corto» corre hasta 80 por vez, porque una función del servidor tiene poco tiempo de ejecución.

## Límites conocidos

- **Capacidad del generador.** El generador solo publica lo que el léxico permite demostrar, así que su capacidad depende del vocabulario con sinónimos confirmados. Con la versión `bank-1.1` (hasta dos alternativas de material por mecanismo, respuestas desde frecuencia zipf 2,2) y las reglas de duplicados actuales, la capacidad medida en local es de unos **4.300 crípticos en español y 12.400 en inglés**, repartidos de forma desigual:

  | Idioma | 1 | 2 | 3 | 4 | 5 | Total |
  |---|---|---|---|---|---|---|
  | es | 554 | 1.265 | 1.765 | 632 | 99 | 4.315 |
  | en | 996 | 3.164 | 4.454 | 3.129 | 615 | 12.358 |

  Casi la mitad de las respuestas posibles en español no tienen ningún juego de palabras demostrable con el léxico (los sinónimos en español exigen dos fuentes que coincidan). Es decir, el generador solo no alcanza las 100.000: llega a cerca del 17 % de la meta total (la versión `bank-1.0` llegaba a 3.400 y 9.500).
- **Cómo se sigue.**
  - Cada versión nueva del generador (más mecanismos, más patrones de frase, plurales y formas flexionadas, nuevas fuentes léxicas) reinicia el recorrido de cada celda. Lo ya publicado se respeta: los duplicados se descartan solos.
  - Las fuentes externas con licencia y los crípticos de la comunidad aprobados también suman en su celda.
  - La matriz siempre muestra exactamente cuánto falta.
- **Calidad de la superficie.** Las pistas son correctas y verificadas, pero su redacción es más sobria que la de un autor humano. La auditoría por muestra existe para detectar definiciones forzadas.
