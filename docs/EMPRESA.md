# Play Crípticos como empresa: gobierno, agentes y operaciones

Este documento describe cómo funciona la empresa dentro del sistema: quién decide, qué puede hacer cada agente sin pedir permiso, cómo se aprueba algo y dónde queda registrado. Todo lo descrito acá está implementado y probado (`test/company.test.js` y la prueba de navegador «empresa: invitar a un CEO…»), salvo lo que se marca explícitamente como **pendiente**.

## 1. Dirección

| Persona | Cargo | Rol en el sistema |
|---|---|---|
| Juan Ignacio Elías | CEO y Súper Administrador | `owner` |
| Inés de Gregorio | CEO y Súper Administradora | `owner` (se suma por invitación) |

- Los dos tienen **exactamente los mismos permisos**. No hay jerarquía ni administrador secundario: el código no distingue entre un CEO y otro.
- Un CEO **solo se suma por invitación** (`Equipo → Invitar a alguien`). La persona invitada elige su usuario y su contraseña; nadie más la conoce. La API rechaza crear un `owner` de forma directa (`owner_requires_invite`).
- Cambiar el rol de un CEO, desactivarlo o convertir a alguien en CEO **no se aplica en el momento**: crea un pedido en la bandeja que tiene que aprobar un CEO.
- Las reglas de seguridad y gobierno (`security.*`, `governance.*`) también pasan por la bandeja.

### Seguridad de cada cuenta (`Mi seguridad`)

- **MFA** con aplicación de autenticación (TOTP, RFC 6238). El secreto se guarda cifrado (AES-256-GCM). Un código usado no vuelve a servir. Se entregan 8 códigos de recuperación de un solo uso.
- **Sesiones**: lista de sesiones abiertas con navegador, última actividad y si pasaron por MFA; se puede cerrar una o todas las demás.
- **Dispositivo nuevo**: un acceso desde una combinación nueva de red y navegador genera una alerta de seguridad en el panel y queda en la auditoría.
- **Recuperación**: otra persona del equipo con permiso genera un enlace de un solo uso (24 h). Al usarlo se cambia la contraseña, se quita MFA y se cierran todas las sesiones. Nadie puede generarse un enlace para su propia cuenta.
- **Política opcional**: `security.require_mfa_owner = true` obliga a los CEO a tener MFA; sin MFA solo pueden entrar a «Mi seguridad».
- **Pendiente**: avisos por correo (no hay proveedor de correo, tarea T-007).

## 2. Bandeja de aprobaciones

Cada pedido tiene tipo, área, resumen, contenido exacto, monto opcional y una política: **un CEO** o **los dos**.

**Decisión de los CEO (22/10/2026): con la aprobación de uno de los dos alcanza para todo** (`governance.dual_approval = false`). Los pedidos que esperaban al segundo CEO se resolvieron con los votos que ya tenían. Si algún día quieren volver a la doble aprobación, se activa ese ajuste en «Reglas y funciones» y vuelve a regir la tabla siguiente:

| Tipo | Política |
|---|---|
| Publicación, campaña, artículo, respuesta pública delicada | Un CEO |
| Funcionalidad, cambio de diseño, cambio en producción, lanzamiento de app, comunicación institucional | Un CEO |
| Términos y políticas legales | Un CEO (nivel 4: nunca se publican solos) |
| Presupuesto o gasto **hasta** `governance.dual_approval_amount_usd` (hoy 100 USD) | Un CEO |
| Gasto **mayor** al umbral, contratos, cambios críticos de seguridad, decisiones legales de alto impacto, cambios de permisos de un CEO | Los dos (solo con `governance.dual_approval` activo; hoy, un CEO) |

Reglas que impone el servidor:

