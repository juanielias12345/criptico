'use strict';

// Acceso a la base de datos. Se usa libSQL: en desarrollo y pruebas es un
// archivo SQLite local; en producción (Vercel) es una base Turso remota.
// Todas las consultas usan parámetros: nunca se concatenan valores en el SQL.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

function toObjects(rs) {
  return rs.rows.map((row) => {
    const o = {};
    rs.columns.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
}

function wrap(exec) {
  return {
    async all(sql, args = []) { return toObjects(await exec({ sql, args })); },
    async get(sql, args = []) { return (await this.all(sql, args))[0] || null; },
    async run(sql, args = []) {
      const rs = await exec({ sql, args });
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid };
    },
  };
}

function openDb({ url, authToken } = {}) {
  const client = createClient({ url, authToken, intMode: 'number' });
  const db = wrap((stmt) => client.execute(stmt));
  db.client = client;
  db.exec = (sql) => client.executeMultiple(sql);

  // Ejecuta fn dentro de una transacción de escritura; revierte si falla.
  db.tx = async (fn) => {
    const tx = await client.transaction('write');
    const t = wrap((stmt) => tx.execute(stmt));
    try {
      const out = await fn(t);
      await tx.commit();
      return out;
    } catch (e) {
      try { await tx.rollback(); } catch { /* ya cerrada */ }
      throw e;
    } finally {
      tx.close();
    }
  };
  db.close = () => client.close();
  return db;
}

async function migrate(db) {
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  const dir = path.join(__dirname, 'migrations');
  const done = new Set((await db.all('SELECT name FROM schema_migrations')).map((r) => r.name));
  const applied = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Una migración que reconstruye tablas declara «-- fk: off». Las claves foráneas se
    // apagan en la misma conexión (fuera de la transacción, como exige SQLite) para que
    // reemplazar una tabla no dispare borrados en cascada; al final se verifican.
    const fkOff = /^--\s*fk:\s*off/m.test(sql);
    try {
      await db.exec(`${fkOff ? 'PRAGMA foreign_keys = OFF;\n' : ''}BEGIN;\n${sql}\nINSERT INTO schema_migrations(name) VALUES ('${file.replace(/'/g, '')}');\nCOMMIT;${fkOff ? '\nPRAGMA foreign_keys = ON;' : ''}`);
    } catch (e) {
      // Si falló a mitad, se deshace todo (en una conexión remota la transacción ya se cerró).
      try { await db.exec('ROLLBACK;'); } catch { /* no había transacción abierta */ }
      if (fkOff) { try { await db.exec('PRAGMA foreign_keys = ON;'); } catch { /* idem */ } }
      throw e;
    }
    if (fkOff) {
      const bad = await db.all('PRAGMA foreign_key_check');
      if (bad.length) throw new Error(`migration ${file}: foreign key check failed (${bad.length})`);
    }
    applied.push(file);
  }
  return applied;
}

module.exports = { openDb, migrate };
