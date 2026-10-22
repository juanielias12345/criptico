'use strict';

// Agentes de crecimiento.
//  - Un agente por red (Instagram, Facebook, TikTok, YouTube) mide con cifras importadas y con el
//    origen real del tráfico del sitio, y propone cambios de estrategia y publicaciones.
//  - El gerente de redes consolida las cuatro redes y le informa a la Dirección de marketing y publicidad.
//  - El agente comercial evalúa líneas de ingreso con las métricas reales del juego y el estudio de mercado.
// Ninguna propuesta se ejecuta sin la aprobación de un CEO (bandeja de aprobaciones). Al aprobarse,
// el plan se convierte en tareas con responsable y después se mide el resultado.
// Sin datos no hay propuestas: el informe dice qué falta. Nada se estima sin marcarlo como estimación.

const { uuid, now, parseJson, HttpError } = require('./util');
const { audit } = require('./audit');
const gov = require('./governance');
const hq = require('./hq');
const MARKET = require('./commercial-market');

const DAY = 86400000;
const NETWORKS = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
const MANAGER = 'gerente-redes';
const DIRECTOR = 'marketing-direccion';
const COMMERCIAL = 'estrategia-comercial';
const SYSTEM = { id: null, username: 'sistema' };
const MEASURE_DAYS = 14;
const STALE_DAYS = 3;

// Métricas aceptadas y sus nombres alternativos (CSV de Metricool en inglés o planillas en español).
const METRIC_ALIASES = {
  followers: ['followers', 'seguidores', 'subscribers', 'suscriptores', 'fans'],
  followers_gained: ['followers_gained', 'followersgained', 'seguidores_ganados', 'nuevos_seguidores', 'new_followers', 'follows'],
  followers_lost: ['followers_lost', 'followerslost', 'seguidores_perdidos'],
  reach: ['reach', 'alcance'],
  views: ['views', 'impressions', 'impresiones', 'visualizaciones', 'vistas'],
  interactions: ['interactions', 'interacciones', 'postsinteractions', 'engagement_total', 'total_interactions'],
  posts: ['posts', 'publicaciones', 'postscount', 'contenidos'],
  videos: ['videos', 'reels', 'videos_publicados'],
  video_interactions: ['video_interactions', 'reels_interactions', 'reelsinteractions', 'interacciones_reels', 'interacciones_videos'],
  video_views: ['video_views', 'reels_views', 'reelsviews', 'reproducciones'],
  clicks: ['clicks', 'clics', 'link_clicks', 'website_clicks'],
};
const METRIC_LABELS = {
  followers: 'Seguidores', followers_gained: 'Seguidores ganados', followers_lost: 'Seguidores perdidos', reach: 'Alcance', views: 'Visualizaciones',
  interactions: 'Interacciones', posts: 'Publicaciones', videos: 'Videos o reels', video_interactions: 'Interacciones en videos', video_views: 'Reproducciones', clicks: 'Clics',
};
// Campos de Metricool (getAnalyticsDataByMetrics) que trae la rutina diaria para cada métrica.
// Un arreglo se suma. Facebook no da alcance total de la página: se usa el del feed. YouTube no da alcance.
const METRICOOL_FIELDS = {
  instagram: { followers: 'IGEV01', followers_gained: 'IGEV43', followers_lost: 'IGEV44', reach: 'IGEV06', views: 'IGEV05', interactions: 'IGEV38', posts: 'IGEV37', videos: 'IGEV22', video_interactions: 'IGEV25', video_views: 'IGEV23' },
  facebook: { followers: 'FBEV17', followers_gained: 'FBEV47', followers_lost: 'FBEV48', reach: 'FBEV20', views: 'FBEV49', interactions: 'FBEV34', posts: 'FBEV33', videos: 'FBEV21', video_interactions: 'FBEV26', video_views: 'FBEV22' },
  tiktok: { followers: 'TKEV07', followers_gained: 'TKEV16', followers_lost: 'TKEV17', reach: 'TKEV11', views: 'TKEV12', interactions: 'TKEV06', posts: 'TKEV01', videos: 'TKEV01', video_interactions: 'TKEV06' },
  youtube: { followers: 'YTEV01', followers_gained: 'YTEV05', followers_lost: 'YTEV06', views: 'YTEV02', interactions: ['YTEV10', 'YTEV12', 'YTEV19'], posts: 'YTEV04', videos: 'YTEV04', video_interactions: ['YTEV10', 'YTEV12', 'YTEV19'], video_views: 'YTEV02' },
};
const ALIAS = Object.fromEntries(Object.entries(METRIC_ALIASES).flatMap(([k, v]) => v.map((a) => [a, k])));
const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s.-]+/g, '_');

const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const ratio = (a, b) => (b > 0 && a != null ? a / b : null);

