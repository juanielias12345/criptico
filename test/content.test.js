'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXAMPLES, LESSONS } = require('../src/views/content');

const seed = { es: require('../seed/clues.es.json'), en: require('../seed/clues.en.json') };
const plain = (parts) => parts.filter(([, r]) => r !== 'enum').map(([s]) => s).join('').replace(/\s+/g, ' ').trim();

// Los ejemplos de la portada y de las lecciones tienen que ser crípticos reales del
// catálogo validado, con la misma respuesta: nada de ejemplos inventados sin revisar.
test('cada ejemplo y lección usa una pista del catálogo validado', () => {
  for (const lang of ['es', 'en']) {
    const tries = [EXAMPLES[lang].home_try, ...LESSONS[lang].flatMap((l) => l.tries)];
    assert.equal(LESSONS[lang].length, 7);
    for (const tr of tries) {
      const clue = plain(tr.parts);
      const hit = seed[lang].find((c) => c.clue.replace(/\s*\([\d,\-]+\)$/, '').trim() === clue);
      assert.ok(hit, `${lang}: «${clue}» no está en el catálogo`);
      assert.equal(hit.answer, tr.answer, `${lang}: «${clue}»`);
    }
    const sp = EXAMPLES[lang].specimen;
    assert.equal([...sp.from].sort().join(''), [...sp.to].sort().join(''), 'la animación de la portada es un anagrama exacto');
  }
});
