'use strict';

// Aplica migraciones, datos de referencia y el catálogo propio. Es idempotente:
// se puede correr en cada despliegue (Vercel lo hace en "vercel-build").

const { loadConfig } = require('../src/config');
const { openDb, migrate } = require('../src/db');
const { seedReference } = require('../src/db/reference');
const { seedCatalog } = require('../src/services/seed');

(async () => {
  const config = loadConfig();
  if (!process.env.DATABASE_URL && process.env.VERCEL) {
    console.error('Falta DATABASE_URL: configurala en Vercel antes de desplegar.');
    process.exit(1);
  }
  const db = openDb({ url: config.databaseUrl, authToken: config.databaseAuthToken });
  const applied = await migrate(db);
  await seedReference(db);
  const r = process.argv.includes('--no-catalog') ? null : await seedCatalog(db, { editorial: process.env.EDITORIAL_NAME || 'Equipo editorial' });
  console.log('Migraciones aplicadas:', applied.length ? applied.join(', ') : 'ninguna (ya estaba al día)');
  if (r) {
    console.log(`Catálogo: ${r.inserted} nuevos, ${r.skipped} ya existían, ${r.failed.length} con errores.`);
    for (const f of r.failed) console.log('  ✗', f.clue, f.errors.map((e) => e.code).join(', '));
    if (r.failed.length) process.exitCode = 1;
  }
  db.close();
})().catch((e) => { console.error(e); process.exit(1); });