function parseDay(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
function parseNumber(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  let s = String(v).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// CSV con una fila por día: fecha + columnas de métricas (y opcionalmente «red»).
function parseCsv(text, network) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new HttpError(400, 'csv_empty', 'El archivo necesita una fila de encabezados y al menos un día.');
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : (lines[0].includes('\t') ? '\t' : ',');
  const split = (l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]).map(norm);
  const dayCol = head.findIndex((h) => ['fecha', 'date', 'day', 'dia'].includes(h));
  if (dayCol < 0) throw new HttpError(400, 'csv_no_date', 'Falta la columna «fecha».');
  const netCol = head.findIndex((h) => ['red', 'network', 'plataforma'].includes(h));
  const cols = head.map((h, i) => [i, ALIAS[h]]).filter(([, k]) => k);
  if (!cols.length) throw new HttpError(400, 'csv_no_metrics', 'No se reconoció ninguna columna de métricas. Usá por ejemplo: seguidores, alcance, interacciones, publicaciones.');
  const byNet = {};
  for (const [i, l] of lines.slice(1).entries()) {
    const c = split(l);
    const day = parseDay(c[dayCol]);
    if (!day) throw new HttpError(400, 'csv_bad_date', `Fecha inválida en la fila ${i + 2}.`);
    const net = netCol >= 0 ? norm(c[netCol]) : network;
    if (!NETWORKS[net]) throw new HttpError(400, 'invalid_network', `Red desconocida en la fila ${i + 2}.`);
    const row = { day };
    for (const [ci, k] of cols) {
      const n = parseNumber(c[ci]);
      if (Number.isNaN(n)) throw new HttpError(400, 'csv_bad_number', `Valor no numérico en la fila ${i + 2}, columna ${head[ci]}.`);
      if (n !== null) row[k] = n;
    }
    (byNet[net] = byNet[net] || []).push(row);
  }
  return byNet;
}

// Guarda métricas diarias. Una nueva importación del mismo día reemplaza la anterior.
async function importMetrics(db, { network, rows, source = 'manual', csv }, actor) {
  if (!['metricool', 'csv', 'manual'].includes(source)) throw new HttpError(400, 'invalid_source');
  const byNet = csv ? parseCsv(csv, network) : { [network]: rows };
  const out = [];
  for (const [net, list] of Object.entries(byNet)) {
    if (!NETWORKS[net]) throw new HttpError(400, 'invalid_network');
    if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'rows_required');
    if (list.length > 400) throw new HttpError(400, 'too_many_rows', 'Hasta 400 días por importación.');
    let n = 0; const days = [];
    const stmts = [];
    for (const r of list) {
      const day = parseDay(r.day);
      if (!day || Date.parse(day) > Date.now()) throw new HttpError(400, 'invalid_day', `Día inválido: ${r.day}`);
      for (const [k, v] of Object.entries(r)) {
        if (k === 'day') continue;
        const key = METRIC_ALIASES[k] ? k : ALIAS[norm(k)];
        if (!key) continue;
        const num = typeof v === 'number' ? v : parseNumber(v);
        if (num === null) continue;
        if (!Number.isFinite(num) || num < 0) throw new HttpError(400, 'invalid_value', `Valor inválido para ${k} el ${day}.`);
        stmts.push({ sql: `INSERT INTO social_metrics_daily(network, day, metric, value, source, imported_by) VALUES (?,?,?,?,?,?)
          ON CONFLICT(network, day, metric) DO UPDATE SET value = excluded.value, source = excluded.source, imported_at = excluded.imported_at, imported_by = excluded.imported_by`,
        args: [net, day, key, num, source, actor && actor.username ? actor.username : null] });
        n++;
      }
      days.push(day);
    }
    if (!n) throw new HttpError(400, 'no_values', 'No hay valores para guardar.');
    await db.tx(async (t) => { for (const st of stmts) await t.run(st.sql, st.args); });
    days.sort();
    await db.run('INSERT INTO social_metric_imports(network, source, rows, first_day, last_day, actor) VALUES (?,?,?,?,?,?)', [net, source, n, days[0], days[days.length - 1], actor && actor.username]);
    await audit(db, { actorId: actor && actor.id, actorKind: actor && actor.id ? 'person' : 'system', action: 'growth.metrics_import', targetKind: 'network', targetId: net, details: { source, values: n, from: days[0], to: days[days.length - 1] } });
    await hq.recordEvent(db, { agentId: 'redes-' + net, kind: 'note', message: `Métricas importadas (${source}): ${n} valores del ${days[0]} al ${days[days.length - 1]}`, source: actor && actor.id ? 'ceo' : 'system', actorId: actor && actor.id });
    out.push({ network: net, values: n, from: days[0], to: days[days.length - 1] });
  }
  return { imported: out };
}

