'use strict';

// Ejecuta lotes del banco de crípticos contra la base configurada (DATABASE_URL).
//
//   node scripts/bank.js status
//   node scripts/bank.js run [--lang es,en] [--difficulty 1,2] [--batches 5] [--size 400] [--concurrency 2] [--minutes 50]
//
// Es reanudable: cada lote retoma desde el último cursor confirmado en la base.
// La GitHub Action «Banco de crípticos» lo corre de forma programada.

const { loadConfig } = require('../src/config');
const { openDb, migrate } = require('../src/db');
const { seedReference } = require('../src/db/reference');
const bank = require('../src/services/bank');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : def;
}
const list = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : null);

function table(m) {
  const rows = [['idioma', 'dif', 'meta', 'generados', 'validados', 'publicados', 'pendientes', 'rechazados', 'duplicados', 'real %', 'faltan', 'estado']];
  for (const c of m.cells) {
    rows.push([c.lang, c.difficulty, c.target, c.generated, c.validated, c.published, c.pending, c.rejected, c.duplicates, c.percent + '%', c.missing, c.status]);
  }
  const t = m.totals;
  rows.push(['total', '', t.target, t.generated, t.validated, t.published, t.pending, t.rejected, t.duplicates, t.percent + '%', t.missing, '']);
  const w = rows[0].map((_, k) => Math.max(...rows.map((r) => String(r[k]).length)));
  return rows.map((r) => r.map((x, k) => String(x).padStart(w[k])).join('  ')).join('\n');
}

(async () => {
  const cmd = process.argv[2] || 'status';
  const config = loadConfig();
  const db = openDb({ url: config.databaseUrl, authToken: config.databaseAuthToken });
  await migrate(db);
  await seedReference(db);
  if (cmd === 'run') {
    const minutes = Number(arg('minutes', 0));
    const startedAt = new Date().toISOString();
    const r = await bank.runCells(db, {
      langs: list(arg('lang')), difficulties: (list(arg('difficulty')) || ['1', '2', '3', '4', '5']).map(Number),
      batches: Number(arg('batches', 1)), size: Number(arg('size', 0)) || undefined, concurrency: Number(arg('concurrency', 2)),
      holder: process.env.GITHUB_RUN_ID ? `gha-${process.env.GITHUB_RUN_ID}` : 'cli',
      deadline: minutes ? Date.now() + minutes * 60000 : undefined,
      log: (m) => console.log(new Date().toISOString(), m),
    });
    const errors = r.results.filter((x) => x.error);
    if (errors.length) process.exitCode = 1;
    // Registro de la ejecución del equipo editorial en el centro de operaciones (con evidencia).
    const pub = r.results.reduce((s, x) => s + (x.published || 0), 0);
    const run = process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : 'línea de comandos';
    await require('../src/services/company').recordAgentRun(db, { agentId: 'editorial', status: errors.length ? 'error' : 'ok', startedAt,
      summary: `${r.results.length} lotes, ${pub} publicados`, evidence: run, error: errors.length ? errors.map((x) => x.error).join('; ').slice(0, 500) : null });
  }
  const m = await bank.matrix(db);
  console.log(table(m));
  console.log(`Auditoría: ${m.audits.pending} pendientes, ${m.audits.ok} aprobadas, ${m.audits.rejected} rechazadas. Generador ${m.generator}.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = require('fs');
    const md = ['| idioma | dif | meta | publicados | pendientes | duplicados | real % | faltan |', '|---|---|---|---|---|---|---|---|',
      ...m.cells.map((c) => `| ${c.lang} | ${c.difficulty} | ${c.target} | ${c.published} | ${c.pending} | ${c.duplicates} | ${c.percent}% | ${c.missing} |`)].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  }
  db.close();
})().catch((e) => { console.error(e); process.exit(1); });
