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
