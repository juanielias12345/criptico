# Estrategia orgánica según métricas (23/10–10/11/2026)

Qué dicen los números de Metricool, qué cambiamos y qué quedó programado del 20/11 al 3/12. Solo crecimiento orgánico, sin pauta.

## 1. Qué funciona y qué no

| Red | Estado al 10/11 | Lo que funciona | Lo que no |
|---|---|---|---|
| TikTok | 657 seguidores (desde 2) | Videos virales con respuestas de 3–4 letras y truco fácil: LEÓN 30.950 vistas, SOL 18.476, ASA 6.925, RATA 5.435 | Los últimos videos caen (744 → 99 vistas) |
| Instagram | 958 seguidores (desde 419) | Imagen del críptico a las 09:00 (más alcance, 5–17 comentarios). Carruseles educativos: más guardados y compartidos | Promos de producto (torneo, duelos): alcance 126–246. Reels: 6–8 s de visión media en videos de 16 s; 46–88 % se salta |
| Facebook | 5 seguidores | Reels con 200–900 vistas | Casi sin interacción |
| YouTube | 4 suscriptores, máx. 376 vistas | — | **No publica desde el 4/11.** Hay que revisar o reconectar YouTube en Metricool |

Sitio: Google trae el 56 % de las visitas, directo el 30 % e Instagram el 8,6 %. Vuelve al día siguiente cerca del 10,6 % de los visitantes. La palanca principal es que resuelvan su primer críptico.

## 2. Qué cambiamos

1. **Videos más cortos y fáciles.** Serie «Relámpago»: 14 videos de 8,6 s (r01–r14). El críptico abre el video, hay cuenta regresiva de 5 s y una ayuda con la primera letra. Después, la solución en una línea. Respuestas cortas (OSO, MAR, CASA…) como las virales.
2. **TikTok dos veces por día**: Relámpago a las 10:00 y el críptico del día a las 18:00 (las mejores horas medidas). El texto invita a comentar la respuesta.
3. **Instagram**: Relámpago como *trial reel* a las 18:00. Se muestra primero a quien no te sigue, así que es para captar gente nueva. Sigue la imagen de las 09:00 y siguen los carruseles educativos.
4. **YouTube Shorts y reels de Facebook** con el Relámpago, con enlace directo al críptico en el sitio (/es/c/…), para que la persona resuelva su primero.
5. **Menos piezas de producto.** Se sacaron los carruseles de fin de semana en Facebook, que no rendían.
6. **Horarios en 00:00 UTC.** No se nombra ningún país.

Programado: **164 piezas del 20/11 al 3/12** (IG 66, FB 42, TikTok 28, YouTube 28). Calendario en `data/social/semanas-20-11.json`, generado con `scripts/social/relampago/calendario.py <sha>`.

## 3. Tareas manuales

- **Trial reels**: si uno anda bien con no seguidores, compartilo al feed desde Instagram. No se comparte solo.
- **YouTube**: reconectarlo en Metricool. Si no, los Shorts programados van a fallar.
- **Comentarios**: contestar en la primera hora, que es cuando más empuja el algoritmo.

## 4. Respuestas automáticas para comentarios y DM

Sirven para la Bandeja de entrada de Metricool (si el plan tiene respuestas automáticas) o para las automatizaciones nativas de Meta (Meta Business Suite > Bandeja de entrada > Automatizaciones), en Instagram y Facebook. TikTok no deja automatizar DM a terceros.

### Comentario con palabra clave → respuesta pública y DM

| Palabra clave | Respuesta pública | DM |
|---|---|---|
| JUGAR, LINK, ENLACE | ¡Te mandamos el enlace por mensaje! 🧩 | ¡Hola! Acá tenés el críptico de hoy, gratis y sin registrarte: https://playcripticos.com/es/diario Si te trabás, cada uno tiene ayudas. |
| CÓMO, AYUDA, NO ENTIENDO | ¡Te explicamos por mensaje! 💡 | Un críptico tiene dos partes: una **definición** (al principio o al final) y un **juego de palabras** que lleva a la misma respuesta. El número es la cantidad de letras. Guía en 7 pasos: https://playcripticos.com/es/ayuda |
| TRUCOS | ¡Van por mensaje! | Los 5 trucos más comunes: anagrama («revuelto», «loco»), palabra escondida («oculta», «en»), quitar letras («sin», «pierde»), sonar igual («se oye», «suena») y unir partes. Practicalos acá: https://playcripticos.com/es/jugar |

