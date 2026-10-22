# AI Company HQ: oficina virtual y monitoreo de agentes

`/hq` es el centro de mando privado de los dos CEO, Juan Ignacio Elías e Inés de Gregorio. Es una oficina isométrica que se puede recorrer: cada agente es un personaje en su departamento, y su estado sale **solo de registros reales de ejecución**. Las animaciones son decorativas y nunca simulan progreso. Pruebas: `test/hq.test.js` y la prueba de navegador «AI Company HQ…» en `test/e2e/browser.test.js`.

## 1. Acceso y privacidad

- Solo el rol `owner` (los dos CEO) tiene los permisos `hq.read` y `hq.act`. Los dos tienen exactamente los mismos; el código no distingue entre uno y otro. No hay cuentas compartidas.
- La página no está en `public/`: la sirve `src/routes/pages.js` desde `src/views/hq.html` después de comprobar la sesión. Si no hay sesión, redirige a `/admin#hq` y vuelve a `/hq` al entrar. Con otro rol responde 403. Así, entrar con la dirección directa no muestra nada.
- Toda la API está en `/api/admin/hq/*` y cada ruta exige el permiso en el servidor (`src/routes/admin-hq.js`).
- Cada apertura queda en la auditoría (`hq.open`), y cada lectura de un informe también (`hq.report_view`). Los intentos rechazados (403, aprobación faltante, versión vieja, falta de evidencia) se registran como `security.denied`.
- Las pantallas no muestran claves ni tokens: la sala de servidores pasa todo texto por `scrub()`, que tapa cualquier cosa con forma de secreto. Respuestas con `no-store` y `noindex`.

## 2. La oficina

- **Plantas**: PB (recepción y centro de operaciones, sala de reuniones, sala de servidores), oficinas de los dos CEO y los departamentos de tecnología, legal, marketing, redes y comunidad, y producto y contenido. Las salas tienen vistas propias (servidores, cada red social, producto, legal, marketing).
- **Navegación**: arrastrar o pellizcar, rueda para el zoom, botones + − ⤢, búsqueda (`/`), filtros por departamento y estado, vista de lista, atajos `H` (centro de operaciones), `0` (vista general), `1`–`7` (plantas) y `Esc`.
- **Actividad en tiempo real**: el panel «Actividad» muestra los eventos registrados (inicio, etapa, archivo, prueba, resultado, error, pedido de aprobación, bloqueo, fin, costo). Se consulta cada 8 segundos y avisa con un mensaje ante errores, bloqueos y pedidos de aprobación.
- **Funciona en celular**: en pantallas chicas la ficha y la actividad ocupan la pantalla completa.

## 3. Estados de un agente

El estado se calcula en `deriveState` (`src/services/hq.js`), en este orden de prioridad:

| Estado | Cuándo |
|---|---|
| Trabajando / Analizando | Hay una ejecución en curso con latido reciente («Analizando» en etapas de investigación). |
| Sin conexión | La ejecución en curso no da señales hace más de `hq.stale_minutes` (30), o la tarea programada no corre hace más del triple de su intervalo (mínimo 26 h), o no tiene forma de ejecutarse. |
| En pausa | Un CEO pausó las asignaciones, o la tarea programada está desactivada. |
| Error | La última ejecución terminó con error. |
| Bloqueado | Tiene tareas bloqueadas. |
| En revisión | Tiene entregables en revisión o aprobaciones pendientes. |
| Esperando | Tiene tareas abiertas pero no está ejecutando. |
| Inactivo | Ninguna de las anteriores. |

Cada ficha muestra **cuándo se verificó** el dato. Si tiene más de dos días, se marca como desactualizado.

## 4. De dónde sale la actividad

| Fuente | Qué registra |
|---|---|
| Tareas programadas (`src/services/jobs.js`) | Cada `runJob` abre y cierra una ejecución para el agente con `runtime = job:<nombre>`, con evidencia `job_runs #id`. |
| Banco de crípticos (`scripts/bank.js`) | Inicio, latidos durante el lote y resultado. |
| CI (`.github/workflows/ci.yml`) | Al terminar en `main`, registra las ejecuciones de «pruebas» y «qa-visual». |
| Commits | Un commit con la línea `HQ-Agent: id1, id2` registra una ejecución para esos agentes, con los archivos tocados. |
| Registro manual | Workflow «AI Company HQ» → `record`, con agente, estado, resumen y evidencia. |

Los eventos (`agent_events`) no se pueden modificar ni borrar: la base lo impide con triggers. El progreso en porcentaje solo se acepta si viene con su base de cálculo.

## 5. Acciones desde la ficha

Asignar una tarea (con prioridad, criterio de aceptación, nivel de aprobación y fecha), cambiar prioridades, pausar y reanudar, reintentar, pedir un informe del agente, ver dependencias, aprobar o rechazar entregables (atados a la versión exacta) y abrir el código.

