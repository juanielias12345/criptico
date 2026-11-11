# Play Crípticos Plus

Suscripción opcional: **USD 1,50 por mes** o **USD 12 por año**. Incluye el sitio sin anuncios, el
Críptico Plus del día (dificultad 4 o más, no suma a la racha del diario), la comparación con la
comunidad (últimos 30 días, recalculada como mucho una vez por día), la insignia Plus y avatares
exclusivos. No da ventajas en torneos ni duelos.

## Cobro: Polar

Polar (polar.sh) actúa como **vendedor registrado** (merchant of record): cobra con tarjeta, emite los
comprobantes y liquida los impuestos de cada país. Paga a la cuenta conectada en Finance → Payout
account. Reemplazó a Lemon Squeezy, que no aprobó la tienda (30/10/2026); antes PayPal Business no
estaba disponible.

Flujo:
1. `POST /api/billing/plus/checkout {plan}` crea un checkout (`POST /v1/checkouts/`) con el producto
   del plan, `external_customer_id` y `metadata.user_id` = id de la cuenta, y vuelve a `/es/plus?plus=ok`.
2. La página consulta `/api/billing/plus` unos segundos mientras llega el webhook.
3. `POST /api/billing/webhook` verifica la firma Standard Webhooks (`webhook-id`, `webhook-timestamp`,
   `webhook-signature`: HMAC-SHA256 de `id.timestamp.cuerpo`; acepta el secreto `whsec_…` en base64 o
   sus bytes tal cual) y aplica los avisos `subscription.*`. El dueño de una suscripción queda fijado
   en el primer aviso. `active`, `trialing` y `past_due` dan Plus hasta `current_period_end` + 3 días;
   cancelada (o con `cancel_at_period_end`) hasta `ends_at`; `unpaid`, `incomplete_expired` o
   terminada la quitan. Un mismo `webhook-id` se aplica una vez.
4. `GET /api/billing/plus/portal` abre el portal de cliente de Polar (sesión con `external_customer_id`)
   para administrar o cancelar.

El beneficio vive en `users.plus_until`, que viaja con la sesión: no suma lecturas a Turso.

## Puesta en marcha

1. Crear la cuenta en https://polar.sh y la organización «Play Crípticos»; en Finance → Payout account
   conectar el cobro y verificar la identidad.
2. Products → dos productos de suscripción: mensual USD 1,50 (month) y anual USD 12 (year). Anotar
   sus ids (UUID).
3. Settings → Developers → token de organización con `checkouts:write`, `customer_sessions:write`,
   `products:read` y `subscriptions:read`.
4. Settings → Webhooks → `https://playcripticos.com/api/billing/webhook`, formato Raw, eventos
   `subscription.*`. Anotar el secreto.
5. En Vercel: `POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_MONTHLY`, `POLAR_PRODUCT_YEARLY`,
   `POLAR_WEBHOOK_SECRET` y Redeploy. Se pueden borrar las `LEMONSQUEEZY_*`.
6. En /admin → Legal (o Actions → «Aprobar textos legales»), aprobar la revisión
   `plus-polar-2026-11-11` (términos, privacidad y encargados). Al publicarse los términos se
   enciende `billing.polar` y aparece el botón.

Para probar sin cobrar: crear un descuento del 100% en Polar, o usar https://sandbox.polar.sh con
`POLAR_SERVER=sandbox` (claves y productos del sandbox, distintos de los reales).

## Conseguir suscriptores (sin ventajas en torneos ni duelos)

- **Prueba gratis del día** (`growth.plus_taste`): cualquier cuenta sin Plus juega gratis el primero de
  los 10 Crípticos Plus del día, en /es/plus («Probá gratis…»). Al terminarlo ve cuántos le quedan y el
  botón «Quiero los 10». Si después se suscribe, ese críptico ya cuenta como jugado. Sin cuenta, la
  página invita a crear una para probarlo.
- **Invitación al resolver** (`growth.plus_upsell`, `growth.plus_upsell_after` = 5): en el modo libre,
  a una cuenta sin Plus que resolvió 5 en la sesión o uno difícil (4★ o más). Una vez por sesión;
  «Ahora no» la calla 7 días en ese navegador. Al terminar el diario, el aviso del próximo suma
  «Mientras tanto: probá gratis el Críptico Plus de hoy».
- **Garantía visible**: debajo de los planes, la garantía de 10 días (la misma de los términos).
- **Embudo** en /admin → Crecimiento → «Invitaciones y siguientes pasos»: invitación mostrada /
  tocada / cerrada, prueba empezada / terminada / «Quiero los 10», visitas a la página, clics en
  pagar (mensual / anual), pagos abiertos y suscripciones nuevas. Contadores diarios sin identificadores.

Cada interruptor se apaga en /admin → Ajustes sin desplegar.

## Panel: Plus (suscriptores y embudo)

/admin → «Plus: suscriptores y embudo» (permiso `analytics.read`; los nombres de quién compró, solo
con `players.read`). Muestra suscriptores activos (mensual / anual), cancelaciones que siguen hasta fin
de período, ingreso mensual estimado (antes de comisiones; el dato exacto está en Polar), compras y
bajas del período, el embudo completo (invitación → página → prueba gratis → clic en pagar → pago
abierto → compra), el gráfico día por día y la lista de las últimas 100 compras con cuenta, plan,
estado y fecha. El Resumen del panel suma una fila «Plus» con los mismos números clave.
API: `GET /api/admin/analytics/plus?period=30d`.