### Primer DM (respuesta de bienvenida)

> ¡Hola! Gracias por escribirnos 🧩 Cada día hay un críptico nuevo en https://playcripticos.com/es/diario (abre a las 00:00 UTC). Si es una consulta, contanos y te respondemos a la brevedad.

### Preguntas frecuentes (botones del DM)

- **¿Es gratis?** Sí. Podés jugar todo gratis y sin registrarte. La cuenta sirve para guardar tu racha.
- **¿A qué hora sale el diario?** A las 00:00 UTC: 18 h México, 19 h Colombia y Perú, 21 h Chile, 1 h España.
- **Tengo un críptico para proponer.** ¡Genial! Mandalo desde https://playcripticos.com/es/contribuir y lo revisamos.

### Más palabras clave para mensajes directos

| Palabra clave | Respuesta |
|---|---|
| TRUCOS | Los 5 trucos más comunes: anagrama («revuelto», «loco»), palabra escondida («oculta», «en»), quitar letras («sin», «pierde»), sonar igual («se oye», «suena») y unir partes. Practicalos acá: https://playcripticos.com/es/jugar |
| PISTA | Cada críptico en la web tiene ayudas paso a paso: primero te marca la definición, después el truco y al final una letra. Probalo acá: https://playcripticos.com/es/diario |
| SOLUCIÓN | ¡No te la podemos spoilear! 😄 La solución sale en historias a las 00:00 UTC. Mientras, en la web podés pedir ayudas sin ver la respuesta: https://playcripticos.com/es/diario |
| EMPEZAR, PRINCIPIANTE | ¡Bienvenido! Arrancá por la guía de 7 pasos, que tiene ejemplos para resolver ahí mismo: https://playcripticos.com/es/ayuda Después probá los de dificultad 1 en https://playcripticos.com/es/jugar |
| DESAFÍO, DUELO | Podés retar a un amigo a un duelo o anotarte en el torneo semanal: https://playcripticos.com/es/desafios |
| TORNEO | El torneo es semanal y gratis. Cada ronda abre a las 00:00 UTC y sumás puntos por cada críptico resuelto: https://playcripticos.com/es/torneos |
| RACHA | Para no perder tu racha, creá una cuenta gratis en la web: así guarda tus resultados aunque cambies de celular. https://playcripticos.com/es/cuenta |
| PROPONER | ¡Nos encanta! Mandá tu críptico desde https://playcripticos.com/es/contribuir Lo revisamos y, si queda, sale con tu nombre. |
| APP | Por ahora no hay app en las tiendas, pero podés instalar la web: abrí playcripticos.com en el celular y elegí «Agregar a la pantalla de inicio». |

Comentarios con palabra clave: TRUCOS (pública «¡Te los mandamos por mensaje! 💡» + DM de TRUCOS) y QUIERO (pública «¡Va por mensaje! 🧩» + DM de JUGAR). Nunca responder automáticamente a todos los comentarios: la gente comenta su respuesta.

### Mensaje automático (fuera de horario, 0 a 9 h)

> ¡Gracias por escribir! Ahora no estamos conectados, pero te respondemos apenas volvamos. Mientras, el críptico de hoy te espera en https://playcripticos.com/es/diario 🧩

Dónde se configura: Meta Business Suite > Mensajes > Automatizaciones (business.facebook.com/latest/inbox/automated_responses). Si Instagram no aparece como canal: en Instagram, Configuración > Mensajes y respuestas a historias > Herramientas conectadas > Permitir acceso a los mensajes.

Regla: las respuestas automáticas nunca dan la solución del día. Las consultas de pagos, cuentas o quejas las contesta una persona.

## 5. Cómo medimos

Medición después del 3/12, comparada con 23/10–10/11:
- TikTok: vistas medianas por video y % de videos de más de 1.000 vistas.
- Instagram: alcance de trial reels con no seguidores, y seguidores nuevos por semana.
- Sitio: visitas desde TikTok, Instagram y YouTube, y cuántas resuelven su primer críptico.

Si Relámpago supera al video largo en TikTok, pasa a ser el formato principal en las próximas semanas.
