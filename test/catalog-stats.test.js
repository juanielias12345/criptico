'use strict';

const test = require('node:test');
const assert = require('node:assert');
const STATS = require('../src/services/catalog-stats');

test('los conteos del catálogo se calculan una vez y se comparten mientras están vigentes', async () => {
  let calls = 0;
  const db = { all: async () => { calls++; return [{ code: 'es', n: 7 }]; } };
  STATS.setTtl(60000);
  try {
    const [a, b] = await Promise.all([STATS.totalsByLanguage(db), STATS.totalsByLanguage(db)]);
    await STATS.totalsByLanguage(db);
    assert.deepStrictEqual(a, [{ code: 'es', n: 7 }]);
    assert.strictEqual(b, a);
    assert.strictEqual(calls, 1);
    STATS.clear(db);
    await STATS.totalsByLanguage(db);
    assert.strictEqual(calls, 2);
  } finally { STATS.setTtl(0); }
});

test('un error no queda guardado', async () => {
  let calls = 0;
  const db = { all: async () => { calls++; if (calls === 1) throw new Error('caída'); return []; } };
  STATS.setTtl(60000);
  try {
    await assert.rejects(STATS.totalsByLanguage(db));
    assert.deepStrictEqual(await STATS.totalsByLanguage(db), []);
    assert.strictEqual(calls, 2);
  } finally { STATS.setTtl(0); }
});

test('una instancia nueva toma el conteo guardado en la base en lugar de recontar', async () => {
  const { makeEnv } = require('./helpers');
  const env = await makeEnv({ catalog: false });
  STATS.setTtl(60000);
  try {
    let calls = 0;
    const fn = async () => { calls++; return [{ code: 'es', n: 42 }]; };
    assert.deepStrictEqual(await STATS.memo(env.db, 'prueba', fn), [{ code: 'es', n: 42 }]);
    STATS.clear(env.db); // como si arrancara otra instancia
    assert.deepStrictEqual(await STATS.memo(env.db, 'prueba', fn), [{ code: 'es', n: 42 }]);
    assert.strictEqual(calls, 1);
  } finally { STATS.setTtl(0); await env.close(); }
});

test('categoría completa: cuenta solo las categorías con 5 o más publicadas, todas resueltas', async () => {
  const { makeEnv } = require('./helpers');
  const PROFILE = require('../src/services/profile');
  const env = await makeEnv({ spanishOnly: true });
  try {
    const db = env.db;
    const cat = (await db.get("SELECT category, COUNT(*) AS n FROM clues WHERE status = 'published' AND category IS NOT NULL GROUP BY category HAVING n >= 5 ORDER BY n LIMIT 1"));
    assert.ok(cat, 'hace falta una categoría con 5 o más');
    const ids = (await db.all("SELECT id FROM clues WHERE status = 'published' AND category = ?", [cat.category])).map((r) => r.id);
    await db.run('INSERT INTO players(id) VALUES (?)', ['pl-cat']);
    const solve = async (clueId, i) => db.run(`INSERT INTO games(id, player_id, clue_id, mode, started_at, finished_at, result, status)
      VALUES (?,?,?,'infinite',?,?, 'solved', 'solved')`, ['g-cat-' + i, 'pl-cat', clueId, new Date().toISOString(), new Date().toISOString()]);
    for (let i = 0; i < ids.length - 1; i++) await solve(ids[i], i);
    assert.strictEqual((await PROFILE.facts(db, ['pl-cat'])).categories_complete, 0);
    await solve(ids[ids.length - 1], ids.length);
    assert.strictEqual((await PROFILE.facts(db, ['pl-cat'])).categories_complete, 1);
  } finally { await env.close(); }
});
