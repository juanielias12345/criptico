/* AI Company HQ: oficina virtual de los CEO. Todo lo que se ve sale de la API
   (/api/admin/hq/*), que deriva el estado de registros reales. Las animaciones
   son decorativas: la prueba de actividad es el registro de ejecución. */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  };
  const NS = 'http://www.w3.org/2000/svg';
  const S = (tag, attrs, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid) n.append(kid);
    return n;
  };

  const REPO = 'https://github.com/juanielias12345/criptico';
  const POLL_STATE = 15000; const POLL_EVENTS = 8000;
  let csrf = null;
  async function api(path, opts) {
    const o = Object.assign({ method: 'GET', credentials: 'same-origin', headers: {} }, opts || {});
    if (o.body !== undefined) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.body); }
    if (csrf) o.headers['x-csrf-token'] = csrf;
    const res = await fetch(path, o);
    let data = null; try { data = await res.json(); } catch (e) { /* sin cuerpo */ }
    if (res.status === 401) { location.href = '/admin#hq'; throw new Error('Sesión vencida'); }
    if (!res.ok) { const err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status)); err.status = res.status; err.data = data; throw err; }
    return data;
  }

  // ── Formatos ──
  const fmt = (d) => (d ? new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  function ago(d) {
    if (!d) return 'sin registro';
    const s = Math.max(0, (Date.now() - Date.parse(d)) / 1000);
    if (s < 60) return 'hace segundos';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
    return 'hace ' + Math.round(s / 86400) + ' d';
  }
  const link = (v) => (/^https:\/\//.test(String(v || '')) ? el('a', { href: v, target: '_blank', rel: 'noopener', text: v.replace(/^https:\/\/(www\.)?/, '').slice(0, 70) }) : el('span', { text: v || '—' }));
  const GLYPH = { working: '⚙', analyzing: '⌕', review: '✎', blocked: '■', error: '✕', waiting: '…', idle: 'z', paused: '‖', offline: '?' };
  const FLOOR_COLOR = { pb: '#64748b', p1: '#c9a227', p2: '#3b82f6', p3: '#8b5cf6', p4: '#ec4899', p5: '#14b8a6', p6: '#f97316' };
  const EV_LABEL = { started: 'Comenzó', stage: 'Etapa', progress: 'Progreso medido', file: 'Archivo', test: 'Pruebas', result: 'Resultado', error: 'Error',
    approval_request: 'Pide aprobación', blocked: 'Bloqueo', finished: 'Terminó', cost: 'Costo', report: 'Informe', paused: 'Pausa', resumed: 'Reanudado',
    assigned: 'Tarea asignada', retry: 'Reintento', note: 'Nota' };
  const STAGE = { research: 'Investigación', analysis: 'Análisis', implementation: 'Implementación', testing: 'Pruebas', review: 'Revisión', delivery: 'Entrega' };
  const TASK_ST = { pending: 'Pendiente', in_progress: 'En curso', blocked: 'Bloqueada', in_review: 'En revisión', approved: 'Aprobada', done: 'Completada', cancelled: 'Cancelada' };
  const RUN_ST = { running: 'En curso', ok: 'Correcta', error: 'Con error', cancelled: 'Cancelada' };
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ── Estado de la vista ──
  const st = { snap: null, events: [], lastEv: 0, firstEv: null, filters: { dept: '', state: '' }, view: 'map', floor: 'all', drawer: null, nodes: {}, updatedAt: null };

  // ── Isometría ──
  const TW = 56; const TH = 28; const WALL = 34; const RW = 7; const RD = 6;
  const iso = (x, y, z) => [(x - y) * TW / 2, (x + y) * TH / 2 - (z || 0)];
  const P = (...pts) => pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  function box(x, y, w, d, h, extra) {
    const z = h;
    return S('g', extra || {},
      S('polygon', { class: 'box-l', points: P(iso(x, y + d), iso(x + w, y + d), iso(x + w, y + d, z), iso(x, y + d, z)) }),
      S('polygon', { class: 'box-r', points: P(iso(x + w, y), iso(x + w, y + d), iso(x + w, y + d, z), iso(x + w, y, z)) }),
      S('polygon', { class: 'box-t', points: P(iso(x, y, z), iso(x + w, y, z), iso(x + w, y + d, z), iso(x, y + d, z)) }));
  }

  const svg = $('#map');
  let world = null; // límites del mundo
  const cam = { x: 0, y: 0, w: 1000, h: 800 };

  function buildMap() {
    const s = st.snap;
    svg.replaceChildren();
    st.nodes = { agents: {}, zones: {}, floors: {} };
    const defs = S('defs', {});
    svg.append(defs);
    const root = S('g', { id: 'world' });
    svg.append(root);
    // El ancho de cada fila se ajusta a la forma de la pantalla (vertical en móviles).
    const dims = s.floors.map((f) => { const n = s.zones.filter((z) => z.floor === f.id).length; const cols = Math.min(n >= 9 ? 4 : 3, n); const rows = Math.ceil(n / cols);
      const W = cols * (RW + 1) + 1; const D = rows * (RD + 1) + 1; return { w: (W + D) * TW / 2, h: (W + D) * TH / 2 + WALL + 70 }; });
    const rect = svg.getBoundingClientRect(); const aspect = rect.width > 50 && rect.height > 50 ? rect.width / rect.height : 1.3;
    const area = dims.reduce((a, d) => a + (d.w + 140) * (d.h + 140), 0);
    const MAXW = Math.max(Math.max(...dims.map((d) => d.w)) + 10, Math.sqrt(area * aspect) * 1.05);
    let ox = 0; let oy = 0; let rowH = 0; const GAP = 140;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const f of s.floors) {
      const zones = s.zones.filter((z) => z.floor === f.id);
      const cols = Math.min(zones.length >= 9 ? 4 : 3, zones.length); const rows = Math.ceil(zones.length / cols);
      const W = cols * (RW + 1) + 1; const D = rows * (RD + 1) + 1;
      const pw = (W + D) * TW / 2; const ph = (W + D) * TH / 2 + WALL + 70;
      if (ox > 0 && ox + pw > MAXW) { ox = 0; oy += rowH + GAP; rowH = 0; }
      const tx = ox + D * TW / 2; const ty = oy + WALL + 60;
      const g = S('g', { class: 'floor', 'data-floor': f.id, transform: `translate(${tx},${ty})` });
      g.append(S('polygon', { class: 'plate', points: P(iso(0, 0), iso(W, 0), iso(W, D), iso(0, D)) }));
      g.append(S('text', { class: 'plate-label', x: iso(0, 0)[0] - D * TW / 2 + 10, y: -WALL - 26, text: f.name }));
      const order = zones.map((z, i) => ({ z, c: i % cols, r: Math.floor(i / cols) })).sort((a, b) => (a.c + a.r) - (b.c + b.r));
      for (const { z, c, r } of order) g.append(buildRoom(z, 1 + c * (RW + 1), 1 + r * (RD + 1), f.id));
      root.append(g);
      st.nodes.floors[f.id] = { x: tx - D * TW / 2, y: ty - WALL - 60, w: pw, h: ph };
      minX = Math.min(minX, tx - D * TW / 2 - 40); minY = Math.min(minY, ty - WALL - 70);
      maxX = Math.max(maxX, tx + W * TW / 2 + 40); maxY = Math.max(maxY, ty + (W + D) * TH / 2 + 40);
      ox += pw + GAP; rowH = Math.max(rowH, ph);
    }
    world = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    updateAgents();
  }

  function zoneBox(x0, y0) {
    const a = iso(x0, y0); const b = iso(x0 + RW, y0); const c = iso(x0 + RW, y0 + RD); const d = iso(x0, y0 + RD);
    return { x: d[0], y: a[1] - WALL - 30, w: b[0] - d[0], h: c[1] - a[1] + WALL + 30 };
  }

  function buildRoom(z, x0, y0, floorId) {
    const color = FLOOR_COLOR[floorId] || '#64748b';
    const g = S('g', { class: 'room', tabindex: '0', role: 'button', 'data-zone': z.id, 'aria-label': z.name });
    g.addEventListener('click', (e) => { if (e.target.closest('.agent')) return; openZone(z.id); });
    g.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === g) { e.preventDefault(); openZone(z.id); } });
    // Piso y paredes del fondo.
    const fl0 = S('polygon', { class: 'room-floor', points: P(iso(x0, y0), iso(x0 + RW, y0), iso(x0 + RW, y0 + RD), iso(x0, y0 + RD)) });
    fl0.style.fill = `color-mix(in srgb, ${color} 16%, var(--floor))`;
    g.append(fl0);
    g.append(S('polygon', { class: 'wall-l', points: P(iso(x0, y0), iso(x0, y0 + RD), iso(x0, y0 + RD, WALL), iso(x0, y0, WALL)) }));
    g.append(S('polygon', { class: 'wall-r', points: P(iso(x0, y0), iso(x0 + RW, y0), iso(x0 + RW, y0, WALL), iso(x0, y0, WALL)) }));
    g.append(S('polyline', { points: P(iso(x0, y0 + RD, WALL), iso(x0, y0, WALL), iso(x0 + RW, y0, WALL)), fill: 'none', stroke: color, 'stroke-width': 3 }));
    const content = S('g', {});
    g.append(content);
    const agents = z.agents.map((id) => st.snap.agents.find((a) => a.id === id)).filter(Boolean);
    if (z.kind === 'room' || z.kind === 'ceo' || z.kind === 'social') furnish(content, z, x0, y0);
    if (agents.length) {
      const slots = agents.slice(0, 6).map((a, i) => ({ a, x: x0 + 1.5 + (i % 3) * 2.1, y: y0 + (z.kind === 'team' ? 2.3 : 3.6) + Math.floor(i / 3) * 2.2 }));
      slots.sort((p, q) => (p.x + p.y) - (q.x + q.y));
      for (const sl of slots) content.append(buildAgent(sl.a, sl.x, sl.y, color));
      if (agents.length > 6) content.append(S('text', { class: 'vacant', x: iso(x0 + RW - 0.5, y0 + RD - 0.3)[0], y: iso(x0 + RW - 0.5, y0 + RD - 0.3)[1], 'text-anchor': 'end', text: `+${agents.length - 6} agentes` }));
    } else if (z.kind === 'team') {
      content.append(box(x0 + 2.9, y0 + 2.6, 1.2, 0.7, 12));
      const p = iso(x0 + 3.5, y0 + 4.2);
      content.append(S('text', { class: 'vacant', x: p[0], y: p[1], 'text-anchor': 'middle', text: 'Puesto vacante: sin agente asignado' }));
    }
    // Cartel con el nombre.
    const lp = iso(x0 + RW * 0.68, y0, WALL + 22);
    const label = z.name.length > 34 ? z.name.slice(0, 32) + '…' : z.name;
    const lw = Math.max(70, label.length * 6 + 18);
    g.append(S('g', { class: 'room-label' + (z.kind === 'team' ? ' minor' : ''), transform: `translate(${lp[0] - lw / 2},${lp[1] - 12})` },
      S('rect', { width: lw, height: 20, rx: 6 }), S('text', { x: lw / 2, y: 14, 'text-anchor': 'middle', text: label })));
    const beacon = S('g', { class: 'beacon', transform: `translate(${lp[0] + lw / 2 + 4},${lp[1] - 6})` });
    g.append(beacon);
    const fl = st.snap.floors.find((f) => f.id === floorId);
    const idx = st.snap.floors.indexOf(fl);
    st.nodes.zones[z.id] = { g, beacon, bbox: zoneBox(x0, y0), floor: floorId, idx };
    return g;
  }

  // Muebles de las salas especiales. Las pantallas muestran datos reales del último estado.
  function furnish(c, z, x0, y0) {
    const s = st.snap;
    // Pantalla sobre la pared del fondo: el texto se inclina con la pared (isometría).
    const screen = (lines, wx) => {
      // En la pared izquierda: el cartel con el nombre queda libre sobre la pared derecha.
      const a = iso(x0, y0 + (wx || 1) + 3.6, WALL - 4); const w = 3.6 * TW / 2;
      const g = S('g', { class: 'wall-screen', transform: `matrix(1,-0.5,0,1,${a[0].toFixed(1)},${a[1].toFixed(1)})` });
      g.append(S('rect', { class: 'screen', width: w, height: 26, rx: 2 }));
      lines.forEach((ln, i) => g.append(S('text', { class: 'screen-text' + (ln.cls ? ' ' + ln.cls : ''), x: 6, y: 11 + i * 10, text: ln.t.length > 24 ? ln.t.slice(0, 23) + '…' : ln.t })));
      return g;
    };
    if (z.id === 'reception') {
      c.append(screen([{ t: `Activos ${s.totals.working} · Bloqueados ${s.totals.blocked}` }, { t: `Alertas ${s.totals.open_alerts} · Aprob. ${s.totals.pending_approvals}`, cls: s.totals.critical_alerts ? 'bad' : '' }], 0.8));
      c.append(box(x0 + 2.2, y0 + 3.4, 2.6, 0.8, 16));
    } else if (z.id === 'meeting') {
      c.append(screen([{ t: 'Revisión automática' }, { t: s.reports.last ? 'Última: ' + fmt(s.reports.last.generated_at) : 'Sin informes todavía', cls: s.reports.last ? '' : 'warn' }], 1.2));
      c.append(box(x0 + 1.8, y0 + 2.6, 3.4, 1.6, 10));
      for (let i = 0; i < 4; i++) { c.append(box(x0 + 2 + i * 0.85, y0 + 1.9, 0.5, 0.45, 7)); c.append(box(x0 + 2 + i * 0.85, y0 + 4.5, 0.5, 0.45, 7)); }
    } else if (z.id === 'servers') {
      const jobs = s.jobs || [];
      jobs.slice(0, 10).forEach((j, i) => {
        const x = x0 + 1 + (i % 5) * 1.1; const y = y0 + 1.4 + Math.floor(i / 5) * 2.4;
        c.append(box(x, y, 0.8, 0.8, 46));
        const p = iso(x + 0.8, y + 0.4, 40);
        const cls = j.state === 'ok' ? 'ok' : j.state === 'failed' ? 'bad' : 'stale';
        for (let k = 0; k < 3; k++) c.append(S('circle', { class: 'led ' + cls, cx: p[0] - 4, cy: p[1] + k * 9, r: 2.2 }, S('title', { text: `${j.name}: ${j.label}` })));
      });
    } else if (z.kind === 'ceo') {
      const office = s.ceos.find((o) => o.zone === z.id) || {};
      c.append(screen([{ t: office.name || '' }, { t: `${s.totals.pending_approvals} aprobaciones pendientes`, cls: s.totals.pending_approvals ? 'warn' : '' }], 1.2));
      c.append(box(x0 + 2.4, y0 + 3, 2.2, 1, 13));
      c.append(box(x0 + 3.2, y0 + 2.2, 0.7, 0.6, 9));
      const p = iso(x0 + 3.5, y0 + 4.9);
      c.append(S('text', { class: 'vacant', x: p[0], y: p[1], 'text-anchor': 'middle', text: office.status || '' }));
    } else if (z.kind === 'social') {
      const soc = (s.social || {})[z.id] || {};
      c.append(screen([{ t: z.name }, { t: `Prog. ${soc.scheduled || 0} · Pub. ${soc.published || 0} · Pend. ${soc.pending_approval || 0}` }], 1.2));
    }
  }

  function buildAgent(a, x, y, color) {
    const h = hash(a.id);
    const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d1a17a'];
    const hairs = ['#2c1b10', '#5a3825', '#a0522d', '#1f1f1f', '#d6b370', '#7b4b2a', '#3d2b5a'];
    const p = iso(x - 0.15, y - 0.75);
    const g = S('g', { class: 'agent', tabindex: '0', role: 'button', 'data-agent': a.id, transform: `translate(${p[0].toFixed(1)},${p[1].toFixed(1)})` });
    g.addEventListener('click', (e) => { e.stopPropagation(); openAgent(a.id); });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openAgent(a.id); } });
    const title = S('title', {});
    g.append(title,
      S('ellipse', { class: 'shadow', cx: 0, cy: 0, rx: 10, ry: 4 }),
      S('ellipse', { class: 'ring', cx: 0, cy: 0, rx: 14, ry: 7 }),
      S('rect', { class: 'legs', x: -5, y: -13, width: 4, height: 13, rx: 1.5 }), S('rect', { class: 'legs', x: 1, y: -13, width: 4, height: 13, rx: 1.5 }));
    const upper = S('g', { class: 'upper' },
      S('g', { class: 'breathe' },
        S('path', { class: 'body', d: 'M-8,-13 L-8,-26 Q-8,-31 -3,-31 L3,-31 Q8,-31 8,-26 L8,-13 Z', fill: color }),
        S('circle', { class: 'head', cx: 0, cy: -38, r: 7, fill: skins[h % skins.length] }),
        S('path', { d: h % 3 ? 'M-7,-39 Q-7,-47 0,-47 Q7,-47 7,-39 Q3,-43 -7,-39 Z' : 'M-7.5,-37 Q-8,-47 0,-47 Q8,-47 7.5,-37 L6,-40 Q0,-44 -6,-40 Z', fill: hairs[(h >> 3) % hairs.length] })),
      S('rect', { class: 'arm l', x: -11, y: -26, width: 3.5, height: 11, rx: 1.7, fill: color }),
      S('rect', { class: 'arm r', x: 7.5, y: -26, width: 3.5, height: 11, rx: 1.7, fill: color }),
      S('rect', { class: 'paper', x: 9, y: -44, width: 9, height: 11, rx: 1, fill: '#f8fafc', stroke: '#94a3b8' }));
    g.append(upper);
    // Escritorio y monitor delante del personaje.
    const desk = S('g', { class: 'desk', transform: `translate(${(-p[0]).toFixed(1)},${(-p[1]).toFixed(1)})` }, box(x - 0.55, y - 0.35, 1.2, 0.7, 12));
    const mp = iso(x - 0.35, y - 0.2, 12);
    desk.append(S('rect', { class: 'monitor', x: mp[0] - 14, y: mp[1] - 13, width: 12, height: 10, rx: 1.5 }), S('rect', { class: 'glow', x: mp[0] - 12.5, y: mp[1] - 11.5, width: 9, height: 7, rx: 1 }));
    g.append(desk);
    const bubble = S('g', { class: 'bubble', transform: 'translate(0,-58)' }, S('circle', { r: 9 }), S('text', { text: '' }));
    const tagText = S('text', { x: 0, y: 26, text: a.name.length > 20 ? a.name.slice(0, 19) + '…' : a.name });
    const tw = Math.min(130, Math.max(50, tagText.textContent.length * 5.2 + 12));
    const tag = S('g', { class: 'tag' }, S('rect', { x: -tw / 2, y: 16, width: tw, height: 14, rx: 4 }), tagText);
    g.append(bubble, tag);
    st.nodes.agents[a.id] = { g, title, bubble, x, y };
    return g;
  }

  function updateAgents() {
    if (!st.snap) return;
    const q = ($('#q').value || '').trim().toLowerCase();
    for (const a of st.snap.agents) {
      const n = st.nodes.agents[a.id];
      if (!n) continue;
      const match = (!st.filters.dept || a.department === st.filters.dept) && (!st.filters.state || a.state === st.filters.state || (st.filters.state === 'working' && a.state === 'analyzing'));
      n.g.setAttribute('class', `agent st-${a.state}${match ? '' : ' dim'}${q && a.name.toLowerCase().includes(q) ? ' found' : ''}`);
      n.g.setAttribute('aria-label', `${a.name}: ${a.state_label}. ${a.reason || ''}`);
      n.title.textContent = `${a.name} · ${a.state_label}${a.reason ? ' — ' + a.reason : ''}\nVerificado: ${a.verified_at ? fmt(a.verified_at) : 'sin registros'}`;
      n.bubble.querySelector('text').textContent = GLYPH[a.state] || '';
    }
    for (const z of st.snap.zones) {
      const n = st.nodes.zones[z.id];
      if (!n) continue;
      n.beacon.replaceChildren();
      if (z.urgent) n.beacon.append(S('circle', { class: 'halo', r: 9 }), S('circle', { r: 9 }), S('text', { x: 0, y: 3.5, 'text-anchor': 'middle', text: String(z.urgent) }), S('title', { text: `${z.urgent} agente(s) con algo urgente` }));
    }
  }

  // ── Cámara: desplazamiento y zoom ──
  function applyCam() {
    svg.setAttribute('viewBox', `${cam.x.toFixed(1)} ${cam.y.toFixed(1)} ${cam.w.toFixed(1)} ${cam.h.toFixed(1)}`);
    svg.classList.toggle('zoomed-out', cam.w > 1900);
    svg.classList.toggle('zoomed-in', cam.w < 1000);
  }
  let anim = null;
  function goTo(b, pad) {
    const r = svg.getBoundingClientRect(); const ar = r.width > 50 && r.height > 50 ? r.width / r.height : 1.3;
    let w = b.w + (pad || 80) * 2; let h = b.h + (pad || 80) * 2;
    if (!(w > 0 && h > 0)) return;
    if (w / h > ar) h = w / ar; else w = h * ar;
    const target = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
    const from = { ...cam }; const t0 = performance.now();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    cancelAnimationFrame(anim);
    const step = (t) => {
      const k = reduce ? 1 : Math.max(0, Math.min(1, (t - t0) / 450)); const e = 1 - Math.pow(1 - k, 3);
      for (const key of ['x', 'y', 'w', 'h']) cam[key] = from[key] + (target[key] - from[key]) * e;
      applyCam(); if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  const fitAll = () => world && goTo(world, 40);
  function toWorld(cx, cy) {
    const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function zoomAt(f, cx, cy) {
    const r = svg.getBoundingClientRect();
    const p = cx === undefined ? { x: cam.x + cam.w / 2, y: cam.y + cam.h / 2 } : toWorld(cx, cy);
    const nw = Math.max(300, Math.min((world ? world.w : 3000) * 2.2, cam.w * f));
    const k = nw / cam.w;
    cam.x = p.x - (p.x - cam.x) * k; cam.y = p.y - (p.y - cam.y) * k; cam.w = nw; cam.h = cam.h * k;
    applyCam(); void r;
  }
  const pointers = new Map(); let dragged = false; let pinch = null;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragged = false;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId); if (!prev) return;
    const r = svg.getBoundingClientRect(); const scale = Math.max(cam.w / r.width, cam.h / r.height);
    if (pointers.size === 1) {
      const dx = e.clientX - prev.x; const dy = e.clientY - prev.y;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      if (!dragged) { dragged = true; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); }
      cam.x -= dx * scale; cam.y -= dy * scale; applyCam();
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt(pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch = d; dragged = true;
    }
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  // Un arrastre no debe abrir la ficha del personaje sobre el que terminó.
  svg.addEventListener('click', (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
  svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
  svg.addEventListener('keydown', (e) => {
    if (e.target !== svg) return;
    const k = cam.w * 0.08;
    if (e.key === 'ArrowLeft') cam.x -= k; else if (e.key === 'ArrowRight') cam.x += k; else if (e.key === 'ArrowUp') cam.y -= k; else if (e.key === 'ArrowDown') cam.y += k;
    else if (e.key === '+' || e.key === '=') zoomAt(1 / 1.2); else if (e.key === '-') zoomAt(1.2); else return;
    e.preventDefault(); applyCam();
  });
  $('#z-in').addEventListener('click', () => zoomAt(1 / 1.25));
  $('#z-out').addEventListener('click', () => zoomAt(1.25));
  $('#z-fit').addEventListener('click', () => selectFloor('all'));

  function focusZone(id) {
    const n = st.nodes.zones[id]; if (!n) return;
    const f = st.nodes.floors[n.floor];
    const t = n.g.closest('.floor').getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/);
    const b = n.bbox; void f;
    goTo({ x: b.x + Number(t[1]), y: b.y + Number(t[2]), w: b.w, h: b.h }, 60);
  }
  function focusAgent(id) {
    const n = st.nodes.agents[id]; if (!n) return;
    const bb = n.g.getBBox(); const m = n.g.getCTM(); const root = svg.getCTM();
    if (!m || !root) return;
    const rel = root.inverse().multiply(m);
    const cx = rel.e + bb.x + bb.width / 2; const cy = rel.f + bb.y + bb.height / 2;
    goTo({ x: cx - 260, y: cy - 180, w: 520, h: 340 }, 20);
  }

  // ── Plantas ──
  function renderFloors() {
    const nav = $('#floors');
    const urgentBy = {};
    for (const z of st.snap.zones) urgentBy[z.floor] = (urgentBy[z.floor] || 0) + z.urgent;
    const total = Object.values(urgentBy).reduce((a, b) => a + b, 0);
    const item = (id, name, desc, n, key) => el('button', { type: 'button', 'aria-current': st.floor === id ? 'true' : 'false', title: key ? `Atajo: ${key}` : '', onclick: () => selectFloor(id) },
      el('span', {}, name, desc ? el('small', { text: desc }) : null), n ? el('span', { class: 'dot', text: String(n), 'aria-label': n + ' urgentes' }) : null);
    nav.replaceChildren(item('all', 'Vista general', 'Toda la empresa', total, '0'),
      ...st.snap.floors.map((f, i) => item(f.id, f.name, f.desc, urgentBy[f.id], String(i + 1))));
  }
  function selectFloor(id) {
    st.floor = id; renderFloors();
    if (st.view !== 'map') setView('map');
    if (id === 'all') return fitAll();
    const f = st.nodes.floors[id]; if (f) goTo(f, 30);
  }

  // ── Leyenda, filtros, lista y franja móvil ──
  function renderLegend() {
    const lg = $('#legend');
    lg.replaceChildren(el('details', { open: window.innerWidth > 900 ? true : null },
      el('summary', { text: 'Estados' }),
      el('ul', {}, Object.entries(st.snap.states).map(([k, v]) => el('li', { class: 'st-' + k }, el('span', { class: 'sw' }), `${GLYPH[k]} ${v}`))),
      el('p', { text: 'Las animaciones son decorativas. La prueba de actividad es el registro de ejecución de cada agente (abrí su ficha).' })));
  }
  function renderFilters() {
    const dsel = $('#f-dept'); const ssel = $('#f-state');
    if (dsel.options.length <= 1) {
      for (const d of [...new Set(st.snap.agents.map((a) => a.department))].sort()) dsel.append(el('option', { value: d, text: d }));
      for (const [k, v] of Object.entries(st.snap.states)) if (k !== 'analyzing') ssel.append(el('option', { value: k, text: k === 'working' ? 'Trabajando o analizando' : v }));
    }
  }
  function renderList() {
    const box2 = $('#hq-list');
    const groups = {};
    for (const a of st.snap.agents) {
      if (st.filters.dept && a.department !== st.filters.dept) continue;
      if (st.filters.state && !(a.state === st.filters.state || (st.filters.state === 'working' && a.state === 'analyzing'))) continue;
      (groups[a.department] = groups[a.department] || []).push(a);
    }
    const out = [];
    for (const [d, list] of Object.entries(groups)) {
      out.push(el('h3', { text: `${d} (${list.length})` }), el('div', { class: 'cards' }, list.map((a) => el('button', { type: 'button', class: 'acard', onclick: () => openAgent(a.id) },
        el('b', { text: a.name }), el('span', {}, el('span', { class: 'chip st-' + a.state, text: a.state_label })),
        el('span', { class: 'why', text: a.reason || '' }), el('small', { text: 'Verificado: ' + (a.verified_at ? ago(a.verified_at) : 'sin registros') })))));
    }
    if (!out.length) out.push(el('p', { class: 'na', text: 'Ningún agente coincide con los filtros.' }));
    box2.replaceChildren(...out);
  }
  function renderStrip() {
    const t = st.snap.totals;
    $('#strip').replaceChildren(
      el('span', { class: 'chip st-working', text: `${t.working} trabajando` }), el('span', { class: 'chip st-review', text: `${t.review} en revisión` }),
      el('span', { class: 'chip st-blocked', text: `${t.blocked} bloqueados` }), el('span', { class: 'chip st-error', text: `${t.error} con error` }),
      el('span', { class: 'chip st-idle', text: `${t.idle} inactivos` }), el('span', { class: 'chip st-offline', text: `${t.offline} desconectados` }));
  }
  function setView(v) {
    st.view = v;
    $('#v-map').setAttribute('aria-pressed', v === 'map' ? 'true' : 'false'); $('#v-list').setAttribute('aria-pressed', v === 'list' ? 'true' : 'false');
    $('#map-wrap').hidden = v !== 'map'; $('#hq-list').hidden = v !== 'list';
    if (v === 'list') renderList();
  }
  $('#v-map').addEventListener('click', () => setView('map'));
  $('#v-list').addEventListener('click', () => setView('list'));
  $('#f-dept').addEventListener('change', (e) => { st.filters.dept = e.target.value; updateAgents(); if (st.view === 'list') renderList(); });
  $('#f-state').addEventListener('change', (e) => { st.filters.state = e.target.value; updateAgents(); if (st.view === 'list') renderList(); });

  // ── Búsqueda ──
  const qi = $('#q'); const qr = $('#q-results'); let qsel = -1;
  function search() {
    const q = qi.value.trim().toLowerCase(); updateAgents();
    if (!q) { qr.hidden = true; qi.setAttribute('aria-expanded', 'false'); return; }
    const hits = st.snap.agents.filter((a) => (a.name + ' ' + a.department + ' ' + a.id).toLowerCase().includes(q)).slice(0, 10);
    qsel = hits.length ? 0 : -1;
    qr.replaceChildren(...hits.map((a, i) => el('li', { role: 'option', 'aria-selected': i === qsel ? 'true' : 'false', 'data-id': a.id, onclick: () => pick(a.id) },
      el('span', { text: a.name }), el('span', { class: 'chip st-' + a.state, text: a.state_label }))));
    if (!hits.length) qr.append(el('li', { text: 'Sin resultados' }));
    qr.hidden = false; qi.setAttribute('aria-expanded', 'true');
  }
  function pick(id) { qr.hidden = true; qi.setAttribute('aria-expanded', 'false'); if (st.view !== 'map') setView('map'); focusAgent(id); openAgent(id); }
  qi.addEventListener('input', search);
  qi.addEventListener('keydown', (e) => {
    const items = [...qr.querySelectorAll('li[data-id]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); qsel = (qsel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); items.forEach((li, i) => li.setAttribute('aria-selected', i === qsel ? 'true' : 'false')); }
    else if (e.key === 'Enter' && items[qsel]) { e.preventDefault(); pick(items[qsel].dataset.id); }
    else if (e.key === 'Escape') { qi.value = ''; search(); qi.blur(); }
  });

  // ── Panel lateral ──
  const drawer = $('#drawer'); const body = $('#drawer-body');
  function openDrawer(kind, id, nodes) {
    st.drawer = { kind, id };
    body.replaceChildren(...nodes.filter(Boolean));
    drawer.hidden = false;
    $('#drawer-close').focus({ preventScroll: true });
  }
  function closeDrawer() { drawer.hidden = true; st.drawer = null; }
  $('#drawer-close').addEventListener('click', closeDrawer);
  const loading = (t) => [el('h2', { text: t }), el('p', { class: 'sub', text: 'Cargando…' })];
  const sec = (title, kids, open) => el('details', { open: open ? true : null }, el('summary', {}, el('h3', { text: title })), ...kids);
  const kv = (pairs) => el('dl', { class: 'kv' }, pairs.filter(Boolean).map(([k, v]) => [el('dt', { text: k }), el('dd', {}, v === null || v === undefined || v === '' ? '—' : v)]));
  const listOr = (arr, render, empty) => (arr && arr.length ? el('ul', { class: 'rows' }, arr.map((x) => el('li', {}, render(x)))) : el('p', { class: 'na', text: empty || 'Sin registros.' }));
  const kpi = (n, label, cls) => el('div', { class: 'kpi' + (cls ? ' ' + cls : '') }, el('b', { text: n === null || n === undefined ? '—' : String(n) }), el('span', { text: label }));
  function flash(msg, ok) { const t = el('div', { class: 'toast', role: 'status', text: msg }); t.style.setProperty('--st', ok === false ? '#ef4444' : '#22c55e'); $('#toasts').append(t); setTimeout(() => t.remove(), 6000); t.onclick = () => t.remove(); }
  const run = (fn, ok) => async (e) => {
    const b = e && e.currentTarget; if (b) b.disabled = true;
    try { const r = await fn(); if (ok) flash(typeof ok === 'function' ? ok(r) : ok, true); await refresh(); if (st.drawer && st.drawer.kind === 'agent') openAgent(st.drawer.id, true); }
    catch (err) { flash(err.message, false); } finally { if (b) b.disabled = false; }
  };

  // Centro de operaciones (recepción).
  function openHome(e, noFocus) {
    const s = st.snap; const t = s.totals; const r = s.reports.next || {};
    if (!noFocus) focusZone('reception');
    openDrawer('home', null, [
      el('h2', { text: 'Centro de operaciones' }),
      el('p', { class: 'sub', text: `Estado calculado ${fmt(s.generated_at)} a partir de los registros de ejecución.` }),
      el('div', { class: 'kpis' }, kpi(t.agents, 'agentes'), kpi(t.working, 'trabajando o analizando', t.working ? 'good' : ''), kpi(t.review, 'esperan revisión'),
        kpi(t.blocked, 'bloqueados', t.blocked ? 'warn' : ''), kpi(t.error, 'con error', t.error ? 'bad' : ''), kpi(t.waiting, 'en espera'), kpi(t.idle, 'inactivos'),
        kpi(t.paused, 'pausados'), kpi(t.offline, 'desconectados')),
      sec('Últimas 48 horas', [el('div', { class: 'kpis' }, kpi(t.events_48h, 'eventos registrados'), kpi(t.runs_48h, 'ejecuciones'), kpi(t.runs_ok_48h, 'correctas', 'good'), kpi(t.runs_error_48h, 'con error', t.runs_error_48h ? 'bad' : '')),
        el('button', { class: 'hq-btn small', type: 'button', onclick: () => toggleFeed(true), text: 'Ver la actividad' })], true),
      sec('Alertas importantes', [listOr(s.alerts.slice(0, 10), (a) => [el('span', { class: 'chip ' + (a.severity === 'critical' ? 'st-error' : a.severity === 'warning' ? 'st-blocked' : 'st-idle'), text: { critical: 'Crítica', warning: 'Advertencia', info: 'Aviso' }[a.severity] }), ' ', el('b', { text: a.title }),
        a.details && a.details.cause ? el('span', { class: 'meta', text: `Causa: ${a.details.cause}` }) : null, a.details && a.details.impact ? el('span', { class: 'meta', text: `Impacto: ${a.details.impact}` }) : null,
        a.details && a.details.owner ? el('span', { class: 'meta', text: `Responsable: ${a.details.owner}` }) : null, a.details && a.details.action ? el('span', { class: 'meta', text: `Acción: ${a.details.action}` }) : null,
        el('span', { class: 'meta', text: `Visto ${ago(a.last_seen_at)} · ${a.occurrences} vez/veces` })], 'No hay alertas abiertas.')], true),
      sec('Próximo informe ejecutivo', [kv([['Fecha', r.local ? `${r.local} (${r.timezone})` : '—'], ['Automatización', r.status_label || '—'], ['Último correcto', r.last_success ? fmt(r.last_success) : 'todavía ninguno']]),
        el('button', { class: 'hq-btn small', type: 'button', onclick: openReports, text: 'Ir a informes' })], true),
      sec(`Tareas pendientes (${t.open_tasks})`, [listOr(s.agents.filter((a) => a.open_tasks).sort((a, b) => b.blocked_tasks - a.blocked_tasks).slice(0, 12), (a) => [el('a', { href: '#', onclick: (e) => { e.preventDefault(); openAgent(a.id); }, text: a.name }), ` · ${a.open_tasks} abiertas${a.blocked_tasks ? `, ${a.blocked_tasks} bloqueadas` : ''}`])]),
      sec(`Decisiones de los CEO (${s.decisions.length + s.approvals.length})`, [listOr([...s.decisions.map((d) => `${d.id}: ${d.title}`), ...s.approvals.map((a) => `Aprobación: ${a.title}`)], (x) => x, 'Nada pendiente.'),
        el('a', { href: '/admin#approvals', text: 'Abrir la bandeja de aprobaciones' })]),
      sec('Acceso a todas las áreas', [el('div', { class: 'actions' }, s.floors.map((f) => el('button', { class: 'hq-btn small', type: 'button', onclick: () => selectFloor(f.id), text: f.name })),
        el('button', { class: 'hq-btn small', type: 'button', onclick: () => openZone('meeting'), text: 'Sala de reuniones' }), el('button', { class: 'hq-btn small', type: 'button', onclick: () => openZone('servers'), text: 'Sala de servidores' }))], true),
    ]);
  }

  async function openZone(id) {
    const z = st.snap.zones.find((x) => x.id === id); if (!z) return;
    if (id === 'reception') return openHome();
    focusZone(id);
    openDrawer('zone', id, loading(z.name));
    const agents = z.agents.map((a) => st.snap.agents.find((x) => x.id === a)).filter(Boolean);
    const head = [el('h2', { text: z.name }), el('p', { class: 'sub', text: (st.snap.floors.find((f) => f.id === z.floor) || {}).name }),
      sec('Temas que cubre', [el('ul', { class: 'plain' }, z.topics.map((t) => el('li', { text: t })))]),
      sec(`Agentes (${agents.length})`, [agents.length ? el('ul', { class: 'rows' }, agents.map((a) => el('li', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); openAgent(a.id); }, text: a.name }), ' ',
        el('span', { class: 'chip st-' + a.state, text: a.state_label }), el('span', { class: 'meta', text: a.reason || '' })))) :
        el('p', { class: 'na', text: z.kind === 'team' ? 'Puesto vacante: no hay un agente asignado a este equipo.' : 'Sala sin agentes.' })], true)];
    let extra = [];
    try {
      if (id === 'servers') extra = serversView(await api('/api/admin/hq/rooms/servers'));
      else if (id === 'meeting') extra = await meetingView();
      else if (z.kind === 'ceo') extra = ceoView(z);
      else if (z.kind === 'social') extra = socialView(await api('/api/admin/hq/rooms/social/' + id));
      else if (z.floor === 'p3') extra = legalView(await api('/api/admin/hq/rooms/legal'));
      else if (z.floor === 'p4') extra = marketingView(await api('/api/admin/hq/rooms/marketing'));
      else if (z.floor === 'p6') extra = productView(await api('/api/admin/hq/rooms/product'));
    } catch (e) { extra = [el('p', { class: 'notice bad', text: 'No se pudieron leer los datos: ' + e.message })]; }
    if (st.drawer && st.drawer.id === id) body.replaceChildren(...head.slice(0, 2), ...extra, ...head.slice(2));
  }

  function serversView(d) {
    return [
      el('div', { class: 'kpis' }, kpi(d.database.latency_ms + ' ms', 'latencia de la base ahora'), kpi(d.jobs.filter((j) => j.last_status === 'failed').length, 'tareas con fallo', d.jobs.some((j) => j.last_status === 'failed') ? 'bad' : ''),
        kpi(d.jobs.filter((j) => j.stale).length, 'tareas sin correr a tiempo', d.jobs.some((j) => j.stale) ? 'warn' : ''), kpi(d.apis.errors_24h.reduce((s, x) => s + x.n, 0), 'errores en 24 h')),
      sec('Backend', [kv([['Estado', d.backend.status], ['Versión', d.backend.commit ? d.backend.commit.slice(0, 7) : 'local'], ['Node', d.backend.node], ['Medido', fmt(d.measured_at)]]), el('p', { class: 'notice', text: d.backend.note })], true),
      sec('Base de datos', [kv([['Latencia', d.database.latency_ms + ' ms'], ['Crípticos', d.database.rows.clues], ['Partidas', d.database.rows.games], ['Usuarios', d.database.rows.users], ['Eventos de agentes', d.database.rows.events], ['Auditoría', d.database.rows.audit]])]),
      sec('Tareas programadas', [listOr(d.jobs, (j) => [el('b', { text: j.name }), ' ', el('span', { class: 'chip ' + (j.last_status === 'failed' ? 'st-error' : j.stale ? 'st-blocked' : j.last_status === 'success' ? 'st-working' : 'st-idle'),
        text: j.last_status === 'failed' ? 'Falló' : j.stale ? 'Atrasada' : j.last_status === 'success' ? 'Al día' : 'Sin ejecutar' }),
        el('span', { class: 'meta', text: `Cada ${j.interval_minutes} min · última ${fmt(j.last_run_at)} · próxima ${fmt(j.next_run_at)}${j.enabled ? '' : ' · desactivada'}` }), j.last_error ? el('span', { class: 'meta', text: j.last_error }) : null])], true),
      sec('APIs y errores', [listOr(d.apis.errors_24h, (x) => `${x.scope}: ${x.n} en 24 h`, 'Sin errores en 24 h.'), listOr(d.errors, (x) => [el('b', { text: x.scope }), ' ', x.message, el('span', { class: 'meta', text: fmt(x.created_at) })], 'Sin errores registrados.')]),
      sec('Integraciones', [listOr(d.integrations, (i) => [el('b', { text: i.name }), ' ', el('span', { class: 'chip ' + (i.status === 'verified' ? 'st-working' : i.status === 'missing' ? 'st-error' : 'st-idle'), text: { verified: 'Verificada', configured_unverified: 'Sin verificar', missing: 'Falta', not_needed: 'No hace falta' }[i.status] || i.status }),
        i.ceo_action && i.ceo_action !== '—' ? el('span', { class: 'meta', text: 'CEO: ' + i.ceo_action }) : null])]),
      sec('Disponibilidad, recursos y costos', [el('p', { class: 'notice', text: d.availability.note }), kv([['Memoria (esta instancia)', d.resources.instance_memory_mb + ' MB']]), el('p', { class: 'notice', text: d.resources.note }),
        listOr(d.costs.rows, (c) => `${c.vendor} · ${c.area} · ${{ actual: 'real', estimate: 'estimado', budget: 'presupuesto' }[c.kind] || c.kind}: ${Math.round(c.total * 100) / 100} ${c.currency}`, 'No hay costos cargados.'),
        d.costs.note ? el('p', { class: 'notice', text: d.costs.note }) : null]),
      el('p', { class: 'notice', text: 'Nunca se muestran claves, tokens ni contraseñas: los textos de error se filtran antes de llegar acá.' }),
    ];
  }
  function socialView(d) {
    return [el('div', { class: 'kpis' }, kpi(d.pending_approval, 'por aprobar'), kpi(d.approved, 'aprobadas'), kpi(d.scheduled, 'programadas'), kpi(d.published, 'publicadas'), kpi(d.incidents, 'incidencias', d.incidents ? 'bad' : '')),
      sec('Próximas publicaciones', [listOr(d.next, (p) => [el('b', { text: p.title }), el('span', { class: 'meta', text: `${p.format} · ${p.status} · ${fmt(p.scheduled_at)}` })], 'Nada aprobado ni programado.')], true),
      sec('Publicadas', [listOr(d.published_items, (p) => [p.title, ' ', link(p.published_url)], 'Sin publicaciones verificadas con enlace.')]),
      sec('Comentarios y mensajes', [el('p', { class: 'notice', text: d.comments.note }), el('p', { class: 'notice', text: d.results.note })], true),
      sec('Incidencias', [listOr(d.errors, (e) => [e.title, el('span', { class: 'meta', text: e.external_error || '' })], 'Sin errores de publicación.')]),
      el('a', { href: '/admin#social', text: 'Abrir el calendario de redes' })];
  }
  function legalView(d) {
    return [sec('Documentos', [listOr(d.docs, (x) => `${x.title}: v${x.version || '—'} (${x.status || 'sin versión'})`)], true),
      sec('Jurisdicciones', [listOr(d.jurisdictions, (j) => `${j.name}: ${j.status}${j.needs_lawyer ? ' · requiere abogado' : ''}${j.verified_at ? ' · verificado ' + fmt(j.verified_at) : ''}`)]),
      sec('Riesgos legales abiertos', [listOr(d.risks, (r) => `${r.id}: ${r.title} (${r.severity})`, 'Sin riesgos abiertos.')]),
      sec('Pendientes de revisión humana', [listOr(d.approvals, (a) => a.title, 'Nada pendiente.'), el('p', { class: 'notice', text: 'Los agentes legales investigan y preparan borradores; no son abogados.' })], true)];
  }
  function marketingView(d) {
    return [sec('Campañas', [listOr(d.campaigns, (c) => `${c.campaign}: ${c.n} piezas · ${c.in_production || 0} en producción · ${c.pending || 0} por aprobar · ${c.scheduled || 0} programadas · ${c.published || 0} publicadas`)], true),
      sec('Contenidos en producción', [listOr(d.in_production, (p) => [el('b', { text: p.title }), el('span', { class: 'meta', text: `${p.platform} · ${p.format} · ${p.status}` })], 'Nada en producción.')]),
      sec('Aprobaciones de marketing', [listOr(d.approvals, (a) => a.title, 'Nada pendiente.')])];
  }
  function productView(d) {
    return [el('div', { class: 'kpis' }, kpi(d.bank.published, `publicados (meta ${d.bank.target})`), kpi(d.review_pending, 'en revisión'), kpi(d.audits_pending, 'auditorías pendientes'),
      kpi(d.duplicates_open, 'duplicados abiertos'), kpi(d.reports_open, 'errores informados', d.reports_open ? 'warn' : ''), kpi(d.submissions_pending, 'propuestas por moderar'), kpi(d.games_7d, 'partidas en 7 días')),
    sec('Dificultades e idiomas', [listOr(d.by_difficulty, (x) => `Dificultad ${x.difficulty}: ${x.n} publicados`), listOr(d.languages, (l) => `${l.name_native} (${l.code}): ${l.enabled ? 'activo' : 'inactivo'}`)]),
    sec('Último lote del banco', [d.last_batch ? kv([['Celda', `${d.last_batch.language_code} · dificultad ${d.last_batch.difficulty}`], ['Estado', d.last_batch.status], ['Publicados', d.last_batch.published], ['Inicio', fmt(d.last_batch.started_at)], ['Fin', fmt(d.last_batch.finished_at)]]) : el('p', { class: 'na', text: 'Sin lotes.' })])];
  }
  async function meetingView() {
    const list = await api('/api/admin/hq/reports');
    const last = list.items.find((r) => r.status === 'ready');
    const rep = last ? await api('/api/admin/hq/reports/' + last.id) : null;
    const rv = rep && rep.content && rep.content.review;
    const s = st.snap;
    return [
      el('p', { class: 'notice warn', text: 'Revisiones automáticas generadas a partir de los registros. No son reuniones ni conversaciones entre agentes.' }),
      sec('Revisión programada', [kv([['Próxima', s.reports.next ? s.reports.next.local : '—'], ['Última', rep ? `${fmt(rep.generated_at)} (${rep.trigger === 'scheduled' ? 'programada' : 'manual'})` : 'todavía ninguna']])], true),
      rv ? sec('Resumen de la última revisión', [
        el('h4', { text: '¿Qué está funcionando?' }), listOr(rv.working, (x) => x, 'Sin evidencia de trabajo correcto en el período.'),
        el('h4', { text: '¿Qué no está funcionando?' }), listOr(rv.not_working, (x) => x, 'Sin fallos registrados.'),
        el('h4', { text: '¿Qué agentes están bloqueados?' }), listOr(rv.blocked_agents, (x) => x, 'Ninguno.'),
        el('h4', { text: '¿Qué lleva demasiado tiempo?' }), listOr(rv.too_long, (x) => x, 'Nada.'),
        el('h4', { text: '¿Qué departamentos necesitan recursos?' }), listOr(rv.needs_resources, (x) => x, 'Ninguno con carga alta.'),
        el('h4', { text: 'Mejoras de mayor impacto' }), listOr(rv.highest_impact, (x) => x),
        el('h4', { text: 'Prioridades del próximo ciclo' }), listOr(rv.next_cycle, (x) => x)], true) : el('p', { class: 'na', text: 'Todavía no hay una revisión generada.' }),
      sec(`Decisiones pendientes (${s.decisions.length + s.approvals.length})`, [listOr([...s.decisions.map((d) => `${d.id}: ${d.title}`), ...s.approvals.map((a) => a.title)], (x) => x, 'Nada pendiente.')], true),
      sec(`Riesgos críticos y altos (${s.risks.length})`, [listOr(s.risks, (r) => `${r.id}: ${r.title} (${r.severity})`, 'Ninguno abierto.')]),
      rep ? el('button', { class: 'hq-btn small', type: 'button', onclick: () => openReport(rep.id), text: 'Abrir el informe completo' }) : null,
    ];
  }
  function ceoView(z) {
    const office = st.snap.ceos.find((o) => o.zone === z.id) || {};
    return [
      kv([['Cuenta', office.account ? `${office.account.username}${office.account.title ? ' · ' + office.account.title : ''}` : '—'], ['Estado', office.status], ['Último ingreso', office.account ? fmt(office.account.last_login_at) : '—']]),
      el('p', { class: 'notice', text: 'Los dos despachos tienen los mismos accesos, permisos y herramientas. No hay diferencias de autoridad.' }),
      el('div', { class: 'actions' },
        el('button', { class: 'hq-btn primary', type: 'button', onclick: openHome, text: 'Abrir centro de mando' }),
        el('button', { class: 'hq-btn', type: 'button', onclick: openApprovals, text: `Aprobaciones (${st.snap.totals.pending_approvals})` }),
        el('button', { class: 'hq-btn', type: 'button', onclick: openReports, text: 'Informes' }),
        el('button', { class: 'hq-btn', type: 'button', onclick: () => setView('list'), text: 'Revisar agentes' })),
    ];
  }

  async function openApprovals() {
    openDrawer('approvals', null, loading('Aprobaciones'));
    const d = await api('/api/admin/approvals?status=open');
    body.replaceChildren(el('h2', { text: 'Aprobaciones pendientes' }), el('p', { class: 'sub', text: 'Cada voto queda registrado y vale solo para la versión exacta que se ve.' }),
      listOr(d.items, (a) => [el('b', { text: a.title }), el('span', { class: 'meta', text: `${a.kind_label} · v${a.version} · ${fmt(a.created_at)}` }), voteBox(a)], 'No hay aprobaciones pendientes.'),
      el('a', { href: '/admin#approvals', text: 'Ver el detalle completo en el panel' }));
  }
  function voteBox(a) {
    const c = el('input', { placeholder: 'Comentario (obligatorio para rechazar o pedir cambios)', 'aria-label': 'Comentario' });
    const v = (decision) => run(() => api('/api/admin/approvals/' + a.id + '/vote', { method: 'POST', body: { decision, comment: c.value, version: a.version, content_hash: a.content_hash } }), 'Decisión registrada.');
    return el('div', { class: 'form' }, c, el('div', { class: 'actions' },
      el('button', { class: 'hq-btn small primary', type: 'button', onclick: v('approve'), text: 'Aprobar' }),
      el('button', { class: 'hq-btn small', type: 'button', onclick: v('changes'), text: 'Pedir cambios' }),
      el('button', { class: 'hq-btn small danger', type: 'button', onclick: v('reject'), text: 'Rechazar' })));
  }

  // ── Ficha del agente ──
  function avatarSvg(a) {
    const sv = document.createElementNS(NS, 'svg'); sv.setAttribute('viewBox', '-24 -70 48 80'); sv.setAttribute('aria-hidden', 'true');
    const zone = st.snap.zones.find((z) => z.id === a.zone) || {};
    const node = buildAgent({ ...a }, 0, 0, FLOOR_COLOR[zone.floor] || '#64748b');
    node.setAttribute('transform', 'translate(0,0)'); node.removeAttribute('tabindex'); node.removeAttribute('role');
    node.setAttribute('class', 'agent st-' + a.state);
    node.querySelector('.tag').remove(); node.querySelector('.desk').remove();
    node.querySelector('.bubble text').textContent = GLYPH[a.state] || '';
    sv.append(node);
    return sv;
  }
  async function openAgent(id, keep) {
    const card = st.snap.agents.find((a) => a.id === id);
    if (!keep) { openDrawer('agent', id, loading(card ? card.name : id)); if (st.view === 'map' && window.innerWidth > 900) focusAgent(id); }
    let a;
    try { a = await api('/api/admin/hq/agents/' + encodeURIComponent(id)); } catch (e) { body.replaceChildren(el('p', { class: 'notice bad', text: e.message })); return; }
    if (!st.drawer || st.drawer.id !== id) return;
    const mapNode = st.nodes.agents[id];
    const av = avatarSvg(a);
    if (mapNode) st.nodes.agents[id] = mapNode;
    const stale = a.stale || (a.verified_at && Date.now() - Date.parse(a.verified_at) > 2 * 86400000);
    const ev = { week: a.evaluation.week, month: a.evaluation.month };
    let period = 'month';
    const evalBox = el('div', {});
    const renderEval = () => {
      const e = ev[period]; const i = e.indicators;
      const row = (k, v) => el('div', {}, el('span', { text: k }), el('b', { text: v }), el('small', { text: i[Object.keys(LBL).find((x) => LBL[x] === k)].definition }));
      evalBox.replaceChildren(
        el('p', { class: 'sub', text: `${e.period.label}: ${fmt(e.period.from)} → ${fmt(e.period.to)}` }),
        el('p', {}, 'Calidad: ', el('span', { class: 'chip ' + ({ good: 'st-working', watch: 'st-blocked', poor: 'st-error', insufficient: 'st-idle' }[e.quality.grade]), text: e.quality.label }), ' ', el('span', { class: 'meta', text: e.quality.basis })),
        el('div', { class: 'ind' },
          row(LBL.runs, `${i.runs.value} (${i.runs.ok} ok · ${i.runs.error} error · ${i.runs.cancelled} canc.)`),
          row(LBL.success_rate, i.success_rate.value == null ? `sin datos (${i.success_rate.sample})` : `${i.success_rate.value} %`),
          row(LBL.tasks_done, String(i.tasks_done.value)), row(LBL.first_pass, i.first_pass.value == null ? 'sin datos' : `${i.first_pass.value} % de ${i.first_pass.sample}`),
          row(LBL.rework, String(i.rework.value)), row(LBL.regressions, String(i.regressions.value)),
          row(LBL.median_minutes, i.median_minutes.value == null ? 'sin datos' : `${i.median_minutes.value} min`), row(LBL.cost, `${i.cost.value} USD`),
          row(LBL.permission_denials, String(i.permission_denials.value)), row(LBL.impact, String(i.impact.value)),
          row(LBL.documentation, i.documentation.value == null ? 'sin datos' : `${i.documentation.value} %`),
          row(LBL.external_blocks, `${i.external_blocks.value}${Object.keys(i.external_blocks.by_cause).length ? ' · ' + Object.entries(i.external_blocks.by_cause).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ') : ''}`)));
    };
    const LBL = { runs: 'Ejecuciones', success_rate: 'Tasa de éxito', tasks_done: 'Tareas completadas', first_pass: 'Aprobado a la primera', rework: 'Retrabajo', regressions: 'Regresiones',
      median_minutes: 'Duración mediana', cost: 'Costo registrado', permission_denials: 'Acciones sin permiso', impact: 'Impacto', documentation: 'Documentación', external_blocks: 'Bloqueos ajenos (no penalizan)' };
    renderEval();
    const tabs = el('div', { class: 'tabs' }, [['week', '7 días'], ['month', '30 días']].map(([k, t]) => el('button', { type: 'button', 'aria-pressed': k === period ? 'true' : 'false',
      onclick: (e) => { period = k; tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); renderEval(); }, text: t })));

    const taskRow = (t) => {
      const sel = el('select', { 'aria-label': 'Prioridad de ' + t.id, onchange: run(() => api('/api/admin/hq/tasks/' + t.id + '/priority', { method: 'PATCH', body: { priority: Number(sel.value) } }), 'Prioridad actualizada.') },
        [1, 2, 3, 4, 5].map((p) => el('option', { value: p, selected: p === t.priority ? true : null, text: 'P' + p })));
      return [el('b', { text: `${t.id} · ${t.title}` }), ' ', el('span', { class: 'chip ' + (t.status === 'blocked' ? 'st-blocked' : t.status === 'in_review' ? 'st-review' : t.status === 'done' ? 'st-working' : 'st-waiting'), text: TASK_ST[t.status] || t.status }),
        el('span', { class: 'meta', text: [t.expected, t.blocked_reason ? 'Bloqueo: ' + t.blocked_reason : null, t.due_at ? 'Vence ' + fmt(t.due_at) : null].filter(Boolean).join(' · ') }),
        t.status === 'done' ? el('span', { class: 'meta' }, 'Evidencia: ', link(t.evidence)) : el('label', { class: 'meta' }, 'Prioridad ', sel),
        el('a', { class: 'meta', href: '/admin#task/' + t.id, text: 'Ver detalle de la tarea' })];
    };

    // Formularios de acciones.
    const fTitle = el('input', { required: true, placeholder: 'Qué tiene que hacer' }); const fExp = el('input', { placeholder: 'Resultado esperado (criterio de aceptación)' });
    const fPri = el('select', {}, [1, 2, 3, 4, 5].map((p) => el('option', { value: p, selected: p === 3 ? true : null, text: 'Prioridad ' + p + (p === 1 ? ' (máxima)' : '') })));
    const fLvl = el('select', {}, [1, 2, 3, 4].map((p) => el('option', { value: p, text: 'Nivel de aprobación ' + p })));
    const fDue = el('input', { type: 'date' });
    const assign = el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); run(() => api('/api/admin/hq/agents/' + id + '/tasks', { method: 'POST', body: { title: fTitle.value, expected: fExp.value, priority: Number(fPri.value), approval_level: Number(fLvl.value), due_at: fDue.value || undefined } }), (t) => `Tarea ${t.id} asignada.`)(e); } },
      el('label', {}, 'Tarea', fTitle), el('label', {}, 'Resultado esperado', fExp), el('label', {}, 'Prioridad', fPri), el('label', {}, 'Aprobación', fLvl), el('label', {}, 'Fecha objetivo', fDue),
      el('button', { class: 'hq-btn primary', type: 'submit', disabled: a.pause ? true : null, text: a.pause ? 'Agente pausado' : 'Asignar tarea' }));
    const pauseReason = el('input', { placeholder: 'Motivo de la pausa' });
    const doPause = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await api('/api/admin/hq/agents/' + id + '/pause', { method: 'POST', body: { reason: pauseReason.value } }); flash('Asignaciones pausadas.'); }
      catch (err) {
        if (err.data && err.data.error === 'confirm_required') {
          const typed = window.prompt(err.message);
          if (typed === 'PAUSAR') { try { await api('/api/admin/hq/agents/' + id + '/pause', { method: 'POST', body: { reason: pauseReason.value, confirm: 'PAUSAR' } }); flash('Asignaciones pausadas. La ejecución en curso termina sola.'); } catch (x) { flash(x.message, false); } }
        } else flash(err.message, false);
      } finally { b.disabled = false; await refresh(); openAgent(id, true); }
    };

    const nodes = [
      el('div', { class: 'head' }, av, el('div', {}, el('h2', { text: a.name }), el('p', { class: 'sub', text: `${a.role_title} · ${a.department}` }),
        el('span', { class: 'chip st-' + a.state, text: a.state_label }))),
      el('p', { class: 'sub', text: a.reason || '' }),
      el('p', { class: 'notice' + (stale ? ' warn' : '') }, `Última actividad verificada: ${a.verified_at ? fmt(a.verified_at) + ' (' + ago(a.verified_at) + ')' : 'sin registros'}. `,
        stale ? 'La información puede estar desactualizada. ' : '', 'La animación del personaje es decorativa: la prueba es el historial de ejecución de abajo.'),
      a.pause ? el('p', { class: 'notice warn', text: `Asignaciones pausadas ${fmt(a.pause.at)} por ${a.pause.by || '—'}: ${a.pause.reason || ''}` }) : null,
      sec('Trabajo actual', [kv([
        ['Tarea actual', a.current_task ? `${a.current_task.id} · ${a.current_task.title}` : (a.current_run ? a.current_run.summary : 'Ninguna en curso')],
        ['Etapa', a.current_run && a.current_run.stage ? (STAGE[a.current_run.stage] || a.current_run.stage) : '—'],
        ['Tiempo en ejecución', a.elapsed_minutes != null ? `${a.elapsed_minutes} min` : '—'],
        ['Próxima tarea', a.next_task ? `${a.next_task.id} · ${a.next_task.title}` : '—'],
        ['Último resultado', a.last_result ? el('span', {}, `${RUN_ST[a.last_result.status]} · ${fmt(a.last_result.at)} · ${a.last_result.summary || a.last_result.error || ''} `, a.last_result.evidence ? link(a.last_result.evidence) : null) : 'Sin ejecuciones registradas'],
        a.job ? ['Proceso', `Tarea programada «${a.job.name}» cada ${a.job.interval_minutes} min · próxima ${fmt(a.job.next_run_at)}${a.job.enabled ? '' : ' · desactivada'}`] : ['Proceso', { on_demand: 'A pedido (sesiones de trabajo registradas)', none: 'Sin proceso', 'workflow:ci.yml': 'GitHub Actions «Pruebas»', 'workflow:bank.yml': 'GitHub Actions «Banco de crípticos»' }[a.runtime] || a.runtime],
      ])], true),
      sec('Acciones', [
        el('div', { class: 'actions' },
          el('button', { class: 'hq-btn small', type: 'button', onclick: run(() => api('/api/admin/hq/agents/' + id + '/report', { method: 'POST', body: {} }), (r) => 'Informe: ' + r.lines.join(' ')), text: 'Solicitar informe' }),
          a.recent_errors.length ? el('button', { class: 'hq-btn small', type: 'button', onclick: run(() => api('/api/admin/hq/agents/' + id + '/retry', { method: 'POST', body: {} }), (r) => r.mode === 'job' ? 'Se volvió a ejecutar la tarea programada.' : `Se creó la tarea de reintento ${r.task}.`), text: 'Reintentar la última fallida' }) : null,
          a.evaluation.week.pattern ? el('button', { class: 'hq-btn small', type: 'button', onclick: run(() => api('/api/admin/hq/agents/' + id + '/corrections', { method: 'POST', body: {} }), 'Corrección propuesta: espera aprobación.'), text: 'Proponer corrección' }) : null,
          a.pause ? el('button', { class: 'hq-btn small', type: 'button', onclick: run(() => api('/api/admin/hq/agents/' + id + '/resume', { method: 'POST', body: {} }), 'Asignaciones reanudadas.'), text: 'Reanudar asignaciones' }) : null,
          a.code_paths.map((p) => el('a', { class: 'hq-btn small ghost', href: `${REPO}/${p.endsWith('/') ? 'tree' : 'blob'}/main/${p}`, target: '_blank', rel: 'noopener', text: 'Código: ' + p }))),
        a.pause ? null : el('div', { class: 'form' }, el('label', {}, 'Pausar nuevas asignaciones', pauseReason), el('button', { class: 'hq-btn small danger', type: 'button', onclick: doPause, text: 'Pausar' }),
          el('p', { class: 'meta', text: 'La pausa no corta una ejecución en curso: si hay una, se pide confirmación y termina sola.' })),
        el('h3', { text: 'Asignar una tarea nueva' }), assign]),
      sec(`Tareas asignadas (${a.tasks.filter((t) => !['done', 'cancelled'].includes(t.status)).length} abiertas)`, [listOr(a.tasks, taskRow, 'Sin tareas asignadas.')]),
      sec(`Aprobaciones pendientes (${a.approvals.filter((x) => ['pending', 'conflict'].includes(x.status)).length})`, [listOr(a.approvals.filter((x) => ['pending', 'conflict'].includes(x.status)), (x) => [el('b', { text: x.title }), el('span', { class: 'meta', text: `v${x.version} · ${fmt(x.created_at)}` }), voteBox(x)], 'Nada para aprobar.')]),
      sec('Desempeño', [tabs, evalBox]),
      a.evaluation.week.pattern ? el('div', { class: 'notice ' + (a.evaluation.week.pattern.penalizes ? 'bad' : 'warn') },
        el('b', { text: 'Patrón detectado: ' + a.evaluation.week.pattern.pattern }), el('br'), `Causa probable: ${a.evaluation.week.pattern.cause_label}${a.evaluation.week.pattern.penalizes ? '' : ' (no penaliza al agente)'}. `, a.evaluation.week.pattern.proposal) : null,
      sec(`Errores recientes (${a.recent_errors.length})`, [listOr(a.recent_errors, (r) => [el('b', { text: `Ejecución ${r.run}` }), ' ', r.error || 'sin detalle', el('span', { class: 'meta', text: fmt(r.at) })], 'Sin errores.')]),
      sec('Registro de ejecuciones', [listOr(a.runs, (r) => [el('b', { text: `#${r.id} · ${RUN_ST[r.status]}` }), ' ', r.summary || '', el('span', { class: 'meta', text: `${fmt(r.started_at)} → ${r.finished_at ? fmt(r.finished_at) : 'en curso'}${r.stage ? ' · etapa ' + (STAGE[r.stage] || r.stage) : ''}${r.source ? ' · origen ' + r.source : ''}${r.cost_amount != null ? ' · ' + r.cost_amount + ' ' + (r.cost_currency || '') : ''}` }),
        r.evidence ? el('span', { class: 'meta' }, 'Evidencia: ', link(r.evidence)) : null, r.error ? el('span', { class: 'meta', text: 'Error: ' + r.error }) : null], 'Sin ejecuciones registradas: no hay prueba de actividad.')]),
      sec('Historial de actividad', [listOr(a.events, (e) => [el('b', { text: EV_LABEL[e.kind] || e.kind }), ' ', e.message, e.progress != null ? el('span', { class: 'meta', text: `Progreso medido: ${Math.round(e.progress * 100)} % (${e.progress_basis})` }) : null,
        el('span', { class: 'meta', text: `${fmt(e.created_at)} · ${e.source}${e.actor_username ? ' · ' + e.actor_username : ''}` })], 'Sin eventos.')]),
      sec('Archivos y resultados generados', [listOr(a.files, (f) => link(f), 'Sin archivos registrados.')]),
      sec('Ficha', [kv([['Función', a.mission], ['Supervisión', a.supervisor], ['Autonomía máxima', 'Nivel ' + a.autonomy_max]]),
        el('h3', { text: 'Objetivos e indicadores' }), el('ul', { class: 'plain' }, a.objectives.map((x) => el('li', { text: x }))),
        el('h3', { text: 'Responsabilidades' }), el('ul', { class: 'plain' }, a.responsibilities.map((x) => el('li', { text: x }))),
        el('h3', { text: 'Herramientas autorizadas' }), el('ul', { class: 'plain' }, a.tools.map((x) => el('li', { text: x }))),
        el('h3', { text: 'Límites' }), el('ul', { class: 'plain' }, a.limits.map((x) => el('li', { text: x })))]),
      sec('Dependencias', [listOr(a.dependencies.agents, (d) => [el('a', { href: '#', onclick: (e) => { e.preventDefault(); openAgent(d.id); }, text: d.name }), ' ', el('span', { class: 'chip st-' + d.state, text: d.state_label })], 'No depende de otros agentes.'),
        listOr(a.dependencies.integrations, (i) => `${i.name}: ${i.status}`, 'Sin integraciones declaradas.'), listOr(a.dependencies.tasks, (t) => `${t.id}: ${t.title} (${TASK_ST[t.status] || t.status})`, 'Sus tareas no dependen de otras.')]),
      a.corrections.length ? sec('Correcciones', [listOr(a.corrections, (c) => [el('b', { text: c.pattern }), ' ', el('span', { class: 'chip st-review', text: c.status }), el('span', { class: 'meta', text: c.proposal }),
        c.result ? el('span', { class: 'meta', text: `Después: ${c.result.success_rate_after} % en ${c.result.runs_after} ejecuciones (antes ${c.result.baseline ?? '—'} %)` }) : null,
        c.status === 'approved' ? el('button', { class: 'hq-btn small', type: 'button', onclick: run(() => api('/api/admin/hq/corrections/' + c.id + '/applied', { method: 'POST', body: {} }), 'Marcada como aplicada: se medirá con las próximas ejecuciones.'), text: 'Marcar como aplicada' }) : null])]) : null,
    ];
    body.replaceChildren(...nodes.filter(Boolean));
  }

  // ── Informes ──
  async function openReports() {
    openDrawer('reports', null, loading('Informes ejecutivos'));
    const d = await api('/api/admin/hq/reports');
    const n = d.next || {};
    body.replaceChildren(el('h2', { text: 'Informes ejecutivos' }),
      el('p', { class: 'sub', text: 'El mismo informe para Juan Ignacio Elías e Inés de Gregorio, cada 48 horas.' }),
      kv([['Próximo', n.local ? `${n.local} (${n.timezone})` : '—'], ['Automatización', el('span', { class: 'chip ' + (n.status === 'verified' ? 'st-working' : 'st-blocked'), text: n.status_label || '—' })],
        ['Último correcto', n.last_success ? fmt(n.last_success) : 'todavía ninguno'], ['Fallos seguidos', String(n.consecutive_failures || 0)],
        ['Planificadores', el('ul', { class: 'plain' }, (n.schedulers || []).map((x) => el('li', { text: x })))]]),
      el('div', { class: 'actions' }, el('button', { class: 'hq-btn primary', type: 'button', onclick: run(async () => { const r = await api('/api/admin/hq/reports', { method: 'POST', body: {} }); openReport(r.id); }, 'Informe generado.'), text: 'Generar un informe ahora' })),
      el('h3', { text: 'Historial' }),
      listOr(d.items, (r) => [el('a', { href: '#', onclick: (e) => { e.preventDefault(); openReport(r.id); }, text: `${fmt(r.period_start)} → ${fmt(r.period_end)}` }), ' ',
        el('span', { class: 'chip ' + (r.status === 'ready' ? 'st-working' : r.status === 'failed' ? 'st-error' : 'st-analyzing'), text: { ready: 'Listo', failed: 'Falló', generating: 'Generando' }[r.status] }), r.read_at ? null : (r.status === 'ready' ? el('span', { class: 'badge', text: 'nuevo' }) : null),
        el('span', { class: 'meta', text: `${r.trigger === 'scheduled' ? 'Programado' : 'Manual'} · intentos ${r.attempts}${r.error ? ' · ' + r.error : ''}` })], 'Todavía no hay informes.'));
  }
  async function openReport(id) {
    openDrawer('report', id, loading('Informe ejecutivo'));
    const r = await api('/api/admin/hq/reports/' + id);
    const c = r.content || {};
    const na = (x) => (x && x.available === false ? el('p', { class: 'na', text: x.note }) : null);
    const list = (arr, empty) => listOr(arr, (x) => (typeof x === 'string' ? x : JSON.stringify(x)), empty || 'Sin registros en el período.');
    const section = (k, kids) => el('section', {}, el('h4', { text: `${k}. ${(c[k] || {}).title || ''}` }), ...kids);
    const cmp = c.comparison || {};
    const cmpRow = (label, d) => (d ? `${label}: ${d.current} (antes ${d.previous}, ${d.change >= 0 ? '+' : ''}${d.change})` : null);
    body.replaceChildren(el('div', { class: 'report' },
      el('h2', { text: 'Informe ejecutivo' }),
      el('p', { class: 'sub', text: `Período ${fmt(r.period_start)} → ${fmt(r.period_end)} (${r.timezone}) · ${r.trigger === 'scheduled' ? 'programado' : 'manual'} · generado ${fmt(r.generated_at)}` }),
      r.status !== 'ready' ? el('p', { class: 'notice bad', text: `Estado: ${r.status}. ${r.error || ''}` }) : null,
      c.status ? el('p', {}, 'Estado general: ', el('span', { class: 'chip ' + ({ critical: 'st-error', attention: 'st-blocked', normal: 'st-working' }[c.status]), text: c.status_label })) : null,
      el('div', { class: 'actions' }, el('button', { class: 'hq-btn small', type: 'button', onclick: () => window.print(), text: 'Descargar PDF' }),
        el('a', { class: 'hq-btn small', href: '/api/admin/hq/reports/' + id + '/markdown', text: 'Descargar .md' }), el('button', { class: 'hq-btn small', type: 'button', onclick: openReports, text: '← Historial' })),
      c.A ? section('A', [el('b', { text: 'Avances' }), list(c.A.advances), el('b', { text: 'Problemas críticos' }), list(c.A.critical_problems, 'Ninguno.'), el('b', { text: 'Decisiones necesarias' }), list(c.A.decisions, 'Ninguna.')]) : null,
      c.B ? section('B', [kv([['Tareas completadas', c.B.tasks.completed], ['En curso', c.B.tasks.in_progress], ['Ejecuciones fallidas', c.B.tasks.failed_runs], ['Bloqueadas', c.B.tasks.blocked]]),
        el('b', { text: 'Agentes que ejecutaron tareas' }), listOr(c.B.agents_with_runs, (x) => `${x.name}: ${x.n} (${x.ok || 0} ok, ${x.err || 0} error)`, 'Ningún agente registró ejecuciones.'),
        el('b', { text: 'Último resultado verificado por equipo' }), listOr(c.B.last_result_by_team, (x) => [`${x.department}: ${x.status} · ${fmt(x.at)} · ${x.summary || ''} `, x.evidence ? link(x.evidence) : null]),
        el('p', { class: 'meta', text: `Inactivos: ${c.B.inactive.length} · Sin registros en el período: ${c.B.no_records.length}` })]) : null,
      c.C ? section('C', [el('b', { text: 'Código registrado' }), listOr(c.C.commits, (x) => [`${x.agent_id}: ${x.summary || ''} `, link(x.evidence)], 'Sin commits registrados en el período.'),
        el('b', { text: 'Pruebas' }), listOr(c.C.tests, (x) => [`${x.status}: ${x.summary || ''} `, link(x.evidence)], 'Sin corridas registradas.'),
        el('b', { text: 'Errores por origen' }), listOr(c.C.errors_by_scope, (x) => `${x.scope}: ${x.n}`, 'Sin errores.'), el('b', { text: 'Corregidos (alertas resueltas)' }), list(c.C.fixed, 'Ninguno.'),
        el('b', { text: 'Pendiente' }), list(c.C.pending, 'Nada.'), el('b', { text: 'Riesgos de seguridad' }), list(c.C.security_risks, 'Ninguno abierto.')]) : null,
      c.D ? section('D', [el('b', { text: 'Documentos creados o modificados' }), listOr(c.D.documents_changed, (x) => `${x.doc_id} v${x.version} (${x.status})`, 'Ninguno.'), na(c.D.regulatory_changes),
        el('b', { text: 'Revisión profesional' }), list(c.D.professional_review, 'Nada.'), el('b', { text: 'Riesgos abiertos' }), list(c.D.open_risks, 'Ninguno.')]) : null,
      c.E ? section('E', [kv([['Creadas', c.E.created], ['Aprobadas en el período', c.E.approved_in_period], ['Publicadas y verificadas', c.E.published_verified], ['Pendientes de aprobación', c.E.pending_approval], ['Programadas', c.E.scheduled]]),
        na(c.E.performance), el('b', { text: 'Campañas' }), listOr(c.E.campaigns, (x) => `${x.campaign}: ${x.n} piezas, ${x.live || 0} programadas o publicadas`)]) : null,
      c.F ? section('F', [na(c.F.inbox), na(c.F.prepared_replies), kv([['Casos resueltos', c.F.resolved ?? '—'], ['Reportes abiertos', c.F.reports_open], ['Propuestas pendientes', c.F.submissions_pending], ['Errores de publicación', c.F.publish_errors]]),
        el('b', { text: 'Problemas recurrentes' }), listOr(c.F.recurring, (x) => `${x.reason}: ${x.n}`, 'Sin reportes en el período.')]) : null,
      c.G ? section('G', [kv([['Banco', `${c.G.bank.published} de ${c.G.bank.target}`], ['Creados', c.G.created], ['Publicados en el período', c.G.published_in_period], ['Errores reportados', c.G.reported], ['Auditorías pendientes', c.G.audits_pending],
        ['Partidas', c.G.usage.games], ['Resueltas', c.G.usage.solved], ['Jugadores', c.G.usage.players]]), el('b', { text: 'Mejoras de experiencia' }), list(c.G.ux_improvements, 'Ninguna completada.')]) : null,
      c.H ? section('H', [el('p', { class: 'na', text: c.H.note }), list(c.H.pending, 'Nada.')]) : null,
      c.I ? section('I', [listOr(c.I.costs, (x) => `${x.vendor} · ${x.area} · ${x.kind}: ${x.total} ${x.currency}`, 'Sin costos cargados en el período.'), na(c.I.ai_usage),
        kv([['Costo real del mes', c.I.month_actual_usd + ' USD'], ['Presupuesto', c.I.monthly_budget_usd ? c.I.monthly_budget_usd + ' USD' : 'sin configurar'], ['Restante', c.I.budget_left_usd ?? '—'], ['Riesgo de sobrecosto', c.I.overrun_risk == null ? '—' : c.I.overrun_risk ? 'sí' : 'no']])]) : null,
      c.J ? section('J', [listOr(c.J.priorities, (p) => [el('b', { text: `${p.task} · ${p.title}` }), el('span', { class: 'meta', text: `Responsable: ${p.owner} · Esperado: ${p.expected || '—'} · Depende de: ${p.depends_on.join(', ') || 'nada'} · Fecha: ${p.due_at ? fmt(p.due_at) : 'sin fecha'}` })]),
        el('b', { text: 'Decisiones de los CEO' }), list(c.J.decisions, 'Ninguna.')]) : null,
      c.comparison ? el('section', {}, el('h4', { text: 'Comparación con el período anterior' }), el('ul', { class: 'plain' }, [cmpRow('Ejecuciones correctas', cmp.runs_ok), cmpRow('Ejecuciones con error', cmp.runs_error), cmpRow('Tareas completadas', cmp.tasks_done),
        cmpRow('Errores técnicos', cmp.errors), cmpRow('Eventos', cmp.events), cmpRow('Costos (USD)', cmp.costs_usd), cmpRow('Partidas', cmp.games)].filter(Boolean).map((x) => el('li', { text: x }))),
        el('b', { text: 'Sin progreso' }), list(cmp.stalled, 'Ninguna.'), el('b', { text: 'Errores recurrentes' }), listOr(cmp.recurring_errors, (x) => `${x.scope}: ${x.message} (${x.n})`, 'Ninguno.'),
        el('b', { text: 'Cuellos de botella (bloqueos por causa)' }), listOr(Object.entries(cmp.bottlenecks || {}), ([k, v]) => `${k}: ${v.join(', ')}`, 'Ninguno.'), el('b', { text: 'Objetivos retrasados' }), list(cmp.delayed, 'Ninguno.')) : null,
      c.review ? el('section', {}, el('h4', { text: 'Revisión ejecutiva' }), el('p', { class: 'notice warn', text: c.review.label }),
        el('b', { text: '¿Qué funciona?' }), list(c.review.working), el('b', { text: '¿Qué no?' }), list(c.review.not_working, 'Nada registrado.'), el('b', { text: 'Agentes bloqueados' }), list(c.review.blocked_agents, 'Ninguno.'),
        el('b', { text: 'Lleva demasiado tiempo' }), list(c.review.too_long, 'Nada.'), el('b', { text: 'Necesitan recursos' }), list(c.review.needs_resources, 'Ninguno.'),
        el('b', { text: 'Mayor impacto' }), list(c.review.highest_impact), el('b', { text: 'Riesgos' }), list(c.review.risks, 'Ninguno.'), el('b', { text: 'Decisiones para Juan Ignacio o Inés' }), list(c.review.ceo_decisions, 'Ninguna.'),
        el('b', { text: 'Prioridad del próximo ciclo' }), list(c.review.next_cycle)) : null,
      c.limitations ? el('section', {}, el('h4', { text: 'Limitaciones de visibilidad' }), list(c.limitations)) : null,
      el('section', {}, el('h4', { text: 'Evidencia: fuentes consultadas' }), listOr(r.sources, (s) => `${s.source}: ${s.rows} filas`)),
      el('section', {}, el('h4', { text: 'Entrega' }), r.delivery ? kv(Object.entries(r.delivery).map(([k, v]) => [{ panel: 'Panel', notification: 'Notificación interna', email: 'Correo', pdf: 'PDF' }[k] || k, `${v.status}${v.recipients ? ' · ' + v.recipients.join(', ') : ''}${v.note ? ' · ' + v.note : ''}`])) : el('p', { class: 'na', text: 'Sin entrega registrada.' }),
        listOr(r.readers, (x) => `${x.username}: ${x.read_at ? 'leído ' + fmt(x.read_at) : 'sin leer'}`, 'Sin destinatarios.'))));
    refresh();
  }

  // ── Actividad en tiempo real ──
  const feed = $('#feed'); const feedList = $('#feed-list');
  function evItem(e, fresh) {
    return el('li', { class: 'ev-' + e.kind + (fresh ? ' new' : '') }, el('b', { text: `${EV_LABEL[e.kind] || e.kind} · ` }),
      el('a', { href: '#', onclick: (x) => { x.preventDefault(); openAgent(e.agent_id); }, text: e.agent_name }), el('div', { text: e.message }),
      e.progress != null ? el('div', { class: 'meta', text: `Progreso medido: ${Math.round(e.progress * 100)} % (${e.progress_basis})` }) : null,
      el('time', { datetime: e.created_at, text: `${fmt(e.created_at)} · ${e.source}` }));
  }
  function toggleFeed(force) {
    const open = force === undefined ? feed.hidden : force;
    feed.hidden = !open; $('#b-feed').setAttribute('aria-pressed', open ? 'true' : 'false');
  }
  $('#b-feed').addEventListener('click', () => toggleFeed());
  $('#feed-close').addEventListener('click', () => toggleFeed(false));
  $('#feed-more').addEventListener('click', async () => {
    if (!st.firstEv) return;
    const d = await api('/api/admin/hq/events?before=' + st.firstEv + '&limit=60');
    for (const e of d.items) feedList.append(evItem(e));
    if (d.items.length) st.firstEv = d.items[d.items.length - 1].id; else $('#feed-more').disabled = true;
  });
  async function pollEvents(initial) {
    const d = await api('/api/admin/hq/events?' + (initial ? 'limit=60' : 'since=' + st.lastEv));
    if (!d.items.length) { if (initial) feedList.replaceChildren(el('li', { text: 'Todavía no hay eventos registrados.' })); return; }
    if (initial) { feedList.replaceChildren(...d.items.map((e) => evItem(e))); st.firstEv = d.items[d.items.length - 1].id; }
    else {
      if (feedList.firstElementChild && !feedList.firstElementChild.className) feedList.replaceChildren();
      for (const e of d.items.slice().reverse()) {
        feedList.prepend(evItem(e, true));
        if (['error', 'blocked', 'approval_request'].includes(e.kind)) toast(e);
      }
    }
    st.lastEv = Math.max(st.lastEv, ...d.items.map((e) => e.id));
  }
  function toast(e) {
    const t = el('div', { class: 'toast ev-' + e.kind, role: 'alert', tabindex: '0', onclick: () => { t.remove(); openAgent(e.agent_id); } }, el('b', { text: `${EV_LABEL[e.kind]}: ${e.agent_name}` }), el('div', { text: e.message }));
    $('#toasts').append(t); setTimeout(() => t.remove(), 9000);
  }

  // ── Actualización periódica ──
  async function refresh() {
    try {
      const s = await api('/api/admin/hq/state');
      const first = !st.snap;
      const zonesChanged = !st.snap || JSON.stringify(st.snap.zones.map((z) => z.agents)) !== JSON.stringify(s.zones.map((z) => z.agents));
      st.snap = s; st.updatedAt = Date.now();
      if (first || zonesChanged) { const keep = { ...cam }; buildMap(); if (first) fitAll(); else { Object.assign(cam, keep); applyCam(); } }
      else { updateScreens(); updateAgents(); }
      renderFloors(); renderFilters(); renderStrip(); if (first) renderLegend();
      if (st.view === 'list') renderList();
      const u = $('#unread'); u.hidden = !s.unread_reports; u.textContent = s.unread_reports || '';
      setLive(true);
      if (first) {
        if (window.innerWidth > 900) openHome(null, true);
        const deep = location.hash.match(/^#agent\/(.+)$/); if (deep) openAgent(decodeURIComponent(deep[1]));
      }
    } catch (e) { setLive(false, e.message); }
  }
  function updateScreens() {
    // Las pantallas de las salas muestran el último estado: se redibujan con el mapa completo cada minuto.
    if (!st.lastFull || Date.now() - st.lastFull > 60000) { const keep = { ...cam }; buildMap(); Object.assign(cam, keep); applyCam(); st.lastFull = Date.now(); }
  }
  function setLive(ok, msg) {
    const l = $('#live');
    l.className = 'live ' + (ok ? 'ok' : 'bad');
    l.textContent = ok ? 'En vivo · ' + new Date(st.updatedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : `Sin conexión${st.updatedAt ? ' · datos de ' + new Date(st.updatedAt).toLocaleTimeString('es-AR') : ''}${msg ? ' (' + msg + ')' : ''}`;
  }
  setInterval(() => { if (!document.hidden) refresh(); }, POLL_STATE);
  setInterval(() => { if (!document.hidden && st.snap) pollEvents(false).catch(() => setLive(false)); }, POLL_EVENTS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); pollEvents(false).catch(() => {}); } });

  // ── Atajos ──
  $('#b-home').addEventListener('click', openHome);
  $('#b-reports').addEventListener('click', openReports);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === '/') { e.preventDefault(); qi.focus(); }
    else if (e.key === 'Escape') { if (!drawer.hidden) closeDrawer(); else if (!feed.hidden) toggleFeed(false); }
    else if (e.key === 'h' || e.key === 'H') openHome();
    else if (e.key === '0') selectFloor('all');
    else if (/^[1-7]$/.test(e.key) && st.snap && st.snap.floors[Number(e.key) - 1]) selectFloor(st.snap.floors[Number(e.key) - 1].id);
  });
  window.addEventListener('resize', () => { if (st.floor === 'all') fitAll(); });

  (async () => {
    try { const me = await api('/api/auth/me'); csrf = me.csrf; } catch (e) { /* la página ya exige sesión */ }
    await refresh();
    await pollEvents(true).catch(() => {});
  })();
})();
