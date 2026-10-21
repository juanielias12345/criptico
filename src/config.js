'use strict';

// Configuración desde variables de entorno. No hay secretos en el código:
// ver .env.example y docs/DESPLIEGUE.md.

const path = require('path');

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const cfg = {
    production,
    port: Number(env.PORT) || 3000,
    siteName: env.SITE_NAME || 'Play Crípticos',
    siteUrl: (env.SITE_URL || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL || `file:${path.join(process.cwd(), 'data', 'criptico.db')}`,
    databaseAuthToken: env.DATABASE_AUTH_TOKEN || undefined,
    ipHashSalt: env.IP_HASH_SALT || '',
    cronSecret: env.CRON_SECRET || '',
    autoMigrate: env.AUTO_MIGRATE ? env.AUTO_MIGRATE === '1' : !production,
    internalScheduler: env.INTERNAL_SCHEDULER === '1',
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : production,
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
