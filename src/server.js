'use strict';

// Servidor para desarrollo o para un servidor propio (en Vercel se usa api/index.js).

const { setup } = require('./bootstrap');
const { tick } = require('./services/jobs');

(async () => {
  const { app, config, db } = await setup({ seed: !config_production() });
  app.listen(config.port, () => console.log(`${config.siteName} escuchando en ${config.siteUrl}`));
  if (config.internalScheduler) {
    const run = () => tick(db).catch((e) => console.error('[scheduler]', e));
    setInterval(run, 60 * 1000).unref();
    run();
  }
})().catch((e) => { console.error(e); process.exit(1); });

function config_production() { return process.env.NODE_ENV === 'production'; }
