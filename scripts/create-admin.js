'use strict';

// Crea la primera cuenta de administración sin contraseñas por defecto.
// Uso interactivo:   npm run admin:create
// Uso no interactivo (por ejemplo, en CI): ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run admin:create
// La contraseña nunca se muestra ni se guarda en texto plano.

const readline = require('readline');
const { loadConfig } = require('../src/config');
const { openDb, migrate } = require('../src/db');
const { seedReference } = require('../src/db/reference');
const { createUser, passwordProblems } = require('../src/services/auth');

function ask(q, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (v) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(v.trim()); });
  });
}

(async () => {
  const config = loadConfig();
  const db = openDb({ url: config.databaseUrl, authToken: config.databaseAuthToken });
  await migrate(db); await seedReference(db);
  const username = process.env.ADMIN_USERNAME || await ask('Usuario administrador: ');
  const email = process.env.ADMIN_EMAIL || (process.env.ADMIN_USERNAME ? '' : await ask('Correo (opcional): '));
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await ask('Contraseña (mín. 10 caracteres): ', true);
    const again = await ask('Repetí la contraseña: ', true);
    if (password !== again) { console.error('Las contraseñas no coinciden.'); process.exit(1); }
  }
  const problems = passwordProblems(password, username);
  if (problems.length) { console.error('Contraseña débil:', problems.join(', ')); process.exit(1); }
  const role = process.env.ADMIN_ROLE || 'owner';
  const u = await createUser(db, { username, password, email: email || null, role });
  console.log(`Cuenta «${u.username}» creada con rol ${u.role}. Entrá en ${config.siteUrl}/admin`);
  db.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