// ── Análisis de una red ──
async function sumMetric(db, net, metric, from, to) {
  const r = await db.get('SELECT SUM(value) AS v, COUNT(*) AS n FROM social_metrics_daily WHERE network = ? AND metric = ? AND day >= ? AND day < ?', [net, metric, from, to]);
  return r.n ? r.v : null;
}
async function lastMetric(db, net, metric, before) {
  const r = await db.get('SELECT value, day FROM social_metrics_daily WHERE network = ? AND metric = ? AND day < ? ORDER BY day DESC LIMIT 1', [net, metric, before]);
  return r ? r.value : null;
}
async function periodMetrics(db, net, from, to) {
  const m = {};
  for (const k of ['reach', 'views', 'interactions', 'posts', 'videos', 'video_interactions', 'video_views', 'clicks', 'followers_gained', 'followers_lost']) m[k] = await sumMetric(db, net, k, from, to);
  m.followers = await lastMetric(db, net, 'followers', to);
  m.followers_start = await lastMetric(db, net, 'followers', from);
  m.net_followers = m.followers_gained != null ? m.followers_gained - (m.followers_lost || 0) : (m.followers != null && m.followers_start != null ? m.followers - m.followers_start : null);
  m.engagement_rate = r3(ratio(m.interactions, m.reach));
  m.interactions_per_post = r1(ratio(m.interactions, m.posts));
  const feedPosts = m.posts != null && m.videos != null ? m.posts - m.videos : null;
  const feedInter = m.interactions != null && m.video_interactions != null ? m.interactions - m.video_interactions : null;
  m.video_ipp = r1(ratio(m.video_interactions, m.videos));
  m.feed_ipp = r1(ratio(feedInter, feedPosts));
  m.feed_posts = feedPosts;
  return m;
}
async function sitePeriod(db, name, from, to) {
  const e = await db.get("SELECT COALESCE(SUM(n), 0) AS n FROM traffic_sources_daily WHERE kind = 'entry' AND source = ? AND day >= ? AND day < ?", [name, from, to]);
  const p = await db.get('SELECT COUNT(*) AS n, SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) AS acc FROM players WHERE origin_source = ? AND created_at >= ? AND created_at < ?', [name, from, to]);
  const g = await db.get('SELECT COUNT(*) AS n FROM games g JOIN players pl ON pl.id = g.player_id WHERE pl.origin_source = ? AND g.started_at >= ? AND g.started_at < ?', [name, from, to]);
  return { entries: e.n, players: p.n, accounts: p.acc || 0, games: g.n };
}

async function analyzeNetwork(db, net, at = Date.now()) {
  const name = NETWORKS[net];
  const end = dayStr(at); const start = dayStr(Date.parse(end) - 7 * DAY); const prevStart = dayStr(Date.parse(end) - 14 * DAY);
  const cur = await periodMetrics(db, net, start, end);
  const prev = await periodMetrics(db, net, prevStart, start);
  const site = await sitePeriod(db, name, start, end);
  const sitePrev = await sitePeriod(db, name, prevStart, start);
  const last = await db.get('SELECT MAX(day) AS d FROM social_metrics_daily WHERE network = ?', [net]);
  const days = (await db.get('SELECT COUNT(DISTINCT day) AS n FROM social_metrics_daily WHERE network = ? AND day >= ? AND day < ?', [net, start, end])).n;
  const like = '%' + net + '%';
  const pipeline = await db.get(`SELECT SUM(CASE WHEN status = 'published' AND published_at >= ? AND published_at < ? THEN 1 ELSE 0 END) AS published,
    SUM(CASE WHEN status IN ('approved','scheduled') AND scheduled_at >= ? AND scheduled_at < ? THEN 1 ELSE 0 END) AS next7,
    SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) AS pending FROM content_pieces WHERE lower(platform) LIKE ?`,
  [start, end, end, dayStr(Date.parse(end) + 7 * DAY), like]);
  const lastDay = last && last.d;
  const stale = !lastDay || Date.parse(end) - Date.parse(lastDay) > STALE_DAYS * DAY;
  return {
    network: net, name, period: { from: start, to: end, last: dayStr(Date.parse(end) - DAY), label: 'Últimos 7 días completos' }, previous: { from: prevStart, to: start },
    metrics: cur, previous_metrics: prev,
    site: { ...site, entries_per_1k_reach: r1(cur.reach ? site.entries / cur.reach * 1000 : null), players_per_1k_reach: r1(cur.reach ? site.players / cur.reach * 1000 : null) },
    site_previous: sitePrev,
    pipeline: { published: pipeline.published || 0, next7: pipeline.next7 || 0, pending: pipeline.pending || 0 },
    data: { last_day: lastDay || null, days_in_period: days, stale, note: stale ? (lastDay ? `Las métricas de la red llegan hasta el ${lastDay}: faltan días recientes.` : 'Todavía no se importaron métricas de esta red.') : null },
  };
}

