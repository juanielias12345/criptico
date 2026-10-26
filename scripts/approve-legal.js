'use strict';

// Aprueba y publica los borradores legales globales pendientes en nombre de un CEO (rol owner),
// igual que el botón de /admin → Legal. Uso: APPROVER_USERNAME=... npm run legal:approve
// Pensado para la acción «Aprobar textos legales», con el consentimiento escrito del CEO.

const { loadConfig } = require('../src/config');
const { openDb, migrate } = require('../src/db');
const { seedReference } = require('../src/db/reference');
const company = require('../src/services/company');

(async () => {
  const config = loadConfig();
  const db = openDb({ url: config.databaseUrl, authToken: config.databaseAuthToken });
  await migrate(db); await seedReference(db);
  const username = String(process.env.APPROVER_USERNAME || '').trim();
  // Se acepta el usuario o el nombre visible; tiene que coincidir con una sola cuenta de CEO.
  // Sin distinguir mayúsculas, tildes ni espacios de más.
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const owners = await db.all("SELECT * FROM users WHERE role = 'owner'");
  const found = owners.filter((u) => username && (norm(u.username) === norm(username) || norm(u.display_name) === norm(username)));
  if (found.length !== 1) {
    throw new Error((found.length ? `«${username}» coincide con varias cuentas.` : `No hay un CEO «${username}».`)
      + ` Cuentas de CEO: ${owners.map((u) => u.username).join(', ') || 'ninguna'}.`);
  }
  const user = found[0];
  console.log(`Aprueba: ${user.username}`);
  const out = await company.approveGlobalLegal(db, user, config.siteUrl);
  for (const x of out.items) console.log(`${x.doc}${x.version ? ' v' + x.version : ''}: ${x.status}`);
  const pay = await db.get("SELECT value FROM settings WHERE key = 'billing.lemonsqueezy'");
  console.log(`Publicados: ${out.published}. Pago de Plus habilitado: ${pay ? pay.value : 'no'}`);
  db.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
