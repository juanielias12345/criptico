'use strict';

// Configuración desde variables de entorno. No hay secretos en el código:
// ver .env.example y docs/DESPLIEGUE.md.

const path = require('path');

// Dominio público. En producción de Vercel nunca se usa *.vercel.app: los enlaces
// canónicos y el sitemap tienen que apuntar al dominio propio para Google.
const PUBLIC_URL = 'https://playcripticos.com';
function siteUrlFrom(env) {
  const url = (env.SITE_URL || '').replace(/\/$/, '');
  if (env.VERCEL_ENV === 'production' && (!url || /\.vercel\.app$/i.test(url))) return PUBLIC_URL;
  return url || `http://localhost:${Number(env.PORT) || 3000}`;
}

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const cfg = {
    production,
    port: Number(env.PORT) || 3000,
    siteName: env.SITE_NAME || 'Play Crípticos',
    // Código de verificación de Google Search Console (opcional; también se puede verificar por DNS).
    googleSiteVerification: env.GOOGLE_SITE_VERIFICATION || '',
    // Google AdSense: ID de editor (ca-pub-…) y, opcional, un bloque de anuncios manual. Ver docs/MONETIZACION.md.
    adsenseClient: /^ca-pub-\d{10,20}$/.test(env.ADSENSE_CLIENT || '') ? env.ADSENSE_CLIENT : '',
    adsenseSlot: /^\d{6,20}$/.test(env.ADSENSE_SLOT || '') ? env.ADSENSE_SLOT : '',
    // Plan Plus: suscripción de PayPal (mensual y anual). Sin estas claves, el botón de pago queda deshabilitado.
    paypal: {
      env: env.PAYPAL_ENV === 'sandbox' ? 'sandbox' : 'live',
      clientId: env.PAYPAL_CLIENT_ID || '',
      clientSecret: env.PAYPAL_CLIENT_SECRET || '',
      planMonthly: /^P-[A-Z0-9]{6,40}$/.test(env.PAYPAL_PLAN_MONTHLY || '') ? env.PAYPAL_PLAN_MONTHLY : '',
      planYearly: /^P-[A-Z0-9]{6,40}$/.test(env.PAYPAL_PLAN_YEARLY || '') ? env.PAYPAL_PLAN_YEARLY : '',
      webhookId: env.PAYPAL_WEBHOOK_ID || '',
    },
    siteUrl: siteUrlFrom(env),
    databaseUrl: env.DATABASE_URL || `file:${path.join(process.cwd(), 'data', 'criptico.db')}`,
    databaseAuthToken: env.DATABASE_AUTH_TOKEN || undefined,
    ipHashSalt: env.IP_HASH_SALT || '',
    cronSecret: env.CRON_SECRET || '',
    autoMigrate: env.AUTO_MIGRATE ? env.AUTO_MIGRATE === '1' : !production,
    internalScheduler: env.INTERNAL_SCHEDULER === '1',
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : production,
    mfaKey: env.MFA_ENCRYPTION_KEY || '',                     // opcional; si falta se deriva de IP_HASH_SALT
    commit: env.VERCEL_GIT_COMMIT_SHA || null,
    commitMessage: env.VERCEL_GIT_COMMIT_MESSAGE ? env.VERCEL_GIT_COMMIT_MESSAGE.split('\n')[0].slice(0, 120) : null,
  };
  const missing = [];
  if (production) {
    if (!env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!env.IP_HASH_SALT || env.IP_HASH_SALT.length < 16) missing.push('IP_HASH_SALT (16+ caracteres)');
    if (!env.CRON_SECRET || env.CRON_SECRET.length < 16) missing.push('CRON_SECRET (16+ caracteres)');
    if (!env.SITE_URL) missing.push('SITE_URL');
  }
  cfg.missing = missing;
  return cfg;
}

module.exports = { loadConfig };