// ── Reglas: cada una exige una muestra mínima y deja su evidencia ──
function socialRules(a) {
  const m = a.metrics; const p = a.previous_metrics; const out = [];
  const agent = 'redes-' + a.network; const n = a.name;
  const ev = (o) => ({ period: a.period, ...o });
  if (a.data.stale) return out;
  if (m.videos >= 3 && m.feed_posts >= 3 && m.video_ipp != null && m.feed_ipp > 0 && m.video_ipp >= 1.5 * m.feed_ipp) {
    out.push({ rule: 'format_video', metric: 'interactions_per_post', baseline: m.interactions_per_post,
      title: `${n}: más videos y reels en el calendario`,
      rationale: `En los últimos 7 días cada video o reel tuvo ${m.video_ipp} interacciones de promedio contra ${m.feed_ipp} de las imágenes y carruseles (${r1(m.video_ipp / m.feed_ipp)} veces más).`,
      evidence: ev({ videos: m.videos, video_interactions: m.video_interactions, feed_posts: m.feed_posts, feed_interactions: m.interactions - m.video_interactions, video_ipp: m.video_ipp, feed_ipp: m.feed_ipp }),
      plan: [['produccion-contenido', `${n}: convertir en video o reel la mitad de las imágenes y carruseles de las próximas 2 semanas`, 'Piezas reemplazadas en el calendario, cada una con su archivo', 'growth', 'marketing', 3],
        [agent, `${n}: comparar interacciones por publicación 14 días después del cambio`, 'Medición antes y después en el informe de la red', 'growth', 'marketing', 1]] });
  }
  if (m.reach >= 300 && p.reach >= 300 && m.engagement_rate != null && p.engagement_rate > 0 && m.engagement_rate < 0.7 * p.engagement_rate) {
    out.push({ rule: 'engagement_drop', metric: 'engagement_rate', baseline: m.engagement_rate,
      title: `${n}: la tasa de interacción bajó, revisar temas y horarios`,
      rationale: `La tasa de interacción pasó de ${r1(p.engagement_rate * 100)} % a ${r1(m.engagement_rate * 100)} % (interacciones ÷ alcance) con más de 300 de alcance en ambas semanas.`,
      evidence: ev({ engagement_rate: m.engagement_rate, previous: p.engagement_rate, reach: m.reach, previous_reach: p.reach, interactions: m.interactions, previous_interactions: p.interactions }),
      plan: [['marketing-direccion', `${n}: revisar temas, ganchos y horarios de la semana con menor interacción`, 'Lista de cambios concretos para la próxima semana', 'growth', 'marketing', 2],
        ['produccion-contenido', `${n}: aplicar los cambios aprobados en las piezas de la próxima semana`, 'Piezas actualizadas y aprobadas', 'growth', 'marketing', 3]] });
  }
  if (m.reach >= 1000 && a.site.entries_per_1k_reach != null && a.site.entries_per_1k_reach < 2) {
    const short = { instagram: '/ig', facebook: '/fb', tiktok: '/tt', youtube: '/yt' }[a.network];
    out.push({ rule: 'low_click_through', metric: 'entries_per_1k_reach', baseline: a.site.entries_per_1k_reach,
      title: `${n}: llevar más gente a jugar desde la red`,
      rationale: `Con ${m.reach} de alcance llegaron ${a.site.entries} visitas al sitio desde ${n} (${a.site.entries_per_1k_reach} por cada 1.000 personas alcanzadas).`,
      evidence: ev({ reach: m.reach, site_entries: a.site.entries, entries_per_1k_reach: a.site.entries_per_1k_reach, new_players: a.site.players }),
      plan: [['produccion-contenido', `${n}: cerrar cada pieza con una invitación a jugar el críptico del día y el enlace playcripticos.com${short}`, 'Plantilla de cierre aplicada en las próximas piezas', 'growth', 'marketing', 3],
        ['crecimiento', `${n}: revisar que el enlace de la biografía sea playcripticos.com${short}`, 'Enlace verificado', 'growth', 'marketing', 1]] });
  }
  const fg = m.net_followers; const posts = m.posts || 0;
  if (fg != null && fg <= 0 && posts >= 5) {
    out.push({ rule: 'followers_stalled', metric: 'net_followers', baseline: fg,
      title: `${n}: los seguidores no crecen`,
      rationale: `Con ${posts} publicaciones en 7 días el saldo de seguidores fue ${fg}.`,
      evidence: ev({ posts, net_followers: fg, followers: m.followers }),
      plan: [['comunidad', `${n}: lista diaria de 20 cuentas de jugadores de palabras para seguir e interactuar (a mano)`, 'Lista preparada; la acción la hace una persona', 'growth', 'marketing', 2],
        ['alianzas', `${n}: proponer 3 colaboraciones con cuentas de juegos de palabras en español`, 'Borradores de contacto para aprobar', 'growth', 'marketing', 3]] });
  }
  return out;
}

