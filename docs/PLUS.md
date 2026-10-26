# Play Crípticos Plus

Suscripción opcional: **USD 1,50 por mes** o **USD 12 por año**. Incluye el sitio sin anuncios, el
Críptico Plus del día (dificultad 4 o más, no suma a la racha del diario), la comparación con la
comunidad (últimos 30 días, recalculada como mucho una vez por día), la insignia Plus y avatares
exclusivos. No da ventajas en torneos ni duelos.

## Cobro: Lemon Squeezy

Lemon Squeezy actúa como **vendedor registrado** (merchant of record): cobra con tarjeta o PayPal,
emite los comprobantes y liquida los impuestos de cada país. Paga a la empresa por PayPal o
transferencia bancaria. Se eligió porque PayPal Business no está disponible en Argentina.

Flujo:
1. `POST /api/billing/plus/checkout {plan}` crea un checkout (`POST /v1/checkouts`) con
   `custom.user_id` y vuelve a `/es/plus?plus=ok`.
2. La página consulta `/api/billing/plus` unos segundos mientras llega el webhook.
3. `POST /api/billing/webhook` verifica `X-Signature` (HMAC-SHA256 del cuerpo crudo con el secreto)
   y aplica los avisos `subscription_*`. El dueño de una suscripción queda fijado en el primer
   aviso. `active`, `on_trial` y `past_due` dan Plus hasta `renews_at` + 3 días; `cancelled`
   hasta `ends_at`; `expired`, `unpaid` y `paused` lo quitan. Avisos repetidos se ignoran.

El beneficio vive en `users.plus_until`, que viaja con la sesión: no suma lecturas a Turso.

## Puesta en marcha

1. Crear la cuenta en https://app.lemonsqueezy.com, la tienda «Play Crípticos» y completar la
   verificación de identidad y los datos de cobro (PayPal o banco).
2. Products → New product «Play Crípticos Plus», tipo suscripción, con dos variantes:
   mensual USD 1,50 y anual USD 12. Anotar el número del producto («…» → Copy ID) y el de la tienda
   (Settings → Stores). Las variantes mensual y anual se buscan solas por la API.
3. Settings → API → crear una API key.
4. Settings → Webhooks → `https://playcripticos.com/api/billing/webhook`, un secreto de firma
   largo y los eventos `subscription_created`, `subscription_updated`, `subscription_cancelled`,
   `subscription_resumed`, `subscription_expired`, `subscription_paused`, `subscription_unpaused`,
   `subscription_payment_success`, `subscription_payment_failed`.
5. En Vercel: `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_PRODUCT_ID`,
   `LEMONSQUEEZY_WEBHOOK_SECRET`, y Redeploy (opcional: `LEMONSQUEEZY_VARIANT_MONTHLY` y
   `LEMONSQUEEZY_VARIANT_YEARLY` para fijarlas a mano).
6. En /admin → Legal, aprobar la revisión `plus-ls-2026-10-26` (términos, privacidad y
   encargados). Al publicarse los términos se enciende `billing.lemonsqueezy` y aparece el botón.

Para probar, Lemon Squeezy tiene modo de prueba (Test mode) con tarjetas de prueba; las claves
y variantes de prueba son distintas de las reales.
