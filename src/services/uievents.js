'use strict';

// Contadores diarios de la interfaz para medir invitaciones y siguientes pasos
// (docs/CRECIMIENTO-PRODUCTO.md). Solo día, tipo y cantidad: sin identificadores.

const { now } = require('./util');

// Tipos que acepta el navegador. Los del servidor (signup_*) los suma la ruta de registro.
const CLIENT_KINDS = new Set([
  'prefs_auto',              // «Jugar» empezó con la sugerencia del navegador, sin diálogo
  'signup_prompt_shown', 'signup_prompt_click', 'signup_prompt_dismiss',
  'daily_nudge_shown', 'daily_nudge_click',
  'daily_next_shown',        // al terminar el diario: cuándo llega el próximo
  'next_after_solve',        // «Otro críptico» después de resolver o revelar
]);
const SERVER_KINDS = /^signup_(completed|completed_post_solve|error_[a-z_]{2,30})$/;

async function bump(db, kind, at = now()) {
  if (!CLIENT_KINDS.has(kind) && !SERVER_KINDS.test(kind)) return false;
  await db.run(`INSERT INTO ui_events_daily(day, kind, n) VALUES (?,?,1)
    ON CONFLICT(day, kind) DO UPDATE SET n = n + 1`, [at.slice(0, 10), kind]);
  return true;
}

async function totals(db, from, to) {
  const rows = await db.all('SELECT kind, SUM(n) AS n FROM ui_events_daily WHERE day >= ? AND day < ? GROUP BY kind', [from.slice(0, 10), to.slice(0, 10)]);
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n || 0)]));
}

module.exports = { bump, totals, CLIENT_KINDS };