// ── Propuestas ──
async function createProposal(db, { agentId, kind, network, c, amount }) {
  const open = await db.get(`SELECT id FROM growth_proposals WHERE agent_id = ? AND rule = ? AND (status IN ('proposed','approved','executing')
    OR (status = 'rejected' AND decided_at >= ?))`, [agentId, c.rule, new Date(Date.now() - 14 * DAY).toISOString()]);
  if (open) return null;
  const id = uuid();
  const steps = c.plan.map(([agent, title, expected, category, area, level, ceo]) => ({ agent, title, expected, category, area, approval_level: level || 1, ceo: !!ceo }));
  const chain = kind === 'social' ? [`Agente de ${NETWORKS[network]}`, 'Gerencia de redes sociales', 'Dirección de marketing y publicidad', 'Decisión final: un CEO'] : ['Estrategia comercial y monetización', 'Decisión final: un CEO'];
  const item = await gov.createRequest(db, { kind: kind === 'social' ? 'campaign' : 'decision', title: c.title, summary: c.rationale,
    content: { agent: agentId, network: network || null, rule: c.rule, rationale: c.rationale, evidence: c.evidence, plan: steps, metric: c.metric || null, baseline: c.baseline ?? null, chain, extra: c.extra || null },
    amount, targetKind: 'growth_proposal', targetId: id, requestedByKind: 'agent', requestedBy: agentId }, null);
  await db.run(`INSERT INTO growth_proposals(id, agent_id, kind, network, rule, title, rationale, evidence, plan, metric, baseline, approval_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, agentId, kind, network || null, c.rule, c.title, c.rationale, JSON.stringify(c.evidence), JSON.stringify(steps), c.metric || null, c.baseline ?? null, item.id]);
  await hq.recordEvent(db, { agentId, kind: 'approval_request', message: `Propuesta para los CEO: ${c.title}`, data: { proposal: id, approval: item.id } });
  return id;
}

// Se llama desde la bandeja al aprobarse: el plan se convierte en tareas y queda en medición.
async function onApproved(db, item, actor) {
  const p = await db.get('SELECT * FROM growth_proposals WHERE id = ?', [item.target_id]);
  if (!p || p.status !== 'proposed') return;
  const company = require('./company');
  await db.run("UPDATE growth_proposals SET status = 'approved', decided_at = ? WHERE id = ?", [now(), p.id]);
  const steps = parseJson(p.plan, []);
  const tasks = [];
  for (const s of steps) {
    const t = await company.saveTask(db, null, { title: s.title.slice(0, 200), objective: `Propuesta aprobada: ${p.title}`, expected: s.expected, area: s.area || 'marketing',
      category: s.category || 'growth', agent_id: s.agent || null, approval_level: s.approval_level || 1, status: s.ceo ? 'blocked' : 'pending',
      blocked_reason: s.ceo ? 'Acción de un CEO' : undefined }, actor || SYSTEM);
    tasks.push(t.id);
    if (s.agent) await hq.recordEvent(db, { agentId: s.agent, taskId: t.id, kind: 'assigned', message: `Tarea por propuesta aprobada: ${t.title}`, data: { proposal: p.id } });
  }
  const measureAfter = new Date(Date.now() + MEASURE_DAYS * DAY).toISOString();
  await db.run("UPDATE growth_proposals SET status = 'executing', tasks = ?, measure_after = ? WHERE id = ?", [JSON.stringify(tasks), measureAfter, p.id]);
  await gov.markExecuted(db, item.id, `Plan en ejecución: tareas ${tasks.join(', ')}`, actor);
  await hq.recordEvent(db, { agentId: p.agent_id, kind: 'result', message: `Aprobada por ${actor ? actor.username : 'un CEO'}: ${p.title}. Tareas ${tasks.join(', ')}`, data: { proposal: p.id, tasks }, actorId: actor && actor.id });
  await audit(db, { actorId: actor && actor.id, action: 'growth.proposal_executing', targetKind: 'growth_proposal', targetId: p.id, details: { tasks } });
}

// Rechazos y retiros de la bandeja se reflejan en la propuesta.
async function syncDecisions(db) {
  await db.run(`UPDATE growth_proposals SET status = 'rejected', decided_at = COALESCE(decided_at, ?) WHERE status = 'proposed'
    AND approval_id IN (SELECT id FROM approval_items WHERE status IN ('rejected'))`, [now()]);
  await db.run(`UPDATE growth_proposals SET status = 'withdrawn', decided_at = COALESCE(decided_at, ?) WHERE status = 'proposed'
    AND approval_id IN (SELECT id FROM approval_items WHERE status = 'withdrawn')`, [now()]);
}

// Medición: social compara la métrica 14 días después; comercial, el avance de sus tareas.
async function measureProposals(db) {
  const due = await db.all("SELECT * FROM growth_proposals WHERE status = 'executing' AND measure_after <= ?", [now()]);
  const out = [];
  for (const p of due) {
    let result;
    if (p.kind === 'social') {
      const a = await analyzeNetwork(db, p.network);
      const after = p.metric === 'entries_per_1k_reach' ? a.site.entries_per_1k_reach : a.metrics[p.metric];
      if (a.data.stale || after == null) {
        result = { measured: false, note: 'Sin métricas recientes de la red: se vuelve a medir cuando lleguen.' };
        await db.run('UPDATE growth_proposals SET measure_after = ? WHERE id = ?', [new Date(Date.now() + 2 * DAY).toISOString(), p.id]);
        out.push({ id: p.id, ...result });
        continue;
      }
      const improved = p.baseline == null ? null : after > p.baseline;
      result = { measured: true, metric: p.metric, before: p.baseline, after, improved, period: a.period };
    } else {
      const ids = parseJson(p.tasks, []);
      const rows = ids.length ? await db.all(`SELECT id, status FROM ops_tasks WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : [];
      result = { measured: true, tasks_total: rows.length, tasks_done: rows.filter((t) => t.status === 'done').length, tasks_blocked: rows.filter((t) => t.status === 'blocked').length };
    }
    await db.run("UPDATE growth_proposals SET status = 'measured', result = ?, measured_at = ? WHERE id = ?", [JSON.stringify(result), now(), p.id]);
    await hq.recordEvent(db, { agentId: p.agent_id, kind: 'result', message: p.kind === 'social'
      ? `Medición de «${p.title}»: ${p.metric} ${p.baseline} → ${result.after}${result.improved === true ? ' (mejoró)' : result.improved === false ? ' (no mejoró)' : ''}`
      : `Avance de «${p.title}»: ${result.tasks_done} de ${result.tasks_total} tareas completas`, data: { proposal: p.id, result } });
    out.push({ id: p.id, ...result });
  }
  return out;
}

