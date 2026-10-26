# Play Crípticos Plus

Plan pago opcional, **mensual (USD 1,50)** o **anual (USD 12)**, cobrado con **PayPal**. Jugar sigue siendo gratis.

## Qué incluye

| Beneficio | Dónde está |
|---|---|
| Sin anuncios en todo el sitio (con la sesión iniciada) | `routes/pages.js`: el middleware de anuncios mira `users.plus_until`, que viaja con la sesión (no suma lecturas a la base) |
| Críptico Plus del día: uno difícil (dificultad 4 y 5; si se agotan, 3) distinto del diario común | `services/game.js` → `ensurePlusDaily`, `startPlusDaily`; `POST /api/plus/daily/start`. Modo `plus_daily`, sin `daily_date`: no toca la racha ni el resumen del diario común |
| Vos contra la comunidad: aciertos, tiempo mediano y pistas por dificultad (30 días) | `services/plus.js` → `comparison`; `GET /api/plus/comparison`. Las referencias de la comunidad se guardan en `community_benchmarks` y se recalculan como mucho una vez por día |
| Insignia Plus en el perfil público y los rankings; avatares exclusivos | `services/profile.js` (`PLUS_GLYPHS`, `plus` en el perfil público y en los rankings) |

**Plus nunca da ventajas en torneos ni duelos.**

Página de venta y panel del suscriptor: `/es/plus` (`public/js/plus.js`). En el encabezado hay un botón «Plus» y debajo de cada página con anuncios, un enlace «Jugá sin anuncios con Plus».

## Cómo se cobra

1. `POST /api/billing/plus/checkout {plan}` crea la suscripción en PayPal con el id de la cuenta en `custom_id` y devuelve el enlace de aprobación.
2. PayPal vuelve a `/es/plus?plus=ok&subscription_id=…`. La página llama a `POST /api/billing/plus/confirm`. El servidor consulta la suscripción en PayPal, verifica el plan y que sea de esa cuenta, y actualiza `users.plus_until`.
3. El webhook `POST /api/billing/webhook` mantiene el estado (renovaciones, cancelaciones, suspensiones). La firma se verifica con la API de PayPal (`verify-webhook-signature`) y después se vuelve a leer la suscripción: nunca se confía en el contenido del aviso. Los avisos repetidos se ignoran (`payment_events`).

Hasta cuándo es Plus:
- **Activa:** próximo cobro + 3 días de margen.
- **Cancelada:** hasta el final del período pagado.
- **Suspendida, vencida o sin aprobar:** nada.

El pago se habilita solo cuando estén las **claves de PayPal** y los **términos con Plus** publicados. Los términos son la revisión legal `plus-2026-10-26`; al publicarlos se enciende `billing.enabled`. Mientras tanto, los botones dicen «Muy pronto».

## Puesta en marcha (lo hace un CEO)

1. **Cuenta PayPal Business.** Si tu cuenta es personal, pasala a Business; es gratis y desde ahí retirás el dinero.
2. **Credenciales:** en https://developer.paypal.com → *Apps & Credentials* → pestaña **Live** → *Create App* (nombre: Play Crípticos). Copiá **Client ID** y **Secret**.
3. **Planes.** En PayPal → *Pay & Get Paid* → *Subscriptions* → *Create plan*:
   - **Producto:** «Play Crípticos Plus», tipo servicio / digital.
   - **Plan mensual:** USD 1,50 cada 1 mes, sin período de prueba.
   - **Plan anual:** USD 12 cada 1 año.
   - Copiá el **ID de cada plan** (empieza con `P-`).
4. **Webhook:** en la app de developer.paypal.com → *Add webhook*:
   - **URL:** `https://playcripticos.com/api/billing/webhook`
   - **Eventos:** `BILLING.SUBSCRIPTION.ACTIVATED`, `.UPDATED`, `.CANCELLED`, `.SUSPENDED`, `.EXPIRED`, `.RE-ACTIVATED` y `PAYMENT.SALE.COMPLETED`.
   - Copiá el **Webhook ID**.
5. **Vercel → Settings → Environment Variables (Production):**
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`
   - `PAYPAL_PLAN_MONTHLY`
   - `PAYPAL_PLAN_YEARLY`
   - `PAYPAL_WEBHOOK_ID`

   Para probar con el sandbox de PayPal, además `PAYPAL_ENV=sandbox`. Después, **Redeploy**.
6. **Panel → Legal:** aprobar la versión global. Publica Términos, Privacidad y Registro de proveedores con Plus y PayPal, y habilita el pago.

## Impuestos

PayPal cobra y te paga, pero **no liquida impuestos** (a diferencia de un «vendedor registrado» como Lemon Squeezy o Paddle). Lo cobrado es ingreso del titular y se declara como cualquier otro; conviene revisarlo con un contador.

## Comisiones

PayPal cobra un porcentaje más un monto fijo por cobro. En un pago de USD 1,50 la parte fija pesa mucho, así que el plan anual deja bastante más neto por persona. Si el volumen lo justifica, se puede pedir a PayPal la tarifa de micropagos.
