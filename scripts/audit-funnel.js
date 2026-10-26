'use strict';

// Auditoría de solo lectura del embudo y la retención (docs/CRECIMIENTO-PRODUCTO.md).
// Lee partidas, jugadores y contadores agregados, y muestra SOLO totales y proporciones:
// nunca imprime identificadores, nombres, correos ni textos escritos por las personas.
// No escribe nada en la base. Uso: DATABASE_URL=… DATABASE_AUTH_TOKEN=… node scripts/audit-funnel.js
// Variables opcionales: AUDIT_FROM (AAAA-MM-DD, por defecto hace 30 días), AUDIT_NOW (ISO).

const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db');

const H = 3600000; const DAY = 24 * H;
// Desfase horario aproximado por país elegido (octubre de 2026). Sin país: Argentina.
const OFFSET = { AR: -3, UY: -3, PY: -3, CL: -3, BR: -3, BO: -4, VE: -4, DO: -4, PR: -4, CU: -4, CO: -5, PE: -5, EC: -5, PA: -5,
  MX: -6, GT: -6, SV: -6, HN: -6, NI: -6, CR: -6, US: -5, CA: -5, ES: 1, AD: 1, FR: 1, IT: 1, DE: 1, PT: 0, GB: 0, GQ: 1 };
const localDay = (t, off) => new Date(t + off * H).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—');
const bucket = (n, edges) => { for (const [lo, hi, label] of edges) if (n >= lo && n <= hi) return label; return '?'; };

function table(title, rows) {
  console.log('\n## ' + title);
  for (const r of rows) console.log('  ' + r.map((x) => String(x)).join(' | '));
}

