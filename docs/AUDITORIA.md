# Auditoría inicial — 22/10/2026

Revisión del proyecto real (repositorio, base de producción a través de los flujos de GitHub, despliegues de Vercel y configuración) antes de convertirlo en empresa. Cada hallazgo indica qué se hizo y qué falta. Las tareas `T-nnn` y riesgos `R-nnn` están cargados en el centro de operaciones.

## Estado general

- Sitio en producción en playcripticos.com (Vercel, Node 22 + Express, Turso en São Paulo). ~9.500 líneas de JavaScript propio.
- `npm audit`: 0 vulnerabilidades conocidas.
- Banco: 16.696 crípticos generados publicados de una meta de 100.000; el generador actual está agotado en todas las celdas (ver docs/BANCO.md).
- No existen aplicaciones móviles: solo el sitio con manifiesto instalable (corregido el 22/10/2026: decía «Cripta» y no tenía íconos PNG; ahora tiene nombre, íconos de 192/512, adaptable y de Apple).
- No hay cuentas de redes sociales conectadas.

## Hallazgos

| Categoría | Hallazgo | Qué se hizo | Qué falta |
|---|---|---|---|
| Crítico | Cuentas de superadministrador sin segundo factor | MFA (TOTP), códigos de recuperación, sesiones revocables, alertas de dispositivo nuevo | Que cada CEO lo active (T-001); decidir si es obligatorio (T-003) |
| Crítico | La limpieza programada borraba registros de auditoría | Auditoría inalterable en la base; la limpieza solo anonimiza la red | — |
| Crítico | Un único superadministrador; sin forma segura de sumar al segundo CEO | Invitaciones de un solo uso; cambios sobre un CEO con aprobación doble | Generar la invitación de Inés (T-002) |
| Crítico | Vercel Hobby no admite uso comercial | Registrado como riesgo R-001 | Decisión y pago (T-005) |
| Importante | Sin pruebas automáticas en cada cambio | Flujo «Pruebas» en GitHub Actions (unitarias y navegador) | — |
| Importante | Sin recuperación de cuenta | Enlaces de recuperación entre integrantes del equipo | Correo transaccional (T-007) |
| Importante | `SITE_URL` y región de funciones pendientes | — | Configurar en Vercel (T-006) |
| Importante | Sin monitoreo de errores externo | Los errores quedan en el panel | Proveedor (T-008) |
| Importante | Copias de Turso no verificadas | — | Prueba de restauración (T-018) |
| Importante | 346 crípticos del banco esperan auditoría humana | Cola en el panel | Revisión (T-015) |
| Legal | Términos y privacidad sin revisión profesional | Cargados como versión 1 de base; nuevos borradores requieren aprobación | Abogado (T-009) |
| Legal | Requisitos por país sin investigar | Matriz de 11 jurisdicciones con campos y reglas de evidencia | Elegir países (T-010) |
| Integración | Ninguna red social conectada | Metricool vinculado a Claude, pero la marca no tiene redes | Conectar o crear cuentas (T-011) |
| Integración | Sin cuentas de tiendas | — | T-014 |
| Decisión humana | Umbral de gasto para aprobación doble | Ajuste en 100 USD, editable solo con aprobación de los dos | Confirmar (T-004) |
| Decisión humana | Tecnología de apps | — | T-013 |
| Crecimiento | Sin plan de lanzamiento | Flujo de contenido con 13 estados y aprobación por versión | Plan de 90 días (T-012) |
| Deuda técnica | El generador del banco no alcanza la meta | — | Nueva versión (T-016) |

## Lo que no se pudo verificar

- El entorno de trabajo de Claude no llega al sitio en vivo ni a Turso directamente; la base se verificó a través de los flujos de GitHub Actions y los despliegues a través de los estados de Vercel en GitHub.
- La ejecución del cron diario de Vercel no se pudo observar (integración «configurada sin verificar»).
