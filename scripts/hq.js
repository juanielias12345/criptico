'use strict';

// AI Company HQ desde la línea de comandos o GitHub Actions (ver docs/HQ.md).
//
//   node scripts/hq.js tick        corre las tareas de HQ vencidas (informe de 48 h, alertas, recuperación)
//   node scripts/hq.js record-ci   registra la corrida de «Pruebas» y los commits con «HQ-Agent:»
//   node scripts/hq.js record      registra una ejecución a mano (variables HQ_AGENT, HQ_STATUS, HQ_SUMMARY, HQ_EVIDENCE, HQ_STAGE, HQ_TASK)
//   node scripts/hq.js metrics     importa métricas de redes (HQ_METRICS: JSON de Metricool) y corre los agentes de redes (docs/CRECIMIENTO.md)
//
// No aplica migraciones: si la base todavía no tiene las tablas de HQ (el despliegue
// las crea), avisa y termina sin error para no competir con el despliegue.

const fs = require('fs');
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');

const HQ_JOBS = ['exec_report', 'alerts_scan', 'recover_stuck', 'social_insights', 'commercial_review'];

async function ready(db) {
  const t = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_events'");
  const j = await db.get("SELECT name FROM jobs WHERE name = 'exec_report'").catch(() => null);
  return !!(t && j);
}

const runUrl = () => (process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null);

async function recordCi(db) {
  const hq = require('../src/services/hq');
  const status = { success: 'ok', failure: 'error', cancelled: 'cancelled' }[process.env.CI_STATUS] || 'error';
  const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
  const evidence = runUrl() || 'línea de comandos';
  const startedAt = process.env.CI_STARTED_AT || undefined;
  for (const agentId of ['pruebas', 'qa-visual']) {
    await hq.recordCompletedRun(db, { agentId, status, startedAt, source: 'workflow', stage: 'testing', evidence,
      summary: `Pruebas unitarias, de integración y en navegador sobre ${sha || 'el commit'}`,
      tests: { status: process.env.CI_STATUS, message: `Flujo «Pruebas»: ${process.env.CI_STATUS || 'sin estado'}` },
      error: status === 'error' ? 'Fallaron las pruebas (ver el registro del flujo)' : null });
  }
  // Commits con la línea «HQ-Agent: id1, id2»: trabajo de agentes con evidencia (commit y archivos).
  let event = null;
  try { event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')); } catch { /* sin evento */ }
  const known = new Set((await db.all('SELECT id FROM agents')).map((a) => a.id));
  let n = 0;
  for (const c of (event && event.commits) || []) {
    const ids = [...String(c.message).matchAll(/^HQ-Agent:\s*(.+)$/gim)].flatMap((m) => m[1].split(',').map((x) => x.trim())).filter((x) => known.has(x));
    for (const agentId of [...new Set(ids)]) {
      await hq.recordCompletedRun(db, { agentId, status: status === 'ok' ? 'ok' : 'error', startedAt: c.timestamp, source: 'commit', stage: 'implementation',
        summary: String(c.message).split('\n')[0].slice(0, 200), evidence: c.url,
        files: [...(c.added || []), ...(c.modified || []), ...(c.removed || [])],
        tests: { status: process.env.CI_STATUS, message: `Pruebas del commit: ${process.env.CI_STATUS || 'sin estado'}`, run: runUrl() },
        error: status === 'ok' ? null : 'Las pruebas fallaron después de este commit' });
      n++;
    }
  }
  return { ci: status, commits_recorded: n };
}

// Métricas diarias por red traídas de Metricool por la rutina diaria:
// HQ_METRICS = [{ "network": "instagram", "rows": [{ "day": "2026-10-21", "followers": 120, "reach": 900, ... }] }, ...]
async function importMetrics(db) {
  const growth = require('../src/services/growth');
  let payload;
  try { payload = JSON.parse(process.env.HQ_METRICS || ''); } catch { throw new Error('HQ_METRICS no es un JSON válido'); }
  const list = Array.isArray(payload) ? payload : [payload];
  const imported = [];
  for (const x of list) if (x && x.rows && x.rows.length) imported.push(...(await growth.importMetrics(db, { network: x.network, rows: x.rows, source: 'metricool' }, { id: null, username: 'rutina Metricool' })).imported);
  await db.run("UPDATE jobs SET next_run_at = ? WHERE name = 'social_insights'", [new Date().toISOString()]);
  const run = await require('../src/services/jobs').runJob(db, 'social_insights');
  return { imported, analysis: run.status || run.skipped };
}

async function recordManual(db) {
  const hq = require('../src/services/hq');
  const e = process.env;
  if (!e.HQ_AGENT || !e.HQ_SUMMARY) throw new Error('Faltan HQ_AGENT y HQ_SUMMARY');
  const id = await hq.recordCompletedRun(db, { agentId: e.HQ_AGENT, status: e.HQ_STATUS || 'ok', summary: e.HQ_SUMMARY, evidence: e.HQ_EVIDENCE || runUrl(),
    stage: e.HQ_STAGE || null, taskId: e.HQ_TASK || null, source: process.env.GITHUB_RUN_ID ? 'workflow' : 'cli', error: e.HQ_STATUS === 'error' ? e.HQ_SUMMARY : null });
  return { run: id };
}

(async () => {
  const cmd = process.argv[2] || 'tick';
  const config = loadConfig();
  if (process.env.GITHUB_ACTIONS && !process.env.DATABASE_URL) { console.log('Sin DATABASE_URL: no hay dónde registrar.'); return; }
  const db = openDb({ url: config.databaseUrl, authToken: config.databaseAuthToken });
  if (!(await ready(db))) { console.log('La base todavía no tiene las tablas de AI Company HQ: se crean en el próximo despliegue.'); return; }
  let out;
  if (cmd === 'tick') out = await require('../src/services/jobs').tick(db, { only: HQ_JOBS, siteUrl: config.siteUrl });
  else if (cmd === 'record-ci') out = await recordCi(db);
  else if (cmd === 'record') out = await recordManual(db);
  else if (cmd === 'metrics') out = await importMetrics(db);
  else throw new Error('Comando desconocido: ' + cmd);
  console.log(JSON.stringify(out, null, 2));
  if (cmd === 'tick' && out.some((r) => r.status === 'failed')) process.exitCode = 1;
  db.close();
})().catch((e) => { console.error(e); process.exit(1); });