(async () => {
  const config = loadConfig();
  const db = openDb({ url: config.databaseUrl, authToken: config.databaseAuthToken });
  const NOW = process.env.AUDIT_NOW ? Date.parse(process.env.AUDIT_NOW) : Date.now();
  const FROM = process.env.AUDIT_FROM || new Date(NOW - 30 * DAY).toISOString().slice(0, 10);
  console.log(`Auditoría de embudo · desde ${FROM} · ahora ${new Date(NOW).toISOString()}`);

  const users = new Map((await db.all('SELECT id, role, created_at, plus_until, deleted_at, email IS NOT NULL AS has_email FROM users')).map((u) => [u.id, u]));
  const players = await db.all('SELECT id, user_id, created_at, country_code, origin_source, origin_medium, origin_landing, retired_at FROM players');
  const games = await db.all(`SELECT player_id, started_at, mode, status, hints_used, attempts, daily_date FROM games
    WHERE started_at >= ? ORDER BY player_id, started_at`, [FROM]);
  const byPlayer = new Map();
  for (const g of games) { if (!byPlayer.has(g.player_id)) byPlayer.set(g.player_id, []); byPlayer.get(g.player_id).push(g); }
  const isStaff = (p) => p.user_id && users.get(p.user_id) && users.get(p.user_id).role !== 'player';

  // ── 0. Rango de datos ──
  const range = await db.get('SELECT MIN(started_at) AS a, MAX(started_at) AS b, COUNT(*) AS n FROM games');
  table('Rango de datos (todas las partidas)', [[range.a, range.b, range.n + ' partidas']]);

  // ── 1. Visitas agregadas vs. jugadores nuevos por día ──
  const traffic = await db.all(`SELECT day, SUM(CASE WHEN kind='pageview' THEN n ELSE 0 END) AS pv, SUM(CASE WHEN kind='new_visitor' THEN n ELSE 0 END) AS nv
    FROM traffic_daily WHERE day >= ? GROUP BY day ORDER BY day`, [FROM]);
  const newPlayersByDay = {}; const gamesByDay = {}; const usersByDay = {};
  for (const p of players) if (p.created_at >= FROM && byPlayer.has(p.id) && !isStaff(p)) { const d = p.created_at.slice(0, 10); newPlayersByDay[d] = (newPlayersByDay[d] || 0) + 1; }
  for (const g of games) { const d = g.started_at.slice(0, 10); gamesByDay[d] = (gamesByDay[d] || 0) + 1; }
  for (const u of users.values()) if (u.role === 'player' && !u.deleted_at && u.created_at >= FROM) { const d = u.created_at.slice(0, 10); usersByDay[d] = (usersByDay[d] || 0) + 1; }
  const days = [...new Set([...traffic.map((t) => t.day), ...Object.keys(gamesByDay)])].sort();
  const tmap = new Map(traffic.map((t) => [t.day, t]));
  table('Por día UTC: páginas vistas | «navegadores nuevos» | jugadores nuevos (sin equipo) | partidas | cuentas nuevas | nuevos jugadores ÷ «navegadores nuevos»',
    days.map((d) => { const t = tmap.get(d) || { pv: 0, nv: 0 }; return [d, t.pv, t.nv, newPlayersByDay[d] || 0, gamesByDay[d] || 0, usersByDay[d] || 0, pct(newPlayersByDay[d] || 0, t.nv)]; }));

  // ── 2. Equipo ──
  const staffPlayers = players.filter(isStaff);
  const staffGames = staffPlayers.reduce((s, p) => s + (byPlayer.get(p.id) || []).length, 0);
  table('Cuentas del equipo dentro de las métricas', [[`identificadores de equipo con partidas: ${staffPlayers.filter((p) => byPlayer.has(p.id)).length}`, `partidas del equipo: ${staffGames} de ${games.length} (${pct(staffGames, games.length)})`]]);

  // ── 3. Cohorte: jugadores nuevos del período, sin equipo ──
  const cohort = players.filter((p) => p.created_at >= FROM && byPlayer.has(p.id) && !isStaff(p));
  const stats = cohort.map((p) => {
    const gs = byPlayer.get(p.id);
    const off = OFFSET[p.country_code] ?? -3;
    const t0 = Date.parse(gs[0].started_at);
    const d0utc = gs[0].started_at.slice(0, 10); const d0 = localDay(t0, off);
    const utcDays = new Set(gs.map((g) => g.started_at.slice(0, 10)));
    const locDays = new Set(gs.map((g) => localDay(Date.parse(g.started_at), off)));
    // Sesiones: partidas separadas por menos de 30 minutos.
    let sessions = 1; const gaps = [];
    for (let i = 1; i < gs.length; i++) { const gap = Date.parse(gs[i].started_at) - Date.parse(gs[i - 1].started_at); if (gap > 30 * 60000) { sessions++; gaps.push(gap); } }
    const day0 = gs.filter((g) => localDay(Date.parse(g.started_at), off) === d0);
    const later = (n) => [...locDays].some((d) => d > d0 && d <= addDays(d0, n));
    const ageDays = (NOW - t0) / DAY;
    // El día local de hoy todavía no terminó: solo cuenta quien ya pudo vivir el día N completo.
    const localToday = localDay(NOW, off);
    return {
      p, gs, off, sessions, gaps, ageDays,
      eligD1: addDays(d0, 1) < localToday, eligD3: addDays(d0, 3) < localToday, eligD7: addDays(d0, 7) < localToday,
      d1utc: utcDays.has(addDays(d0utc, 1)), eligD1utc: addDays(d0utc, 1) < new Date(NOW).toISOString().slice(0, 10),
      d1: locDays.has(addDays(d0, 1)), w3: later(3), w7: later(7), anyLater: [...locDays].some((d) => d > d0),
      anyLaterUtc: utcDays.size > 1,
      first: gs[0], day0Solved: day0.filter((g) => g.status === 'solved').length, day0Games: day0.length,
      day0Daily: day0.some((g) => g.mode === 'daily'), day0Hint: day0.some((g) => g.hints_used > 0), day0Revealed: day0.some((g) => g.status === 'revealed'),
      registered: !!p.user_id, hourLocal: new Date(t0 + off * H).getUTCHours(),
      attempted: gs.some((g) => g.attempts > 0), hinted: gs.some((g) => g.hints_used > 0), done: gs.some((g) => ['solved', 'revealed'].includes(g.status)),
      solved: gs.some((g) => g.status === 'solved'), revealedOnly: !gs.some((g) => g.attempts > 0) && gs.some((g) => g.status === 'revealed'),
    };
  });
  const n = stats.length; const c = (f) => stats.filter(f).length;
  table('Embudo recalculado (jugadores nuevos del período, sin cuentas del equipo; cada paso ÷ iniciaron)', [
    ['iniciaron', n], ['respondieron', c((s) => s.attempted), pct(c((s) => s.attempted), n)], ['pidieron pista', c((s) => s.hinted), pct(c((s) => s.hinted), n)],
    ['completaron (resuelto o revelado)', c((s) => s.done), pct(c((s) => s.done), n)], ['resolvieron al menos uno sin revelar', c((s) => s.solved), pct(c((s) => s.solved), n)],
    ['completaron solo revelando, sin responder nunca', c((s) => s.revealedOnly)],
    ['jugaron otro', c((s) => s.gs.length > 1), pct(c((s) => s.gs.length > 1), n)],
    ['otro día UTC (definición del panel, sin ventana)', c((s) => s.anyLaterUtc), pct(c((s) => s.anyLaterUtc), n)],
    ['otro día en su hora local', c((s) => s.anyLater), pct(c((s) => s.anyLater), n)],
    ['con cuenta', c((s) => s.registered), pct(c((s) => s.registered), n)],
  ]);

  // ── 4. Retención con distintas definiciones ──
  const e1u = stats.filter((s) => s.eligD1utc); const e1 = stats.filter((s) => s.eligD1);
  const e3 = stats.filter((s) => s.eligD3); const e7 = stats.filter((s) => s.eligD7);
  const crossMidnight = e1u.filter((s) => s.d1utc && !s.d1).length;
  table('Retención (solo quien ya pudo cumplir la ventana)', [
    ['D1 por día UTC (como el panel)', `${e1u.filter((s) => s.d1utc).length}/${e1u.length}`, pct(e1u.filter((s) => s.d1utc).length, e1u.length)],
    ['D1 por día local (día calendario siguiente en su zona)', `${e1.filter((s) => s.d1).length}/${e1.length}`, pct(e1.filter((s) => s.d1).length, e1.length)],
    ['«D1» UTC que en hora local fue el mismo día (cruce de medianoche UTC)', crossMidnight],
    ['Vuelve dentro de los días locales 1–3', `${e3.filter((s) => s.w3).length}/${e3.length}`, pct(e3.filter((s) => s.w3).length, e3.length)],
    ['Vuelve dentro de los días locales 1–7', `${e7.filter((s) => s.w7).length}/${e7.length}`, pct(e7.filter((s) => s.w7).length, e7.length)],
  ]);

  // ── 5. D1 local según la primera experiencia (correlación, no causalidad) ──
  const seg = (label, f) => { const g = e1.filter(f); return [label, g.length, pct(g.filter((s) => s.d1).length, g.length)]; };
  table('D1 local por comportamiento del día 0 (grupo | tamaño | D1)', [
    seg('0 resueltos el día 0', (s) => s.day0Solved === 0), seg('1 resuelto', (s) => s.day0Solved === 1), seg('2–4 resueltos', (s) => s.day0Solved >= 2 && s.day0Solved <= 4),
    seg('5–9 resueltos', (s) => s.day0Solved >= 5 && s.day0Solved <= 9), seg('10+ resueltos', (s) => s.day0Solved >= 10),
    seg('jugó el desafío diario el día 0', (s) => s.day0Daily), seg('no jugó el diario el día 0', (s) => !s.day0Daily),
    seg('pidió pista el día 0', (s) => s.day0Hint), seg('reveló alguno el día 0', (s) => s.day0Revealed),
    seg('con cuenta', (s) => s.registered), seg('sin cuenta', (s) => !s.registered),
    seg('primera partida resuelta', (s) => s.first.status === 'solved'), seg('primera partida revelada', (s) => s.first.status === 'revealed'),
    seg('primera partida saltada/abandonada', (s) => ['abandoned', 'started', 'in_progress'].includes(s.first.status)),
  ]);

  // ── 6. Primera partida ──
  const firstBy = {}; const firstMode = {};
  for (const s of stats) { firstBy[s.first.status] = (firstBy[s.first.status] || 0) + 1; firstMode[s.first.mode] = (firstMode[s.first.mode] || 0) + 1; }
  table('Primera partida: estado', Object.entries(firstBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, pct(v, n)]));
  table('Primera partida: modo', Object.entries(firstMode).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, pct(v, n)]));

  // ── 7. Distribución de partidas por jugador y de sesiones ──
  const ge = [[1, 1, '1'], [2, 4, '2–4'], [5, 9, '5–9'], [10, 24, '10–24'], [25, 49, '25–49'], [50, 99, '50–99'], [100, 1e9, '100+']];
  const dist = {}; for (const s of stats) { const b = bucket(s.gs.length, ge); dist[b] = (dist[b] || 0) + 1; }
  table('Partidas por jugador (cohorte)', ge.map(([, , l]) => [l, dist[l] || 0, pct(dist[l] || 0, n)]));
  const sorted = stats.map((s) => s.gs.length).sort((a, b) => a - b);
  const q = (x) => sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))];
  table('Partidas por jugador: percentiles', [[`p50 ${q(0.5)}`, `p75 ${q(0.75)}`, `p90 ${q(0.9)}`, `p99 ${q(0.99)}`, `máx ${sorted[sorted.length - 1]}`,
    `top 1% concentra ${pct(sorted.slice(Math.floor(sorted.length * 0.99)).reduce((a, b) => a + b, 0), sorted.reduce((a, b) => a + b, 0))} de las partidas`]]);
  const gapE = [[0, 2 * H, '<2 h'], [2 * H, 6 * H, '2–6 h'], [6 * H, 12 * H, '6–12 h'], [12 * H, 24 * H, '12–24 h'], [24 * H, 48 * H, '24–48 h'], [48 * H, 1e15, '>48 h']];
  const gd = {}; let withSecond = 0;
  for (const s of stats) if (s.gaps.length) { withSecond++; const b = bucket(s.gaps[0], gapE); gd[b] = (gd[b] || 0) + 1; }
  table('Tiempo hasta la segunda sesión (quienes tuvieron una)', gapE.map(([, , l]) => [l, gd[l] || 0, pct(gd[l] || 0, withSecond)]));
  table('Sesiones por jugador', [[`1 sesión: ${pct(c((s) => s.sessions === 1), n)}`, `2: ${pct(c((s) => s.sessions === 2), n)}`, `3+: ${pct(c((s) => s.sessions >= 3), n)}`]]);

  // ── 8. Modos y diario ──
  const modes = {};
  for (const g of games) { modes[g.mode] = modes[g.mode] || { games: 0, players: new Set() }; modes[g.mode].games++; modes[g.mode].players.add(g.player_id); }
  table('Partidas por modo (período, todas las cuentas)', Object.entries(modes).sort((a, b) => b[1].games - a[1].games).map(([k, v]) => [k, v.games, v.players.size + ' jugadores']));
  table('Jugadores de la cohorte que alguna vez jugaron el diario', [[c((s) => s.gs.some((g) => g.mode === 'daily')), pct(c((s) => s.gs.some((g) => g.mode === 'daily')), n)]]);

  // ── 9. Hora local de la primera partida, país y origen ──
  const hours = Array(24).fill(0); for (const s of stats) hours[s.hourLocal]++;
  table('Hora local de la primera partida', [hours.map((v, h) => `${h}h:${v}`)]);
  const ctry = {}; for (const s of stats) { const k = s.p.country_code || '(sin)'; ctry[k] = (ctry[k] || 0) + 1; }
  table('País elegido (cohorte)', Object.entries(ctry).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, v, pct(v, n)]));
  const land = {}; for (const s of stats) { const k = (s.p.origin_landing || '(sin dato)').replace(/^(\/[^/]+\/[^/]+).*/, '$1'); land[k] = land[k] || [0, 0]; land[k][0]++; if (s.eligD1 && s.d1) land[k][1]++; }
  table('Página de llegada (dos primeros tramos) | jugadores', Object.entries(land).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12).map(([k, v]) => [k, v[0]]));
  const src = {}; for (const s of stats) { const k = (s.p.origin_source || '(directo/sin dato)') + ' / ' + (s.p.origin_medium || ''); src[k] = (src[k] || 0) + 1; }
  table('Origen de los jugadores', Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, v, pct(v, n)]));
  const entries = await db.all(`SELECT source, medium, SUM(CASE WHEN kind='entry' THEN n ELSE 0 END) AS e, SUM(CASE WHEN kind='new_visitor' THEN n ELSE 0 END) AS nv
    FROM traffic_sources_daily WHERE day >= ? GROUP BY source, medium ORDER BY e DESC LIMIT 12`, [FROM]);
  table('Visitas de entrada por origen (agregado)', entries.map((r) => [r.source || '(sin)', r.medium || '', r.e, r.nv]));

  // ── 10. Cuentas ──
  const newUsers = [...users.values()].filter((u) => u.role === 'player' && !u.deleted_at && u.created_at >= FROM);
  const userPlayers = new Map(); for (const p of players) if (p.user_id) { if (!userPlayers.has(p.user_id)) userPlayers.set(p.user_id, []); userPlayers.get(p.user_id).push(p); }
  const withGames = newUsers.filter((u) => (userPlayers.get(u.id) || []).some((p) => byPlayer.has(p.id)));
  const playedBefore = newUsers.filter((u) => (userPlayers.get(u.id) || []).some((p) => (byPlayer.get(p.id) || []).some((g) => g.started_at < u.created_at)));
  const playedAfter = newUsers.filter((u) => (userPlayers.get(u.id) || []).some((p) => (byPlayer.get(p.id) || []).some((g) => g.started_at > u.created_at)));
  table('Cuentas de jugador creadas en el período', [
    ['cuentas nuevas', newUsers.length], ['con correo', newUsers.filter((u) => u.has_email).length], ['con partidas vinculadas', withGames.length],
    ['con partidas anteriores al registro (vinculadas)', playedBefore.length], ['jugaron después de registrarse', playedAfter.length],
    ['Plus vigente', [...users.values()].filter((u) => u.plus_until && u.plus_until > new Date(NOW).toISOString()).length],
  ]);

  // ── 11. Errores ──
  const errs = await db.all('SELECT scope, COUNT(*) AS n FROM error_log WHERE created_at >= ? GROUP BY scope ORDER BY n DESC LIMIT 15', [FROM]);
  table('Errores del servidor por ámbito', errs.map((r) => [r.scope, r.n]));
  const gst = {}; for (const g of games) gst[g.status] = (gst[g.status] || 0) + 1;
  table('Estados de las partidas del período', Object.entries(gst).map(([k, v]) => [k, v, pct(v, games.length)]));
  process.exit(0);
})().catch((e) => { console.error('Falló la auditoría:', e.message); process.exit(1); });