// ── Ejecución diaria de los agentes de redes y del gerente ──
async function runSocial(db, at = Date.now()) {
  await syncDecisions(db);
  const reports = [];
  for (const net of Object.keys(NETWORKS)) {
    const agentId = 'redes-' + net;
    const ag = await db.get('SELECT paused_at FROM agents WHERE id = ?', [agentId]);
    if (!ag || ag.paused_at) continue;
    const runId = await hq.startRun(db, { agentId, stage: 'analysis', summary: `Análisis diario de ${NETWORKS[net]}` });
    try {
      const a = await analyzeNetwork(db, net, at);
      const candidates = socialRules(a);
      const created = [];
      for (const c of candidates) { const id = await createProposal(db, { agentId, kind: 'social', network: net, c }); if (id) created.push(id); }
      const content = { ...a, findings: candidates.map((c) => ({ rule: c.rule, title: c.title, rationale: c.rationale })), proposals_created: created };
      const r = await db.run('INSERT INTO growth_reports(agent_id, kind, network, period_start, period_end, addressed_to, content, run_id) VALUES (?,?,?,?,?,?,?,?)',
        [agentId, 'network', net, a.period.from, a.period.to, MANAGER, JSON.stringify(content), runId]);
      const summary = a.data.stale ? `${NETWORKS[net]}: sin métricas recientes; informe entregado sin propuestas` : `${NETWORKS[net]}: ${candidates.length} hallazgos, ${created.length} propuestas nuevas`;
      await hq.finishRun(db, runId, { status: 'ok', summary, evidence: `growth_reports #${Number(r.lastInsertRowid)}` });
      reports.push({ ...content, report_id: Number(r.lastInsertRowid) });
    } catch (e) {
      await hq.finishRun(db, runId, { status: 'error', error: e.message });
      throw e;
    }
  }
  const manager = await runManager(db, reports, at);
  const measured = await measureProposals(db);
  return { networks: reports.length, manager_report: manager && manager.id, measured: measured.length };
}

async function runManager(db, reports, at) {
  const ag = await db.get('SELECT paused_at FROM agents WHERE id = ?', [MANAGER]);
  if (!ag || ag.paused_at || !reports.length) return null;
  const runId = await hq.startRun(db, { agentId: MANAGER, stage: 'analysis', summary: 'Consolidado de las cuatro redes' });
  const withData = reports.filter((r) => !r.data.stale);
  const totalPlayers = reports.reduce((s, r) => s + r.site.players, 0);
  const ranking = reports.map((r) => ({ network: r.network, name: r.name, reach: r.metrics.reach, interactions: r.metrics.interactions, engagement_rate: r.metrics.engagement_rate,
    net_followers: r.metrics.net_followers, followers: r.metrics.followers, site_entries: r.site.entries, new_players: r.site.players, players_per_1k_reach: r.site.players_per_1k_reach,
    published: r.pipeline.published, next7: r.pipeline.next7, stale: r.data.stale }))
    .sort((x, y) => (y.new_players - x.new_players) || ((y.players_per_1k_reach || 0) - (x.players_per_1k_reach || 0)));
  const recs = [];
  const missing = reports.filter((r) => r.data.stale).map((r) => r.name);
  if (missing.length) recs.push(`Faltan métricas recientes de ${missing.join(', ')}: sin esos datos no se pueden comparar ni proponer cambios. Importarlas desde Metricool (lo hace la rutina diaria) o cargar un CSV en la sala de la red.`);
  if (totalPlayers >= 20) {
    const share = ranking.filter((r) => r.new_players > 0).map((r) => `${r.name} ${Math.round(r.new_players / totalPlayers * 100)} %`);
    recs.push(`Repartir el esfuerzo de producción según los jugadores nuevos que trae cada red: ${share.join(', ')}.`);
  } else recs.push(`Todavía hay pocos jugadores nuevos desde redes (${totalPlayers} en 7 días) para repartir el esfuerzo por resultado: mantener el calendario aprobado.`);
  const noPipeline = reports.filter((r) => r.pipeline.next7 === 0).map((r) => r.name);
  if (noPipeline.length) recs.push(`Sin publicaciones aprobadas para los próximos 7 días en ${noPipeline.join(', ')}.`);
  const open = await db.all("SELECT id, title, network, status, approval_id FROM growth_proposals WHERE kind = 'social' AND status IN ('proposed','executing') ORDER BY created_at DESC LIMIT 20");
  const end = dayStr(at);
  const content = { period: { from: dayStr(Date.parse(end) - 7 * DAY), to: end }, addressed_to: 'Dirección de marketing y publicidad', ranking, recommendations: recs,
    networks_with_data: withData.length, open_proposals: open, new_players_from_social: totalPlayers,
    note: 'Ranking por jugadores nuevos que llegaron desde cada red (origen real del tráfico) y, a igualdad, por jugadores por cada 1.000 de alcance.' };
  const r = await db.run('INSERT INTO growth_reports(agent_id, kind, network, period_start, period_end, addressed_to, content, run_id) VALUES (?,?,?,?,?,?,?,?)',
    [MANAGER, 'manager', null, content.period.from, content.period.to, DIRECTOR, JSON.stringify(content), runId]);
  const id = Number(r.lastInsertRowid);
  await hq.recordEvent(db, { agentId: DIRECTOR, kind: 'report', message: `Informe de la Gerencia de redes recibido (${withData.length} de 4 redes con datos)`, data: { growth_report: id } });
  await hq.finishRun(db, runId, { status: 'ok', summary: `Informe consolidado para la Dirección de marketing y publicidad (${withData.length} de 4 redes con datos)`, evidence: `growth_reports #${id}` });
  return { id };
}

