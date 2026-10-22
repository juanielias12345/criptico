# Agentes de crecimiento: redes sociales y estrategia comercial

Pedido del 22/10/2026:
- un agente por red social que mida, haga métricas y proponga cambios de estrategia y publicaciones según los números;
- un gerente de redes que le informe al director de marketing y publicidad;
- un agente que piense cómo ganar dinero con el juego según el mercado y las métricas, con la última palabra de los CEO y ejecución de lo aprobado.

Código en `src/services/growth.js` y `src/services/commercial-market.js`. Pruebas en `test/growth.test.js` y en la prueba de navegador de AI Company HQ. Se ve en `/hq`: salas de Instagram, Facebook, TikTok y YouTube (planta «Redes y comunidad»), «Gerencia de redes sociales» y «Estrategia comercial» (planta «Dirección»).

## 1. Equipo y cadena de mando

| Agente | Informa a | Proceso |
|---|---|---|
| Métricas y estrategia de Instagram, Facebook, TikTok y YouTube (`redes-*`) | Gerencia de redes sociales | Tarea diaria `social_insights` |
| Gerencia de redes sociales (`gerente-redes`) | Dirección de marketing y publicidad | La misma tarea, después de las cuatro redes |
| Dirección de marketing y publicidad (`marketing-direccion`, antes «Dirección de marketing y marca») | Los dos CEO | Recibe el informe consolidado |
| Estrategia comercial y monetización (`estrategia-comercial`) | Los dos CEO | Tarea semanal `commercial_review` |

Las tareas corren con el cron diario de Vercel y con el flujo horario de GitHub «AI Company HQ», y también desde el botón «Analizar ahora» de cada sala. Cada agente registra su propia ejecución con su informe como evidencia (`growth_reports #id`). Los informes no se pueden modificar.

## 2. De dónde salen los números

- **Métricas de cada cuenta** (`social_metrics_daily`): seguidores, seguidores ganados y perdidos, alcance, visualizaciones, interacciones, publicaciones, videos o reels e interacciones en videos, una fila por día. Llegan por dos vías:
  - **Rutina diaria de Metricool**: una sesión programada de Claude lee Metricool con su conector y dispara el flujo «AI Company HQ» con `action = metrics`. El flujo importa las cifras y corre el análisis. Los campos de Metricool por red están en `METRICOOL_FIELDS`. El plan Starter de Metricool no tiene API propia, por eso se usa el conector.
  - **CSV** pegado en la sala de la red, en «Cargar métricas». La columna `fecha` es obligatoria; las columnas de métricas se aceptan en español o inglés (`seguidores`, `alcance`, `interacciones`, `publicaciones`, `reels`, `interacciones_reels`…).

  Una nueva importación del mismo día reemplaza la anterior. Cada importación queda registrada con su fuente y quién la hizo.
- **Resultado real en el juego**: visitas de entrada desde cada red, jugadores nuevos y cuentas por origen, y partidas de esos jugadores. Viene del origen del tráfico del sitio, incluidos los enlaces cortos `/ig`, `/fb`, `/tt` y `/yt`.
- **Calendario**: piezas publicadas, aprobadas para los próximos 7 días y por aprobar en cada red.

Si una red no tiene métricas de los últimos 3 días, su informe lo dice y el agente **no propone nada**. Nunca se estiman cifras.

## 3. Qué mide cada agente de red

El período son los últimos 7 días completos, comparados con los 7 anteriores.

| Indicador | Definición |
|---|---|
| Tasa de interacción | Interacciones ÷ alcance. |
| Interacciones por publicación | Interacciones ÷ publicaciones; se calcula aparte para videos o reels y para imágenes o carruseles. |
| Saldo de seguidores | Ganados − perdidos (o la diferencia de seguidores si no hay ese dato). |
| Visitas por 1.000 de alcance | Visitas al sitio desde la red ÷ alcance × 1.000. |
| Jugadores nuevos | Jugadores cuyo primer origen es la red. |

### Reglas que generan propuestas

Cada regla exige una muestra mínima:

| Regla | Cuándo | Propuesta y plan | Se mide |
|---|---|---|---|
| `format_video` | Con 3 o más de cada tipo, los videos o reels tienen 1,5 veces o más interacciones por pieza que las imágenes | Pasar a video la mitad de las imágenes de las próximas 2 semanas | Interacciones por publicación |
| `engagement_drop` | La tasa de interacción cae más de 30 %, con 300 o más de alcance en las dos semanas | Revisar temas, ganchos y horarios | Tasa de interacción |
| `low_click_through` | Con 1.000 o más de alcance llegan menos de 2 visitas por cada 1.000 | Cierre con invitación a jugar y enlace corto; revisar la biografía | Visitas por 1.000 de alcance |
| `followers_stalled` | Con 5 o más publicaciones, el saldo de seguidores es 0 o negativo | Lista diaria de cuentas para interactuar (a mano) y colaboraciones | Saldo de seguidores |

Una regla no se vuelve a proponer mientras haya otra igual abierta, ni durante los 14 días siguientes a un rechazo.

## 4. Gerencia de redes

Consolida los cuatro informes y le entrega uno a la Dirección de marketing y publicidad, que lo recibe como evento en su ficha. El informe incluye:

- un ranking de redes por jugadores nuevos traídos, desempatado por jugadores por cada 1.000 de alcance;
- las redes sin datos;
- las redes sin publicaciones aprobadas para la semana;
- cómo repartir el esfuerzo, solo cuando hay 20 jugadores nuevos o más desde redes;
- las propuestas abiertas.

## 5. Estrategia comercial

Con métricas reales calcula:
- jugadores activos en 7 y 30 días;
- retención al día 7 (solo con una cohorte de 20 o más);
- cuentas;
- visitas en 30 días;
- seguidores sumados;
- crípticos publicados;
- partidas por jugador.

Con eso evalúa seis líneas de ingreso definidas en `commercial-market.js`. Cada línea tiene requisitos medibles, plan con responsables, riesgos y fuentes fechadas:

1. Licencias a medios y educación (B2B).
2. Suscripción «Play Crípticos+» (freemium).
3. Patrocinio del críptico diario.
4. Publicidad en el sitio.
5. Libros y cuadernillos.
6. Aportes voluntarios.

Solo propone las líneas que cumplen todos sus requisitos, como máximo dos por vez. Los montos aparecen únicamente como escenarios marcados «Estimación (no es promesa)» y con sus supuestos explícitos. Por ejemplo, la suscripción usa la conversión mediana freemium del 2,1 % de RevenueCat 2026. Los umbrales son criterios internos y se pueden ajustar en el archivo.

Fuentes consultadas el 22/10/2026:
- [NYT Games](https://thenewyorktimeshelpcenter.helpjuice.com/360052272251-New-York-Times-Games-Subscription)
- [RevenueCat 2026](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026.md)
- [Mercado Pago Suscripciones](https://www.mercadopago.com.ar/herramientas-para-vender/suscripciones)
- [INMA sobre Nine](https://www.inma.org/blogs/value-content/post.cfm/nine-uses-puzzles-to-drive-premium-subscription-bundles)

## 6. Aprobación, ejecución y medición

1. Cada propuesta entra a la bandeja de aprobaciones, como «Campaña» si es de redes o «Decisión» si es comercial. Lleva la evidencia, el plan, la métrica a medir y la cadena de mando. También se vota desde la sala en `/hq`.
2. **La última palabra es de un CEO.** Una base de datos impide pasar una propuesta a «aprobada» o «en ejecución» sin una aprobación vigente (`approval_required`).
3. Al aprobarse, el plan se convierte en tareas con responsable. Lo que solo puede hacer un CEO (abrir una cuenta de cobro, firmar, fijar precios) queda como tarea bloqueada a su nombre. La aprobación pasa a «ejecutada» con la lista de tareas como evidencia.
4. A los 14 días se mide:
   - redes: la métrica antes y después; si faltan datos, se vuelve a medir cuando lleguen;
   - comercial: el avance de las tareas.
5. Las propuestas rechazadas o retiradas no generan tareas.

## 7. Límites

- Los agentes no publican, no siguen cuentas, no escriben mensajes y no cobran: preparan, proponen y miden. Publicar sigue el flujo del calendario con aprobación.
- Facebook no informa el alcance total de la página: se usa el alcance de las publicaciones del feed. YouTube no informa alcance, así que no se calcula su tasa de interacción.
- Sin una clave de modelo de lenguaje, las propuestas salen de reglas fijas y verificables, no de texto generado.