**Pausar es seguro**: si el agente tiene una ejecución en curso, el servidor responde `confirm_required` y hay que escribir `PAUSAR` para confirmar. La pausa nunca corta una ejecución a la mitad: bloquea nuevas asignaciones y desactiva la tarea programada, y la ejecución en curso termina sola.

## 6. Informe ejecutivo cada 48 horas

- Lo genera `src/services/hq-reports.js`. Tiene las secciones A–J, la comparación con el período anterior, las limitaciones de visibilidad y las fuentes consultadas. Incluye una **revisión ejecutiva automática**, que aclara que no fue una reunión entre agentes.
- **Programación persistente**: la tarea `exec_report` (cada 2880 minutos) vive en la base. La disparan dos planificadores:
  - el cron diario de Vercel (`/api/cron/tick`);
  - el workflow de GitHub «AI Company HQ», que corre **cada hora** (`scripts/hq.js tick`) usando los secretos `DATABASE_URL` y `DATABASE_AUTH_TOKEN`.
- **Sin duplicados**: cada período tiene una clave única. Un disparo programado antes de tiempo se saltea (`not_due`). Uno manual repetido en el mismo minuto responde 409.
- **Reintentos y recuperación**: un informe fallido o colgado se reintenta y suma intentos. Al reiniciar, `recover_stuck` libera los que quedaron a medias. Si falla, se crea una alerta crítica con causa, impacto, responsable y acción.
- **Zona horaria**: el ajuste `hq.report_timezone` (por defecto `America/Argentina/Buenos_Aires`) se valida al guardarlo.
- **Entrega**: el mismo informe llega a los dos CEO como notificación en el panel. Desde el informe se puede descargar en PDF (impresión) o en `.md`. El historial muestra quién lo leyó.
- **Estado honesto**: la automatización figura como «configurada, sin verificar» hasta que haya un informe programado real que haya salido bien. Recién ahí pasa a «verificada».
- Generación manual: botón «Generar un informe ahora» en Informes.

## 7. Alertas inmediatas

Con severidad, causa, impacto, responsable y acción, y agrupadas para no repetirse: un agente que falla varias veces seguidas (`hq.agent_failure_streak`), un informe atrasado más de 3 h, el presupuesto mensual superado (`hq.monthly_budget_usd`), una publicación sin aprobación, una cuenta de CEO desactivada, bloqueada o con 3 o más ingresos fallidos, intentos de saltear aprobaciones, un riesgo legal alto y una integración que falla seguido.

## 8. Rendimiento de los agentes

Indicadores objetivos para 7 y 30 días, cada uno con su definición en pantalla:

| Indicador | Definición |
|---|---|
| Ejecuciones | Ejecuciones que terminaron en el período (correctas, con error o canceladas). |
| Tasa de éxito | Correctas ÷ (correctas + con error). Se informa con 3 o más ejecuciones. |
| Tareas completadas | Tareas completadas con evidencia. |
| Aprobado a la primera | Entregables aprobados en su primera versión ÷ entregables decididos. |
| Retrabajo | Entregables con cambios pedidos o rechazados. |
| Regresiones | Fallos que siguen inmediatamente a una ejecución correcta. |
| Duración mediana | Mediana de duración de las ejecuciones, en minutos. |
| Costo | Solo costos registrados, nunca estimados. |
| Acciones sin permiso | Rechazos por falta de permiso en la auditoría. |
| Impacto | Tareas completadas de categoría crítica, importante o de crecimiento. |
| Documentación | Ejecuciones con resumen y evidencia ÷ ejecuciones terminadas. |
| Bloqueos ajenos | Bloqueos por permisos, terceros o decisiones de los CEO. Se muestran y **no penalizan**. |

- La calidad (Bien, A observar, Con problemas, Sin datos suficientes) se calcula con esas cifras. Ningún agente se califica a sí mismo.
- **Correcciones**, en este orden: detectar un patrón → mostrar la evidencia → identificar la causa → proponer una corrección (va a la bandeja de aprobaciones) → aplicar → medir. La medición compara antes y después, y la hace sola la tarea `alerts_scan`.

## 9. Qué tienen que configurar los CEO

- **Correo**: no hay proveedor de correo (tarea T-007). Hasta que lo haya, los informes se entregan solo en el panel, y el informe lo dice.
- **Presupuesto** (opcional): `hq.monthly_budget_usd` en Ajustes. Con `0` no hay alerta de presupuesto.
- **Zona horaria** del informe: `hq.report_timezone` en Ajustes.
- El workflow horario usa los secretos de base de datos que ya existen en GitHub.

## 10. Limitaciones

- Solo se ve lo que queda registrado. Un agente que trabaja fuera de estos canales aparece como inactivo o sin conexión, nunca como trabajando.
- Los costos se muestran solo si se cargan. No se estiman.
- La actividad se actualiza por consulta periódica (estado cada 15 s, eventos cada 8 s), no por conexión permanente.
