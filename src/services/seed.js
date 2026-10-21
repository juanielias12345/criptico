'use strict';

// Carga el catálogo propio (seed/clues.*.json). Son crípticos originales
// escritos para la plataforma; cada uno pasa por el validador antes de publicarse.

const path = require('path');
const fs = require('fs');
const { buildClue, insertClue } = require('./clues');

async function seedCatalog(db, { dir = path.join(__dirname, '..', '..', 'seed'), editorial = 'Equipo editorial' } = {}) {
  const result = { inserted: 0, skipped: 0, failed: [] };
  for (const file of fs.readdirSync(dir).filter((f) => /^clues\.[a-z]{2}\.json$/.test(f)).sort()) {
    const lang = file.split('.')[1];
    const list = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const c of list) {
      const { row, report } = await buildClue(db, { ...c, clue_text: c.clue, language_code: lang, variant_code: c.variant || null });
      if (await db.get('SELECT 1 FROM clues WHERE fingerprint = ?', [row.fingerprint])) { result.skipped++; continue; }
      if (report.errors) { result.failed.push({ clue: c.clue, errors: report.checks.filter((x) => x.level === 'error') }); continue; }
      await insertClue(db, { ...row, origin: 'original', status: 'published', author_name: editorial }, { actorKind: 'seed' });
      result.inserted++;
    }
  }
  return result;
}

module.exports = { seedCatalog };
