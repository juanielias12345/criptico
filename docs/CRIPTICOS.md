# Formato de un críptico

Un críptico tiene una **definición** y un **juego de palabras** que llevan a la misma respuesta. En Cripta el juego de palabras se describe como un árbol JSON. El validador lo resuelve, comprueba que dé exactamente la respuesta y genera la explicación paso a paso a partir de ese árbol.

## Campos

| Campo | Ejemplo | Notas |
| --- | --- | --- |
| `clue` | `Ramo revuelto para el sentimiento (4)` | Debe terminar con la enumeración entre paréntesis: `(4)`, `(3,5)`, `(4-3)` |
| `answer` | `AMOR` | Se compara sin tildes ni mayúsculas; la Ñ cuenta como letra distinta |
| `definition` | `el sentimiento` | Tiene que aparecer en la pista, al principio o al final |
| `wordplay` | ver abajo | Opcional pero recomendado; sin él el críptico queda como no verificado |
| `language` / `variant` | `es` / `es-AR` | La variante es opcional: sin ella sirve para todo el idioma |
| `category`, `difficulty`, `mechanism` | `sentimientos`, `1`–`5`, `anagram` | |
| `explanation` | texto | Opcional: si hay `wordplay`, la explicación se genera sola |

## Nodos del juego de palabras

| Nodo | Forma | Significado |
| --- | --- | --- |
| `lit` | `{ "op": "lit", "text": "ramo" }` | Letras tomadas tal cual de la pista |
| `syn` | `{ "op": "syn", "from": "río", "text": "po" }` | Sinónimo (afirmación que revisa una persona) |
| `abbr` | `{ "op": "abbr", "from": "norte", "text": "n" }` | Abreviatura convencional (se comprueba contra la lista del idioma) |
| `letter` | `{ "op": "letter", "from": "ele", "text": "l" }` | Nombre de una letra |
| `concat` | `{ "op": "concat", "parts": [ … ] }` | Charada: partes una detrás de otra |
| `anagram` | `{ "op": "anagram", "indicator": "revuelto", "of": [ … ] }` | Las letras de `of` reordenadas |
| `reverse` | `{ "op": "reverse", "indicator": "de vuelta", "of": { … } }` | Al revés |
| `insert` | `{ "op": "insert", "indicator": "en", "outer": { … }, "inner": { … } }` | `inner` dentro de `outer` |
| `delete` | `{ "op": "delete", "indicator": "sin", "of": { … }, "remove": "first" }` | `remove`: `first`, `last`, `middle` o letras concretas; `remove_from` indica de qué palabra salen |
| `hidden` | `{ "op": "hidden", "indicator": "esconde", "in": "queso solo" }` | Palabra oculta en ese tramo de la pista |
| `initials` | `{ "op": "initials", "indicator": "al principio", "in": "…" }` | Primeras letras de cada palabra |
| `homophone` | `{ "op": "homophone", "indicator": "suena", "of": { … } }` | Suena igual (seseo y yeísmo según variante; en inglés, tabla con diferencias GB/US) |
| `double` | `{ "op": "double", "definitions": ["…", "…"] }` | Doble definición |
| `cryptic` | `{ "op": "cryptic" }` | Definición críptica: no se puede comprobar, requiere revisión humana |

## Ejemplos

```json
{ "clue": "Ramo revuelto para el sentimiento (4)", "answer": "AMOR", "definition": "el sentimiento",
  "wordplay": { "op": "anagram", "indicator": "revuelto", "of": [{ "op": "lit", "text": "ramo" }] } }

{ "clue": "Queso solo esconde un animal del bosque (3)", "answer": "OSO", "definition": "un animal del bosque",
  "wordplay": { "op": "hidden", "indicator": "esconde", "in": "queso solo" } }
```

## Qué comprueba el validador

- Que la enumeración de la pista coincida con la respuesta.
- Que la definición aparezca en un extremo de la pista.
- Que el juego de palabras produzca exactamente la respuesta.
- Que los textos `lit` y `hidden` estén realmente en la pista y que los indicadores aparezcan en ella.
- Que las abreviaturas sean conocidas para ese idioma o variante (por ejemplo, `TA` = *thanks* solo en en-GB).
- Que la respuesta no aparezca escrita en la pista fuera de una palabra oculta.
- Que no haya HTML, enlaces ni caracteres de control.

Resultado:
- **verified**: todo se comprobó mecánicamente.
- **asserted**: es coherente, pero tiene afirmaciones semánticas (sinónimos, doble definición, críptica) que debe confirmar una persona.
- **failed**: tiene errores críticos; no se puede publicar.
