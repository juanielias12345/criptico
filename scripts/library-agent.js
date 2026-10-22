'use strict';

// Agente Autónomo de Biblioteca contra la base configurada (DATABASE_URL).
//
//   node scripts/library-agent.js status
//   node scripts/library-agent.js run [--minutes 50]
//
// Lo corre la GitHub Action «Agente de biblioteca» cada hora. Cada ejecución
// retoma el ciclo del día desde el último lote confirmado. Sin ANTHROPIC_API_KEY
// o sin presupuesto, deja el ciclo bloqueado y lo informa (no simula trabajo).

const { loadConfig } = require('../src/config');
const { openDb, migrate } = require('../src/db');
const { seedReference } = require('../src/db/reference');
const agent = require('../src/services/library-agent');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : def;
}

function summary(o) {
  const t = o.today.totals || {};
  const lines = [`Estado: ${o.state} · ciclo ${o.today.date} (${o.today.status}${o.today.blocked_reason ? ': ' + o.today.blocked_reason : ''})`,
    `Hoy: ${t.approved || 0} aprobados de ${t.daily_target || 0} · ${t.candidates || 0} candidatos · ${t.needs_review || 0} en revisión · ${t.rejected || 0} rechazados · US$ ${t.cost_usd || 0}`,
    '', '| variante | meta | aprobados | revisión | rechazados | duplicados | cumplimiento | biblioteca | faltan | motivo |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const v of o.variants) lines.push(`| ${v.variant} | ${v.daily_target} | ${v.approved} | ${v.needs_review} | ${v.rejected} | ${v.duplicates} | ${v.compliance}% | ${v.library} | ${v.library_missing} | ${v.shortfall_reason || ''} |`);
  return lines.join('\n');
}

(async () => {
  const cmd = process.argv[2] || 'status';
  const config = loadConfig();
  const db = openDb({ url: config.databaseUrl, authToken: config.databaseAuthToken });
  await migrate(db);
  await seedReference(db);
  if (cmd === 'run') {
    const minutes = Number(arg('minutes', 50));
    const run = process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
    const startedAt = new Date().toISOString();
    const r = await agent.runOnce(db, {
      holder: process.env.GITHUB_RUN_ID ? `gha-${process.env.GITHUB_RUN_ID}` : 'cli',
      deadline: Date.now() + minutes * 60000, evidence: run,
      log: (m) => console.log(new Date().toISOString(), m),
    });
    console.log(JSON.stringify({ status: r.status, summary: r.summary, cycle: r.cycle, blocked: r.blocked || null, skipped: r.skipped || null, recovered: r.recovered }, null, 2));
    if (!r.skipped) {
      await require('../src/services/company').recordAgentRun(db, { agentId: 'editorial', status: r.status === 'error' ? 'error' : 'ok', startedAt,
        summary: `Agente de biblioteca: ${r.summary}`, evidence: run || 'línea de comandos',
        error: r.batches && r.batches.some((b) => b.error) ? r.batches.filter((b) => b.error).map((b) => `${b.variant}: ${b.error}`).join('; ').slice(0, 500) : null });
    }
  }
  const o = await agent.overview(db);
  const text = summary(o);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) require('fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Agente Autónomo de Biblioteca\n\n' + text + '\n');
  db.close();
})().catch((e) => { console.error(e); process.exit(1); });