1. **La aprobación es de una versión exacta.** Cada versión guarda el hash del contenido. Votar exige indicar la versión; si el contenido cambió, el voto se rechaza (`stale_version`) y hay que volver a revisar.
2. **Cualquier cambio invalida la aprobación**: editar el contenido crea una versión nueva y el pedido vuelve a «Pendiente».
3. **Instrucciones contradictorias**: si un CEO aprueba y el otro rechaza la misma versión, el pedido queda **en conflicto y en pausa**, y se abre un conflicto que los dos deben resolver. Resolverlo crea una versión nueva para votar otra vez.
4. **Ejecutado exige evidencia**: marcar un pedido como ejecutado pide un enlace o identificador verificable.
5. Rechazar o pedir cambios exige un comentario.

## 3. Registro de auditoría inalterable

`audit_log` registra quién (persona o agente), qué acción, sobre qué objeto, cuándo, detalles, costo, resultado y error. La base **impide** borrar filas y modificarlas (disparadores `audit_log_immutable`). La única modificación permitida es anonimizar la red (`ip_hash`) al cumplirse el plazo de conservación; la tarea de limpieza ya no borra registros.

## 4. Niveles de autonomía

| Nivel | Qué puede hacer el agente | Ejemplos |
|---|---|---|
| 1 | Investigar, analizar y preparar borradores internos sin pedir permiso | Auditorías, informes, borradores de piezas y documentos |
| 2 | Cambios internos reversibles, con pruebas, informando después | Código en una rama, pruebas, documentación, tareas del tablero |
| 3 | Requiere la aprobación de **un** CEO antes de completar | Cambios en producción, publicaciones, gastos menores, campañas |
| 4 | Requiere aprobación explícita de un CEO y nunca se ejecuta solo (los dos, si se activa la doble aprobación) | Seguridad crítica, contratos, textos legales, permisos de un CEO, gastos sobre el umbral |

Una tarea de nivel 3 o 4 no puede marcarse como completada sin un pedido aprobado.

Ningún agente puede: publicar sin aprobación, firmar contratos, pagar sin autorización, borrar bases de datos, eliminar registros de auditoría, desactivar controles de seguridad, cambiar términos públicos sin revisión, inventar permisos, licencias o resultados, ni usar datos personales fuera de los fines autorizados.

## 5. Agentes

El organigrama tiene 51 puestos: los 41 roles pedidos (dirección, investigación y producto, tecnología, UX/UI, programación, calidad, legal) y 10 equipos (editorial, siete de marketing y analítica, comunidad y moderación). Cada uno tiene objetivo, responsabilidades, herramientas, límites, indicadores y nivel de autonomía; se ven en `Centro de operaciones → Agentes`.

**Estado real, no simulado.** El estado de un agente se calcula a partir de procesos que existen:

| Origen | Qué se muestra |
|---|---|
| `none` | «Sin proceso activo» |
| `on_demand` | «A pedido de un CEO» (trabaja cuando alguien se lo pide a Claude) |
| `job:<nombre>` | Última ejecución de esa tarea programada |
| `workflow:bank.yml` | Último lote del banco de crípticos (el flujo registra su ejecución con el enlace de GitHub como evidencia) |
| `workflow:ci.yml` | Resultado de las pruebas en GitHub Actions |

No hay agentes que se llamen entre sí en bucle ni procesos en segundo plano que no estén en esta tabla.

## 6. Tareas

Cada tarea tiene: identificador (`T-nnn`), objetivo, agente responsable, entrada, resultado esperado, dependencias, estado, plazo, costo estimado y real, riesgo, permisos, nivel de aprobación, pedido de aprobación y evidencia. **Completar exige evidencia** (lo comprueban el servidor y la base). Las tareas de la auditoría inicial son T-001 a T-018.

## 7. Contenido y redes

Cada pieza pasa por 13 estados: idea, en investigación, en producción, en edición, revisión de derechos, pendiente de aprobación, aprobada, programada, publicada, pausada, rechazada, requiere cambios y error de publicación.