// ── Estrategia comercial ──
async function commercialMetrics(db, at = Date.now()) {
  const t7 = new Date(at - 7 * DAY).toISOString(); const t30 = new Date(at - 30 * DAY).toISOString();
  const wau = (await db.get('SELECT COUNT(DISTINCT player_id) AS n FROM games WHERE started_at >= ?', [t7])).n;
  const mau = (await db.get('SELECT COUNT(DISTINCT player_id) AS n FROM games WHERE started_at >= ?', [t30])).n;
  const games7 = (await db.get('SELECT COUNT(*) AS n FROM games WHERE started_at >= ?', [t7])).n;
  // Retención al día 7: de los jugadores nuevos entre hace 37 y 7 días, cuántos jugaron 7 días o más después de llegar.
  const coh = await db.get(`SELECT COUNT(*) AS n, SUM(CASE WHEN EXISTS (SELECT 1 FROM games g WHERE g.player_id = p.id AND g.started_at >= strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at, '+7 days')) THEN 1 ELSE 0 END) AS kept
    FROM players p WHERE p.created_at >= ? AND p.created_at < ? AND EXISTS (SELECT 1 FROM games g WHERE g.player_id = p.id)`, [new Date(at - 37 * DAY).toISOString(), t7]);
  const accounts = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND deleted_at IS NULL")).n;
  const entries = (await db.get("SELECT COALESCE(SUM(n), 0) AS n FROM traffic_sources_daily WHERE kind = 'entry' AND day >= ?", [t30.slice(0, 10)])).n;
  let followers = 0; let followersKnown = 0;
  for (const net of Object.keys(NETWORKS)) { const f = await lastMetric(db, net, 'followers', dayStr(at + DAY)); if (f != null) { followers += f; followersKnown++; } }
  const published = (await db.get("SELECT COUNT(*) AS n FROM clues WHERE status = 'published'")).n;
  const countries = await db.all('SELECT COALESCE(country_code, \'—\') AS country, COUNT(DISTINCT player_id) AS players FROM games WHERE started_at >= ? GROUP BY country ORDER BY players DESC LIMIT 5', [t30]);
  return {
    measured_at: new Date(at).toISOString(),
    values: { wau, mau, d7: coh.n >= 20 ? r1(coh.kept / coh.n * 100) : null, accounts, entries_30d: entries, followers: followersKnown ? followers : null, published_clues: published, games_per_wau: wau ? r1(games7 / wau) : null },
    notes: { d7: coh.n >= 20 ? `Cohorte de ${coh.n} jugadores nuevos.` : `Sin dato: hacen falta al menos 20 jugadores nuevos en la cohorte (hay ${coh.n}).`,
      followers: followersKnown ? `Suma de ${followersKnown} de 4 redes con métricas importadas.` : 'Sin dato: no hay métricas de redes importadas.' },
    countries,
  };
}

function readiness(opt, values) {
  const reqs = opt.requirements.map(([k, min]) => {
    const v = values[k];
    return { metric: k, label: MARKET.METRICS[k][0], unit: MARKET.METRICS[k][1], min, value: v, met: v != null && v >= min, unknown: v == null };
  });
  const met = reqs.filter((r) => r.met).length;
  return { ready: met === reqs.length, score: reqs.length ? met / reqs.length : 1, requirements: reqs };
}

function scenario(opt, values) {
  if (!opt.conversion || !values.mau) return null;
  const subs = values.mau * opt.conversion;
  return { estimate: true, assumptions: `${values.mau} jugadores activos en 30 días × ${opt.conversion * 100} % de conversión (mediana freemium, RevenueCat 2026) × US$ ${opt.price_usd} por mes − comisión de cobro de ${r1(opt.fee * 100)} %`,
    subscribers: Math.round(subs), monthly_usd: Math.round(subs * opt.price_usd * (1 - opt.fee)) };
}

