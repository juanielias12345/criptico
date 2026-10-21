'use strict';

// Crea la conexión, aplica migraciones si corresponde y devuelve la app.
// Se reutiliza entre invocaciones de la misma instancia serverless.

const { loadConfig } = require('./config');
const { openDb, migrate } = require('./db');
const { seedReference } = require('./db/reference');
const { createApp } = require('./app');

let ready;

async function setup({ env = process.env, seed = false } = {}) {
  const config = loadConfig(env);
  if (config.missing.length) throw new Error('Faltan variables de entorno: ' + config.missing.join(', '));
  if (config.databaseUrl.startsWith('file:')) {
    require('fs').mkdirSync(require('path').dirname(config.databaseUrl.slice(5)), { recursive: true });
  }
  const db = openDb({ url: config.databaseUrl, authToken: config.databaseAuthToken });
  if (config.autoMigrate || seed) {
    await migrate(db);
    await seedReference(db);
  }
  if (seed) {
    const { seedCatalog } = require('./services/seed');
    await seedCatalog(db);
  }
  return { config, db, app: createApp({ db, config }) };
}

function getApp() {
  if (!ready) ready = setup().catch((e) => { ready = null; throw e; });
  return ready;
}

module.exports = { setup, getApp };