- Programar exige una aprobación vigente de la versión exacta. Cualquier cambio en el texto, los archivos, la red o el público invalida la aprobación y vuelve la pieza a «pendiente de aprobación».
- **Publicada** exige el enlace `https` a la publicación real. Sin enlace no hay «publicada».
- Una pieza no figura con archivos si solo existe una descripción: el campo de archivos guarda enlaces reales.
- **Piezas cargadas (22/10/2026)**: 4 carruseles con sus imágenes reales (23 PNG en `data/marketing/`, visibles en la bandeja), 1 artículo, 3 guiones de reel (en producción: falta grabar) y 1 newsletter (bloqueada por el correo, T-007). Las 5 listas esperan aprobación.
- **Pendiente**: no hay ninguna red conectada. Metricool está vinculado a Claude pero la marca no tiene redes conectadas (T-011).

## 8. Legal

Los agentes legales **investigan y preparan borradores; no son abogados**. Nada de lo que producen es asesoramiento jurídico.

- **Matriz por jurisdicción** (AR, UY, CL, MX, CO, ES, UE, EE. UU., GB, CA, AU): requisitos, fuentes oficiales, fecha de verificación, riesgo, documentos afectados y si hace falta un abogado local. No se puede cargar un requisito ni marcar «cumple» sin fuentes oficiales y fecha. Al 22/10/2026 hay **hallazgos en borrador** para Argentina, México, España, Unión Europea y EE. UU., con fuentes oficiales y fecha; todas marcadas como «requiere abogado». Hallazgo principal: Argentina exige cláusulas contractuales o consentimiento expreso para transferir datos a Brasil (Turso) y EE. UU. (Vercel), riesgo R-010. El resto de los países sigue sin investigar.
- **15 documentos legales** versionados. Los textos de términos y privacidad que ya estaban en el sitio (es/en) se cargaron como versión 1 «publicada de base», sin revisión profesional. Cada borrador nuevo tiene hash; aprobarlo o publicarlo exige un pedido aprobado con ese hash, y la base lo impide si no coincide. **Nunca se publica un documento legal automáticamente.** Los agentes cargaron 10 borradores (cookies, contenido de usuarios, normas de comunidad, propiedad intelectual, moderación, eliminación de cuenta, consentimientos, encargados de tratamiento, incidentes y contratos) como versión 1 «borrador», con campos `[COMPLETAR]` y la advertencia de que no son asesoramiento jurídico.

## 9. Mejora continua

Ciclo: auditoría → hallazgos categorizados (crítico, importante, experiencia, crecimiento, deuda técnica, legal, integración, decisión humana) → tareas con prioridad → cambios pequeños con pruebas → aprobación si corresponde → publicación → verificación con evidencia. Las pruebas automáticas corren en GitHub Actions en cada cambio de `main` (flujo «Pruebas»).

## 10. Integraciones

Cada integración registra los 7 puntos: qué aporta, permisos, datos, costo, acciones permitidas, limitaciones y qué tiene que hacer un CEO. Estados: verificada (con evidencia), configurada sin verificar, falta, no hace falta. «Verificada» exige evidencia. Se ven en `Centro de operaciones → Integraciones`.

## 11. Qué necesita de los CEO

Ver las tareas bloqueadas en `Centro de operaciones → Dirección`. Al 22/10/2026: invitar a Inés (T-002), activar MFA (T-001), decidir la política de MFA y el umbral de gasto (T-003, T-004), plan de Vercel (T-005), `SITE_URL` y región (T-006), proveedor de correo (T-007), abogado y países prioritarios (T-009, T-010), cuentas de redes (T-011), tecnología y cuentas de tiendas para las apps (T-013, T-014).

### Variable recomendada

`MFA_ENCRYPTION_KEY`: clave propia para cifrar los secretos de MFA (32 bytes aleatorios, por ejemplo `openssl rand -hex 32`). Si no existe se deriva de `IP_HASH_SALT`. **Conviene cargarla en Vercel antes de que alguien active MFA**: si se agrega después, quien ya lo tenía activo tendrá que pedir un enlace de recuperación.