async function runCommercial(db, at = Date.now()) {
  await syncDecisions(db);
  const ag = await db.get('SELECT paused_at FROM agents WHERE id = ?', [COMMERCIAL]);
  if (!ag || ag.paused_at) return { skipped: 'paused' };
  const runId = await hq.startRun(db, { agentId: COMMERCIAL, stage: 'analysis', summary: 'Revisión semanal de líneas de ingreso' });
  try {
    const m = await commercialMetrics(db, at);
    const options = MARKET.OPTIONS.map((o) => ({ id: o.id, name: o.name, summary: o.summary, why: o.why, revenue: o.revenue, risks: o.risks, kpi: o.kpi,
      sources: o.sources.map((s) => MARKET.SOURCES[s]), ...readiness(o, m.values), scenario: scenario(o, m.values) }))
      .sort((a, b) => (b.ready - a.ready) || (b.score - a.score));
    const created = [];
    // Propone las líneas listas (una propuesta abierta por línea).
    for (const o of options.filter((x) => x.ready).slice(0, 2)) {
      const def = MARKET.OPTIONS.find((x) => x.id === o.id);
      const reqText = o.requirements.map((r) => `${r.label}: ${r.value}${r.unit} (mínimo ${r.min}${r.unit})`).join('; ');
      const id = await createProposal(db, { agentId: COMMERCIAL, kind: 'commercial', c: {
        rule: o.id, title: `Línea de ingreso: ${o.name}`, metric: 'tasks_done',
        rationale: `${o.summary} ${o.why} Requisitos cumplidos con datos reales: ${reqText}.`,
        evidence: { metrics: m.values, requirements: o.requirements, sources: o.sources, scenario: o.scenario, measured_at: m.measured_at },
        plan: def.plan, extra: { revenue: o.revenue, risks: o.risks, kpi: o.kpi } } });
      if (id) created.push(id);
    }
    const next = options.filter((x) => !x.ready).map((o) => ({ id: o.id, name: o.name, missing: o.requirements.filter((r) => !r.met).map((r) => r.unknown ? `${r.label}: sin dato` : `${r.label}: ${r.value}${r.unit} de ${r.min}${r.unit}`) }));
    const content = { metrics: m, options, proposals_created: created, not_ready: next,
      note: 'Las líneas se proponen solo cuando cumplen sus requisitos con datos reales. Los montos son escenarios marcados como estimación, nunca promesas.' };
    const r = await db.run('INSERT INTO growth_reports(agent_id, kind, network, period_start, period_end, addressed_to, content, run_id) VALUES (?,?,?,?,?,?,?,?)',
      [COMMERCIAL, 'commercial', null, new Date(at - 30 * DAY).toISOString(), new Date(at).toISOString(), 'Los dos CEO', JSON.stringify(content), runId]);
    const id = Number(r.lastInsertRowid);
    await hq.finishRun(db, runId, { status: 'ok', summary: `${options.filter((o) => o.ready).length} líneas listas, ${created.length} propuestas nuevas para los CEO`, evidence: `growth_reports #${id}` });
    await measureProposals(db);
    return { report_id: id, proposals: created.length };
  } catch (e) {
    await hq.finishRun(db, runId, { status: 'error', error: e.message });
    throw e;
  }
}

// ── Vistas ──
const lastReport = async (db, kind, network) => {
  const r = await db.get(`SELECT * FROM growth_reports WHERE kind = ? AND ${network ? 'network = ?' : 'network IS NULL'} ORDER BY id DESC LIMIT 1`, network ? [kind, network] : [kind]);
  return r ? { ...r, content: parseJson(r.content, {}) } : null;
};
const proposals = async (db, where, args) => (await db.all(`SELECT p.*, a.status AS approval_status, a.version AS approval_version, a.content_hash AS approval_hash FROM growth_proposals p
  LEFT JOIN approval_items a ON a.id = p.approval_id WHERE ${where} ORDER BY p.created_at DESC LIMIT 30`, args))
  .map((p) => ({ ...p, evidence: parseJson(p.evidence, {}), plan: parseJson(p.plan, []), tasks: parseJson(p.tasks, []), result: parseJson(p.result, null) }));

async function networkView(db, net) {
  if (!NETWORKS[net]) throw new HttpError(404, 'not_found');
  await syncDecisions(db);
  const series = await db.all('SELECT day, metric, value, source FROM social_metrics_daily WHERE network = ? AND day >= ? ORDER BY day', [net, dayStr(Date.now() - 28 * DAY)]);
  const imports = await db.all('SELECT * FROM social_metric_imports WHERE network = ? ORDER BY id DESC LIMIT 5', [net]);
  return { network: net, name: NETWORKS[net], live: await analyzeNetwork(db, net), report: await lastReport(db, 'network', net), proposals: await proposals(db, 'p.network = ?', [net]),
    series, imports, labels: METRIC_LABELS };
}
async function managerView(db) {
  await syncDecisions(db);
  return { report: await lastReport(db, 'manager'), proposals: await proposals(db, "p.kind = 'social'", []) };
}
async function commercialView(db) {
  await syncDecisions(db);
  return { report: await lastReport(db, 'commercial'), live: await commercialMetrics(db), proposals: await proposals(db, "p.kind = 'commercial'", []),
    options: MARKET.OPTIONS.map((o) => ({ id: o.id, name: o.name })), metric_labels: MARKET.METRICS };
}

module.exports = { NETWORKS, METRIC_ALIASES, METRICOOL_FIELDS, METRIC_LABELS, parseCsv, importMetrics, analyzeNetwork, socialRules, createProposal, onApproved, syncDecisions,
  measureProposals, runSocial, runCommercial, commercialMetrics, readiness, networkView, managerView, commercialView };
