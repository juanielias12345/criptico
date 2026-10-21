# Fuentes externas

Play Crípticos solo importa contenido de fuentes que lo permiten. **No hace scraping de sitios que no lo autorizan, respeta `robots.txt`, no elude CAPTCHAs ni bloqueos y nunca republica contenido sin licencia o permiso.**

## Alta de una fuente

En el panel → *Fuentes* → *Nueva*:

1. **Datos**: nombre, URL del feed, sitio de origen, idioma (y variante si corresponde).
2. **Método**: `json_feed`, `rss`, `csv` o `api` (descarga automática), o `manual_upload` (se sube un archivo a mano).
3. **Licencia**: CC0, dominio público, CC BY 4.0, CC BY-SA 4.0, permiso escrito, todos los derechos reservados o desconocida. Solo las cuatro primeras y el permiso escrito permiten republicar.
4. **Tipo de contenido**: `clues` (pistas completas, se pueden republicar si la licencia lo permite) o `metadata` (solo se guarda el identificador y el enlace, nunca el texto).
5. **Atribución**: texto exacto exigido por la licencia; se muestra junto a cada críptico.
6. **Credencial** (opcional): nombre de una variable de entorno, por ejemplo `SOURCE_EJEMPLO_TOKEN`. El valor se carga en Vercel, nunca en el panel ni en el código; se envía como `Authorization: Bearer …`.

La fuente queda en `pending_review` hasta que un propietario la **aprueba**. Sin esa aprobación no se importa nada.

## Las 10 condiciones de publicación automática

Cada elemento importado se publica solo si se cumplen todas; si falla alguna, va a la cola de revisión con el motivo:

1. La fuente está habilitada.
2. Un administrador aprobó la fuente.
3. La licencia o el permiso permiten republicar (y el tipo de contenido es `clues`).
4. El método de obtención está autorizado.
5. Hay texto de atribución cuando la licencia lo exige.
6. No hay errores críticos en pista, respuesta o explicación.
7. Supera la validación automática (por defecto, solo `verified`; los `asserted` van a revisión salvo que se active `publishing.external_allow_asserted`).
8. Idioma, variante y formato (con enumeración) coinciden con la fuente.
9. No es duplicado exacto ni muy parecido a otro del catálogo.
10. La procedencia es verificable: el elemento trae su URL y pertenece al dominio de la fuente.

Además, la base de datos rechaza publicar un críptico externo si la fuente o la licencia no lo permiten, aunque se intente a mano.

## Comportamiento de la descarga

- Agente identificado (`User-Agent: PlayCripticosBot`), con tiempo límite.
- Consulta `robots.txt` antes de descargar (salvo método `api`) y se detiene si lo prohíbe.
- Un 401/403 o la falta de credencial detienen la fuente sin reintentar; un 429 respeta `Retry-After`; los errores temporales se reintentan con espera creciente.
- Cada elemento se guarda una sola vez por `(fuente, id)`: volver a importar no duplica.

## Formatos

### JSON

Un arreglo, o un objeto con `items`:

```json
{
  "items": [
    {
      "id": "2026-10-21-1",
      "url": "https://fuente.example/c/2026-10-21-1",
      "clue": "Ramo revuelto para el sentimiento (4)",
      "answer": "AMOR",
      "definition": "el sentimiento",
      "wordplay": { "op": "anagram", "indicator": "revuelto", "of": [{ "op": "lit", "text": "ramo" }] },
      "language": "es", "variant": "es-AR",
      "category": "sentimientos", "difficulty": 1, "mechanism": "anagram",
      "explanation": "Anagrama de RAMO."
    }
  ]
}
```

El formato de `wordplay` está en [CRIPTICOS.md](CRIPTICOS.md).

### CSV

Primera fila con encabezados; `wordplay` va como JSON entre comillas:

```csv
id,url,clue,answer,definition,language,variant,category,difficulty,mechanism,explanation,wordplay
1,https://fuente.example/c/1,Ramo revuelto para el sentimiento (4),AMOR,el sentimiento,es,,sentimientos,1,anagram,Anagrama de RAMO.,"{""op"":""anagram"",""indicator"":""revuelto"",""of"":[{""op"":""lit"",""text"":""ramo""}]}"
```

### RSS

RSS 2.0 con elementos del espacio de nombres `criptico:`:

```xml
<rss version="2.0" xmlns:criptico="https://cripta.app/ns/criptico">
  <channel>
    <item>
      <guid>2026-10-21-1</guid>
      <link>https://fuente.example/c/2026-10-21-1</link>
      <criptico:clue>Ramo revuelto para el sentimiento (4)</criptico:clue>
      <criptico:answer>AMOR</criptico:answer>
      <criptico:definition>el sentimiento</criptico:definition>
      <criptico:language>es</criptico:language>
      <criptico:wordplay>{"op":"anagram","indicator":"revuelto","of":[{"op":"lit","text":"ramo"}]}</criptico:wordplay>
    </item>
  </channel>
</rss>
```

Sin `criptico:clue` se usa `title`; sin `criptico:explanation`, `description`. También se leen `criptico:variant`, `criptico:category`, `criptico:difficulty` y `criptico:mechanism`.

## Fuentes recomendadas

Lo más seguro es trabajar con autores o editoriales que den **permiso escrito**, o con colecciones publicadas bajo **CC0 o CC BY**. Ante la duda, cargar la fuente como `metadata` (solo enlaces) o con licencia `unknown`: así nada se publica sin revisión humana.
