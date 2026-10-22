/* Panel de administración. Toda comprobación de permisos ocurre también en el servidor. */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  };
  const main = $('#admin-main');
  let csrf = null; let me = null; let perms = [];

  async function api(path, opts) {
    const o = Object.assign({ method: 'GET', credentials: 'same-origin', headers: {} }, opts || {});
    if (o.body !== undefined) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.body); }
    if (csrf) o.headers['x-csrf-token'] = csrf;
    const res = await fetch(path, o);
    let data = null; try { data = await res.json(); } catch (e) { /* vacío */ }
    if (!res.ok) { const err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status)); err.status = res.status; err.data = data; throw err; }
    return data;
  }
  const can = (p) => perms.includes(p);
  const fmt = (d) => (d ? new Date(d).toLocaleString('es') : '—');
  const pill = (v) => el('span', { class: 'pill ' + v, text: LABELS[v] || v });
  const LABELS = {
    published: 'Publicado', draft: 'Borrador', review: 'En revisión', disabled: 'Desactivado', verified: 'Verificado', asserted: 'Con afirmaciones',
    failed: 'Con errores', unchecked: 'Sin validar', pending: 'Pendiente de aprobación', in_review: 'En revisión', needs_changes: 'Necesita correcciones',
    approved: 'Aprobado', rejected: 'Rechazado', auto_published: 'Publicado automáticamente', discarded: 'Descartado', duplicate: 'Duplicado', error: 'Error',
    active: 'Activa', paused: 'Pausada', pending_review: 'Pendiente de revisión', success: 'Correcta', partial: 'Parcial', running: 'En curso',
    original: 'Original', generated: 'Generado', external: 'Externo', community: 'Comunidad',
    licensed: 'Con licencia', public_domain: 'Dominio público', permission: 'Con permiso', reference_only: 'Solo referencia', unverified: 'Sin verificar',
  };
  function flash(msg, ok) { const f = el('div', { class: 'flash ' + (ok ? 'ok' : 'bad'), role: 'status', text: msg }); main.prepend(f); setTimeout(() => f.remove(), 6000); }
  const checksList = (checks) => el('ul', { class: 'checks' }, (checks || []).map((c) => el('li', { class: c.level, text: c.msg || c.code })));
  const table = (head, rows) => el('div', { class: 'tbl-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, head.map((h) => el('th', { text: h })))), el('tbody', {}, rows)));
  const btn = (text, onclick, cls) => el('button', { class: 'btn ' + (cls || ''), type: 'button', onclick, text });
  // El aviso se muestra después de volver a dibujar la vista (si no, el redibujo lo borra).
  // `fn` puede devolver { flash, ok } para avisar con un texto propio.
  const act = (fn, okMsg) => async (e) => {
    const b = e && e.currentTarget && e.currentTarget.tagName === 'BUTTON' ? e.currentTarget : null;
    if (b) { if (b.disabled) return; b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Procesando…'; }
    try {
      const res = await fn(b); await route();
      if (res && res.flash) flash(res.flash, res.ok !== false); else if (okMsg) flash(okMsg, true);
    } catch (err) { flash(err.message, false); if (b) { b.disabled = false; b.textContent = b.dataset.label; } }
  };

  // ── Acceso ──
  function loginView(msg) {
    $('#admin-nav').hidden = true; $('#nav-toggle').hidden = true; $('#logout').hidden = true;
    const u = el('input', { id: 'a-user', autocomplete: 'username', required: true });
    const p = el('input', { id: 'a-pass', type: 'password', autocomplete: 'current-password', required: true });
    const err = el('p', { class: 'field-error', role: 'alert', text: msg || '' });
    // El código de verificación en dos pasos aparece solo si la cuenta lo tiene activo.
    const c = el('input', { id: 'a-code', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '123456 o código de recuperación' });
    const cl = el('label', { hidden: true }, 'Código de verificación', c);
    const f = el('form', { class: 'form login-box', id: 'admin-login' }, el('h1', { text: 'Panel privado' }), el('label', {}, 'Usuario', u), el('label', {}, 'Contraseña', p), cl, err,
      el('button', { class: 'btn primary', type: 'submit', text: 'Entrar' }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { username: u.value, password: p.value, admin: true }; if (!cl.hidden) body.code = c.value.trim();
      try { const r = await api('/api/auth/login', { method: 'POST', body }); csrf = r.csrf; await boot(); } catch (x) {
        if (x.data && x.data.error === 'mfa_required') { cl.hidden = false; err.textContent = 'Escribí el código de tu aplicación de autenticación.'; c.focus(); return; }
        err.textContent = x.message;
      }
    });
    main.replaceChildren(f); u.focus();
  }

  async function boot() {
    const s = await api('/api/auth/me'); csrf = s.csrf;
    // Enlaces de invitación y de recuperación: se usan sin haber entrado.
    if (/^#(invite|reset)\?/.test(location.hash)) return publicTokenView(location.hash.startsWith('#invite') ? 'invite' : 'reset');
    if (!s.user || s.user.role === 'player') return loginView();
    const m = await api('/api/admin/me'); me = m.user; me.role_label = m.role_label; perms = m.permissions;
    try { meta = await api('/api/admin/panel/meta'); } catch (e) { meta = null; }
    $('#who').textContent = me.username + ' · ' + (m.role_label || me.role);
    $('#logout').hidden = false;
    $('#admin-nav').hidden = false; $('#nav-toggle').hidden = false;
    document.querySelectorAll('#admin-nav a').forEach((a) => { a.hidden = !can(a.dataset.perm); });
    // Un grupo sin enlaces visibles no se muestra.
    document.querySelectorAll('#admin-nav .nav-group').forEach((g) => {
      let n = g.nextElementSibling; let any = false;
      while (n && !n.classList.contains('nav-group')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
      g.hidden = !any;
    });
    route();
  }
  $('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); csrf = null; loginView(); });

  // ── Vistas ──
  const V = {};

  // ── Utilidades del centro de control ──
  const NA = 'Sin información';
  const isNum = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
  const nf = (v, d) => (isNum(v) ? Number(v).toLocaleString('es', { maximumFractionDigits: d === undefined ? 1 : d }) : NA);
  const pct = (v) => (isNum(v) ? nf(v) + ' %' : NA);
  const dur = (v) => {
    if (!isNum(v)) return NA;
    const s = Math.round(Number(v) / 1000);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s';
    return Math.floor(s / 3600) + ' h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ' min';
  };
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(['es'], { type: 'region' }); } catch (e) { /* navegador antiguo */ }
  const country = (c) => (!c ? NA : (regionNames ? (regionNames.of(c) || c) + ' (' + c + ')' : c));
  const LANGS = { es: 'Español', en: 'Inglés', fr: 'Francés', pt: 'Portugués', it: 'Italiano', de: 'Alemán' };
  const lang = (c) => (!c ? NA : (LANGS[c] || c) + ' (' + c + ')');
  const variantName = (v) => (!v ? NA : v);
  const GS = { started: 'Iniciada', in_progress: 'En curso', solved: 'Resuelta', revealed: 'Completada tras revelar', abandoned: 'Abandonada',
    expired: 'Expirada', error: 'Interrumpida por error' };
  const END = { inactivity: 'por inactividad', skipped: 'pasó a otra', server_error: 'error del servidor', timeout: 'se agotó el tiempo', restart: 'reinició' };
  const gpill = (s, reason) => el('span', { class: 'pill g-' + s, text: (GS[s] || s) + (reason && END[reason] ? ' · ' + END[reason] : '') });
  const EV = { start: 'Inicio', resume: 'Reanudación', guess_wrong: 'Respuesta incorrecta', guess_repeat: 'Respuesta repetida (no cuenta)', guess_correct: 'Respuesta correcta',
    hint: 'Pista pedida', reveal: 'Reveló la respuesta', skip: 'Pasó a otra', timeout: 'Tiempo agotado', abandon: 'Marcada como abandonada', error: 'Error técnico', restart: 'Reinicio' };
  const MODES = { quick: 'Rápida', infinite: 'Infinita', daily: 'Diaria', archive: 'Archivo', beginner: 'Principiante', intermediate: 'Intermedio', expert: 'Experto',
    guided: 'Guiada', timed: 'Contrarreloj', themed: 'Temática', practice: 'Práctica', streak: 'Racha', shared: 'Compartida' };
  const PERIOD_LABELS = { today: 'Hoy', '24h': 'Últimas 24 h', '7d': 'Últimos 7 días', '30d': 'Últimos 30 días', '90d': 'Últimos 90 días',
    this_month: 'Este mes', last_month: 'Mes anterior', custom: 'Personalizado' };
  let meta = null;
  const def = (k) => (meta && meta.definitions && meta.definitions[k]) || '';

  const hashName = () => location.hash.replace(/^#/, '').split('?')[0];
  const qs = () => new URLSearchParams(location.hash.split('?')[1] || '');
  const go = (params) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined) p.set(k, v);
    location.hash = hashName() + (String(p) ? '?' + p : '');
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('adm.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('adm.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
  };
  const section = (title, ...kids) => el('section', { class: 'panel' }, el('h3', { text: title }), kids);
  const empty = (t) => el('p', { class: 'empty', text: t || 'Todavía no hay datos para este filtro.' });
  const infoTip = (text) => (text ? el('details', { class: 'def' }, el('summary', { 'aria-label': 'Definición', text: '?' }), el('p', { text })) : '');

  // Barra de período y filtros (país, idioma, variante). Se refleja en la URL.
  function filterBar(q, opts) {
    const o = Object.assign({ period: true, geo: true }, opts || {});
    const per = el('select', { name: 'period', 'aria-label': 'Período' }, (meta ? meta.periods : Object.keys(PERIOD_LABELS)).map((p) =>
      el('option', { value: p, selected: (q.get('period') || '30d') === p, text: PERIOD_LABELS[p] || p })));
    const from = el('input', { type: 'date', name: 'from', 'aria-label': 'Desde', value: q.get('from') || '' });
    const to = el('input', { type: 'date', name: 'to', 'aria-label': 'Hasta', value: q.get('to') || '' });
    const custom = el('span', { class: 'custom-range' }, from, el('span', { class: 'muted', text: '→' }), to);
    custom.hidden = per.value !== 'custom';
    per.addEventListener('change', () => { custom.hidden = per.value !== 'custom'; });
    const ctry = el('input', { name: 'country', placeholder: 'País (AR, ES…)', maxlength: '2', size: '10', 'aria-label': 'País elegido', value: q.get('country') || '' });
    const lg = el('select', { name: 'lang', 'aria-label': 'Idioma' }, el('option', { value: '', text: 'Todos los idiomas' }),
      Object.keys(LANGS).map((l) => el('option', { value: l, selected: q.get('lang') === l, text: LANGS[l] })));
    const vr = el('input', { name: 'variant', placeholder: 'Variante (es-AR…)', size: '14', 'aria-label': 'Variante', value: q.get('variant') || '' });
    const f = el('form', { class: 'toolbar filters', role: 'search' }, o.period ? [per, custom] : '', o.geo ? [ctry, lg, vr] : '', o.extra || '',
      el('button', { class: 'btn', type: 'submit', text: 'Aplicar' }));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = Object.fromEntries(q);
      delete p.page;
      if (o.period) { p.period = per.value; p.from = per.value === 'custom' ? from.value : ''; p.to = per.value === 'custom' ? to.value : ''; }
      if (o.geo) { p.country = ctry.value.trim().toUpperCase(); p.lang = lg.value; p.variant = vr.value.trim(); }
      for (const n of f.querySelectorAll('[data-extra]')) p[n.name] = n.type === 'checkbox' ? (n.checked ? '1' : '') : n.value;
      go(p);
    });
    return f;
  }
  const apiQs = (q, keys) => { const p = new URLSearchParams(); for (const k of keys) if (q.get(k)) p.set(k, q.get(k)); return String(p); };
  const PERIOD_KEYS = ['period', 'from', 'to', 'country', 'lang', 'variant'];

  function pager(d) {
    const q = qs(); const page = d.page || 1; const pages = Math.max(1, Math.ceil(d.total / d.per_page));
    const set = (n) => () => { q.set('page', n); go(Object.fromEntries(q)); };
    return el('div', { class: 'toolbar pager' }, el('span', { class: 'muted small', text: nf(d.total, 0) + ' resultados · página ' + page + ' de ' + pages }),
      page > 1 ? btn('← Anterior', set(page - 1)) : '', page < pages ? btn('Siguiente →', set(page + 1)) : '');
  }

  // Tabla con selección de columnas (se recuerda por navegador).
  function dataTable(key, cols, rows, opts) {
    const o = opts || {};
    const saved = store.get('cols.' + key, null);
    const visible = cols.filter((c) => (saved ? saved.includes(c.k) : !c.hidden));
    const picker = el('details', { class: 'col-picker' }, el('summary', { text: 'Columnas' }),
      el('div', { class: 'col-list' }, cols.map((c) => {
        const cb = el('input', { type: 'checkbox', value: c.k }); cb.checked = visible.includes(c);
        cb.addEventListener('change', () => {
          const now = [...picker.querySelectorAll('input:checked')].map((x) => x.value);
          store.set('cols.' + key, now.length ? now : cols.filter((x) => !x.hidden).map((x) => x.k)); route();
        });
        return el('label', { class: 'check' }, cb, c.t);
      })));
    const sortKey = qs().get('sort');
    const head = visible.map((c) => {
      if (!c.sort || !o.sortable) return el('th', { text: c.t, class: c.num ? 'num' : null });
      const q = qs(); const active = sortKey === c.sort;
      return el('th', { class: (c.num ? 'num ' : '') + (active ? 'sorted' : '') }, el('a', { href: '#', onclick: (e) => { e.preventDefault(); q.set('sort', c.sort); q.delete('page'); go(Object.fromEntries(q)); }, text: c.t + (active ? ' ↓' : '') }));
    });
    const body = rows.map((r) => el('tr', {}, visible.map((c) => {
      const v = c.f ? c.f(r) : r[c.k];
      return el('td', { class: c.num ? 'num' : null }, v === null || v === undefined || v === '' ? el('span', { class: 'muted', text: NA }) : v);
    })));
    return el('div', {}, o.noPicker ? '' : el('div', { class: 'toolbar end' }, picker),
      rows.length ? el('div', { class: 'tbl-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, head)), el('tbody', {}, body))) : empty(o.empty));
  }

  // ── Gráficos (SVG generado en el navegador; sin estilos en línea en el HTML del servidor) ──
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, ...kids) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); for (const k of kids) if (k) n.append(k); return n; };
  const fmtT = (t, unit) => (unit === 'hour' ? t.slice(11, 13) + ' h' : unit === 'week' ? 'sem. ' + t.slice(5, 10).split('-').reverse().join('/') : t.slice(5, 10).split('-').reverse().join('/'));

  // Líneas en un solo eje; cada serie con su color, leyenda y etiqueta del último valor.
  function lineChart(points, series, opts) {
    const o = Object.assign({ unit: 'day', fmt: (v) => nf(v, 0), height: 200 }, opts || {});
    if (!points.length || points.every((p) => series.every((s) => !p[s.k]))) return empty('Sin partidas en este período.');
    const W = 720; const H = o.height; const pad = 6;
    const max = Math.max(1, ...points.flatMap((p) => series.map((s) => Number(p[s.k]) || 0)));
    const x = (i) => (points.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (points.length - 1));
    const y = (v) => H - pad - ((Number(v) || 0) / max) * (H - 2 * pad);
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'chart-svg', role: 'img', 'aria-label': o.label || 'Gráfico' });
    for (const f of [0.5, 1]) g.append(svg('line', { x1: 0, x2: W, y1: y(max * f), y2: y(max * f), class: 'grid' }));
    g.append(svg('line', { x1: 0, x2: W, y1: H - pad, y2: H - pad, class: 'axis' }));
    series.forEach((s, si) => {
      const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[s.k]).toFixed(1)).join(' ');
      g.append(svg('path', { d, class: 'line s' + (si + 1), 'vector-effect': 'non-scaling-stroke' }));
    });
    // Zonas de lectura por punto: el título muestra todos los valores.
    const colW = W / points.length;
    const cross = svg('line', { x1: 0, x2: 0, y1: 0, y2: H, class: 'cross', visibility: 'hidden' });
    g.append(cross);
    points.forEach((p, i) => {
      const r = svg('rect', { x: Math.max(0, x(i) - colW / 2), y: 0, width: colW, height: H, class: 'hit' },
        svg('title', {}, document.createTextNode(fmtT(p.t, o.unit) + ' — ' + series.map((s) => s.t + ': ' + o.fmt(p[s.k])).join(' · '))));
      r.addEventListener('mouseenter', () => { cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible'); tip.textContent = r.textContent; });
      r.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); tip.textContent = ''; });
      g.append(r);
    });
    const last = points[points.length - 1];
    const tip = el('p', { class: 'chart-tip small', 'aria-live': 'polite' });
    const legend = el('ul', { class: 'legend' }, series.map((s, si) => el('li', {}, el('span', { class: 'swatch s' + (si + 1) }), s.t + ' · último: ' + o.fmt(last[s.k]))));
    const table = el('details', { class: 'chart-table' }, el('summary', { text: 'Ver como tabla' }),
      el('div', { class: 'tbl-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: o.unit === 'hour' ? 'Hora (UTC)' : o.unit === 'week' ? 'Semana' : 'Día (UTC)' }), series.map((s) => el('th', { class: 'num', text: s.t })))),
        el('tbody', {}, points.map((p) => el('tr', {}, el('td', { text: p.t }), series.map((s) => el('td', { class: 'num', text: o.fmt(p[s.k]) }))))))));
    return el('figure', { class: 'chart' }, series.length > 1 ? legend : el('p', { class: 'small muted', text: series[0].t + ' · último: ' + o.fmt(last[series[0].k]) }),
      el('div', { class: 'chart-frame' }, el('span', { class: 'y-max small muted', text: o.fmt(max) }), g),
      el('div', { class: 'x-axis small muted' }, el('span', { text: fmtT(points[0].t, o.unit) }), points.length > 2 ? el('span', { text: fmtT(points[Math.floor(points.length / 2)].t, o.unit) }) : '', el('span', { text: fmtT(last.t, o.unit) })),
      tip, table);
  }

  // Barras horizontales (magnitud, una sola serie).
  function barList(rows, labelF, valueF, opts) {
    const o = Object.assign({ fmt: (v) => nf(v, 0) }, opts || {});
    if (!rows.length) return empty();
    const max = Math.max(1, ...rows.map((r) => Number(valueF(r)) || 0));
    return el('ul', { class: 'bars' }, rows.map((r) => {
      const v = Number(valueF(r)) || 0;
      return el('li', { title: labelF(r) + ': ' + o.fmt(v) + (o.extra ? ' · ' + o.extra(r) : '') },
        el('span', { class: 'bar-label', text: labelF(r) }),
        el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill', style: 'width:' + Math.max(1, Math.round((v / max) * 100)) + '%' })),
        el('span', { class: 'bar-value', text: o.fmt(v) + (o.extra ? ' · ' + o.extra(r) : '') }));
    }));
  }

  // Tarjeta de indicador con comparación contra el período anterior.
  function kpi(label, value, opts) {
    const o = opts || {};
    const shown = o.fmt ? o.fmt(value) : nf(value, 0);
    let delta = '';
    if (o.prev !== undefined) {
      if (o.prev === null || o.prev === undefined || !isNum(value)) delta = el('small', { class: 'delta muted', text: 'Sin período anterior comparable' });
      else if (o.points) {
        const d = Math.round((Number(value) - Number(o.prev)) * 10) / 10;
        delta = el('small', { class: 'delta', text: (d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= ') + nf(d) + ' pts vs. anterior (' + (o.fmt ? o.fmt(o.prev) : nf(o.prev)) + ')' });
      } else if (Number(o.prev) === 0) delta = el('small', { class: 'delta', text: Number(value) ? 'Antes: 0' : '= sin cambios (0)' });
      else {
        const d = ((Number(value) - Number(o.prev)) / Number(o.prev)) * 100;
        delta = el('small', { class: 'delta', text: (d > 0.05 ? '▲ +' : d < -0.05 ? '▼ ' : '= ') + nf(d) + ' % vs. anterior (' + (o.fmt ? o.fmt(o.prev) : nf(o.prev, 0)) + ')' });
      }
    }
    return el('div', { class: 'card' + (o.warn && Number(value) ? ' warn' : '') + (shown === NA ? ' na' : '') },
      el('div', { class: 'card-head' }, el('span', { text: label }), infoTip(o.def)), el('b', { class: o.txt ? 'txt' : null, text: shown }), delta, o.href ? el('a', { class: 'small', href: o.href, text: o.link || 'Ver detalle' }) : '');
  }

  // ── Resumen ──
  V.dashboard = async () => {
    if (!can('analytics.read')) return dashboardBasic();
    const q = qs();
    const d = await api('/api/admin/analytics/overview?' + apiQs(q, PERIOD_KEYS));
    const c = d.current; const p = d.previous; const cg = c.games; const pg = p ? p.games : null;
    // Sin datos en el período anterior: no se muestra comparación en cada tarjeta.
    const P = (k) => (pg ? pg[k] : undefined); const PB = (k) => (p ? p[k] : undefined);
    const failingJobs = d.jobs.filter((j) => j.consecutive_failures > 0 || j.last_status === 'failed');
    const alertsN = d.open_alerts.reduce((s, a) => s + a.n, 0);
    const crit = (d.open_alerts.find((a) => a.severity === 'critical') || {}).n || 0;
    const periodTxt = (d.period.from.slice(0, 10) + ' → ' + new Date(Date.parse(d.period.to) - 1).toISOString().slice(0, 10)) + ' (UTC)';
    main.replaceChildren(
      el('div', { class: 'adm-head' }, el('h1', { text: 'Resumen' }),
        el('p', { class: 'muted small', text: periodTxt + (p ? ' · comparado con el período anterior de igual duración' : ' · el período anterior no tiene datos para comparar') + ' · datos calculados ' + fmt(d.computed_at) }),
        el('div', { class: 'toolbar' }, btn('Recalcular ahora', act(() => api('/api/admin/analytics/refresh', { method: 'POST', body: {} }), 'Indicadores recalculados.')),
          can('export.data') ? el('a', { class: 'btn', href: '/api/admin/export/daily.csv?' + apiQs(q, PERIOD_KEYS), text: 'Exportar CSV diario' }) : '')),
      filterBar(q),
      alertsN ? el('a', { class: 'flash ' + (crit ? 'bad' : 'warn'), href: '#alerts', text: alertsN + ' alertas abiertas' + (crit ? ' (' + crit + ' críticas)' : '') + ' → revisar' }) : '',
      el('h2', { text: 'Personas' }),
      el('div', { class: 'cards' },
        kpi('Usuarios registrados', d.registered_total, { def: def('registered') }),
        kpi('Nuevos registros', c.new_users, { prev: PB('new_users'), def: def('new_users') }),
        kpi('Jugadores activos', c.active_players, { prev: PB('active_players'), def: def('active_players') }),
        kpi('Registrados que jugaron', c.active_registered, { prev: PB('active_registered'), def: def('active_registered') }),
        kpi('DAU', d.dau, { def: def('dau') }), kpi('WAU', d.wau, { def: def('wau') }), kpi('MAU', d.mau, { def: def('mau') }),
        kpi('Visitas (páginas)', c.visits.pageview, { prev: p ? p.visits.pageview : undefined, def: def('visits') }),
        kpi('Navegadores nuevos', c.visits.new_visitor, { prev: p ? p.visits.new_visitor : undefined, def: def('visits') })),
      el('h2', { text: 'Partidas' }),
      el('div', { class: 'cards' },
        kpi('Iniciadas', cg.started, { prev: P('started'), def: def('started'), href: '#games' }),
        kpi('Completadas', cg.completed, { prev: P('completed'), def: def('completed') }),
        kpi('Resueltas correctamente', cg.solved, { prev: P('solved'), def: def('solved') }),
        kpi('Tasa de resolución', cg.solve_rate, { fmt: pct, points: true, prev: P('solve_rate'), def: def('solve_rate') }),
        kpi('Tasa de abandono', cg.abandon_rate, { fmt: pct, points: true, prev: P('abandon_rate'), def: def('abandon_rate') }),
        kpi('Tiempo medio hasta resolver', cg.avg_solve_ms, { fmt: dur, prev: P('avg_solve_ms'), def: def('avg_solve') }),
        kpi('Mediana hasta resolver', c.median_solve_ms, { fmt: dur, prev: PB('median_solve_ms'), def: def('median_solve') }),
        kpi('Mediana de tiempo activo', c.median_active_solve_ms, { fmt: dur, prev: PB('median_active_solve_ms'), def: def('median_active') }),
        kpi('Pistas por partida', cg.hints_per_game, { fmt: (v) => nf(v), prev: P('hints_per_game') }),
        kpi('Reveladas', cg.revealed, { prev: P('revealed') }), kpi('Expiradas', cg.expired, { prev: P('expired') }),
        kpi('Interrumpidas por error', cg.errored, { prev: P('errored'), warn: true })),
      section('Evolución de partidas', lineChart(d.series.points, [{ k: 'started', t: 'Iniciadas' }, { k: 'solved', t: 'Resueltas' }], { unit: d.series.unit, label: 'Partidas iniciadas y resueltas' })),
      section('Jugadores distintos', lineChart(d.series.points, [{ k: 'players', t: 'Jugadores' }], { unit: d.series.unit, label: 'Jugadores distintos' })),
      el('h2', { text: 'Contenido y operación' }),
      el('div', { class: 'cards' },
        kpi('Crípticos publicados', d.catalog.published, { href: '#catstats', link: 'Ver catálogo' }),
        kpi('Importados automáticamente', d.catalog.auto_imported, { def: 'Elementos de fuentes externas publicados solos en el período.', href: '#importstats' }),
        kpi('Propuestas pendientes', d.pending_submissions, { warn: true, href: '#submissions', link: 'Moderar' }),
        kpi('Errores técnicos', c.errors, { prev: PB('errors'), warn: true, def: def('errors'), href: '#jobs' }),
        kpi('Fuentes activas', d.sources.active, { def: 'Fuentes externas aprobadas y activas.' }),
        kpi('Fuentes con fallos', d.sources.failing, { warn: true, href: '#importstats' }),
        kpi('Tareas con fallos', failingJobs.length, { warn: true, href: '#jobs' })),
      el('div', { class: 'cols' },
        section('Idiomas más jugados', barList(d.top.languages, (r) => lang(r.k), (r) => r.games, { extra: (r) => nf(r.players, 0) + ' jug.' })),
        section('Países elegidos', el('p', { class: 'small muted', text: 'País que cada persona eligió en sus preferencias. No se deduce de la conexión.' }),
          barList(d.top.countries, (r) => country(r.k), (r) => r.games, { extra: (r) => nf(r.players, 0) + ' jug.' })),
        section('Variantes elegidas', barList(d.top.variants, (r) => variantName(r.k), (r) => r.games))),
      section('Estado de importaciones y tareas', el('p', { class: 'small', text: 'Última importación correcta: ' + fmt(d.sources.last_success) }),
        table(['Tarea', 'Estado', 'Última', 'Próxima', 'Fallos'], d.jobs.map((j) => el('tr', {}, el('td', { text: j.name }), el('td', {}, j.last_status ? pill(j.last_status) : el('span', { class: 'muted', text: NA })),
          el('td', { text: fmt(j.last_run_at) }), el('td', { text: fmt(j.next_run_at) }), el('td', { text: j.consecutive_failures })))))
    );
  };

  // Resumen reducido para roles sin acceso a estadísticas (moderación, contenido básico).
  async function dashboardBasic() {
    const d = await api('/api/admin/dashboard');
    const card = (v, label, warn, href) => el('div', { class: 'card' + (warn && v ? ' warn' : '') }, el('div', { class: 'card-head' }, el('span', { text: label })), el('b', { text: String(v) }), href ? el('a', { class: 'small', href, text: 'Abrir' }) : '');
    main.replaceChildren(el('h1', { text: 'Resumen' }),
      el('p', { class: 'muted', text: 'Tu rol (' + (me.role_label || me.role) + ') no incluye las estadísticas de uso. Estas son tus tareas pendientes.' }),
      el('div', { class: 'cards' },
        can('submissions.read') ? card(d.pending_submissions, 'Propuestas pendientes', true, '#submissions') : '',
        can('reports.manage') ? card(d.reports_open, 'Errores informados', true, '#reports') : '',
        card(d.duplicates_open, 'Duplicados por revisar', true, '#duplicates'),
        can('sources.read') ? card(d.import_review, 'Importaciones en revisión', true, '#imports') : '',
        can('sources.read') ? card(d.sources_with_errors, 'Fuentes con errores', true, '#sources') : ''));
  }

  // ── Usuarios registrados ──
  const USTATUS = { active: 'Activa', suspended: 'Suspendida', deleted: 'Eliminada' };
  const ustat = (s) => el('span', { class: 'pill u-' + s, text: USTATUS[s] || s });
  V.players = async () => {
    const q = qs();
    const d = await api('/api/admin/players?' + apiQs(q, ['q', 'status', 'country', 'lang', 'variant', 'from', 'to', 'verified', 'sort', 'page', 'per']));
    const search = el('input', { type: 'search', name: 'q', 'data-extra': '1', placeholder: can('players.pii') ? 'Usuario, nombre, correo o id' : 'Usuario, nombre o id', value: q.get('q') || '' });
    const st = el('select', { name: 'status', 'data-extra': '1', 'aria-label': 'Estado' }, [['', 'Todos los estados'], ['active', 'Activas'], ['suspended', 'Suspendidas'], ['deleted', 'Eliminadas']].map(([v, t]) => el('option', { value: v, selected: q.get('status') === v, text: t })));
    const from = el('input', { type: 'date', name: 'from', 'data-extra': '1', 'aria-label': 'Registrado desde', value: q.get('from') || '' });
    const to = el('input', { type: 'date', name: 'to', 'data-extra': '1', 'aria-label': 'Registrado hasta', value: q.get('to') || '' });
    const ver = el('input', { type: 'checkbox', name: 'verified', 'data-extra': '1' }); ver.checked = q.get('verified') === '1';
    const cols = [
      { k: 'username', t: 'Usuario', sort: 'name', f: (u) => el('a', { href: '#player/' + u.id, text: u.username }) },
      { k: 'display_name', t: 'Nombre visible' },
      ...(can('players.pii') ? [{ k: 'email', t: 'Correo', f: (u) => u.email || '' }] : []),
      { k: 'email_verified', t: 'Correo verificado', f: (u) => (u.has_email ? (u.email_verified ? 'Sí' : 'No') : '') , hidden: true },
      { k: 'status', t: 'Estado', f: (u) => ustat(u.status) },
      { k: 'created_at', t: 'Registro', sort: 'created', f: (u) => fmt(u.created_at) },
      { k: 'last_login_at', t: 'Último acceso', f: (u) => (u.last_login_at ? fmt(u.last_login_at) : ''), hidden: true },
      { k: 'last_active_at', t: 'Última actividad', sort: 'active', f: (u) => (u.last_active_at ? fmt(u.last_active_at) : '') },
      { k: 'country_code', t: 'País elegido', f: (u) => (u.country_code ? country(u.country_code) : '') },
      { k: 'play_variant', t: 'Variante', f: (u) => u.play_variant || '' },
      { k: 'origin_source', t: 'Origen', f: (u) => originText(u) || '' },
      { k: 'ui_language', t: 'Idioma de interfaz', f: (u) => (u.ui_language ? lang(u.ui_language) : ''), hidden: true },
      { k: 'timezone', t: 'Zona horaria', hidden: true },
      { k: 'games', t: 'Partidas', sort: 'games', num: true },
      { k: 'solved', t: 'Resueltas', num: true },
      { k: 'abandoned', t: 'Abandonadas', num: true, hidden: true },
      { k: 'revealed', t: 'Reveladas', num: true, hidden: true },
      { k: 'solve_rate', t: '% resolución', sort: 'solve_rate', num: true, f: (u) => (isNum(u.solve_rate) ? pct(u.solve_rate) : '') },
      { k: 'avg_solve_ms', t: 'Tiempo medio', num: true, f: (u) => (isNum(u.avg_solve_ms) ? dur(u.avg_solve_ms) : '') , hidden: true },
      { k: 'hints', t: 'Pistas', num: true, hidden: true },
      { k: 'last_game_at', t: 'Última partida', sort: 'last_game', f: (u) => (u.last_game_at ? fmt(u.last_game_at) : '') },
    ];
    const exp = can('export.data') ? el('a', { class: 'btn', href: '/api/admin/export/users.csv?' + apiQs(q, ['q', 'status', 'country', 'lang', 'variant', 'from', 'to', 'verified']), text: 'Exportar CSV' }) : '';
    main.replaceChildren(
      el('div', { class: 'adm-head' }, el('h1', { text: 'Usuarios registrados' }), el('div', { class: 'toolbar' }, exp)),
      el('p', { class: 'muted small', text: 'Solo cuentas de jugador. Nunca se muestran contraseñas, tokens ni sesiones.' + (can('players.pii') ? ' Consultar una ficha con correo queda en la auditoría.' : ' Tu rol no ve correos electrónicos.') }),
      filterBar(q, { period: false, extra: [search, st, el('label', { class: 'inline small' }, 'Registro', from, to), el('label', { class: 'check small' }, ver, 'Correo verificado')] }),
      dataTable('players', cols, d.items, { sortable: true, empty: 'No hay cuentas con estos filtros.' }), pager(d));
  };

  V.player = async (id) => {
    const q = qs(); const tab = q.get('tab') || 'summary';
    const d = await api('/api/admin/players/' + id);
    const u = d.user; const s = d.stats;
    const TABS = [['summary', 'Resumen'], ['games', 'Historial de partidas'], ['performance', 'Rendimiento'], ['contributions', 'Contribuciones'], ['activity', 'Actividad reciente'], ['admin', 'Historial administrativo']];
    const tabs = el('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, t]) => el('a', { href: '#player/' + id + '?tab=' + k, class: k === tab ? 'active' : '', role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', text: t })));
    const actions = el('div', { class: 'toolbar' },
      can('players.manage') && u.status === 'active' ? btn('Suspender', async () => {
        const reason = prompt('Motivo de la suspensión (queda en la auditoría):'); if (reason === null) return;
        try { await api('/api/admin/players/' + id + '/suspend', { method: 'POST', body: { reason } }); flash('Cuenta suspendida. Se cerraron sus sesiones.', true); route(); } catch (e) { flash(e.message); }
      }) : '',
      can('players.manage') && u.status === 'suspended' ? btn('Reactivar', act(() => api('/api/admin/players/' + id + '/reactivate', { method: 'POST', body: {} }), 'Cuenta reactivada.')) : '',
      can('privacy.manage') && u.status !== 'deleted' ? btn('Eliminar datos personales', async () => {
        const c = prompt('Esto anonimiza la cuenta de forma irreversible (las partidas quedan solo como estadística). Escribí ELIMINAR para confirmar.');
        if (c === null) return;
        try { await api('/api/admin/players/' + id + '/anonymize', { method: 'POST', body: { confirm: c } }); flash('Datos personales eliminados.', true); route(); } catch (e) { flash(e.message); }
      }, 'danger') : '');
    const head = el('div', { class: 'adm-head' }, el('p', {}, el('a', { href: '#players', text: '← Usuarios' })),
      el('h1', { text: u.username }), el('p', {}, ustat(u.status), ' ', el('span', { class: 'muted small', text: 'id ' + u.id + ' · ' + d.pseudonymous_ids + ' identificadores de jugador vinculados' })), actions);
    let body;
    if (tab === 'summary') {
      const fact = (k, v) => el('div', {}, el('dt', { text: k }), el('dd', {}, v === null || v === undefined || v === '' ? el('span', { class: 'muted', text: NA }) : v));
      const pref = (rows, f) => (rows.length ? rows.map((r) => f(r.k) + ' (' + r.n + ')').join(', ') : NA);
      body = [
        el('div', { class: 'cols' },
          section('Cuenta', el('dl', { class: 'facts' },
            fact('Nombre visible', u.display_name), can('players.pii') ? fact('Correo', u.email) : fact('Correo', u.has_email ? 'Oculto para tu rol' : 'No informado'),
            fact('Correo verificado', u.has_email ? (u.email_verified ? 'Sí' : 'No') : null), fact('Registro', fmt(u.created_at)),
            fact('Último acceso', u.last_login_at && fmt(u.last_login_at)), fact('Última actividad', u.last_active_at && fmt(u.last_active_at)),
            fact('Idioma de interfaz', u.ui_language && lang(u.ui_language)), fact('País elegido', u.country_code && country(u.country_code)),
            fact('Variante de juego', u.play_variant), fact('Zona horaria', u.timezone), fact('Cómo llegó', originText(u)))),
          section('Preferencias observadas', el('dl', { class: 'facts' },
            fact('Idiomas jugados', pref(d.preferences.languages, lang)), fact('Dificultades', pref(d.preferences.difficulties, (k) => 'nivel ' + k)),
            fact('Categorías', pref(d.preferences.categories, (k) => k || NA)), fact('Modos', pref(d.preferences.modes, (k) => MODES[k] || k)),
            fact('País al jugar', pref(d.preferences.countries, (k) => (k ? k : NA)))))),
        el('div', { class: 'cards' },
          kpi('Partidas', s.games), kpi('Completadas', s.completed), kpi('Resueltas', s.solved), kpi('% resolución', s.solve_rate, { fmt: pct }),
          kpi('Abandonadas', s.abandoned), kpi('Reveladas', s.revealed), kpi('En curso', s.in_progress), kpi('Respuestas incorrectas', s.wrong),
          kpi('Pistas usadas', s.hints), kpi('Tiempo medio hasta resolver', s.avg_solve_ms, { fmt: dur }), kpi('Mediana hasta resolver', s.median_solve_ms, { fmt: dur }),
          kpi('Tiempo activo total', s.active_ms, { fmt: dur }), kpi('Racha actual', s.current_streak), kpi('Mejor racha', s.best_streak),
          kpi('Última partida', s.last_game_at, { txt: true, fmt: (v) => (v ? fmt(v) : NA) })),
      ];
    } else if (tab === 'games') {
      body = await gamesTable('/api/admin/players/' + id + '/games', q, { hideUser: true });
    } else if (tab === 'performance') {
      const p = await api('/api/admin/players/' + id + '/performance');
      const pts = p.weeks.map((w) => ({ ...w, t: w.week }));
      body = pts.length ? [
        section('Partidas por semana', lineChart(pts, [{ k: 'games', t: 'Partidas' }, { k: 'solved', t: 'Resueltas' }], { unit: 'week' })),
        section('Tasa de resolución semanal', lineChart(pts, [{ k: 'solve_rate', t: '% resolución' }], { unit: 'week', fmt: pct })),
        section('Tiempo medio hasta resolver', lineChart(pts, [{ k: 'avg_solve_ms', t: 'Tiempo medio' }], { unit: 'week', fmt: dur })),
        section('Pistas por semana', lineChart(pts, [{ k: 'hints', t: 'Pistas' }], { unit: 'week' })),
        section('Dificultad media jugada', lineChart(pts, [{ k: 'avg_difficulty', t: 'Dificultad media (1–5)' }], { unit: 'week', fmt: (v) => nf(v) })),
      ] : empty('Esta cuenta todavía no jugó.');
    } else if (tab === 'contributions') {
      const c = await api('/api/admin/players/' + id + '/contributions');
      body = c.items.length ? table(['Propuesta', 'Respuesta', 'Idioma', 'Estado', 'Enviada', 'Decisiones'], c.items.map((x) => el('tr', {},
        el('td', {}, can('submissions.read') ? el('a', { href: '#submission/' + x.id, text: x.clue_text }) : x.clue_text), el('td', { text: x.answer }),
        el('td', { text: x.language_code + (x.variant_code ? ' · ' + x.variant_code : '') }), el('td', {}, pill(x.status)), el('td', { text: fmt(x.created_at) }),
        el('td', {}, x.events.map((e) => el('div', { class: 'small', text: fmt(e.created_at) + ' · ' + (LABELS[e.to_status] || e.to_status) + (e.actor ? ' · ' + e.actor : '') + (e.note ? ' — ' + e.note : '') })))))) : empty('Sin propuestas enviadas.');
    } else if (tab === 'activity') {
      const t = await api('/api/admin/players/' + id + '/timeline');
      const KIND = { account_created: 'Creó la cuenta', last_login: 'Último inicio de sesión', game: 'Partida', submission: 'Propuesta', admin_action: 'Acción administrativa', data_request: 'Solicitud de datos' };
      body = section('Actividad reciente', el('p', { class: 'small muted', text: 'Hechos relevantes; no se registra cada movimiento en pantalla.' }),
        el('ol', { class: 'timeline' }, t.items.map((x) => el('li', {}, el('time', { text: fmt(x.at) }), el('strong', { text: KIND[x.kind] || x.kind }), ' ',
          x.kind === 'game' ? [gpill(x.status), ' ', el('a', { href: '#game/' + x.game_id, text: x.clue })] : '',
          x.kind === 'submission' ? [pill(x.status), ' ', x.clue] : '', x.kind === 'admin_action' ? x.action + (x.actor ? ' · ' + x.actor : '') : '',
          x.kind === 'data_request' ? x.request + ' · ' + x.status : ''))));
    } else {
      const h = await api('/api/admin/players/' + id + '/admin-history');
      body = h.items.length ? table(['Fecha', 'Quién', 'Acción', 'Detalles'], h.items.map((x) => el('tr', {}, el('td', { text: fmt(x.created_at) }), el('td', { text: x.actor || '—' }),
        el('td', { text: x.action }), el('td', {}, el('code', { class: 'small', text: (x.details || '').slice(0, 200) }))))) : empty('Sin acciones administrativas sobre esta cuenta.');
    }
    main.replaceChildren(head, tabs, el('div', { role: 'tabpanel' }, body));
  };

  // ── Partidas ──
  async function gamesTable(endpoint, q, opts) {
    const o = opts || {};
    const keys = ['id', 'player', 'clue', 'status', 'mode', 'lang', 'variant', 'country', 'from', 'to', 'registered', 'page'];
    const d = await api(endpoint + '?' + apiQs(q, keys));
    const st = el('select', { name: 'status', 'data-extra': '1', 'aria-label': 'Estado' }, el('option', { value: '', text: 'Todos los estados' }), Object.keys(GS).map((k) => el('option', { value: k, selected: q.get('status') === k, text: GS[k] })));
    const md = el('select', { name: 'mode', 'data-extra': '1', 'aria-label': 'Modo' }, el('option', { value: '', text: 'Todos los modos' }), Object.keys(MODES).map((k) => el('option', { value: k, selected: q.get('mode') === k, text: MODES[k] })));
    const clue = el('input', { name: 'clue', 'data-extra': '1', placeholder: 'Id o slug del críptico', value: q.get('clue') || '' });
    const gid = el('input', { name: 'id', 'data-extra': '1', placeholder: 'Id de partida', value: q.get('id') || '' });
    const from = el('input', { type: 'date', name: 'from', 'data-extra': '1', 'aria-label': 'Desde', value: q.get('from') || '' });
    const to = el('input', { type: 'date', name: 'to', 'data-extra': '1', 'aria-label': 'Hasta', value: q.get('to') || '' });
    const reg = el('select', { name: 'registered', 'data-extra': '1', 'aria-label': 'Tipo de jugador' }, [['', 'Con y sin cuenta'], ['1', 'Con cuenta'], ['0', 'Sin cuenta']].map(([v, t]) => el('option', { value: v, selected: (q.get('registered') || '') === v, text: t })));
    const cols = [
      { k: 'started_at', t: 'Inicio', f: (g) => el('a', { href: '#game/' + g.id, text: fmt(g.started_at) }) },
      { k: 'clue_text', t: 'Críptico', f: (g) => g.clue_text },
      ...(o.hideUser ? [] : [{ k: 'username', t: 'Jugador', f: (g) => (g.user_id && g.username ? el('a', { href: '#player/' + g.user_id, text: g.username }) : g.registered ? 'Con cuenta' : 'Sin cuenta (seudónimo)') }]),
      { k: 'status', t: 'Estado', f: (g) => gpill(g.status, g.end_reason) },
      { k: 'mode', t: 'Modo', f: (g) => MODES[g.mode] || g.mode },
      { k: 'language_code', t: 'Idioma', f: (g) => g.language_code },
      { k: 'play_variant', t: 'Variante', hidden: true },
      { k: 'country_code', t: 'País elegido', hidden: true },
      { k: 'difficulty', t: 'Dificultad', num: true, hidden: true },
      { k: 'attempts', t: 'Intentos', num: true },
      { k: 'wrong_attempts', t: 'Incorrectas', num: true, hidden: true },
      { k: 'hints_used', t: 'Pistas', num: true },
      { k: 'elapsed_ms', t: 'Transcurrido', num: true, f: (g) => dur(g.elapsed_ms) },
      { k: 'active_ms', t: 'Activo', num: true, f: (g) => dur(g.active_ms) },
      { k: 'finished_at', t: 'Cierre', f: (g) => (g.finished_at ? fmt(g.finished_at) : '') , hidden: true },
    ];
    const exp = can('export.data') && !o.hideUser ? el('a', { class: 'btn', href: '/api/admin/export/games.csv?' + apiQs(q, keys.filter((k) => k !== 'page')), text: 'Exportar CSV' }) : '';
    return [filterBar(q, { period: false, extra: [gid, clue, st, md, reg, el('label', { class: 'inline small' }, 'Fecha', from, to)] }), exp ? el('div', { class: 'toolbar' }, exp) : '',
      dataTable(o.hideUser ? 'player-games' : 'games', cols, d.items, { empty: 'No hay partidas con estos filtros.' }), pager(d)];
  }

  V.games = async () => {
    const q = qs();
    const body = await gamesTable('/api/admin/games', q, {});
    main.replaceChildren(el('div', { class: 'adm-head' }, el('h1', { text: 'Partidas' })),
      el('p', { class: 'muted small', text: 'Una partida se marca como abandonada recién cuando pasa el plazo de inactividad configurado (analytics.abandon_minutes); si la persona vuelve, se reanuda. Cerrar la pestaña no la abandona en el acto.' }),
      body);
  };

  V.game = async (id) => {
    const d = await api('/api/admin/games/' + id);
    const g = d.game;
    const row = (k, v) => el('div', {}, el('dt', { text: k }), el('dd', {}, v === null || v === undefined || v === '' ? el('span', { class: 'muted', text: NA }) : v));
    const t0 = Date.parse(g.started_at);
    main.replaceChildren(el('p', {}, el('a', { href: '#games', text: '← Partidas' })),
      el('h1', { class: 'clue-text', text: g.clue_text }), el('p', {}, gpill(g.status, g.end_reason)),
      el('div', { class: 'cols' },
        section('Partida', el('dl', { class: 'facts' }, row('Id', g.id), row('Jugador', g.user_id && g.username ? el('a', { href: '#player/' + g.user_id, text: g.username }) : 'Sin cuenta (identificador seudónimo)'),
          row('Modo', MODES[g.mode] || g.mode), row('Diario', g.daily_date), row('Variante', g.play_variant), row('País elegido', g.country_code && country(g.country_code)),
          row('Inicio', fmt(g.started_at)), row('Última actividad', fmt(g.last_activity_at)), row('Cierre', g.finished_at && fmt(g.finished_at)))),
        section('Medidas', el('dl', { class: 'facts' }, row('Tiempo transcurrido', dur(g.elapsed_ms)), row('Tiempo activo estimado', dur(g.active_ms)),
          row('Tiempo hasta resolver', g.status === 'solved' ? dur(g.duration_ms) : null), row('Tiempo hasta abandonar', g.status === 'abandoned' ? dur(g.elapsed_ms) : null),
          row('Intentos', g.attempts), row('Respuestas incorrectas', g.wrong_attempts), row('Pistas', g.hints_used), row('Errores técnicos', g.error_count))),
        section('Críptico', el('dl', { class: 'facts' }, row('Respuesta', g.answer), row('Idioma', lang(g.language_code)), row('Variante', g.variant_code || 'general'),
          row('Dificultad', g.difficulty), row('Mecanismo', g.mechanism), row('Origen', LABELS[g.origin] || g.origin)), can('catalog.read') ? el('a', { href: '#clue/' + g.clue_id, text: 'Abrir críptico' }) : '')),
      section('Eventos', d.events.length ? table(['Momento', 'Desde el inicio', 'Evento', 'Datos'], d.events.map((e) => el('tr', {}, el('td', { text: fmt(e.created_at) }),
        el('td', { text: dur(Date.parse(e.created_at) - t0) }), el('td', { text: EV[e.kind] || e.kind }), el('td', {}, e.data ? el('code', { class: 'small', text: JSON.stringify(e.data).slice(0, 160) }) : '')))) : empty('Sin eventos registrados.')));
  };

  // ── Rendimiento por críptico ──
  const SORT_LABELS = { abandon: 'Más abandonados', solve: 'Menor resolución', time: 'Más lentos', hints: 'Más pistas', flags: 'Posibles errores', plays: 'Más jugados', reveals: 'Más revelados' };
  V.cluestats = async () => {
    const q = qs();
    const d = await api('/api/admin/analytics/clues?' + apiQs(q, ['period', 'from', 'to', 'country', 'lang', 'variant', 'mechanism', 'origin', 'status', 'difficulty', 'q', 'min_plays', 'sort', 'page']));
    const sort = q.get('sort') || 'plays';
    const search = el('input', { type: 'search', name: 'q', 'data-extra': '1', placeholder: 'Pista, respuesta o id', value: q.get('q') || '' });
    const minP = el('input', { type: 'number', min: '0', name: 'min_plays', 'data-extra': '1', 'aria-label': 'Mínimo de partidas', placeholder: 'mín. partidas', size: '8', value: q.get('min_plays') || '' });
    const diff = el('select', { name: 'difficulty', 'data-extra': '1', 'aria-label': 'Dificultad' }, el('option', { value: '', text: 'Toda dificultad' }), [1, 2, 3, 4, 5].map((n) => el('option', { value: n, selected: q.get('difficulty') === String(n), text: 'Nivel ' + n })));
    const origin = el('select', { name: 'origin', 'data-extra': '1', 'aria-label': 'Origen' }, el('option', { value: '', text: 'Todo origen' }), ['original', 'generated', 'external', 'community'].map((o) => el('option', { value: o, selected: q.get('origin') === o, text: LABELS[o] })));
    const per = el('select', { name: 'period', 'data-extra': '1', 'aria-label': 'Período' }, el('option', { value: '', text: 'Todo el historial' }), Object.keys(PERIOD_LABELS).filter((p) => p !== 'custom').map((p) => el('option', { value: p, selected: q.get('period') === p, text: PERIOD_LABELS[p] })));
    const cols = [
      { k: 'clue_text', t: 'Críptico', f: (c) => el('span', {}, el('a', { href: '#clue/' + c.id, text: c.clue_text }), c.review ? el('span', { class: 'pill review', title: 'Señalado para revisión: puede ser solo difícil.', text: 'Revisar' }) : '') },
      { k: 'answer', t: 'Respuesta' }, { k: 'language_code', t: 'Idioma', f: (c) => c.language_code + (c.variant_code ? ' · ' + c.variant_code : '') },
      { k: 'difficulty', t: 'Dif.', num: true }, { k: 'mechanism', t: 'Mecanismo', hidden: true }, { k: 'origin', t: 'Origen', f: (c) => LABELS[c.origin], hidden: true },
      { k: 'plays', t: 'Partidas', num: true }, { k: 'solve_rate', t: '% resolución', num: true, f: (c) => (isNum(c.solve_rate) ? pct(c.solve_rate) : '') },
      { k: 'abandon_rate', t: '% abandono', num: true, f: (c) => (isNum(c.abandon_rate) ? pct(c.abandon_rate) : '') },
      { k: 'reveal_rate', t: '% revelado', num: true, f: (c) => (isNum(c.reveal_rate) ? pct(c.reveal_rate) : '') },
      { k: 'wrong', t: 'Incorrectas', num: true, hidden: true },
      { k: 'avg_solve_ms', t: 'Tiempo medio', num: true, f: (c) => (isNum(c.avg_solve_ms) ? dur(c.avg_solve_ms) : '') },
      { k: 'median_solve_ms', t: 'Mediana', num: true, f: (c) => (isNum(c.median_solve_ms) ? dur(c.median_solve_ms) : ''), hidden: true },
      { k: 'hints_avg', t: 'Pistas/partida', num: true, f: (c) => (isNum(c.hints_avg) ? nf(c.hints_avg) : '') },
      { k: 'reports_open', t: 'Reportes', num: true },
    ];
    main.replaceChildren(el('div', { class: 'adm-head' }, el('h1', { text: 'Rendimiento de crípticos' }),
      can('export.data') ? el('div', { class: 'toolbar' }, el('a', { class: 'btn', href: '/api/admin/export/clues.csv?' + apiQs(q, ['period', 'lang', 'variant', 'origin', 'difficulty', 'q', 'min_plays', 'sort']), text: 'Exportar CSV' })) : ''),
      el('p', { class: 'muted small', text: `«Revisar» aparece con ${d.thresholds.reports} o más reportes de respuesta/explicación, o con resolución menor a ${d.thresholds.minRate} % y al menos ${d.thresholds.minPlays} partidas. Es una señal para mirar respuesta y explicación: un críptico difícil no está necesariamente mal.` }),
      el('div', { class: 'tabs' }, Object.keys(SORT_LABELS).map((k) => el('a', { href: '#', class: k === sort ? 'active' : '', onclick: (e) => { e.preventDefault(); const p = Object.fromEntries(qs()); p.sort = k; delete p.page; go(p); }, text: SORT_LABELS[k] }))),
      filterBar(q, { period: false, extra: [per, search, diff, origin, minP] }),
      dataTable('cluestats', cols, d.items, { empty: 'Sin crípticos con estos filtros.' }), pager(d));
  };

  // ── Regiones e idiomas ──
  // ── Origen del tráfico ──
  const MEDIUM = { social: 'Redes sociales', search: 'Buscadores', referral: 'Otros sitios', direct: 'Directo', email: 'Correo', ai: 'Asistentes de IA', campaign: 'Campaña' };
  function originText(o) {
    if (!o || !o.origin_source) return '';
    return o.origin_source + (o.origin_medium && o.origin_source !== 'Directo' ? ' · ' + (MEDIUM[o.origin_medium] || o.origin_medium) : '')
      + (o.origin_campaign ? ' · campaña «' + o.origin_campaign + '»' : '') + (o.origin_landing ? ' · entró por ' + o.origin_landing : '');
  }
  V.origins = async () => {
    const q = qs();
    const d = await api('/api/admin/analytics/origins?' + apiQs(q, PERIOD_KEYS));
    const src = (r) => (r.source || 'Sin dato') + (r.medium && r.source !== 'Directo' ? ' · ' + (MEDIUM[r.medium] || r.medium) : '');
    main.replaceChildren(el('div', { class: 'adm-head' }, el('h1', { text: 'Origen del tráfico' })),
      el('p', { class: 'muted small', text: 'De qué red, buscador o sitio llegó cada visita. Solo se registra el dominio que la trajo y la campaña del enlace (utm_campaign), nunca la dirección completa. Instagram y TikTok muchas veces no informan el sitio de origen: esas visitas aparecen como «Directo» salvo que el enlace lleve utm_source.' }),
      d.storing ? '' : el('p', { class: 'flash', text: 'El origen por jugador y por cuenta empieza a guardarse cuando se publique la política de privacidad que lo explica (Legal → Aprobar y publicar). Las visitas se cuentan desde ya, de forma agregada.' }),
      filterBar(q, { geo: false }),
      el('div', { class: 'cols' },
        section('Visitas de entrada', d.visits.length ? barList(d.visits, src, (r) => r.entries, { extra: (r) => nf(r.new_visitors, 0) + ' navegadores nuevos' }) : empty()),
        section('Jugadores nuevos', d.players.length ? barList(d.players, src, (r) => r.players, { extra: (r) => nf(r.games, 0) + ' partidas · ' + nf(r.with_account, 0) + ' con cuenta' }) : empty()),
        section('Cuentas nuevas', d.accounts.length ? barList(d.accounts, src, (r) => r.users) : empty())),
      section('Campañas', d.campaigns.length ? dataTable('origin-campaigns', [{ k: 'campaign', t: 'Campaña' }, { k: 'source', t: 'Origen' }, { k: 'entries', t: 'Visitas', num: true }], d.campaigns, { noPicker: true })
        : el('p', { class: 'small muted', text: 'Para medir cada publicación, usá enlaces con utm, por ejemplo playcripticos.com/es?utm_source=instagram&utm_campaign=bio.' })),
      section('Cuentas nuevas y cómo llegaron', d.recent.length ? dataTable('origin-recent', [
        { k: 'username', t: 'Usuario', f: (u) => el('a', { href: '#player/' + u.id, text: u.username }) }, { k: 'created_at', t: 'Registro', f: (u) => fmt(u.created_at) },
        { k: 'origin_source', t: 'Origen', f: (u) => originText(u) || 'Sin dato' }, { k: 'origin_referrer', t: 'Sitio que la trajo', f: (u) => u.origin_referrer || '' },
      ], d.recent, { noPicker: true }) : empty()));
  };

  V.geo = async () => {
    const q = qs();
    const d = await api('/api/admin/analytics/geo?' + apiQs(q, PERIOD_KEYS));
    const ex = (r) => (can('export.data') ? el('a', { class: 'btn small', href: '/api/admin/export/' + r + '.csv?' + apiQs(q, PERIOD_KEYS), text: 'CSV' }) : '');
    main.replaceChildren(el('div', { class: 'adm-head' }, el('h1', { text: 'Regiones e idiomas' })),
      el('p', { class: 'muted small', text: 'País = el que cada persona eligió en sus preferencias. Idioma = el idioma del críptico jugado. Son datos distintos: el idioma no indica dónde está alguien. No se infiere ubicación por IP.' }),
      filterBar(q),
      section('Países elegidos', ex('countries'), dataTable('geo-countries', [
        { k: 'country', t: 'País', f: (c) => country(c.country) }, { k: 'players', t: 'Jugadores', num: true }, { k: 'games', t: 'Partidas', num: true },
        { k: 'solve_rate', t: '% resolución', num: true, f: (c) => (isNum(c.solve_rate) ? pct(c.solve_rate) : '') },
        { k: 'active_ms', t: 'Tiempo activo', num: true, f: (c) => dur(c.active_ms) },
        { k: 'users', t: 'Cuentas', num: true }, { k: 'new_users', t: 'Cuentas nuevas', num: true }, { k: 'active_users', t: 'Cuentas activas', num: true },
      ], d.countries, { noPicker: true })),
      el('div', { class: 'cols' },
        section('Idiomas jugados', ex('languages'), barList(d.languages, (r) => lang(r.lang), (r) => r.games, { extra: (r) => nf(r.players, 0) + ' jug. · ' + pct(r.games ? (r.solved / r.games) * 100 : null) })),
        section('Variantes jugadas', barList(d.variants, (r) => variantName(r.variant), (r) => r.games, { extra: (r) => nf(r.players, 0) + ' jug.' })),
        section('Preferencia de las cuentas', el('p', { class: 'small muted', text: 'Variante o idioma guardado en cada cuenta (todas, sin período).' }), barList(d.user_languages, (r) => r.choice || NA, (r) => r.users))),
      section('Evolución de los 5 países con más partidas', d.evolution.length ? d.evolution.map((e) => el('div', { class: 'mini' }, el('h4', { text: country(e.country) }),
        lineChart(e.points, [{ k: 'games', t: 'Partidas' }], { height: 90 }))) : empty()));
  };

  // ── Embudo y retención ──
  const FUNNEL = { visit: 'Navegadores nuevos que visitaron', start: 'Iniciaron una partida', attempt: 'Enviaron al menos una respuesta', hint: 'Pidieron una pista',
    complete: 'Completaron un críptico', another: 'Jugaron otro', return: 'Volvieron otro día', register: 'Crearon una cuenta' };
  V.funnel = async () => {
    const q = qs(); const seg = q.get('segment') || 'all';
    const [f, r] = await Promise.all([api('/api/admin/analytics/funnel?' + apiQs(q, PERIOD_KEYS)), api('/api/admin/analytics/retention?' + apiQs(q, [...PERIOD_KEYS, 'segment', 'weeks']))]);
    const segSel = el('select', { name: 'segment', 'data-extra': '1', 'aria-label': 'Unidad' }, [['all', 'Identificadores de jugador'], ['registered', 'Solo cuentas registradas']].map(([v, t]) => el('option', { value: v, selected: seg === v, text: t })));
    const s = r.sessions;
    const max = Math.max(1, ...f.steps.map((x) => x.n));
    main.replaceChildren(el('div', { class: 'adm-head' }, el('h1', { text: 'Embudo y retención' }),
      can('export.data') ? el('div', { class: 'toolbar' }, el('a', { class: 'btn', href: '/api/admin/export/retention.csv?' + apiQs(q, ['segment', 'weeks']), text: 'Exportar cohortes CSV' })) : ''),
      filterBar(q, { extra: [segSel] }),
      section('Embudo de jugadores nuevos del período',
        el('p', { class: 'small muted', text: 'Desde «Iniciaron», la unidad es el identificador de jugador creado en el período (un navegador) y cada paso se mide sobre quienes iniciaron: los pasos no son obligatorios en orden (se puede completar sin pedir pistas). La visita es un conteo agregado, sin identificadores, por eso no se encadena exactamente con el segundo paso.' }),
        el('ol', { class: 'funnel' }, f.steps.map((x, i) => el('li', {}, el('span', { class: 'bar-label', text: (i + 1) + '. ' + FUNNEL[x.key] }),
          el('span', { class: 'bar-track' }, el('span', { class: 'bar-fill', style: 'width:' + Math.max(1, Math.round((x.n / max) * 100)) + '%' })),
          el('span', { class: 'bar-value', text: nf(x.n, 0) + (i > 1 ? ' · ' + pct(x.of_start) + ' de los que iniciaron' : '') })))) ),
      el('div', { class: 'cards' },
        kpi('Retención D1', r.overall.d1, { fmt: pct, def: 'Del grupo que ya cumplió 1 día desde su primera partida, porcentaje que volvió a jugar al día siguiente.' }),
        kpi('Retención D7', r.overall.d7, { fmt: pct, def: 'Volvieron a jugar dentro de los 7 días siguientes a su primer día (solo quienes ya cumplieron 7 días).' }),
        kpi('Retención D30', r.overall.d30, { fmt: pct, def: 'Ídem, dentro de 30 días.' }),
        kpi('Sesiones', s.sessions, { def: 'Una sesión agrupa las partidas de la misma unidad separadas por menos de 30 minutos.' }),
        kpi('Sesiones por unidad', s.sessions_per_unit, { fmt: (v) => nf(v) }), kpi('Partidas por sesión', s.games_per_session, { fmt: (v) => nf(v) }),
        kpi('Horas entre sesiones (prom.)', s.avg_hours_between_sessions, { fmt: (v) => (isNum(v) ? nf(v) + ' h' : NA) }),
        kpi('Jugaron más de una partida', s.multi_game_pct, { fmt: pct })),
      section('Cohortes semanales (' + (seg === 'registered' ? 'cuentas registradas' : 'identificadores de jugador') + ')',
        el('p', { class: 'small muted', text: seg === 'registered' ? 'Cada cuenta es una persona identificada.' : 'Un identificador es un navegador, no una persona: alguien que juega en dos dispositivos sin cuenta cuenta dos veces. «—» = la ventana todavía no se cumplió.' }),
        r.cohorts.length ? table(['Semana (lunes)', 'Nuevos', 'D1', 'D7', 'D30', 'Volvieron alguna vez'], r.cohorts.map((c) => el('tr', {}, el('td', { text: c.week }), el('td', { class: 'num', text: c.size }),
          ...['d1', 'd7', 'd30', 'returned'].map((k) => el('td', { class: 'heat', 'data-v': isNum(c[k]) ? String(Math.min(4, Math.floor(c[k] / 20))) : '', text: isNum(c[k]) ? pct(c[k]) : '—' }))))) : empty()));
  };

  // ── Catálogo ──
  V.catstats = async () => {
    const d = await api('/api/admin/analytics/catalog');
    const bl = (rows, f) => barList(rows, f, (r) => r.n);
    main.replaceChildren(el('h1', { text: 'Estadísticas del catálogo' }),
      el('div', { class: 'cards' }, kpi('Crípticos en total', d.total), kpi('Validación fallida', d.validation_failed, { warn: true, href: '#catalog?validation_status=failed' }),
        kpi('Duplicados por revisar', d.duplicates_open, { warn: true, href: '#duplicates' }), kpi('Reportes abiertos', d.reports_open, { warn: true, href: '#reports' })),
      el('div', { class: 'cols' },
        section('Por estado', bl(d.by_status, (r) => LABELS[r.k] || r.k)), section('Por origen', bl(d.by_origin, (r) => LABELS[r.k] || r.k)),
        section('Por idioma', bl(d.by_language, (r) => lang(r.k))), section('Por variante', bl(d.by_variant, (r) => r.k)),
        section('Por dificultad', bl(d.by_difficulty, (r) => 'Nivel ' + r.k)), section('Por mecanismo', bl(d.by_mechanism, (r) => r.k || NA))));
  };

  // ── Estado de fuentes externas ──
  V.importstats = async () => {
    const d = await api('/api/admin/analytics/imports');
    main.replaceChildren(el('div', { class: 'adm-head' }, el('h1', { text: 'Estado de fuentes externas' }),
      can('export.data') ? el('div', { class: 'toolbar' }, el('a', { class: 'btn', href: '/api/admin/export/imports.csv', text: 'Exportar CSV' })) : ''),
      el('p', { class: 'muted small', text: 'Que una página publique un críptico no da permiso para republicarlo: solo se publica solo lo que viene de una fuente aprobada con licencia que lo permita.' }),
      d.job ? el('p', { class: 'small', text: 'Tarea de importación: ' + (d.job.last_status || 'sin ejecutar') + ' · última ' + fmt(d.job.last_run_at) + ' · próxima ' + fmt(d.job.next_run_at) }) : '',
      dataTable('importstats', [
        { k: 'name', t: 'Fuente', f: (s) => el('a', { href: '#source/' + s.id, text: s.name }) }, { k: 'status', t: 'Estado', f: (s) => pill(s.status) },
        { k: 'license_name', t: 'Licencia' }, { k: 'access_method', t: 'Acceso', hidden: true }, { k: 'language_code', t: 'Idioma', hidden: true },
        { k: 'last_success_at', t: 'Último éxito', f: (s) => (s.last_success_at ? fmt(s.last_success_at) : '') }, { k: 'next_run_at', t: 'Próxima', f: (s) => (s.next_run_at ? fmt(s.next_run_at) : ''), hidden: true },
        { k: 'items', t: 'Elementos', num: true }, { k: 'auto_published', t: 'Publicados solos', num: true }, { k: 'published_manual', t: 'Publicados a mano', num: true },
        { k: 'review', t: 'En revisión', num: true }, { k: 'duplicates', t: 'Duplicados', num: true }, { k: 'discarded', t: 'Descartados', num: true },
        { k: 'errors', t: 'Errores', num: true }, { k: 'consecutive_failures', t: 'Fallos seguidos', num: true }, { k: 'last_error', t: 'Último error', hidden: true },
      ], d.sources, { empty: 'Todavía no hay fuentes externas.' }));
  };

  // ── Alertas ──
  const SEV = { critical: 'Crítica', warning: 'Advertencia', info: 'Información' };
  const AST = { open: 'Abierta', acknowledged: 'Vista', resolved: 'Resuelta' };
  V.alerts = async () => {
    const q = qs();
    const d = await api('/api/admin/alerts?' + apiQs(q, ['status', 'severity']));
    const st = el('select', { name: 'status', 'data-extra': '1', 'aria-label': 'Estado' }, [['', 'Sin resolver'], ['open', 'Abiertas'], ['acknowledged', 'Vistas'], ['resolved', 'Resueltas']].map(([v, t]) => el('option', { value: v, selected: (q.get('status') || '') === v, text: t })));
    const sv = el('select', { name: 'severity', 'data-extra': '1', 'aria-label': 'Gravedad' }, [['', 'Toda gravedad'], ['critical', 'Críticas'], ['warning', 'Advertencias'], ['info', 'Información']].map(([v, t]) => el('option', { value: v, selected: (q.get('severity') || '') === v, text: t })));
    const set = (id, status) => act(() => api('/api/admin/alerts/' + id, { method: 'POST', body: { status } }), 'Alerta actualizada.');
    main.replaceChildren(el('div', { class: 'adm-head' }, el('h1', { text: 'Alertas' }),
      el('div', { class: 'toolbar' }, can('alerts.manage') ? btn('Revisar ahora', act(async () => { const r = await api('/api/admin/alerts/scan', { method: 'POST', body: {} }); flash('Revisión hecha: ' + r.alerts + ' condiciones detectadas.', true); })) : '',
        can('settings.write') ? el('a', { class: 'btn', href: '#settings', text: 'Umbrales (alerts.*)' }) : '')),
      el('p', { class: 'muted small', text: 'Última revisión automática: ' + (d.last_scan ? fmt(d.last_scan.last_run_at) : NA) + '. Los umbrales y la muestra mínima se configuran en «Reglas y funciones». Las copias de seguridad las gestiona Turso: este panel no tiene acceso a su estado.' }),
      filterBar(q, { period: false, geo: false, extra: [st, sv] }),
      d.items.length ? el('ul', { class: 'alert-list' }, d.items.map((x) => el('li', { class: 'alert sev-' + x.severity },
        el('div', { class: 'alert-head' }, el('span', { class: 'pill sev-' + x.severity, text: (x.severity === 'critical' ? '⛔ ' : x.severity === 'warning' ? '⚠ ' : 'ℹ ') + SEV[x.severity] }),
          el('strong', { text: x.title }), el('span', { class: 'pill', text: AST[x.status] })),
        el('p', { class: 'small muted', text: 'Primera vez ' + fmt(x.first_seen_at) + ' · última ' + fmt(x.last_seen_at) + ' · ' + x.occurrences + ' veces' + (x.resolved_at ? ' · resuelta ' + fmt(x.resolved_at) : '') }),
        x.details && x.details.note ? el('p', { class: 'small', text: x.details.note }) : '',
        x.details && x.details.clue_id ? el('a', { class: 'small', href: '#clue/' + x.details.clue_id, text: 'Abrir críptico' }) : '',
        x.details && x.details.source_id ? el('a', { class: 'small', href: '#source/' + x.details.source_id, text: 'Abrir fuente' }) : '',
        x.details && x.details.error ? el('code', { class: 'small', text: String(x.details.error).slice(0, 200) }) : '',
        can('alerts.manage') ? el('div', { class: 'toolbar' }, x.status === 'open' ? btn('Marcar como vista', set(x.id, 'acknowledged')) : '',
          x.status !== 'resolved' ? btn('Resolver', set(x.id, 'resolved'), 'primary') : btn('Reabrir', set(x.id, 'open'))) : ''))) : empty('No hay alertas en este estado.'));
  };

  // ── Privacidad ──
  const DRK = { access: 'Acceso a sus datos', rectification: 'Corrección', deletion: 'Eliminación' };
  const DRS = { open: 'Abierta', in_progress: 'En curso', done: 'Completada', rejected: 'Rechazada' };
  V.privacy = async () => {
    const q = qs();
    const d = await api('/api/admin/privacy/requests' + (q.get('status') ? '?status=' + q.get('status') : ''));
    const upd = (x, status) => async () => {
      if (x.kind === 'deletion' && status === 'done' && !confirm('Completar una solicitud de eliminación anonimiza la cuenta de forma irreversible. ¿Continuar?')) return;
      const note = prompt('Nota de resolución (opcional):'); if (note === null) return;
      try { await api('/api/admin/privacy/requests/' + x.id, { method: 'POST', body: { status, note } }); flash('Solicitud actualizada.', true); route(); } catch (e) { flash(e.message); }
    };
    main.replaceChildren(el('h1', { text: 'Privacidad y solicitudes de datos' }),
      el('div', { class: 'panel small' }, el('ul', {},
        el('li', { text: 'Cada persona puede descargar sus datos y pedir correcciones desde su perfil; borrar la cuenta la anonimiza en el acto.' }),
        el('li', { text: 'Las IP no se guardan completas: solo un hash en las sesiones, que se borra a los 30 días.' }),
        el('li', { text: 'No se infiere ubicación. País e idioma son los que cada persona elige.' }),
        el('li', { text: 'Ver una ficha con correo y cada exportación quedan registrados en la auditoría.' }))),
      el('div', { class: 'tabs' }, [['', 'Pendientes y recientes'], ['open', 'Abiertas'], ['in_progress', 'En curso'], ['done', 'Completadas'], ['rejected', 'Rechazadas']].map(([k, t]) =>
        el('a', { href: '#privacy' + (k ? '?status=' + k : ''), class: (q.get('status') || '') === k ? 'active' : '', text: t }))),
      d.items.length ? table(['Recibida', 'Cuenta', 'Tipo', 'Mensaje', 'Estado', ''], d.items.map((x) => el('tr', {}, el('td', { text: fmt(x.created_at) }),
        el('td', {}, x.user_id ? el('a', { href: '#player/' + x.user_id, text: x.username || x.user_id }) : NA), el('td', { text: DRK[x.kind] || x.kind }),
        el('td', { text: x.message || '' }), el('td', {}, el('span', { class: 'pill', text: DRS[x.status] }), x.resolution_note ? el('div', { class: 'small muted', text: x.resolution_note + (x.resolved_by_name ? ' · ' + x.resolved_by_name : '') }) : ''),
        el('td', {}, ['open', 'in_progress'].includes(x.status) ? [x.status === 'open' ? btn('Tomar', upd(x, 'in_progress')) : '', btn('Completar', upd(x, 'done'), 'primary'), btn('Rechazar', upd(x, 'rejected'))] : '')))) : empty('No hay solicitudes en este estado.'));
  };

  // ── Exportaciones ──
  V.exports = async () => {
    const q = qs();
    const R = [
      ['users', 'Usuarios registrados', 'players.read', 'Una fila por cuenta con sus estadísticas. Sin contraseñas ni tokens.'],
      ['games', 'Partidas', 'games.read', 'Una fila por partida, con estado, intentos, pistas y tiempos.'],
      ['daily', 'Resumen diario', 'analytics.read', 'Partidas por día, idioma, país, variante y modo.'],
      ['countries', 'Países', 'analytics.read', 'Jugadores, partidas y cuentas por país elegido.'],
      ['languages', 'Idiomas y variantes', 'analytics.read', 'Partidas y jugadores por idioma y variante.'],
      ['clues', 'Rendimiento de crípticos', 'analytics.read', 'Resolución, abandono, tiempos y reportes por críptico.'],
      ['retention', 'Cohortes de retención', 'analytics.read', 'D1, D7 y D30 por semana.'],
      ['imports', 'Fuentes e importaciones', 'sources.read', 'Estado y resultados por fuente externa.'],
      ['submissions', 'Propuestas de usuarios', 'submissions.read', 'Propuestas con estado y cantidad de decisiones.'],
      ['bank', 'Banco por idioma y dificultad', 'bank.read', 'Meta, generados, validados, publicados, pendientes, rechazados, duplicados y avance real por celda.'],
      ['catalog', 'Catálogo completo', 'catalog.read', 'Cada críptico con respuesta, explicación, procedencia, licencia, autor y estado de derechos.'],
    ];
    const email = el('input', { type: 'checkbox', id: 'exp-email' });
    const per = filterBar(q);
    const link = (k) => { const p = new URLSearchParams(apiQs(q, PERIOD_KEYS)); if (k === 'users' && email.checked) p.set('include_email', '1'); return '/api/admin/export/' + k + '.csv' + (String(p) ? '?' + p : ''); };
    const rows = R.filter((r) => can(r[2])).map(([k, t, , desc]) => {
      const a = el('a', { class: 'btn', href: link(k), text: 'Descargar CSV' });
      if (k === 'users') email.addEventListener('change', () => { a.href = link(k); });
      return el('tr', {}, el('td', {}, el('strong', { text: t }), el('div', { class: 'small muted', text: desc })), el('td', {}, a));
    });
    main.replaceChildren(el('h1', { text: 'Exportaciones' }),
      el('p', { class: 'muted small', text: 'Cada descarga queda en la auditoría con quién, cuándo, filtros y si incluyó datos personales. Las celdas se protegen contra fórmulas de hoja de cálculo. Período y filtros se aplican a los informes de estadísticas.' }),
      per, can('export.pii') ? el('label', { class: 'check' }, email, 'Incluir correos en «Usuarios» (dato personal: usalo solo si es necesario)') : '',
      table(['Informe', ''], rows));
  };

  async function catalogList(fixed, title) {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const params = new URLSearchParams(Object.assign({}, Object.fromEntries(q), fixed || {}));
    const d = await api('/api/admin/clues?' + params);
    const search = el('input', { type: 'search', placeholder: 'Buscar pista o respuesta', value: q.get('q') || '' });
    const FILTER_NAMES = { status: 'Estado: todos', origin: 'Origen: todos', language_code: 'Idioma: todos', validation_status: 'Validación: toda' };
    const mk = (name, opts) => { const s = el('select', { name, 'aria-label': FILTER_NAMES[name] }, el('option', { value: '', text: FILTER_NAMES[name] }), opts.map((o) => el('option', { value: o, selected: q.get(name) === o, text: LABELS[o] || o }))); return s; };
    const sStatus = mk('status', ['published', 'draft', 'review', 'disabled']);
    const sOrigin = mk('origin', ['original', 'generated', 'external', 'community']);
    const sLang = mk('language_code', ['es', 'en', 'fr', 'pt', 'it', 'de']);
    const sVal = mk('validation_status', ['verified', 'asserted', 'failed', 'unchecked']);
    FILTER_NAMES.difficulty = 'Dificultad: todas'; FILTER_NAMES.rights_status = 'Derechos: todos';
    const sDiff = mk('difficulty', ['1', '2', '3', '4', '5']);
    const sRights = mk('rights_status', ['original', 'licensed', 'public_domain', 'permission', 'reference_only', 'unverified']);
    const author = el('input', { type: 'search', placeholder: 'Autor', value: q.get('author') || '', 'aria-label': 'Autor' });
    const go = () => { const p = new URLSearchParams(); for (const [k, v] of [['q', search.value], ['status', sStatus.value], ['origin', sOrigin.value], ['language_code', sLang.value], ['validation_status', sVal.value], ['difficulty', sDiff.value], ['rights_status', sRights.value], ['author', author.value], ['batch_id', q.get('batch_id')]]) if (v) p.set(k, v); location.hash = location.hash.split('?')[0] + '?' + p; };
    const page = Number(q.get('page') || 1);
    main.replaceChildren(el('h1', { text: title }),
      fixed ? '' : el('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); go(); } }, search, sStatus, sOrigin, sLang, sDiff, sVal, sRights, author, el('button', { class: 'btn', type: 'submit', text: 'Filtrar' })),
      q.get('batch_id') ? el('p', { class: 'small muted', text: 'Mostrando solo el lote ' + q.get('batch_id').slice(0, 8) + '.' }) : '',
      el('p', { class: 'muted small', text: d.total + ' crípticos' }),
      table(['Pista', 'Respuesta', 'Idioma', 'Dif.', 'Origen', 'Autor', 'Estado', 'Validación', ''], d.items.map((c) => el('tr', {},
        el('td', {}, el('a', { href: '#clue/' + c.id, text: c.clue_text })), el('td', { text: c.answer }), el('td', { text: c.language_code + (c.variant_code ? ' · ' + c.variant_code : '') }),
        el('td', { text: c.difficulty }), el('td', { text: LABELS[c.origin] }), el('td', { text: c.author_name || (c.origin === 'generated' ? 'generador' : 'desconocido') }), el('td', {}, pill(c.status)), el('td', {}, pill(c.validation_status)),
        el('td', {}, c.status !== 'published' && c.validation_errors === 0 && can('catalog.write') ? btn('Publicar', act(() => api('/api/admin/clues/' + c.id + '/status', { method: 'POST', body: { status: 'published' } }), 'Publicado.')) : '')))),
      el('div', { class: 'toolbar' }, page > 1 ? btn('← Anterior', () => { q.set('page', page - 1); location.hash = location.hash.split('?')[0] + '?' + q; }) : '',
        d.total > page * d.per_page ? btn('Siguiente →', () => { q.set('page', page + 1); location.hash = location.hash.split('?')[0] + '?' + q; }) : ''));
  }
  // ── Banco de crípticos: matriz idioma × dificultad ──
  const DIFF = { 1: 'Muy fácil', 2: 'Fácil', 3: 'Intermedio', 4: 'Difícil', 5: 'Experto' };
  const CELL_STATUS = { idle: 'En espera', running: 'Generando', paused: 'Pausada', exhausted: 'Sin más candidatos', done: 'Meta cumplida', error: 'Con error' };
  const BATCH_STATUS = { running: 'En curso', committed: 'Guardado, sin verificar', verified: 'Verificado en base', failed: 'Falló', abandoned: 'Abandonado', suspended: 'Suspendido' };
  const nn = (v) => Number(v || 0).toLocaleString('es');

  V.bank = async () => {
    const q = qs();
    const F = ['lang', 'difficulty', 'origin', 'author', 'source', 'license', 'status', 'mechanism'];
    const params = new URLSearchParams(); F.forEach((k) => { if (q.get(k)) params.set(k, q.get(k)); });
    const [m, srcs, lics] = await Promise.all([api('/api/admin/bank/matrix?' + params),
      can('sources.read') ? api('/api/admin/sources').catch(() => ({ items: [] })) : { items: [] },
      can('sources.read') ? api('/api/admin/licenses').catch(() => ({ items: [] })) : { items: [] }]);
    const sel = (name, label, opts) => el('select', { name, 'aria-label': label }, el('option', { value: '', text: label }),
      opts.map(([v, t]) => el('option', { value: v, selected: q.get(name) === String(v), text: t })));
    const langs = [...new Set(m.cells.map((c) => c.lang))];
    const fl = {
      lang: sel('lang', 'Idioma: todos', langs.map((l) => [l, l])),
      difficulty: sel('difficulty', 'Dificultad: todas', [1, 2, 3, 4, 5].map((d) => [d, d + ' · ' + DIFF[d]])),
      origin: sel('origin', 'Origen: todos', ['original', 'generated', 'external', 'community'].map((o) => [o, LABELS[o]])),
      status: sel('status', 'Estado: todos', ['published', 'review', 'draft', 'disabled'].map((o) => [o, LABELS[o]])),
      source: sel('source', 'Fuente: todas', (srcs.items || []).map((s) => [s.id, s.name])),
      license: sel('license', 'Licencia: todas', (lics.items || []).map((l) => [l.id, l.name])),
      mechanism: sel('mechanism', 'Mecanismo: todos', ['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone', 'double_definition', 'combination'].map((x) => [x, x])),
      author: el('input', { name: 'author', type: 'search', placeholder: 'Autor (o «desconocido»)', value: q.get('author') || '' }),
    };
    const go = () => { const p = new URLSearchParams(); F.forEach((k) => { if (fl[k].value) p.set(k, fl[k].value); }); location.hash = 'bank' + (String(p) ? '?' + p : ''); };
    const t = m.totals;
    const filtered = F.some((k) => q.get(k));
    const cellOf = (l, d) => m.cells.find((c) => c.lang === l && c.difficulty === d);
    const detail = el('div', { id: 'bank-cell' });
    const pctBar = (c) => el('span', { class: 'bar-track', title: c.percent + ' %' }, el('span', { class: 'bar-fill', style: 'width:' + Math.min(100, c.percent) + '%' }));
    const showCell = async (c) => {
      const h = await api('/api/admin/bank/batches?lang=' + c.lang + '&difficulty=' + c.difficulty + '&limit=20');
      const list = (status) => '#catalog?language_code=' + c.lang + '&difficulty=' + c.difficulty + (status ? '&status=' + status : '');
      const target = el('input', { type: 'number', min: '0', step: '100', value: c.target, 'aria-label': 'Meta de la celda' });
      const metric = (k, v, hint) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td', { text: v }), el('td', { class: 'small muted', text: hint || '' }));
      detail.replaceChildren(el('div', { class: 'panel' },
        el('h3', { text: c.lang.toUpperCase() + ' · ' + DIFF[c.difficulty] + ' (' + c.difficulty + ')' }),
        el('div', { class: 'tbl-wrap' }, el('table', {}, el('tbody', {},
          metric('Meta', nn(c.target), 'Independiente para este idioma y esta dificultad.'),
          metric('Generados', nn(c.generated), 'Candidatos producidos por el generador más los ingresados por otras vías.'),
          metric('Validados', nn(c.validated), 'Sin errores críticos.'),
          metric('Publicados', nn(c.published), 'Originales y generados: ' + nn(c.published_original) + ' · externos: ' + nn(c.published_external) + ' · comunidad: ' + nn(c.published_community)),
          metric('Pendientes', nn(c.pending), 'Esperan revisión humana; no cuentan para la meta.'),
          metric('Rechazados', nn(c.rejected), 'Descartados por el validador o desactivados.'),
          metric('Duplicados descartados', nn(c.duplicates), 'Mismo juego de palabras, misma pista o respuesta ya muy usada.'),
          metric('Permiso sin verificar', nn(c.unverified), 'En cuarentena: nunca se publican.'),
          metric('Avance real', c.percent + ' %', 'Faltan ' + nn(c.missing) + '.'),
          metric('Última ejecución', fmt(c.last_run)),
          metric('Estado del proceso', CELL_STATUS[c.status] || c.status, c.last_error ? 'Último error: ' + c.last_error : (c.generator_version ? 'Generador ' + c.generator_version + ' · posición ' + nn(c.cursor) : ''))))),
        el('div', { class: 'toolbar' },
          el('a', { class: 'btn', href: list('published'), text: 'Ver publicados' }), el('a', { class: 'btn', href: list('review'), text: 'Revisar pendientes' }),
          can('export.data') ? el('a', { class: 'btn', href: '/api/admin/export/catalog.csv?lang=' + c.lang + '&difficulty=' + c.difficulty, text: 'Exportar CSV' }) : '',
          can('bank.run') ? btn('Generar un lote corto', act(async () => {
            const r = await api('/api/admin/bank/cells/' + c.lang + '/' + c.difficulty + '/run', { method: 'POST', body: { size: 40 } });
            return { ok: !r.skipped, flash: r.skipped ? 'La celda está ocupada o en pausa.' : r.done ? 'La meta ya está cumplida.' : r.exhausted ? 'El generador no tiene más candidatos para esta celda.'
              : 'Lote ' + r.seq + ': ' + r.published + ' publicados, ' + r.pending + ' pendientes, ' + r.duplicates + ' duplicados (verificado en base).' };
          }), 'primary') : '',
          can('bank.run') ? btn(c.status === 'paused' ? 'Reanudar' : 'Pausar', act(() => api('/api/admin/bank/cells/' + c.lang + '/' + c.difficulty, { method: 'PATCH', body: { status: c.status === 'paused' ? 'idle' : 'paused' } }), 'Listo.')) : ''),
        can('bank.run') ? el('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); act(() => api('/api/admin/bank/cells/' + c.lang + '/' + c.difficulty, { method: 'PATCH', body: { target: Number(target.value) } }), 'Meta actualizada.')(); } },
          el('label', {}, 'Meta ', target), el('button', { class: 'btn', type: 'submit', text: 'Guardar meta' })) : '',
        el('h3', { text: 'Historial de lotes' }),
        h.items.length ? table(['#', 'Inicio', 'Estado', 'Candidatos', 'Publicados', 'Pendientes', 'Rechazados', 'Duplicados', 'Duración', ''], h.items.map((b) => el('tr', {},
          el('td', { text: b.seq }), el('td', { text: fmt(b.started_at) }), el('td', {}, el('span', { class: 'pill ' + (b.status === 'verified' ? 'verified' : b.status === 'failed' || b.status === 'suspended' ? 'failed' : 'pending'), text: BATCH_STATUS[b.status] || b.status })),
          el('td', { text: nn(b.candidates) }), el('td', { text: nn(b.published) }), el('td', { text: nn(b.pending) }), el('td', { text: nn(b.rejected) }), el('td', { text: nn(b.duplicates) }),
          el('td', { text: b.duration_ms ? (b.duration_ms / 1000).toFixed(1) + ' s' : '—' }),
          el('td', {}, el('a', { href: '#catalog?batch_id=' + b.id, text: 'Ver' }), ' ',
            can('bank.run') && b.status === 'verified' ? btn('Suspender', act(() => api('/api/admin/bank/batches/' + b.id + '/suspend', { method: 'POST', body: { reason: 'suspendido desde el panel' } }), 'Lote suspendido: sus crípticos volvieron a revisión.'), 'small') : '')))) : el('p', { class: 'muted', text: 'Todavía no hay lotes para esta celda.' })));
      detail.scrollIntoView({ block: 'nearest' });
    };
    const head = el('tr', {}, el('th', { text: 'Idioma' }), [1, 2, 3, 4, 5].map((d) => el('th', { text: d + ' · ' + DIFF[d] })));
    const rows = langs.map((l) => el('tr', {}, el('th', { scope: 'row', text: l.toUpperCase() }), [1, 2, 3, 4, 5].map((d) => {
      const c = cellOf(l, d);
      if (!c) return el('td', { class: 'muted', text: '—' });
      return el('td', {}, el('button', { class: 'bank-cell', type: 'button', onclick: () => showCell(c), 'aria-label': l + ' dificultad ' + d + ': ' + c.published + ' de ' + c.target },
        el('b', { text: nn(c.published) }), el('span', { class: 'small muted', text: ' / ' + nn(c.target) }), pctBar(c),
        el('span', { class: 'small', text: c.percent + ' % · ' + nn(c.pending) + ' pend. · ' + (CELL_STATUS[c.status] || c.status) })));
    })));
    main.replaceChildren(
      el('div', { class: 'adm-head' }, el('h1', { text: 'Banco de crípticos' }),
        el('p', { class: 'muted small', text: 'Meta independiente por idioma y dificultad. Solo cuentan los publicados: validados, sin dudas y con derechos habilitados. Generador ' + (m.generator || '—') + '.' }),
        el('div', { class: 'toolbar' }, can('export.data') ? el('a', { class: 'btn', href: '/api/admin/export/bank.csv?' + params, text: 'Exportar matriz CSV' }) : '',
          can('bank.audit') ? el('a', { class: 'btn', href: '#bankaudit', text: 'Auditar muestra (' + nn(m.audits.pending) + ' pendientes)' }) : '')),
      el('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); go(); } }, Object.values(fl), el('button', { class: 'btn', type: 'submit', text: 'Filtrar' }),
        filtered ? el('a', { class: 'btn', href: '#bank', text: 'Quitar filtros' }) : ''),
      el('div', { class: 'cards' },
        kpi('Meta total', t.target), kpi('Publicados', t.published), kpi('Avance real', t.percent, { fmt: (v) => v + ' %' }), kpi('Faltan', t.missing),
        kpi('Pendientes de revisión', t.pending), kpi('Duplicados descartados', t.duplicates), kpi('Rechazados', t.rejected), kpi('Permiso sin verificar', t.unverified)),
      el('p', { class: 'small muted', text: 'Publicados originales y generados: ' + nn(t.published_original) + ' · externos con licencia o permiso: ' + nn(t.published_external) + ' · de la comunidad (aprobados a mano): ' + nn(t.published_community) + '.' }),
      el('div', { class: 'tbl-wrap' }, el('table', { class: 'bank-matrix' }, el('thead', {}, head), el('tbody', {}, rows))),
      detail);
  };

  V.bankaudit = async () => {
    const d = await api('/api/admin/bank/audits?limit=20');
    const card = (x) => {
      const reason = el('input', { placeholder: 'Motivo (si se rechaza)', 'aria-label': 'Motivo del rechazo' });
      const send = (verdict) => act(async () => {
        const r = await api('/api/admin/bank/audits/' + x.audit_id, { method: 'POST', body: { verdict, reason: reason.value || null } });
        if (r.suspended) return { ok: false, flash: 'La muestra de ese lote superó el máximo de rechazos: el lote se retiró de las partidas.' };
      }, verdict === 'ok' ? 'Marcado como correcto.' : 'Rechazado y retirado de las partidas.');
      return el('div', { class: 'panel' },
        el('p', {}, el('strong', { text: x.clue_text })),
        el('p', {}, 'Respuesta: ', el('strong', { text: x.answer }), ' · ', x.language_code + (x.variant_code ? ' (' + x.variant_code + ')' : ''), ' · ', DIFF[x.difficulty], ' · ', x.mechanism),
        el('ol', {}, x.explanation.map((s) => el('li', { text: s }))),
        x.evidence.length ? el('p', { class: 'small muted', text: 'Evidencia léxica: ' + x.evidence.map((e) => e.word + ' → ' + e.def + ' (' + (e.kind === 'hyp' ? 'hiperónimo' : 'sinónimo') + ')').join(' · ') }) : '',
        el('div', { class: 'toolbar' }, btn('Correcto', send('ok'), 'primary'), reason, btn('Rechazar', send('rejected')), el('a', { class: 'btn', href: '#clue/' + x.id, text: 'Abrir / corregir' })));
    };
    main.replaceChildren(el('h1', { text: 'Auditoría por muestra' }),
      el('p', { class: 'muted', text: 'Cada lote publicado separa una muestra al azar para revisión humana. Rechazar un críptico lo retira de las partidas; si se rechaza más del máximo configurado en la muestra de un lote, el lote completo vuelve a revisión.' }),
      ...(d.items.length ? d.items.map(card) : [el('p', { class: 'muted', text: 'No hay crípticos pendientes de auditoría.' })]));
  };

  V.catalog = () => catalogList(null, 'Crípticos');
  V.generated = () => catalogList({ origin: 'generated', status: 'review' }, 'Generados en revisión');

  function clueForm(c, onSave, saveLabel) {
    const f = {
      clue_text: el('input', { value: c.clue_text || '', required: true }), answer: el('input', { value: c.answer || '', required: true }),
      definition: el('input', { value: c.definition || '' }), language_code: el('select', {}, ['es', 'en'].map((l) => el('option', { value: l, selected: c.language_code === l, text: l }))),
      variant_code: el('input', { value: c.variant_code || '', placeholder: 'vacío = general; es-AR, en-GB…' }), category: el('input', { value: c.category || 'general' }),
      difficulty: el('input', { type: 'number', min: '1', max: '5', value: c.difficulty || 2 }), mechanism: el('input', { value: c.mechanism || '', placeholder: 'anagram, hidden…' }),
      note: el('input', { value: c.note || '' }), proper_noun: el('input', { type: 'checkbox' }),
      wordplay: el('textarea', { class: 'code' }), explanation_text: el('textarea', { placeholder: 'Solo si no hay desglose: una línea por paso' }),
    };
    f.proper_noun.checked = !!c.proper_noun;
    f.wordplay.value = c.wordplay ? JSON.stringify(c.wordplay, null, 2) : '';
    const out = el('div', { id: 'validation-out' });
    const read = () => {
      let wordplay = null;
      if (f.wordplay.value.trim()) { try { wordplay = JSON.parse(f.wordplay.value); } catch (e) { throw new Error('El desglose no es JSON válido.'); } }
      return { clue_text: f.clue_text.value, answer: f.answer.value, definition: f.definition.value || null, language_code: f.language_code.value,
        variant_code: f.variant_code.value || null, category: f.category.value, difficulty: Number(f.difficulty.value), mechanism: f.mechanism.value || null,
        note: f.note.value || null, proper_noun: f.proper_noun.checked, wordplay, explanation_text: f.explanation_text.value || undefined };
    };
    const preview = async () => {
      try {
        const r = await api('/api/admin/clues/validate', { method: 'POST', body: read() });
        out.replaceChildren(el('p', {}, 'Resultado: ', pill(r.report.status), ' · enumeración ', r.enumeration), checksList(r.report.checks),
          r.explanation.length ? el('ol', {}, r.explanation.map((x) => el('li', { text: x }))) : '');
      } catch (e) { out.replaceChildren(el('p', { class: 'field-error', text: e.message })); }
    };
    const lab = (t, i) => el('label', {}, t, i);
    return el('form', { class: 'form', onsubmit: async (e) => { e.preventDefault(); try { await onSave(read()); } catch (x) { flash(x.message, false); } } },
      lab('Pista (con enumeración)', f.clue_text), el('div', { class: 'row' }, lab('Respuesta', f.answer), lab('Definición', f.definition)),
      el('div', { class: 'row' }, lab('Idioma', f.language_code), lab('Variante', f.variant_code), lab('Categoría', f.category), lab('Dificultad', f.difficulty), lab('Mecanismo', f.mechanism)),
      lab('Nota editorial', f.note), el('label', { class: 'check' }, f.proper_noun, 'Nombre propio'),
      lab('Desglose del juego de palabras (JSON, ver docs/CRIPTICOS.md)', f.wordplay), lab('Explicación manual', f.explanation_text),
      el('div', { class: 'toolbar' }, btn('Validar', preview), el('button', { class: 'btn primary', type: 'submit', text: saveLabel })), out);
  }

  V.new = async () => {
    main.replaceChildren(el('h1', { text: 'Nuevo críptico original' }), el('p', { class: 'muted', text: 'Se guarda como borrador. Para publicarlo debe pasar la validación.' }),
      clueForm({ language_code: 'es', difficulty: 2 }, async (data) => {
        const r = await api('/api/admin/clues', { method: 'POST', body: data });
        location.hash = '#clue/' + r.id;
      }, 'Guardar borrador'));
  };

  V.clue = async (id) => {
    const d = await api('/api/admin/clues/' + id);
    const c = d.clue;
    const status = (s) => act(() => api('/api/admin/clues/' + id + '/status', { method: 'POST', body: { status: s } }), 'Estado actualizado.');
    main.replaceChildren(el('p', {}, el('a', { href: '#catalog', text: '← Catálogo' })),
      el('h1', { class: 'clue-text', text: c.clue_text }),
      el('p', {}, pill(c.status), ' ', pill(c.validation_status), ' ', pill(c.origin), ' · ', el('a', { href: '/' + (c.language_code === 'en' ? 'en' : 'es') + '/c/' + c.slug, target: '_blank', text: 'ver página' })),
      el('div', { class: 'toolbar' }, can('catalog.write') ? [c.status !== 'published' ? btn('Publicar', status('published'), 'primary') : '', c.status !== 'disabled' ? btn('Desactivar', status('disabled')) : '', c.status !== 'review' ? btn('Enviar a revisión', status('review')) : ''] : '',
        can('catalog.delete') ? btn('Eliminar', async () => { if (!confirm('¿Eliminar definitivamente este críptico?')) return; try { await api('/api/admin/clues/' + id, { method: 'DELETE', body: {} }); location.hash = '#catalog'; } catch (e) { flash(e.message); } }) : ''),
      el('div', { class: 'cols' },
        el('div', { class: 'panel' }, el('h3', { text: 'Validación' }), checksList(c.validation.checks), c.validation.assertions && c.validation.assertions.length ? el('p', { class: 'small muted', text: 'Afirmaciones a criterio humano: ' + c.validation.assertions.join('; ') }) : ''),
        el('div', { class: 'panel' }, el('h3', { text: 'Explicación pública' }), el('p', { text: 'Respuesta: ' + c.answer }), el('ol', {}, c.explanation.map((x) => el('li', { text: x })))),
        el('div', { class: 'panel' }, el('h3', { text: 'Procedencia' }), el('p', { text: 'Origen: ' + LABELS[c.origin] }), d.source ? el('p', {}, 'Fuente: ', el('a', { href: c.source_url || d.source.url, text: d.source.name })) : '',
          el('p', { text: 'Licencia: ' + (c.license_id || '—') }), el('p', { text: 'Atribución: ' + (c.attribution || c.author_name || '—') }), el('p', { text: 'Importado: ' + fmt(c.imported_at) + ' · Publicado: ' + fmt(c.published_at) }),
          el('p', { text: 'Partidas: ' + (d.stats.played || 0) + ' · resueltas: ' + (d.stats.solved || 0) }))),
      d.reports.length ? el('div', { class: 'panel' }, el('h3', { text: 'Errores informados' }), table(['Motivo', 'Mensaje', 'Estado'], d.reports.map((r) => el('tr', {}, el('td', { text: r.reason }), el('td', { text: r.message || '' }), el('td', { text: r.status }))))) : '',
      d.duplicates.length ? el('div', { class: 'panel' }, el('h3', { text: 'Posibles duplicados' }), table(['Tipo', 'Similitud', 'Críptico'], d.duplicates.map((x) => el('tr', {}, el('td', { text: x.kind }), el('td', { text: x.similarity }), el('td', {}, el('a', { href: '#clue/' + (x.clue_id === c.id ? x.subject_id : x.clue_id), text: 'abrir' })))))) : '',
      can('catalog.write') ? el('div', { class: 'panel' }, el('h3', { text: 'Editar' }), clueForm(c, async (data) => {
        const r = await api('/api/admin/clues/' + id, { method: 'PATCH', body: data });
        flash(r.report.errors ? 'Guardado con errores: el críptico no puede publicarse hasta corregirlos.' : 'Guardado.', !r.report.errors); V.clue(id);
      }, 'Guardar cambios')) : '',
      el('div', { class: 'panel' }, el('h3', { text: 'Historial' }), table(['Fecha', 'Acción', 'De', 'A', 'Quién'], d.events.map((e) => el('tr', {}, el('td', { text: fmt(e.created_at) }), el('td', { text: e.action }), el('td', { text: e.from_status || '' }), el('td', { text: e.to_status || '' }), el('td', { text: e.actor_kind })))))
    );
  };

  // ── Propuestas de usuarios ──
  V.submissions = async () => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const status = q.get('status') || 'pending';
    const d = await api('/api/admin/submissions?status=' + status);
    const count = (s) => ((d.counts.find((c) => c.status === s) || {}).n || 0);
    const tabs = ['pending', 'in_review', 'needs_changes', 'approved', 'published', 'rejected'];
    main.replaceChildren(el('h1', { text: 'Propuestas de usuarios' }),
      el('p', { class: 'muted', text: 'Circuito manual: ninguna propuesta se publica sin la aprobación expresa de una persona con rol de moderación.' }),
      el('div', { class: 'tabs' }, tabs.map((s) => el('a', { href: '#submissions?status=' + s, class: s === status ? 'active' : '', text: LABELS[s] + ' (' + count(s) + ')' }))),
      d.items.length ? table(['Pista', 'Respuesta', 'Idioma', 'Autor', 'Controles', 'Recibida'], d.items.map((s) => el('tr', {},
        el('td', {}, el('a', { href: '#submission/' + s.id, text: s.clue_text })), el('td', { text: s.answer }), el('td', { text: s.language_code + (s.variant_code ? ' · ' + s.variant_code : '') }),
        el('td', { text: s.public_name || s.author_username || 'anónimo' }), el('td', { text: s.errors + ' errores · ' + s.warnings + ' avisos' }), el('td', { text: fmt(s.created_at) })))) : el('p', { class: 'empty', text: 'No hay propuestas en este estado.' }));
  };

  V.submission = async (id) => {
    const d = await api('/api/admin/submissions/' + id);
    const s = d.submission;
    const note = el('textarea', { placeholder: 'Comentario para el autor (obligatorio al pedir correcciones)' });
    note.value = s.moderator_note || '';
    const def = el('input', { value: s.definition || '' });
    const wp = el('textarea', { class: 'code', placeholder: 'Opcional: desglose JSON para que el validador compruebe la mecánica' });
    wp.value = s.wordplay ? JSON.stringify(s.wordplay, null, 2) : '';
    const variant = el('input', { value: s.variant_code || '', placeholder: 'vacío = general' });
    const doAct = (action) => async () => {
      let wordplay = null;
      if (wp.value.trim()) { try { wordplay = JSON.parse(wp.value); } catch (e) { return flash('El desglose no es JSON válido.'); } }
      try {
        const r = await api('/api/admin/submissions/' + id + '/moderate', { method: 'POST', body: { action, note: note.value || null, definition: def.value || null, wordplay, edits: { variant_code: variant.value || null } } });
        if (r.blocked) flash('Aprobada, pero NO publicada: hay errores críticos que deben corregirse (' + r.blocked.map((b) => b.msg).join(' ') + ')', false);
        else flash('Estado: ' + (LABELS[r.status] || r.status), true);
        V.submission(id);
      } catch (e) { flash(e.message); }
    };
    const editable = !['published', 'rejected'].includes(s.status);
    main.replaceChildren(el('p', {}, el('a', { href: '#submissions?status=' + s.status, text: '← Propuestas' })),
      el('h1', { class: 'clue-text', text: s.clue_text }), el('p', {}, pill(s.status)),
      el('div', { class: 'cols' },
        el('div', { class: 'panel' }, el('h3', { text: 'Contenido' }), el('p', { text: 'Respuesta: ' + s.answer + ' (' + s.enumeration + ')' }), el('p', { text: 'Explicación del autor: ' + s.explanation }),
          el('p', { text: 'Idioma: ' + s.language_code + ' · variante: ' + (s.variant_code || 'general') + ' · categoría: ' + s.category + ' · dificultad: ' + s.difficulty + ' · mecanismo: ' + (s.mechanism || '—') }),
          el('p', { text: 'Referencia: ' + (s.reference || '—') })),
        el('div', { class: 'panel' }, el('h3', { text: 'Autor' }), el('p', { text: 'Nombre público: ' + (s.public_name || '—') }), el('p', { text: 'Cuenta: ' + (s.author_username || 'sin cuenta') + (s.author_email ? ' · ' + s.author_email : '') }),
          el('p', { text: 'Derechos confirmados: ' + (s.rights_confirmed ? 'sí' : 'no') + ' · condiciones aceptadas: ' + (s.terms_accepted ? 'sí' : 'no') })),
        el('div', { class: 'panel' }, el('h3', { text: 'Controles automáticos' }), checksList(s.checks), el('p', { class: 'small muted', text: 'Los controles no reemplazan tu revisión.' }))),
      editable && can('submissions.moderate') ? el('div', { class: 'panel form' }, el('h3', { text: 'Decisión' }),
        el('label', {}, 'Definición (parte de la pista)', def), el('label', {}, 'Variante', variant), el('label', {}, 'Desglose', wp), el('label', {}, 'Comentario', note),
        el('div', { class: 'toolbar' }, s.status === 'pending' ? btn('Marcar en revisión', doAct('review')) : '', btn('Aprobar y publicar', doAct('approve'), 'primary'), btn('Pedir correcciones', doAct('request_changes'), 'accent'), btn('Rechazar', doAct('reject')))) : '',
      el('div', { class: 'panel' }, el('h3', { text: 'Historial de decisiones' }), table(['Fecha', 'De', 'A', 'Quién', 'Nota'], d.events.map((e) => el('tr', {}, el('td', { text: fmt(e.created_at) }), el('td', { text: e.from_status ? LABELS[e.from_status] : '' }), el('td', { text: LABELS[e.to_status] }), el('td', { text: e.actor || 'sistema' }), el('td', { text: e.note || '' }))))));
  };

  // ── Importaciones externas ──
  V.sources = async () => {
    const [d, lic] = await Promise.all([api('/api/admin/sources'), api('/api/admin/licenses')]);
    const rows = d.items.map((s) => el('tr', {},
      el('td', {}, el('a', { href: '#source/' + s.id, text: s.name }), el('br'), el('span', { class: 'small muted', text: s.url })),
      el('td', { text: s.language_code + (s.variant_code ? ' · ' + s.variant_code : '') + (s.country_code ? ' · ' + s.country_code : '') }),
      el('td', { text: s.access_method + (s.access_authorized ? ' ✓' : ' (sin autorizar)') }),
      el('td', { text: (s.license_name || '—') + (s.republish_allowed && s.allows_republish ? ' · republicable' : ' · solo referencia') }),
      el('td', {}, pill(s.status), s.last_error ? el('div', { class: 'small field-error', text: s.last_error }) : ''),
      el('td', { text: fmt(s.last_checked_at) + ' · ' + s.items_imported + ' elementos' }),
      el('td', {}, can('sources.write') ? [
        s.status === 'pending_review' ? btn('Aprobar', act(() => api('/api/admin/sources/' + s.id + '/approve', { method: 'POST', body: {} }), 'Fuente aprobada y activada.'), 'primary') : '',
        s.status === 'active' ? btn('Pausar', act(() => api('/api/admin/sources/' + s.id + '/pause', { method: 'POST', body: {} }))) : '',
        ['paused', 'error'].includes(s.status) ? btn('Reanudar', act(() => api('/api/admin/sources/' + s.id + '/resume', { method: 'POST', body: {} }))) : '',
        s.status !== 'disabled' ? btn('Desactivar', act(() => api('/api/admin/sources/' + s.id + '/disable', { method: 'POST', body: {} }))) : '',
        s.access_method !== 'manual_upload' && ['active', 'error'].includes(s.status) ? btn('Sincronizar', act(async () => { const r = await api('/api/admin/sources/' + s.id + '/run', { method: 'POST', body: {} }); flash('Sincronización: ' + r.status + (r.error ? ' — ' + r.error : ` · ${r.published} publicados, ${r.queued} a revisión, ${r.duplicates} duplicados, ${r.discarded} descartados`), r.status !== 'failed'); })) : '',
      ] : '')));
    main.replaceChildren(el('h1', { text: 'Fuentes externas' }),
      el('p', { class: 'muted', text: 'Circuito automático: los elementos de fuentes aprobadas, con licencia que permita republicar y que superan todos los controles, se publican solos. Si falla una condición, van a la cola de revisión.' }),
      can('sources.write') ? el('p', {}, el('a', { class: 'btn primary', href: '#source/new', text: 'Agregar fuente' })) : '',
      d.items.length ? table(['Fuente', 'Idioma', 'Acceso', 'Licencia', 'Estado', 'Última comprobación', ''], rows) : el('p', { class: 'empty', text: 'Todavía no hay fuentes. Agregá solo fuentes con API, feed, datos abiertos o permiso expreso.' }),
      el('details', { class: 'panel' }, el('summary', { text: 'Licencias disponibles' }), table(['Id', 'Nombre', 'Republicación', 'Atribución'], lic.items.map((l) => el('tr', {}, el('td', { text: l.id }), el('td', { text: l.name }), el('td', { text: l.allows_republish ? 'sí' : 'no' }), el('td', { text: l.requires_attribution ? 'obligatoria' : 'no' }))))));
  };

  V.source = async (id) => {
    const [lic, all] = await Promise.all([api('/api/admin/licenses'), api('/api/admin/sources')]);
    const s = id === 'new' ? { language_code: 'es', access_method: 'json_feed', content_type: 'clues', frequency_minutes: 1440, attribution_required: 1 } : all.items.find((x) => x.id === id);
    if (!s) return main.replaceChildren(el('p', { text: 'No encontrada.' }));
    const inp = (name, attrs) => el('input', Object.assign({ name, value: s[name] ?? '' }, attrs || {}));
    const chk = (name) => { const c = el('input', { type: 'checkbox', name }); c.checked = !!s[name]; return c; };
    const sel = (name, opts) => el('select', { name }, opts.map(([v, l]) => el('option', { value: v, selected: String(s[name] ?? '') === String(v), text: l })));
    const f = el('form', { class: 'form' },
      el('label', {}, 'Nombre', inp('name', { required: true })), el('label', {}, 'URL (feed, API o página de la fuente)', inp('url', { required: true, type: 'url' })),
      el('div', { class: 'row' }, el('label', {}, 'País (ISO)', inp('country_code', { maxlength: '2' })), el('label', {}, 'Idioma', sel('language_code', [['es', 'es'], ['en', 'en'], ['fr', 'fr'], ['pt', 'pt'], ['it', 'it'], ['de', 'de']])),
        el('label', {}, 'Variante', inp('variant_code', { placeholder: 'opcional' })), el('label', {}, 'Frecuencia (minutos)', inp('frequency_minutes', { type: 'number', min: '15' }))),
      el('div', { class: 'row' }, el('label', {}, 'Tipo de contenido', sel('content_type', [['clues', 'Crípticos (republicables)'], ['metadata_only', 'Solo referencias/metadatos']])),
        el('label', {}, 'Método de acceso', sel('access_method', [['json_feed', 'Feed JSON'], ['rss', 'RSS'], ['csv', 'CSV / datos abiertos'], ['api', 'API oficial'], ['manual_upload', 'Carga manual']])),
        el('label', {}, 'Licencia', sel('license_id', [['', '—'], ...lic.items.map((l) => [l.id, l.name])])), el('label', {}, 'Credencial (nombre de variable de entorno)', inp('auth_env_var', { placeholder: 'SOURCE_X_TOKEN' }))),
      el('label', {}, 'Condiciones de reutilización', el('textarea', { name: 'reuse_terms' }, s.reuse_terms || '')),
      el('label', {}, 'Texto de atribución', inp('attribution_text')),
      el('label', { class: 'check' }, chk('access_authorized'), 'El proveedor autoriza este método de acceso (API, feed o permiso escrito).'),
      el('label', { class: 'check' }, chk('republish_allowed'), 'Tenemos licencia o permiso para republicar pistas y respuestas.'),
      el('label', { class: 'check' }, chk('attribution_required'), 'Requiere atribución.'),
      el('p', { class: 'small muted', text: 'Cambiar URL, licencia, permisos o método vuelve a dejar la fuente pendiente de revisión.' }),
      el('button', { class: 'btn primary', type: 'submit', text: id === 'new' ? 'Crear fuente (queda pendiente de revisión)' : 'Guardar' }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(f); const body = Object.fromEntries(fd.entries());
      for (const k of ['access_authorized', 'republish_allowed', 'attribution_required']) body[k] = f[k].checked;
      for (const k of ['country_code', 'variant_code', 'license_id', 'auth_env_var']) if (!body[k]) body[k] = null;
      if (body.country_code) body.country_code = body.country_code.toUpperCase();
      body.frequency_minutes = Number(body.frequency_minutes);
      try {
        if (id === 'new') { const r = await api('/api/admin/sources', { method: 'POST', body }); location.hash = '#source/' + r.id; flash('Fuente creada. Revisala y aprobala para activarla.', true); }
        else { const r = await api('/api/admin/sources/' + id, { method: 'PATCH', body }); flash(r.reapproval_required ? 'Guardado. La fuente necesita una nueva aprobación.' : 'Guardado.', true); }
      } catch (x) { flash(x.message); }
    });
    const upload = s.access_method === 'manual_upload' && id !== 'new' ? (() => {
      const fmtSel = el('select', {}, ['json_feed', 'csv', 'rss'].map((v) => el('option', { value: v, text: v })));
      const content = el('textarea', { class: 'code', placeholder: 'Pegá aquí el contenido del archivo' });
      const file = el('input', { type: 'file', accept: '.json,.csv,.xml,.rss,.txt' });
      file.addEventListener('change', async () => { if (file.files[0]) content.value = await file.files[0].text(); });
      return el('div', { class: 'panel form' }, el('h3', { text: 'Carga manual' }), el('label', {}, 'Formato', fmtSel), file, content,
        btn('Importar', async () => { try { const r = await api('/api/admin/sources/' + id + '/upload', { method: 'POST', body: { format: fmtSel.value, content: content.value } }); flash(`Importación ${r.status}: ${r.published || 0} publicados, ${r.queued || 0} a revisión, ${r.duplicates || 0} duplicados, ${r.discarded || 0} descartados${r.error ? ' — ' + r.error : ''}`, r.status !== 'failed'); } catch (e) { flash(e.message); } }, 'primary'));
    })() : '';
    main.replaceChildren(el('p', {}, el('a', { href: '#sources', text: '← Fuentes' })), el('h1', { text: id === 'new' ? 'Nueva fuente' : s.name }), id !== 'new' ? el('p', {}, pill(s.status)) : '', f, upload);
  };

  V.imports = async () => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const status = q.get('status') || 'review';
    const d = await api('/api/admin/imports/items?status=' + status);
    const count = (s) => ((d.counts.find((c) => c.status === s) || {}).n || 0);
    const tabs = ['review', 'auto_published', 'published', 'duplicate', 'discarded', 'error'];
    main.replaceChildren(el('h1', { text: 'Elementos importados' }),
      el('div', { class: 'tabs' }, tabs.map((s) => el('a', { href: '#imports?status=' + s, class: s === status ? 'active' : '', text: LABELS[s] + ' (' + count(s) + ')' }))),
      d.items.length ? table(['Elemento', 'Fuente', 'Controles', 'Importado', ''], d.items.map((i) => el('tr', {},
        el('td', {}, el('strong', { text: i.payload.clue || '(sin contenido: solo referencia)' }), el('br'), el('span', { class: 'small', text: i.payload.answer ? 'Respuesta: ' + i.payload.answer : '' }), i.source_url ? el('div', {}, el('a', { href: i.source_url, rel: 'noopener', target: '_blank', class: 'small', text: i.source_url })) : ''),
        el('td', { text: i.source_name }),
        el('td', {}, el('details', {}, el('summary', { text: i.checks.filter((c) => c.level === 'error').length + ' fallos' }), checksList(i.checks))),
        el('td', { text: fmt(i.imported_at) }),
        el('td', {}, i.status === 'review' && can('imports.review') ? [btn('Publicar', act(() => api('/api/admin/imports/items/' + i.id + '/publish', { method: 'POST', body: {} }), 'Publicado.'), 'primary'), btn('Descartar', act(() => api('/api/admin/imports/items/' + i.id + '/discard', { method: 'POST', body: {} })))] : i.clue_id ? el('a', { href: '#clue/' + i.clue_id, text: 'ver críptico' }) : '')))) : el('p', { class: 'empty', text: 'Nada en este estado.' }));
  };

  V.runs = async () => {
    const d = await api('/api/admin/imports/runs');
    main.replaceChildren(el('h1', { text: 'Historial de sincronizaciones' }), table(['Fuente', 'Inicio', 'Estado', 'Recibidos', 'Publicados', 'A revisión', 'Duplicados', 'Descartados', 'Error'],
      d.items.map((r) => el('tr', {}, el('td', { text: r.source_name }), el('td', { text: fmt(r.started_at) }), el('td', {}, pill(r.status)), el('td', { text: r.fetched }), el('td', { text: r.published }), el('td', { text: r.queued }), el('td', { text: r.duplicates }), el('td', { text: r.discarded }), el('td', { text: r.error || '' })))));
  };

  V.reports = async () => {
    const d = await api('/api/admin/reports');
    main.replaceChildren(el('h1', { text: 'Errores informados por jugadores' }), d.items.length ? table(['Críptico', 'Motivo', 'Mensaje', 'Fecha', ''], d.items.map((r) => el('tr', {},
      el('td', {}, el('a', { href: '#clue/' + r.clue_id, text: r.clue_text })), el('td', { text: r.reason }), el('td', { text: r.message || '' }), el('td', { text: fmt(r.created_at) }),
      el('td', {}, btn('Resuelto', act(() => api('/api/admin/reports/' + r.id, { method: 'POST', body: { status: 'resolved' } }))), btn('Descartar', act(() => api('/api/admin/reports/' + r.id, { method: 'POST', body: { status: 'dismissed' } }))))))) : el('p', { class: 'empty', text: 'Sin reportes abiertos.' }));
  };

  V.duplicates = async () => {
    const d = await api('/api/admin/duplicates');
    main.replaceChildren(el('h1', { text: 'Posibles duplicados' }), d.items.length ? table(['Tipo', 'Similitud', 'Elemento', 'Existente', ''], d.items.map((x) => el('tr', {},
      el('td', { text: x.kind }), el('td', { text: x.similarity }), el('td', { text: x.subject_kind + ' ' + x.subject_id.slice(0, 8) }),
      el('td', {}, el('a', { href: '#clue/' + x.clue_id, text: x.existing_clue + ' → ' + x.existing_answer })), el('td', {}, btn('Marcar revisado', act(() => api('/api/admin/duplicates/' + x.id + '/resolve', { method: 'POST', body: {} }))))))) : el('p', { class: 'empty', text: 'Sin duplicados pendientes.' }));
  };

  // ── Configuración ──
  V.languages = async () => {
    const d = await api('/api/admin/languages');
    const w = can('languages.write');
    main.replaceChildren(el('h1', { text: 'Idiomas y variantes' }),
      el('p', { class: 'muted', text: 'Activá un idioma solo cuando tenga crípticos originales validados. No se muestran traducciones como si fueran crípticos.' }),
      table(['Idioma', 'Crípticos', 'Estado', ''], d.languages.map((l) => el('tr', {}, el('td', { text: l.name_native + ' (' + l.code + ')' }), el('td', { text: l.clues }), el('td', { text: l.enabled ? 'activo' : 'inactivo' }),
        el('td', {}, w ? btn(l.enabled ? 'Desactivar' : 'Activar', act(() => api('/api/admin/languages/' + l.code, { method: 'PATCH', body: { enabled: !l.enabled } }))) : '')))),
      el('h2', { text: 'Variantes' }),
      table(['Variante', 'Crípticos propios', 'Mínimo sin aviso', 'Estado', ''], d.variants.map((v) => {
        const min = el('input', { type: 'number', min: '0', value: v.min_clues, style: 'width:80px' });
        return el('tr', {}, el('td', { text: v.name_native + ' (' + v.code + ')' }), el('td', { text: v.clues }), el('td', {}, min), el('td', { text: v.enabled ? 'activa' : 'inactiva' }),
          el('td', {}, w ? [btn('Guardar', act(() => api('/api/admin/variants/' + v.code, { method: 'PATCH', body: { min_clues: Number(min.value) } }), 'Guardado.')), btn(v.enabled ? 'Desactivar' : 'Activar', act(() => api('/api/admin/variants/' + v.code, { method: 'PATCH', body: { enabled: !v.enabled } })))] : ''));
      })));
  };

  const SETTING_HELP = {
    'governance.dual_approval': 'Si está activo, lo extraordinario (gastos sobre el umbral, contratos, seguridad, permisos de un CEO) necesita a los dos CEO. Desactivado: alcanza con uno.',
    'game.max_hints': 'Pistas progresivas por críptico (máx. 4 tipos).', 'game.timed_seconds': 'Segundos del modo contrarreloj.', 'game.recent_window': 'Cuántas partidas recientes se consideran para no repetir.',
    'modes.enabled': 'Modos activos.', 'difficulty.labels': 'Nombres de las dificultades.', 'antispam.submissions_per_day': 'Propuestas por persona o IP por día.',
    'antispam.reports_per_hour': 'Reportes por IP por hora.', 'antispam.min_form_seconds': 'Tiempo mínimo para completar el formulario.',
    'publishing.external_autopublish': 'Publicar automáticamente externos que superen todos los controles.',
    'publishing.external_allow_asserted': 'Permitir publicar solos externos con afirmaciones semánticas no comprobables (sinónimos, dobles definiciones).',
    'publishing.generated_autopublish': 'Publicar sin revisión los crípticos del generador (no recomendado).',
    'publishing.semantic_duplicate_threshold': 'Umbral de similitud para marcar posibles duplicados (0–1).',
    'retention.games_days': 'Días que se conservan las partidas.', 'retention.audit_days': 'Días que se conserva la auditoría.',
  };
  const ALL_MODES = ['quick', 'infinite', 'daily', 'archive', 'beginner', 'intermediate', 'expert', 'guided', 'timed', 'themed', 'practice', 'streak', 'shared'];

  V.settings = async () => {
    const [d, cats] = await Promise.all([api('/api/admin/settings'), api('/api/admin/categories')]);
    const w = can('settings.write');
    const rows = Object.entries(d.settings).map(([k, v]) => {
      let input; let read;
      if (k === 'modes.enabled') {
        const boxes = ALL_MODES.map((m) => { const c = el('input', { type: 'checkbox', value: m }); c.checked = v.includes(m); return el('label', { class: 'check' }, c, m); });
        input = el('div', { class: 'toolbar' }, boxes); read = () => boxes.map((b) => b.firstChild).filter((c) => c.checked).map((c) => c.value);
      } else if (typeof v === 'boolean') { const c = el('input', { type: 'checkbox' }); c.checked = v; input = c; read = () => c.checked; }
      else if (typeof v === 'number') { const c = el('input', { type: 'number', step: 'any', value: v }); input = c; read = () => Number(c.value); }
      else { const c = el('textarea', { class: 'code' }); c.value = JSON.stringify(v, null, 2); input = c; read = () => JSON.parse(c.value); }
      return el('tr', {}, el('td', {}, el('strong', { text: k }), el('div', { class: 'small muted', text: SETTING_HELP[k] || '' })), el('td', {}, input),
        el('td', {}, w ? btn('Guardar', act(async () => viaApproval(await api('/api/admin/settings/' + encodeURIComponent(k), { method: 'PUT', body: { value: read() } }), 'Guardado.'))) : ''));
    });
    const slug = el('input', { placeholder: 'slug' }); const es = el('input', { placeholder: 'Nombre (es)' }); const en = el('input', { placeholder: 'Name (en)' });
    main.replaceChildren(el('h1', { text: 'Reglas y funciones' }), table(['Opción', 'Valor', ''], rows),
      el('h2', { text: 'Categorías' }), table(['Slug', 'Español', 'English', 'Activa'], cats.items.map((c) => el('tr', {}, el('td', { text: c.slug }), el('td', { text: c.name_es }), el('td', { text: c.name_en }),
        el('td', {}, w ? btn(c.enabled ? 'Desactivar' : 'Activar', act(() => api('/api/admin/categories', { method: 'POST', body: { ...c, enabled: !c.enabled } }))) : (c.enabled ? 'sí' : 'no'))))),
      w ? el('div', { class: 'toolbar' }, slug, es, en, btn('Agregar categoría', act(() => api('/api/admin/categories', { method: 'POST', body: { slug: slug.value, name_es: es.value, name_en: en.value } }), 'Categoría guardada.'))) : '');
  };

  // Respuesta 202: el cambio quedó en la bandeja de aprobaciones de los CEO.
  const viaApproval = (r, okMsg) => (r && r.approval_required
    ? { flash: 'Este cambio pasa por la bandeja: quedó en «Aprobaciones» para que lo apruebe un CEO.', ok: true } : { flash: okMsg, ok: true });

  V.users = async () => {
    const [d, tk] = await Promise.all([api('/api/admin/users'), api('/api/admin/team/tokens')]);
    const u = el('input', { placeholder: 'usuario' }); const p = el('input', { type: 'password', placeholder: 'contraseña (10+)', autocomplete: 'new-password' });
    const ROLES = (meta && meta.roles) || { moderator: 'Moderador', analyst: 'Analista de estadísticas', editor: 'Administrador de contenido', owner: 'Superadministrador (CEO)' };
    const r = el('select', { 'aria-label': 'Rol' }, ['moderator', 'analyst', 'editor'].map((x) => el('option', { value: x, text: ROLES[x] || x })));
    const ir = el('select', { 'aria-label': 'Rol de la invitación', id: 'inv-role' }, ['owner', 'editor', 'analyst', 'moderator'].map((x) => el('option', { value: x, text: ROLES[x] || x })));
    const it = el('input', { id: 'inv-title', placeholder: 'Cargo (p. ej. CEO y Súper Administradora)' }); const iname = el('input', { id: 'inv-name', placeholder: 'Nombre visible' });
    const invOut = el('div', { id: 'invite-result' });
    const showLink = (out, path, what) => out.replaceChildren(el('div', { class: 'flash ok' }, el('strong', { text: what + ' ' }),
      'Se muestra una sola vez. Mandala por un canal privado (no por un grupo ni un correo compartido). Vence el ' + fmt(path.expires_at) + '.'), copyBox(location.origin + path.path));
    const rowOut = el('div');
    main.replaceChildren(el('h1', { text: 'Equipo' }), el('p', { class: 'muted', text: d.players + ' jugadores con cuenta.' }),
      el('div', { class: 'panel' }, el('h3', { text: 'Roles' }), el('ul', {}, el('li', { text: (ROLES.owner || 'owner') + ': todo, incluida la configuración, el equipo, los datos personales, la auditoría y las aprobaciones. Los CEO tienen exactamente los mismos permisos; los cambios sobre un CEO y las reglas de seguridad pasan por la bandeja de aprobaciones.' }),
        el('li', { text: (ROLES.editor || 'editor') + ': catálogo, fuentes, importaciones, estadísticas y alertas (sin datos personales).' }),
        el('li', { text: (ROLES.moderator || 'moderator') + ': propuestas de usuarios y reportes.' }),
        el('li', { text: (ROLES.analyst || 'analyst') + ': estadísticas, usuarios y partidas en modo lectura, sin correos ni acciones.' })),
        el('p', { class: 'small muted', text: 'Los permisos se verifican en el servidor en cada operación.' })),
      table(['Usuario', 'Nombre y cargo', 'Rol', 'MFA', 'Estado', 'Último acceso', ''], d.items.map((x) => el('tr', {}, el('td', { text: x.username }),
        el('td', { text: [x.display_name, x.title].filter(Boolean).join(' · ') || '—' }), el('td', { text: ROLES[x.role] || x.role }),
        el('td', {}, x.mfa ? tag('Activa', 'verified') : tag('Sin activar', 'failed')), el('td', { text: x.disabled ? 'desactivado' : 'activo' }), el('td', { text: fmt(x.last_login_at) }),
        el('td', {}, x.id === me.id ? '(vos)' : el('div', { class: 'toolbar' },
          btn(x.disabled ? 'Reactivar' : 'Desactivar', act(async () => viaApproval(await api('/api/admin/users/' + x.id, { method: 'PATCH', body: { disabled: !x.disabled } }), 'Listo.')), 'small'),
          btn('Enlace de recuperación', async () => { try { const o = await api('/api/admin/team/users/' + x.id + '/reset', { method: 'POST', body: {} }); showLink(rowOut, o, 'Enlace de recuperación para ' + x.username + '.'); } catch (e) { flash(e.message, false); } }, 'small'),
          btn('Cerrar sesiones', act(() => api('/api/admin/team/users/' + x.id + '/sessions/revoke', { method: 'POST', body: {} }), 'Sesiones cerradas.'), 'small')))))),
      rowOut,
      el('h2', { text: 'Invitar a alguien' }),
      el('p', { class: 'small muted', text: 'La persona invitada elige su usuario y su contraseña; nadie más la conoce. Es la única forma de sumar a un CEO.' }),
      el('div', { class: 'toolbar' }, ir, iname, it, btn('Generar invitación', async () => {
        try { const o = await api('/api/admin/team/invites', { method: 'POST', body: { role: ir.value, title: it.value, display_name: iname.value } }); showLink(invOut, o, 'Invitación creada.'); } catch (e) { flash(e.message, false); }
      }, 'primary')), invOut,
      el('h2', { text: 'Invitaciones y enlaces de recuperación' }),
      tk.items.length ? table(['Tipo', 'Para', 'Creado por', 'Vence', 'Estado', ''], tk.items.map((t) => {
        const st = t.revoked_at ? 'Revocado' : t.used_at ? 'Usado por ' + (t.used_by || '—') : Date.parse(t.expires_at) < Date.now() ? 'Vencido' : 'Vigente';
        return el('tr', {}, el('td', { text: t.kind === 'invite' ? 'Invitación' : 'Recuperación' }), el('td', { text: t.kind === 'invite' ? [t.display_name, ROLES[t.role] || t.role].filter(Boolean).join(' · ') : (t.for_user || '—') }),
          el('td', { text: t.created_by }), el('td', { text: fmt(t.expires_at) }), el('td', { text: st }),
          el('td', {}, st === 'Vigente' ? btn('Revocar', act(() => api('/api/admin/team/tokens/' + t.id + '/revoke', { method: 'POST', body: {} }), 'Enlace revocado.'), 'small') : ''));
      })) : el('p', { class: 'muted', text: 'Todavía no se generó ningún enlace.' }),
      el('h2', { text: 'Crear cuenta directamente' }), el('p', { class: 'small muted', text: 'Solo para moderación, análisis o contenido. Vos elegís la contraseña inicial.' }),
      el('div', { class: 'toolbar' }, u, p, r, btn('Crear', act(() => api('/api/admin/users', { method: 'POST', body: { username: u.value, password: p.value, role: r.value } }), 'Cuenta creada.'))));
  };

  V.jobs = async () => {
    const [d, e] = await Promise.all([api('/api/admin/jobs'), api('/api/admin/errors')]);
    main.replaceChildren(el('h1', { text: 'Tareas programadas y errores' }),
      table(['Tarea', 'Cada (min)', 'Estado', 'Fallos seguidos', 'Próxima', ''], d.jobs.map((j) => el('tr', {}, el('td', { text: j.name }), el('td', { text: j.interval_minutes }), el('td', {}, j.last_status ? pill(j.last_status) : '—'), el('td', { text: j.consecutive_failures }), el('td', { text: fmt(j.next_run_at) }),
        el('td', {}, can('jobs.run') ? btn('Ejecutar ahora', act(async () => { const r = await api('/api/admin/jobs/' + j.name + '/run', { method: 'POST', body: {} }); flash(j.name + ': ' + (r.status || r.skipped) + (r.error ? ' — ' + r.error : ''), r.status === 'success'); })) : '')))),
      el('h2', { text: 'Últimas ejecuciones' }), table(['Tarea', 'Inicio', 'Estado', 'Salida'], d.runs.map((x) => el('tr', {}, el('td', { text: x.job_name }), el('td', { text: fmt(x.started_at) }), el('td', {}, pill(x.status)), el('td', {}, el('code', { class: 'small', text: (x.output || '').slice(0, 200) }))))),
      el('h2', { text: 'Registro de errores' }), table(['Fecha', 'Ámbito', 'Mensaje'], e.items.map((x) => el('tr', {}, el('td', { text: fmt(x.created_at) }), el('td', { text: x.scope }), el('td', { text: x.message })))));
  };

  V.audit = async () => {
    const d = await api('/api/admin/audit');
    main.replaceChildren(el('h1', { text: 'Registro de auditoría' }), table(['Fecha', 'Quién', 'Acción', 'Objeto', 'Detalles'], d.items.map((x) => el('tr', {}, el('td', { text: fmt(x.created_at) }), el('td', { text: x.username || '—' }), el('td', { text: x.action }), el('td', { text: (x.target_kind || '') + ' ' + (x.target_id || '').slice(0, 12) }), el('td', {}, el('code', { class: 'small', text: (x.details || '').slice(0, 160) }))))));
  };

  // ══════════════ Empresa: centro de operaciones, aprobaciones, seguridad ══════════════
  const AREA = { direction: 'Dirección', tech: 'Tecnología', marketing: 'Marketing', legal: 'Legal', community: 'Comunidad', apps: 'Aplicaciones',
    content: 'Contenido', finance: 'Finanzas', security: 'Seguridad', integration: 'Integraciones' };
  const CAT = { critical: 'Crítica', important: 'Importante', ux: 'Experiencia', growth: 'Crecimiento', tech_debt: 'Deuda técnica', legal: 'Legal',
    integration: 'Integración', human_decision: 'Decisión de los CEO' };
  const TSTATUS = { pending: 'Pendiente', in_progress: 'En progreso', blocked: 'Bloqueada', in_review: 'En revisión', approved: 'Aprobada', done: 'Completada', cancelled: 'Cancelada' };
  const ASTATUS = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado', changes_requested: 'Pide cambios', conflict: 'En conflicto · en pausa', withdrawn: 'Retirado', executed: 'Ejecutado' };
  const PSTATUS = { idea: 'Idea', research: 'En investigación', production: 'En producción', editing: 'En edición', rights_review: 'Revisión de derechos',
    pending_approval: 'Pendiente de aprobación', approved: 'Aprobada', scheduled: 'Programada', published: 'Publicada', paused: 'Pausada', rejected: 'Rechazada',
    changes_requested: 'Requiere cambios', publish_error: 'Error de publicación' };
  const ISTATUS = { verified: 'Verificada', configured_unverified: 'Configurada sin verificar', missing: 'Falta', not_needed: 'No hace falta' };
  const JSTATUS = { not_researched: 'Sin investigar', researching: 'Investigando', draft_findings: 'Hallazgos en borrador', needs_lawyer: 'Requiere abogado', compliant: 'Cumple (con fuente)', gaps: 'Con brechas' };
  const LSTATUS = { draft: 'Borrador', in_review: 'En revisión', lawyer_review: 'Revisión de abogado', approved: 'Aprobado', published: 'Publicado', superseded: 'Reemplazado' };
  const RSEV = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' };
  const tag = (txt, cls) => el('span', { class: 'pill ' + (cls || ''), text: txt });
  const sevTag = (s) => tag(RSEV[s] || s, s === 'critical' || s === 'high' ? 'failed' : s === 'medium' ? 'pending' : '');
  const statusTag = (map, s) => tag(map[s] || s, ['done', 'approved', 'verified', 'executed', 'published', 'compliant'].includes(s) ? 'verified'
    : ['blocked', 'rejected', 'conflict', 'missing', 'publish_error', 'gaps'].includes(s) ? 'failed' : 'pending');
  const field = (label, input) => el('label', {}, label, input);
  const copyBox = (text) => {
    const i = el('input', { value: text, readonly: true, class: 'copy-input', 'aria-label': 'Enlace para copiar' });
    return el('div', { class: 'toolbar' }, i, btn('Copiar', async () => { try { await navigator.clipboard.writeText(text); flash('Copiado.', true); } catch (e) { i.select(); } }));
  };
  const linkify = (s) => (/^https:\/\/\S+$/.test(String(s || '')) ? el('a', { href: s, target: '_blank', rel: 'noopener', text: s }) : (s || '—'));

  // ── Centro de operaciones ──
  V.company = async () => {
    const tab = qs().get('tab') || 'direction';
    const d = await api('/api/admin/company/overview');
    const TABS = [['direction', 'Dirección'], ['agents', 'Agentes'], ['tech', 'Tecnología'], ['marketing', 'Marketing'], ['legal', 'Legal'],
      ['community', 'Comunidad'], ['apps', 'Aplicaciones'], ['integrations', 'Integraciones'], ['risks', 'Riesgos y costos'], ['audit', 'Auditoría']];
    const tabs = el('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, t]) => el('a', { href: '#company?tab=' + k, class: k === tab ? 'active' : '', role: 'tab', 'aria-selected': k === tab ? 'true' : 'false', text: t })));
    const sum = (rows, f) => rows.filter(f).reduce((s, r) => s + r.n, 0);
    const body = [];
    if (tab === 'direction') {
      const D = d.direction;
      const open = sum(D.tasks, (r) => !['done', 'cancelled'].includes(r.status));
      body.push(el('div', { class: 'cards' },
        kpi('Tareas abiertas', open, { href: '#tasks?status=open' }), kpi('Bloqueadas', D.blocked.length, { warn: true, href: '#tasks?status=blocked' }),
        kpi('Atrasadas', D.overdue.length, { warn: true }), kpi('Aprobaciones pendientes', sum(D.approvals, (r) => ['pending', 'changes_requested'].includes(r.status)), { href: '#approvals' }),
        kpi('Conflictos entre CEO', D.conflicts.length, { warn: true, href: '#approvals' }), kpi('Riesgos altos o críticos', D.risks.length, { warn: true, href: '#company?tab=risks' })));
      body.push(el('div', { class: 'panel' }, el('h3', { text: 'Dirección ejecutiva' }),
        d.ceos.length ? table(['CEO', 'Cargo', 'MFA', 'Último acceso'], d.ceos.map((c) => el('tr', {}, el('td', { text: c.display_name || c.username }), el('td', { text: c.title || 'Superadministrador' }),
          el('td', {}, c.mfa ? tag('Activo', 'verified') : tag('Sin MFA', 'failed')), el('td', { text: fmt(c.last_login_at) })))) : el('p', { class: 'muted', text: 'No hay CEO registrados.' }),
        d.ceos.length < 2 ? el('p', { class: 'small', text: 'Hay ' + d.ceos.length + ' CEO con cuenta. La invitación para el segundo se genera en «Equipo».' }) : ''));
      if (D.conflicts.length) body.push(el('div', { class: 'panel' }, el('h3', { text: 'Instrucciones opuestas: en pausa' }), el('ul', {}, D.conflicts.map((c) => el('li', {}, c.description, ' ', el('a', { href: '#approval/' + c.subject_id, text: 'Resolver' }))))));
      body.push(el('div', { class: 'cols' },
        el('div', { class: 'panel' }, el('h3', { text: 'Decisiones pendientes de los CEO' }), D.decisions.length ? el('ul', {}, D.decisions.map((t) => el('li', {}, el('a', { href: '#task/' + t.id, text: t.id + ' · ' + t.title }), ' ', statusTag(TSTATUS, t.status)))) : el('p', { class: 'muted', text: 'Ninguna.' })),
        el('div', { class: 'panel' }, el('h3', { text: 'Bloqueos' }), D.blocked.length ? el('ul', {}, D.blocked.map((t) => el('li', {}, el('a', { href: '#task/' + t.id, text: t.id + ' · ' + t.title }), el('br'), el('small', { class: 'muted', text: t.blocked_reason || '' })))) : el('p', { class: 'muted', text: 'Ninguno.' }))));
      body.push(el('div', { class: 'panel' }, el('h3', { text: 'Costos registrados' }), D.costs.length
        ? table(['Tipo', 'Área', 'Moneda', 'Total', 'Registros'], D.costs.map((c) => el('tr', {}, el('td', { text: c.kind === 'actual' ? 'Real (con comprobante)' : c.kind === 'estimate' ? 'Estimado' : 'Presupuesto' }), el('td', { text: AREA[c.area] || c.area }), el('td', { text: c.currency }), el('td', { text: nf(c.total, 2) }), el('td', { text: c.n }))))
        : el('p', { class: 'muted', text: 'Todavía no hay costos cargados. Los reales necesitan comprobante; los estimados se muestran aparte.' }),
        el('a', { class: 'small', href: '#company?tab=risks', text: 'Cargar costos' })));
    }
    if (tab === 'agents') {
      body.push(el('p', { class: 'muted', text: 'Roles con responsabilidades, herramientas y límites. El estado dice cómo se ejecuta cada uno de verdad: «Sin proceso activo» significa que hoy no hay ningún proceso trabajando en ese rol.' }));
      const groups = [...new Set(d.agents.map((x) => x.department))];
      for (const g of groups) {
        body.push(el('h2', { text: g }), table(['#', 'Agente', 'Estado real', 'Última ejecución', 'Tareas', 'Autonomía', ''], d.agents.filter((x) => x.department === g).map((x) => el('tr', {},
          el('td', { text: x.number }), el('td', {}, el('strong', { text: x.name }), el('br'), el('small', { class: 'muted', text: x.mission })),
          el('td', { text: x.state }), el('td', { text: x.last_run_at ? fmt(x.last_run_at) + (x.last_result ? ' · ' + (LABELS[x.last_result] || x.last_result) : '') : '—' }),
          el('td', { text: x.open_tasks + (x.blocked_tasks ? ' (' + x.blocked_tasks + ' bloq.)' : '') }), el('td', { text: 'Nivel ' + x.autonomy_max }),
          el('td', {}, el('a', { href: '#agent/' + x.id, text: 'Ficha' }))))));
      }
    }
    if (tab === 'tech') {
      const T = d.tech;
      body.push(el('div', { class: 'cards' }, kpi('Errores 24 h', T.errors24, { warn: true, href: '#jobs' }), kpi('Alertas abiertas', T.openAlerts, { href: '#alerts' }),
        kpi('Alertas de seguridad', T.securityAlerts.length, { warn: true, href: '#alerts' }), kpi('Tareas abiertas', T.tasks.length + T.security_tasks.length, { href: '#tasks?area=tech' })));
      body.push(el('div', { class: 'panel' }, el('h3', { text: 'Versión en producción' }),
        el('p', {}, d.version.commit ? ['Commit ', el('code', { text: d.version.commit.slice(0, 7) }), ' · ', d.version.message || ''] : 'Sin dato de versión (solo se informa en Vercel).'),
        el('p', { class: 'small muted', text: 'Las pruebas corren en GitHub Actions («Pruebas») en cada cambio; el resultado se ve en GitHub. Banco: ' + nn(T.bank.published) + ' crípticos publicados de ' + nn(T.bank.target) + ' de meta.' })));
      if (T.securityAlerts.length) body.push(el('h2', { text: 'Alertas de seguridad' }), table(['Fecha', 'Alerta'], T.securityAlerts.map((x) => el('tr', {}, el('td', { text: fmt(x.last_seen_at) }), el('td', { text: x.title })))));
      body.push(el('h2', { text: 'Mejoras y riesgos técnicos' }), taskTable([...T.security_tasks, ...T.tasks]));
      if (T.jobsFailed.length) body.push(el('h2', { text: 'Tareas programadas con fallos' }), table(['Tarea', 'Fecha', 'Salida'], T.jobsFailed.map((x) => el('tr', {}, el('td', { text: x.job_name }), el('td', { text: fmt(x.started_at) }), el('td', {}, el('code', { class: 'small', text: (x.output || '').slice(0, 160) }))))));
      body.push(el('h2', { text: 'Últimos errores' }), T.recentErrors.length ? table(['Fecha', 'Ámbito', 'Mensaje'], T.recentErrors.map((x) => el('tr', {}, el('td', { text: fmt(x.created_at) }), el('td', { text: x.scope }), el('td', { text: x.message })))) : el('p', { class: 'muted', text: 'Sin errores registrados.' }));
    }
    if (tab === 'marketing') {
      const M = d.marketing;
      body.push(el('div', { class: 'cards' }, Object.keys(PSTATUS).filter((k) => ['idea', 'production', 'pending_approval', 'approved', 'scheduled', 'published'].includes(k)).map((k) =>
        kpi(PSTATUS[k], sum(M.pieces, (r) => r.status === k), { href: '#content?status=' + k }))));
      body.push(el('p', { class: 'small muted', text: 'Ninguna pieza se publica sin la aprobación de un CEO sobre la versión exacta. Sin redes conectadas, la publicación la hace una persona y deja el enlace como evidencia.' }));
      body.push(el('div', { class: 'cols' },
        el('div', { class: 'panel' }, el('h3', { text: 'Calendario' }), M.calendar.length ? el('ul', {}, M.calendar.map((p) => el('li', {}, fmt(p.scheduled_at) + ' · ', el('a', { href: '#piece/' + p.id, text: p.title }), ' · ' + p.platform + ' ', statusTag(PSTATUS, p.status)))) : el('p', { class: 'muted', text: 'Sin piezas con fecha.' })),
        el('div', { class: 'panel' }, el('h3', { text: 'Publicaciones verificadas' }), M.published.length ? el('ul', {}, M.published.map((p) => el('li', {}, p.title + ' · ', linkify(p.published_url)))) : el('p', { class: 'muted', text: 'Ninguna todavía.' }))));
      body.push(el('h2', { text: 'Redes' }), integrationsTable(M.channels));
      body.push(el('p', {}, el('a', { class: 'btn primary', href: '#content', text: 'Ir a contenido' })));
    }
    if (tab === 'legal') {
      const G = d.legal;
      body.push(el('p', { class: 'muted', text: 'Investigación y borradores preparados por agentes: no son asesoramiento jurídico. Ningún texto nuevo se publica sin aprobación y, cuando el riesgo lo exige, revisión profesional.' }));
      body.push(el('div', { class: 'cards' }, kpi('Documentos', G.docs.length), kpi('Con versión publicada', G.docs.filter((x) => x.versions.some((v) => v.status === 'published')).length),
        kpi('Jurisdicciones verificadas', G.jurisdictions.filter((j) => j.verified_at).length), kpi('Requieren abogado', G.jurisdictions.filter((j) => j.needs_lawyer).length + G.risks.filter((r) => r.needs_lawyer).length, { warn: true }),
        kpi('Aprobaciones legales abiertas', G.approvals.length, { href: '#approvals?area=legal' })));
      body.push(el('p', {}, el('a', { class: 'btn primary', href: '#legal', text: 'Documentos y matriz por país' })));
      body.push(el('h2', { text: 'Riesgos legales' }), riskTable(G.risks));
    }
    if (tab === 'community') {
      const C = d.community;
      body.push(el('div', { class: 'cards' }, kpi('Propuestas por moderar', C.submissions_pending, { href: '#submissions' }), kpi('Errores informados abiertos', C.reports_open, { href: '#reports' }),
        kpi('Solicitudes de datos abiertas', C.data_requests_open, { href: '#privacy' })));
      body.push(el('p', { class: 'muted', text: 'Comentarios y mensajes de redes: ninguna red está conectada, así que no hay bandeja de mensajes. Las respuestas, cuando existan, serán borradores para revisión humana salvo política aprobada por los CEO.' }));
      body.push(integrationsTable(C.channels));
    }
    if (tab === 'apps') {
      const A = d.apps;
      body.push(el('div', { class: 'panel' }, el('h3', { text: 'Estado real' }), el('p', { text: A.note })));
      body.push(el('h2', { text: 'Tiendas' }), integrationsTable(A.stores));
      body.push(el('h2', { text: 'Tareas' }), taskTable(A.tasks));
    }
    if (tab === 'integrations') {
      body.push(el('p', { class: 'muted', text: 'Una integración figura «verificada» solo con la evidencia de cómo se comprobó.' }), integrationsTable(d.integrations, true));
    }
    if (tab === 'risks') {
      body.push(el('h2', { text: 'Riesgos' }), riskTable(d.risks));
      if (can('company.write')) {
        const f = { area: el('select', {}, Object.entries(AREA).map(([k, v]) => el('option', { value: k, text: v }))), vendor: el('input', { placeholder: 'Proveedor' }),
          description: el('input', { placeholder: 'Concepto' }), kind: el('select', {}, [['estimate', 'Estimado'], ['budget', 'Presupuesto'], ['actual', 'Real (con comprobante)']].map(([k, v]) => el('option', { value: k, text: v }))),
          amount: el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Monto' }), currency: el('input', { value: 'USD', size: 4 }), period: el('input', { placeholder: 'Período (2026-11)' }),
          evidence: el('input', { placeholder: 'Comprobante o fuente del estimado' }) };
        body.push(el('h2', { text: 'Cargar un costo' }), el('div', { class: 'toolbar' }, Object.values(f), btn('Guardar', act(() => api('/api/admin/company/costs', { method: 'POST',
          body: { area: f.area.value, vendor: f.vendor.value, description: f.description.value, kind: f.kind.value, amount: Number(f.amount.value), currency: f.currency.value, period: f.period.value, evidence: f.evidence.value } }), 'Costo registrado.'), 'primary')));
      }
    }
    if (tab === 'audit') {
      body.push(el('p', { class: 'muted', text: 'Acciones relevantes: aprobaciones, permisos, seguridad, contenido, legal, costos y ejecuciones de agentes. El registro no se puede borrar ni modificar.' }),
        table(['Fecha', 'Quién', 'Acción', 'Objeto', 'Resultado'], d.audit.map((x) => el('tr', {}, el('td', { text: fmt(x.created_at) }),
          el('td', { text: x.username || (x.actor_kind === 'agent' ? 'Agente ' + (x.actor_label || '') : 'Sistema') }), el('td', { text: x.action }),
          el('td', { text: (x.target_kind || '') + ' ' + String(x.target_id || '').slice(0, 14) }), el('td', { text: (x.outcome || 'ok') + (x.cost_amount ? ' · ' + nf(x.cost_amount, 2) : '') })))),
        el('p', {}, el('a', { href: '#audit', text: 'Registro completo' })));
    }
    main.replaceChildren(el('div', { class: 'adm-head' }, el('h1', { text: 'Centro de operaciones' }),
      el('p', { class: 'muted small', text: 'Datos reales de la base al ' + fmt(d.generated_at) + '. Nada se muestra como hecho sin evidencia.' })), tabs, el('div', { role: 'tabpanel' }, body));
  };

  function taskTable(items) {
    if (!items.length) return el('p', { class: 'muted', text: 'Sin tareas.' });
    return table(['ID', 'Tarea', 'Categoría', 'Responsable', 'Estado', 'Fecha límite', 'Riesgo'], items.map((t) => el('tr', {},
      el('td', {}, el('a', { href: '#task/' + t.id, text: t.id })), el('td', {}, t.title, t.blocked_reason ? el('small', { class: 'muted', text: ' · ' + t.blocked_reason }) : ''),
      el('td', { text: CAT[t.category] || t.category }), el('td', { text: t.agent_name || t.owner_username || '—' }), el('td', {}, statusTag(TSTATUS, t.status)), el('td', {}, dueCell(t)), el('td', {}, t.risk ? sevTag(t.risk) : '—'))));
  }
  // Fecha límite en formato local; vencida si pasó y la tarea sigue abierta.
  function dueCell(t) {
    if (!t.due_at) return '—';
    const d = String(t.due_at).slice(0, 10);
    const txt = d.split('-').reverse().join('/');
    const open = !['done', 'cancelled'].includes(t.status);
    return open && d < new Date().toISOString().slice(0, 10) ? tag(txt + ' · vencida', 'failed') : txt;
  }
  function riskTable(items) {
    if (!items.length) return el('p', { class: 'muted', text: 'Sin riesgos abiertos.' });
    return table(['ID', 'Riesgo', 'Área', 'Gravedad', 'Probabilidad', 'Mitigación', 'Abogado'], items.map((r) => el('tr', {},
      el('td', { text: r.id }), el('td', {}, el('strong', { text: r.title }), el('br'), el('small', { class: 'muted', text: r.description || '' })), el('td', { text: AREA[r.area] || r.area }),
      el('td', {}, sevTag(r.severity)), el('td', { text: RSEV[r.likelihood] || r.likelihood }), el('td', { text: r.mitigation || '—' }), el('td', { text: r.needs_lawyer ? 'Sí' : 'No' }))));
  }
  function integrationsTable(items, editable) {
    return table(['Integración', 'Estado', 'Qué aporta', 'Costo', 'Qué falta del CEO', 'Evidencia', ''], items.map((i) => el('tr', {},
      el('td', {}, el('strong', { text: i.name }), el('br'), el('small', { class: 'muted', text: [i.permissions, i.limitations].filter(Boolean).join(' · ') })),
      el('td', {}, statusTag(ISTATUS, i.status)), el('td', { text: i.provides || '—' }), el('td', { text: i.cost || '—' }), el('td', { text: i.ceo_action || '—' }),
      el('td', {}, el('small', { text: i.evidence ? i.evidence + (i.checked_at ? ' (' + String(i.checked_at).slice(0, 10) + ')' : '') : '—' })),
      el('td', {}, editable && can('company.write') ? btn('Marcar verificada', act(async () => {
        const ev = window.prompt('¿Cómo se comprobó? (evidencia verificable)');
        if (!ev) return;
        await api('/api/admin/company/integrations/' + i.id, { method: 'PATCH', body: { status: 'verified', evidence: ev } });
      }, 'Integración actualizada.'), 'small') : ''))));
  }

  V.agent = async (id) => {
    const [d, runs] = await Promise.all([api('/api/admin/company/agents'), api('/api/admin/company/agents/' + encodeURIComponent(id) + '/runs')]);
    const x = d.items.find((a) => a.id === id);
    if (!x) throw new Error('Agente no encontrado');
    const list = (t, arr) => el('div', {}, el('h3', { text: t }), el('ul', {}, arr.map((s) => el('li', { text: s }))));
    main.replaceChildren(el('p', {}, el('a', { href: '#company?tab=agents', text: '← Agentes' })), el('h1', { text: x.number + '. ' + x.name }),
      el('p', { class: 'muted', text: x.department + ' · ' + x.mission }),
      el('div', { class: 'cards' }, kpi('Estado real', x.state, { txt: true, fmt: (v) => v }), kpi('Autonomía máxima', 'Nivel ' + x.autonomy_max, { txt: true, fmt: (v) => v }),
        kpi('Ejecuciones registradas', x.runs), kpi('Errores', x.errors, { warn: true }), kpi('Costo registrado (USD)', x.cost, { fmt: (v) => nf(v, 2) })),
      el('div', { class: 'cols' }, el('div', { class: 'panel' }, list('Responsabilidades', x.responsibilities), list('Indicadores', x.kpis)),
        el('div', { class: 'panel' }, list('Herramientas autorizadas', x.tools), list('Límites', x.limits), el('p', { class: 'small muted', text: 'Responsable operativo: ' + x.owner_label + '. Los agentes no pueden cambiar sus propios permisos ni subir su nivel de autonomía.' }))),
      el('h2', { text: 'Ejecuciones' }), runs.items.length ? table(['Inicio', 'Estado', 'Resumen', 'Evidencia'], runs.items.map((r) => el('tr', {}, el('td', { text: fmt(r.started_at) }),
        el('td', { text: r.status }), el('td', { text: r.summary || r.error || '' }), el('td', {}, linkify(r.evidence))))) : el('p', { class: 'muted', text: 'No hay ejecuciones registradas.' }));
  };

  // ── Tareas ──
  V.tasks = async () => {
    const q = qs();
    const p = new URLSearchParams(); ['status', 'area', 'category'].forEach((k) => { if (q.get(k)) p.set(k, q.get(k)); });
    if (!q.get('status')) p.set('status', 'open');
    const d = await api('/api/admin/company/tasks?' + p);
    const nav = el('div', { class: 'tabs' }, [['open', 'Abiertas'], ['blocked', 'Bloqueadas'], ['in_review', 'En revisión'], ['done', 'Completadas']].map(([k, t]) =>
      el('a', { href: '#tasks?status=' + k, class: (p.get('status') === k) ? 'active' : '', text: t })));
    const out = [el('h1', { text: 'Tareas' }), nav, taskTable(d.items)];
    if (can('company.write')) {
      const f = { title: el('input', { placeholder: 'Título', required: true }), area: el('select', {}, Object.entries(AREA).map(([k, v]) => el('option', { value: k, text: v }))),
        category: el('select', {}, Object.entries(CAT).map(([k, v]) => el('option', { value: k, text: v }))), expected: el('input', { placeholder: 'Resultado esperado' }),
        due_at: el('input', { type: 'date', 'aria-label': 'Plazo' }), approval_level: el('select', { 'aria-label': 'Nivel' }, [1, 2, 3, 4].map((n) => el('option', { value: n, text: 'Nivel ' + n }))) };
      out.push(el('h2', { text: 'Nueva tarea' }), el('div', { class: 'toolbar' }, Object.values(f), btn('Crear', act(() => api('/api/admin/company/tasks', { method: 'POST',
        body: { title: f.title.value, area: f.area.value, category: f.category.value, expected: f.expected.value, due_at: f.due_at.value || null, approval_level: Number(f.approval_level.value) } }), 'Tarea creada.'), 'primary')));
    }
    main.replaceChildren(...out);
  };

  V.task = async (id) => {
    const [d, ag] = await Promise.all([api('/api/admin/company/tasks'), api('/api/admin/company/agents')]);
    const t = d.items.find((x) => x.id === id);
    if (!t) throw new Error('Tarea no encontrada');
    const row = (k, v) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td', {}, v === null || v === undefined || v === '' ? '—' : v));
    const out = [el('p', {}, el('a', { href: '#tasks', text: '← Tareas' })), el('h1', { text: t.id + ' · ' + t.title }),
      el('div', { class: 'tbl-wrap' }, el('table', {}, el('tbody', {}, row('Estado', statusTag(TSTATUS, t.status)), row('Motivo del bloqueo', t.blocked_reason), row('Objetivo', t.objective),
        row('Área', AREA[t.area] || t.area), row('Categoría', CAT[t.category] || t.category), row('Agente', t.agent_name), row('Resultado esperado', t.expected), row('Plazo', t.due_at ? fmt(t.due_at) : null),
        row('Riesgo', t.risk ? RSEV[t.risk] : null), row('Aprobación necesaria', 'Nivel ' + t.approval_level + (t.approval_level >= 3 ? ' (requiere CEO)' : '')),
        row('Pedido de aprobación', t.approval_id ? el('a', { href: '#approval/' + t.approval_id, text: 'Ver' }) : null), row('Evidencia', linkify(t.evidence)),
        row('Costo estimado / real', [t.cost_estimate, t.cost_actual].map((v) => (v == null ? '—' : nf(v, 2))).join(' / ')))))];
    if (can('company.write')) {
      const st = el('select', { 'aria-label': 'Estado' }, Object.entries(TSTATUS).map(([k, v]) => el('option', { value: k, selected: k === t.status, text: v })));
      const ev = el('input', { placeholder: 'Evidencia (obligatoria para completar)', value: t.evidence || '' });
      const br = el('input', { placeholder: 'Motivo del bloqueo', value: t.blocked_reason || '' });
      const agent = el('select', { 'aria-label': 'Agente' }, el('option', { value: '', text: 'Sin agente' }), ag.items.map((a) => el('option', { value: a.id, selected: a.id === t.agent_id, text: a.number + '. ' + a.name })));
      out.push(el('h2', { text: 'Actualizar' }), el('div', { class: 'toolbar' }, st, agent, br, ev, btn('Guardar', act(() => api('/api/admin/company/tasks/' + t.id, { method: 'PATCH',
        body: { status: st.value, evidence: ev.value || null, blocked_reason: br.value || null, agent_id: agent.value || null } }), 'Tarea actualizada.'), 'primary')));
    }
    if (can('approvals.request') && !t.approval_id) {
      const note = el('input', { placeholder: 'Qué se pide aprobar' });
      const amount = el('input', { type: 'number', min: '0', placeholder: 'Monto USD (si hay gasto)' });
      const kind = el('select', { 'aria-label': 'Tipo' }, [['decision', 'Decisión'], ['production_change', 'Cambio en producción'], ['feature', 'Funcionalidad'], ['design_change', 'Diseño o producto'],
        ['budget', 'Presupuesto'], ['contract', 'Contrato'], ['app_release', 'Lanzamiento de app'], ['institutional', 'Comunicación institucional']].map(([k, v]) => el('option', { value: k, text: v })));
      out.push(el('h2', { text: 'Pedir aprobación de los CEO' }), el('div', { class: 'toolbar' }, kind, note, amount, btn('Enviar a la bandeja', act(async () => {
        const r = await api('/api/admin/company/tasks/' + t.id + '/request-approval', { method: 'POST', body: { kind: kind.value, note: note.value, amount: amount.value ? Number(amount.value) : undefined } });
        location.hash = 'approval/' + r.id;
      }), 'primary')));
    }
    main.replaceChildren(...out);
  };

  // ── Aprobaciones ──
  V.approvals = async () => {
    const q = qs(); const status = q.get('status') || 'open'; const area = q.get('area') || '';
    const d = await api('/api/admin/approvals?status=' + status + (area ? '&area=' + area : ''));
    const nav = el('div', { class: 'tabs' }, [['open', 'Abiertas'], ['approved', 'Aprobadas'], ['executed', 'Ejecutadas'], ['rejected', 'Rechazadas'], ['withdrawn', 'Retiradas']].map(([k, t]) =>
      el('a', { href: '#approvals?status=' + k, class: status === k ? 'active' : '', text: t })));
    main.replaceChildren(el('h1', { text: 'Bandeja de aprobaciones' }),
      el('p', { class: 'muted', text: d.dual ? 'Cualquiera de los dos CEO aprueba lo ordinario. Lo extraordinario (gastos sobre el umbral, contratos, seguridad crítica, decisiones legales de alto impacto y permisos de un CEO) necesita a los dos. Cada aprobación vale solo para la versión que se vio.' : 'Por decisión de los CEO, con la aprobación de uno de los dos alcanza para todo. Cada aprobación vale solo para la versión que se vio; si uno aprueba y el otro rechaza, el pedido queda en pausa.' }),
      d.dual && d.owners < 2 ? el('p', { class: 'flash warn', text: 'Hay un solo CEO con cuenta: los pedidos que exigen a los dos quedan pendientes hasta que se sume el segundo.' }) : '',
      d.conflicts.length ? el('div', { class: 'panel' }, el('h3', { text: 'Conflictos abiertos' }), el('ul', {}, d.conflicts.map((c) => el('li', {}, c.description, ' ', el('a', { href: '#approval/' + c.subject_id, text: 'Abrir' }))))) : '',
      nav, d.items.length ? table(['Pedido', 'Tipo', 'Área', 'Política', 'Estado', 'Versión', 'Creado'], d.items.map((x) => el('tr', {},
        el('td', {}, el('a', { href: '#approval/' + x.id, text: x.title })), el('td', { text: x.kind_label }), el('td', { text: AREA[x.area] || x.area }),
        el('td', { text: x.policy === 'both' ? 'Los dos CEO (' + x.approvals + '/2)' : 'Un CEO' }), el('td', {}, statusTag(ASTATUS, x.status)), el('td', { text: 'v' + x.version }), el('td', { text: fmt(x.created_at) }))))
        : el('p', { class: 'muted', text: 'No hay pedidos en esta lista.' }));
  };

  // Vista previa «tal como se publica» de una pieza o un texto.
  function preview(c) {
    if (c && c.platform) {
      return el('div', { class: 'post-preview' }, el('div', { class: 'small muted', text: [c.platform, c.format, c.country, c.language].filter(Boolean).join(' · ') }),
        el('h3', { text: c.title }), c.body ? el('p', { class: 'pre', text: c.body }) : '', c.script ? el('details', {}, el('summary', { text: 'Guion' }), el('p', { class: 'pre', text: c.script })) : '',
        c.cta ? el('p', {}, el('strong', { text: c.cta })) : '', c.hashtags ? el('p', { class: 'muted', text: c.hashtags }) : '', c.link ? el('p', {}, linkify(c.link)) : '',
        (c.assets || []).length ? el('div', {}, el('strong', { text: 'Archivos: ' }), el('ul', {}, c.assets.map((a) => el('li', {}, /^https:/.test(a) ? linkify(a) : el('code', { text: a })))),
          el('div', { class: 'asset-strip' }, c.assets.filter((a) => /^marketing\/[a-z0-9-]+\/[a-z0-9-]+\.png$/.test(a)).map((a) => el('img', { src: '/api/admin/content-assets/' + a, alt: a, loading: 'lazy' })),
            c.assets.filter((a) => /^\/social\//.test(a)).map((a) => mediaEl(a)))) : el('p', { class: 'small', text: 'Sin archivos adjuntos.' }),
        c.alt_text ? el('p', { class: 'small muted', text: 'Texto alternativo: ' + c.alt_text }) : '', c.rights ? el('p', { class: 'small muted', text: 'Derechos: ' + c.rights }) : el('p', { class: 'small', text: 'Derechos de los recursos: sin indicar.' }));
    }
    if (c && c.body && c.doc) return el('div', { class: 'post-preview' }, el('div', { class: 'small muted', text: 'Documento ' + c.doc + ' · versión ' + c.version + ' · ' + c.language }), el('div', { class: 'pre legal-text', text: c.body }));
    return el('pre', { class: 'code' }, JSON.stringify(c, null, 2));
  }

  V.approval = async (id) => {
    const x = await api('/api/admin/approvals/' + encodeURIComponent(id));
    const mine = x.votes.find((v) => v.current && v.user_id === me.id);
    const open = ['pending', 'changes_requested', 'conflict'].includes(x.status) || (x.status === 'pending');
    const comment = el('input', { placeholder: 'Comentario (obligatorio para rechazar o pedir cambios)' });
    const vote = (decision) => act(() => api('/api/admin/approvals/' + x.id + '/vote', { method: 'POST', body: { decision, comment: comment.value, version: x.version, content_hash: x.content_hash } }),
      decision === 'approve' ? 'Aprobación registrada para la versión ' + x.version + '.' : 'Decisión registrada.');
    const out = [el('p', {}, el('a', { href: '#approvals', text: '← Bandeja' })), el('h1', { text: x.title }),
      el('p', {}, statusTag(ASTATUS, x.status), ' ', x.kind_label, ' · ', AREA[x.area] || x.area, ' · ', x.policy === 'both' ? 'Necesita a los dos CEO' : 'Alcanza con un CEO',
        ' · Nivel ' + x.level, x.amount != null ? ' · ' + nf(x.amount, 2) + ' ' + (x.currency || '') : ''),
      x.summary ? el('p', { class: 'muted', text: x.summary }) : '',
      el('div', { class: 'panel' }, el('h3', { text: 'Versión ' + x.version + ' · lo que se aprueba' }), preview(x.content),
        el('p', { class: 'small muted' }, 'Huella de esta versión: ', el('code', { text: x.content_hash.slice(0, 16) }), '. Si el contenido cambia, esta aprobación deja de valer.'))];
    if (x.status === 'conflict' && can('approvals.decide')) {
      const res = el('input', { placeholder: 'Cómo lo resolvieron los dos CEO' });
      const list = await api('/api/admin/approvals?status=open');
      const c = list.conflicts.find((k) => k.subject_id === x.id);
      if (c) out.push(el('div', { class: 'panel' }, el('h3', { text: 'Conflicto: tarea en pausa' }), el('p', { text: c.description }), el('div', { class: 'toolbar' }, res,
        btn('Registrar resolución', act(() => api('/api/admin/conflicts/' + c.id + '/resolve', { method: 'POST', body: { resolution: res.value } }), 'Resolución registrada: se vuelve a votar.'), 'primary'))));
    }
    if (can('approvals.decide') && ['pending', 'changes_requested'].includes(x.status) && !mine) {
      out.push(el('div', { class: 'panel' }, el('h3', { text: 'Tu decisión sobre la versión ' + x.version }), el('div', { class: 'toolbar' }, comment,
        btn('Aprobar esta versión', vote('approve'), 'primary'), btn('Pedir cambios', vote('changes')), btn('Rechazar', vote('reject')))));
    } else if (mine) out.push(el('p', { class: 'small', text: 'Ya decidiste sobre esta versión: ' + ({ approve: 'aprobaste', reject: 'rechazaste', changes: 'pediste cambios' })[mine.decision] + '.' }));
    if (x.status === 'approved' && can('approvals.decide') && !x.target_kind) {
      const ev = el('input', { placeholder: 'Evidencia de la ejecución (enlace, commit, factura…)' });
      out.push(el('div', { class: 'panel' }, el('h3', { text: 'Registrar la ejecución' }), el('div', { class: 'toolbar' }, ev, btn('Marcar ejecutado', act(() => api('/api/admin/approvals/' + x.id + '/executed', { method: 'POST', body: { evidence: ev.value } }), 'Ejecución registrada.')))));
    }
    if (x.execution_evidence) out.push(el('p', {}, 'Evidencia de ejecución: ', linkify(x.execution_evidence)));
    out.push(el('h2', { text: 'Decisiones' }), x.votes.length ? table(['Fecha', 'CEO', 'Decisión', 'Versión', 'Vigente', 'Comentario'], x.votes.map((v) => el('tr', {},
      el('td', { text: fmt(v.created_at) }), el('td', { text: v.display_name || v.username }), el('td', { text: ({ approve: 'Aprobó', reject: 'Rechazó', changes: 'Pidió cambios' })[v.decision] }),
      el('td', { text: 'v' + v.version }), el('td', { text: v.current ? 'Sí' : 'No (otra versión)' }), el('td', { text: v.comment || '' })))) : el('p', { class: 'muted', text: 'Sin decisiones todavía.' }),
    el('h2', { text: 'Versiones' }), table(['Versión', 'Huella', 'Fecha'], x.versions.map((v) => el('tr', {}, el('td', { text: 'v' + v.version }), el('td', {}, el('code', { text: v.content_hash.slice(0, 16) })), el('td', { text: fmt(v.created_at) })))));
    if (can('approvals.request') && !['executed', 'withdrawn'].includes(x.status)) out.push(el('p', {}, btn('Retirar pedido', act(() => api('/api/admin/approvals/' + x.id + '/withdraw', { method: 'POST', body: {} }), 'Pedido retirado.'))));
    void open;
    main.replaceChildren(...out);
  };

  // ── Contenido ──
  V.content = async () => {
    const status = qs().get('status') || '';
    const d = await api('/api/admin/content' + (status ? '?status=' + status : ''));
    const nav = el('div', { class: 'tabs' }, [['', 'Todas'], ...Object.entries(PSTATUS)].map(([k, t]) => el('a', { href: '#content' + (k ? '?status=' + k : ''), class: status === k ? 'active' : '', text: t })));
    const out = [el('h1', { text: 'Contenido y redes' }), el('p', { class: 'muted', text: 'Cada pieza tiene su texto, archivos, derechos y fecha sugerida. Pasa por la bandeja de aprobaciones antes de programarse o publicarse.' }), nav,
      d.items.length ? table(['Pieza', 'Plataforma', 'Formato', 'País / idioma', 'Fecha sugerida', 'Estado'], d.items.map((p) => el('tr', {}, el('td', {}, el('a', { href: '#piece/' + p.id, text: p.title })),
        el('td', { text: p.platform }), el('td', { text: p.format }), el('td', { text: [p.country, p.language].filter(Boolean).join(' / ') || '—' }), el('td', { text: p.scheduled_at ? fmt(p.scheduled_at) : '—' }), el('td', {}, statusTag(PSTATUS, p.status)))))
        : el('p', { class: 'muted', text: 'Todavía no hay piezas.' })];
    if (can('content.write')) out.push(el('p', {}, el('a', { class: 'btn primary', href: '#piece/new', text: 'Nueva pieza' })));
    main.replaceChildren(...out);
  };

  V.piece = async (id) => {
    const isNew = id === 'new';
    const p = isNew ? { assets: [], status: 'idea' } : await api('/api/admin/content/' + encodeURIComponent(id));
    const F = [['title', 'Título'], ['campaign', 'Campaña'], ['objective', 'Objetivo'], ['audience', 'Audiencia'], ['country', 'País'], ['language', 'Idioma'], ['platform', 'Plataforma'],
      ['format', 'Formato (reel, carrusel, historia, artículo, pdf, newsletter…)'], ['idea', 'Idea creativa'], ['script', 'Guion o estructura'], ['body', 'Texto final'], ['cta', 'Llamado a la acción'],
      ['hashtags', 'Hashtags'], ['link', 'Enlace de destino'], ['alt_text', 'Texto alternativo'], ['rights', 'Derechos y licencias de los recursos'], ['metric', 'Métrica de éxito']];
    const big = ['idea', 'script', 'body', 'rights'];
    const inputs = {};
    for (const [k] of F) inputs[k] = big.includes(k) ? el('textarea', {}) : el('input', {});
    for (const [k] of F) inputs[k].value = p[k] || '';
    const assets = el('textarea', { placeholder: 'Un archivo por línea: ruta del repositorio o enlace https' }); assets.value = (p.assets || []).join('\n');
    const sched = el('input', { type: 'datetime-local' }); if (p.scheduled_at) sched.value = String(p.scheduled_at).slice(0, 16);
    const read = () => { const b = {}; for (const [k] of F) b[k] = inputs[k].value; b.assets = assets.value.split('\n').map((s) => s.trim()).filter(Boolean); b.scheduled_at = sched.value ? new Date(sched.value).toISOString() : null; return b; };
    const save = async () => { const r = isNew ? await api('/api/admin/content', { method: 'POST', body: read() }) : await api('/api/admin/content/' + p.id, { method: 'PATCH', body: read() }); if (isNew) location.hash = 'piece/' + r.id; return r; };
    const out = [el('p', {}, el('a', { href: '#content', text: '← Contenido' })), el('h1', { text: isNew ? 'Nueva pieza' : p.title })];
    if (!isNew) {
      out.push(el('p', {}, statusTag(PSTATUS, p.status), ' · versión ' + p.version, p.approval_id ? [' · ', el('a', { href: '#approval/' + p.approval_id, text: 'pedido de aprobación' })] : '',
        p.approved_hash ? (p.approval_valid ? ' · aprobación vigente' : ' · la aprobación ya no vale (cambió)') : ''));
      if (p.published_url) out.push(el('p', {}, 'Publicada: ', linkify(p.published_url)));
    }
    const form = el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); act(save, 'Guardado.' + (p.approved_hash ? ' Si cambiaste algo material, vuelve a aprobación.' : ''))(); } },
      F.map(([k, t]) => field(t, inputs[k])), field('Archivos (diseños, videos, PDF)', assets), field('Fecha y hora sugeridas', sched),
      p.status !== 'published' && can('content.write') ? el('button', { class: 'btn primary', type: 'submit', text: 'Guardar' }) : '');
    out.push(form);
    if (!isNew && can('content.write')) {
      const acts = [];
      if (['idea', 'research', 'production', 'editing', 'rights_review', 'changes_requested', 'rejected', 'paused'].includes(p.status)) {
        acts.push(btn('Enviar a aprobación', act(() => api('/api/admin/content/' + p.id + '/status', { method: 'POST', body: { status: 'pending_approval' } }), 'Enviada a la bandeja.'), 'primary'));
        const st = el('select', { 'aria-label': 'Etapa' }, ['idea', 'research', 'production', 'editing', 'rights_review', 'paused'].map((k) => el('option', { value: k, selected: k === p.status, text: PSTATUS[k] })));
        acts.push(st, btn('Cambiar etapa', act(() => api('/api/admin/content/' + p.id + '/status', { method: 'POST', body: { status: st.value } }), 'Etapa actualizada.')));
      }
      if (can('approvals.decide') && p.status === 'approved' && p.approval_valid) acts.push(btn('Programar', act(() => api('/api/admin/content/' + p.id + '/status', { method: 'POST', body: { status: 'scheduled' } }), 'Programada.')));
      if (can('approvals.decide') && ['approved', 'scheduled'].includes(p.status) && p.approval_valid) {
        const url = el('input', { placeholder: 'https://… enlace a la publicación real' });
        acts.push(url, btn('Marcar publicada', act(() => api('/api/admin/content/' + p.id + '/status', { method: 'POST', body: { status: 'published', published_url: url.value } }), 'Publicación registrada con su evidencia.')));
      }
      if (acts.length) out.push(el('h2', { text: 'Acciones' }), el('div', { class: 'toolbar' }, acts));
      out.push(el('h2', { text: 'Vista previa' }), preview({ ...p }));
    }
    main.replaceChildren(...out);
  };

  // ── Redes: calendario de 60 días ──
  const NETS = { instagram: 'Instagram', facebook: 'Facebook', x: 'X', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube Shorts', whatsapp: 'Canal de WhatsApp' };
  const SGROUP = { pending: 'Para aprobar', approved: 'Aprobada', scheduled: 'Programada', published: 'Publicada', changes: 'Con cambios pedidos' };
  const sgroup = (s) => (['approved'].includes(s) ? 'approved' : s === 'scheduled' ? 'scheduled' : s === 'published' ? 'published'
    : ['changes_requested', 'rejected', 'paused', 'publish_error'].includes(s) ? 'changes' : 'pending');
  const hm = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
  const fileName = (a) => a.split('/').filter(Boolean).slice(-2).join('-');
  function mediaEl(a) {
    if (/\.mp4$/.test(a)) return el('video', { src: a, controls: true, preload: 'metadata', playsinline: true });
    return el('img', { src: a, alt: '', loading: 'lazy' });
  }
  // ZIP sin compresión armado en el navegador (los archivos ya están comprimidos).
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function makeZip(files) {
    const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name); const data = f.data; const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const size = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }
  function saveBlob(blob, name) { const u = URL.createObjectURL(blob); const a = el('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
  async function downloadDay(d) {
    const seen = new Set(); const files = [];
    const textos = d.pieces.map((p) => `${hm(p.scheduled_at)} · ${NETS[p.platform] || p.platform} · ${p.format}\n${p.body || ''}${p.alt_text ? '\n\n[Texto alternativo] ' + p.alt_text : ''}\n\n────────\n`).join('\n');
    files.push({ name: 'textos.txt', data: new TextEncoder().encode(`${d.label}\n\n${textos}`) });
    for (const p of d.pieces) for (const a of p.assets) {
      if (seen.has(a)) continue; seen.add(a);
      const r = await fetch(a); if (!r.ok) throw new Error('No se pudo bajar ' + a);
      files.push({ name: fileName(a), data: new Uint8Array(await r.arrayBuffer()) });
    }
    saveBlob(makeZip(files), `play-cripticos-dia-${String(d.n).padStart(2, '0')}-${d.date}.zip`);
  }
  const counts = (c) => el('div', { class: 'day-counts' }, ['pending', 'approved', 'scheduled', 'published', 'changes'].filter((k) => c[k]).map((k) => el('span', { class: 'pill s-' + k, text: c[k] + ' ' + SGROUP[k].toLowerCase() })));

  V.social = async () => {
    const d = await api('/api/admin/social/calendar');
    if (!d.days.length) { main.replaceChildren(el('h1', { text: 'Redes: 60 días' }), empty('Todavía no hay calendario cargado.')); return; }
    const weeks = [];
    for (const day of d.days) { const w = Math.floor(day.n / 7); (weeks[w] = weeks[w] || []).push(day); }
    const tot = d.days.reduce((s, x) => { for (const k of Object.keys(x.counts)) s[k] = (s[k] || 0) + x.counts[k]; return s; }, {});
    const approveDays = (days) => act(async (b) => {
      let ok = 0; let skipped = 0; let sch = 0;
      for (const [i, day] of days.entries()) {
        if (b) b.textContent = `Aprobando día ${i + 1} de ${days.length}… (${ok} aprobadas)`;
        const full = await api('/api/admin/social/days/' + day.n);
        const items = full.pieces.filter((p) => sgroup(p.status) === 'pending').map((p) => ({ id: p.id, hash: p.current_hash }));
        if (!items.length) continue;
        const r = await api('/api/admin/social/approve', { method: 'POST', body: { items } });
        ok += r.approved; skipped += r.skipped.length; sch += r.scheduled;
      }
      return { flash: `Aprobadas: ${ok}.` + (sch ? ` Programadas en Metricool: ${sch}.` : d.metricool.configured ? '' : ' Quedan esperando la conexión con Metricool.') + (skipped ? ` Sin cambios: ${skipped}.` : '') };
    });
    main.replaceChildren(el('h1', { text: 'Redes: 60 días' }),
      el('p', { class: 'muted', text: `Del ${d.days[0].label} al ${d.days[d.days.length - 1].label}. Cada carpeta es un día: adentro están las imágenes, los videos y los textos de cada red con su horario. Nada se publica sin tu aprobación.` }),
      d.metricool.configured ? '' : el('p', { class: 'flash warn', text: 'El servidor no programa solo en Metricool (el plan Starter no trae API): aprobá acá y avisale a Claude en el chat, que programa lo aprobado en su horario. También podés descargarlo y publicarlo a mano.' }),
      (() => {
        // Atajo arriba de todo: la primera semana que todavía tiene piezas para aprobar.
        const w = weeks.findIndex((days) => days.some((x) => x.counts.pending));
        if (w < 0 || !can('approvals.decide')) return '';
        const days = weeks[w]; const n = days.reduce((s, x) => s + x.counts.pending, 0);
        return el('div', { class: 'toolbar' }, btn(`Aprobar toda la semana ${w + 1} (${days[0].label} – ${days[days.length - 1].label}, ${n} publicaciones)`, approveDays(days), 'primary'));
      })(),
      el('div', { class: 'kpis' }, kpi('Publicaciones', tot.total || 0), kpi('Para aprobar', tot.pending || 0, { warn: !!tot.pending }), kpi('Aprobadas', tot.approved || 0), kpi('Programadas', tot.scheduled || 0), kpi('Publicadas', tot.published || 0)),
      ...weeks.map((days, w) => el('section', { class: 'panel' }, el('div', { class: 'toolbar' }, el('h3', { text: `Semana ${w + 1}` }), el('span', { class: 'muted small', text: `${days[0].label} – ${days[days.length - 1].label}` }),
        can('approvals.decide') && days.some((x) => x.counts.pending) ? btn('Aprobar toda la semana', approveDays(days), 'primary') : ''),
      el('div', { class: 'day-grid' }, days.map((x) => el('a', { class: 'day-folder', href: '#socialday/' + x.n },
        el('span', { class: 'day-n', text: 'Día ' + x.n }), el('strong', { text: x.label }), el('span', { class: 'small muted', text: `${x.counts.total} publicaciones · «${x.clue.clue}»` }), counts(x.counts)))))));
  };

  V.socialday = async (n) => {
    const d = await api('/api/admin/social/days/' + encodeURIComponent(n));
    const pend = d.pieces.filter((p) => sgroup(p.status) === 'pending');
    const approve = (items) => act(async () => {
      const r = await api('/api/admin/social/approve', { method: 'POST', body: { items } });
      return { flash: `Aprobadas: ${r.approved}.` + (r.scheduled ? ` Programadas en Metricool: ${r.scheduled}.` : '') + (r.schedule_errors ? ` No se pudieron programar: ${r.schedule_errors} (mirá el detalle en cada pieza).` : '') + (r.skipped.length ? ` Sin cambios: ${r.skipped.length}.` : '') };
    });
    // Aprobar la semana de este día sin volver al calendario.
    const weekStart = Math.floor(Number(n) / 7) * 7;
    const approveWeek = act(async (b) => {
      let ok = 0; let skipped = 0; let sch = 0;
      for (let k = weekStart; k < weekStart + 7 && k < 60; k++) {
        if (b) b.textContent = `Aprobando día ${k - weekStart + 1} de 7… (${ok} aprobadas)`;
        const full = await api('/api/admin/social/days/' + k);
        const items = full.pieces.filter((p) => sgroup(p.status) === 'pending').map((p) => ({ id: p.id, hash: p.current_hash }));
        if (!items.length) continue;
        const r = await api('/api/admin/social/approve', { method: 'POST', body: { items } });
        ok += r.approved; skipped += r.skipped.length; sch += r.scheduled;
      }
      return { flash: `Semana ${weekStart / 7 + 1}: aprobadas ${ok}.` + (sch ? ` Programadas en Metricool: ${sch}.` : '') + (skipped ? ` Sin cambios: ${skipped}.` : '') };
    });
    const byNet = {};
    for (const p of d.pieces) (byNet[p.platform] = byNet[p.platform] || []).push(p);
    const nav = el('div', { class: 'toolbar' }, el('a', { href: '#social', text: '← Calendario' }),
      Number(n) > 0 ? el('a', { href: '#socialday/' + (Number(n) - 1), text: '← Día anterior' }) : '', Number(n) < 59 ? el('a', { href: '#socialday/' + (Number(n) + 1), text: 'Día siguiente →' }) : '');
    const card = (p) => {
      const g = sgroup(p.status);
      const acts = [];
      if (can('approvals.decide') && g === 'pending') acts.push(btn('Aprobar', approve([{ id: p.id, hash: p.current_hash }]), 'primary'));
      if (can('approvals.decide') && ['pending', 'approved'].includes(g)) {
        const c = el('input', { placeholder: 'Qué hay que cambiar', 'aria-label': 'Cambios pedidos' });
        acts.push(el('span', { class: 'inline-form' }, c, btn('Pedir cambios', act(() => api('/api/admin/social/pieces/' + p.id + '/changes', { method: 'POST', body: { comment: c.value } }), 'Cambios pedidos: la pieza vuelve a producción.'))));
      }
      if (can('approvals.decide') && g === 'approved' && !p.manual && d.metricool.configured) acts.push(btn('Reintentar programación', act(() => api('/api/admin/social/pieces/' + p.id + '/schedule', { method: 'POST', body: {} }), 'Listo.')));
      if (can('approvals.decide') && ['approved', 'scheduled'].includes(g) && p.approval_valid) {
        const url = el('input', { placeholder: 'https://… enlace a la publicación', 'aria-label': 'Enlace a la publicación' });
        acts.push(el('span', { class: 'inline-form' }, url, btn('Marcar publicada', act(() => api('/api/admin/content/' + p.id + '/status', { method: 'POST', body: { status: 'published', published_url: url.value } }), 'Publicación registrada con su enlace.'))));
      }
      const copy = btn('Copiar texto', async () => { try { await navigator.clipboard.writeText(p.body || ''); flash('Texto copiado.', true); } catch (e) { flash('No se pudo copiar: seleccioná el texto a mano.'); } });
      const state = g === 'approved' ? (p.manual ? 'Aprobada: se publica a mano' : p.external_error ? 'Aprobada: ' + p.external_error : d.metricool.configured ? 'Aprobada: programándose' : 'Aprobada: espera la conexión con Metricool')
        : g === 'scheduled' ? 'Programada en Metricool (' + p.external_id + ')' : g === 'published' ? 'Publicada' : SGROUP[g];
      return el('article', { class: 'social-card s-' + g },
        el('header', {}, el('strong', { text: hm(p.scheduled_at) + ' · ' + p.format }), el('span', { class: 'pill s-' + g, text: state })),
        p.assets.length ? el('div', { class: 'social-media' }, p.assets.map((a) => el('figure', {}, mediaEl(a), el('a', { class: 'small', href: a, download: fileName(a), text: 'Descargar ' + a.split('/').pop() })))) : el('p', { class: 'small muted', text: 'Solo texto.' }),
        el('p', { class: 'pre', text: p.body || '' }), copy,
        p.alt_text ? el('p', { class: 'small muted', text: 'Texto alternativo: ' + p.alt_text }) : '',
        el('p', { class: 'small muted', text: 'Horario elegido por el director de marketing: ' + (p.schedule_note || '—') }),
        p.published_url ? el('p', {}, 'Publicada: ', linkify(p.published_url)) : '',
        acts.length ? el('div', { class: 'toolbar' }, acts) : '');
    };
    main.replaceChildren(nav, el('h1', { text: `Día ${d.n} · ${d.label}` }),
      el('p', { class: 'muted' }, 'Críptico del día: «', d.clue.clue, '» · respuesta ', el('strong', { text: d.clue.answer }), ' · ', el('a', { href: 'https://playcripticos.com/es/c/' + d.clue.slug, target: '_blank', rel: 'noopener', text: 'ver en el sitio' })),
      el('div', { class: 'toolbar' }, can('approvals.decide') && pend.length ? btn(`Aprobar todo el día (${pend.length})`, approve(pend.map((p) => ({ id: p.id, hash: p.current_hash }))), 'primary') : '', can('approvals.decide') ? btn('Aprobar toda la semana ' + (weekStart / 7 + 1), approveWeek) : '',
        btn('Descargar el día (.zip)', async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Preparando…'; try { await downloadDay(d); } catch (x) { flash(x.message); } b.disabled = false; b.textContent = 'Descargar el día (.zip)'; })),
      ...Object.entries(byNet).map(([net, ps]) => el('section', { class: 'panel' }, el('h3', { text: NETS[net] || net }), el('div', { class: 'social-list' }, ps.map(card)))));
  };

  // ── Legal ──
  // Versión global de los textos (todos los países). Se aprueba con un botón, bajo la cuenta del CEO que lo aprieta.
  const GLOBAL_NOTE = 'global-2026-10-22';
  function globalLegal(items) {
    const rows = items.flatMap((d) => d.versions.filter((v) => v.source_note === GLOBAL_NOTE).map((v) => ({ d, v })));
    const box = el('div', { class: 'panel' }, el('h2', { text: 'Textos legales globales (todos los países)' }));
    if (!rows.length) {
      box.append(el('p', { class: 'muted', text: 'Todavía no se cargaron: faltan los datos del titular (nombre o razón social, domicilio y correo de contacto). Cuando estén, se cargan solos con el próximo despliegue.' }));
      return box;
    }
    const pub = rows.filter((x) => x.v.status === 'published').length;
    box.append(el('p', { class: 'small muted', text: pub + ' de ' + rows.length + ' publicados. Leé cada texto antes de aprobar: la aprobación queda registrada a tu nombre y vale solo para esta versión exacta.' }),
      el('p', { class: 'pill-list' }, ...rows.map(({ d, v }) => el('a', { href: '#legaldoc/' + d.id + '/' + v.version + '/' + v.language, class: 'pill ' + (v.status === 'published' ? 'verified' : 'pending'), text: d.name + ' · ' + (LSTATUS[v.status] || v.status) }))));
    if (can('approvals.decide') && pub < rows.length) {
      const out = el('div', { class: 'small' });
      box.append(btn('Aprobar y publicar los textos globales', async () => {
        if (!confirm('¿Aprobás y publicás las ' + (rows.length - pub) + ' versiones globales pendientes? Queda registrado a tu nombre.')) return;
        try {
          const r = await api('/api/admin/legal/global/approve', { method: 'POST', body: {} });
          out.replaceChildren(el('p', { class: 'flash', text: 'Publicados: ' + r.published + ' de ' + r.items.length + '.' }),
            ...r.items.filter((x) => x.status !== 'published').map((x) => el('p', { text: x.doc + ': ' + (x.status === 'incomplete' ? 'tiene datos sin completar' : (LSTATUS[x.status] || x.status)) })));
          setTimeout(() => V.legal(), 1500);
        } catch (e) { out.replaceChildren(el('p', { class: 'flash error', text: e.message })); }
      }, 'primary'), out);
    }
    return box;
  }

  V.legal = async () => {
    const [docs, ov] = await Promise.all([api('/api/admin/legal/documents'), api('/api/admin/company/overview')]);
    const jur = ov.legal.jurisdictions;
    main.replaceChildren(el('h1', { text: 'Legal y cumplimiento' }),
      el('p', { class: 'flash', text: 'Investigación y borradores preparados por agentes: no son asesoramiento jurídico ni reemplazan a un abogado matriculado. Un borrador nunca reemplaza al texto público sin aprobación.' }),
      globalLegal(docs.items),
      el('h2', { text: 'Documentos' }), table(['Documento', 'Versiones', 'Publicada', ''], docs.items.map((d) => {
        const pub = d.versions.filter((v) => v.status === 'published');
        return el('tr', {}, el('td', {}, el('strong', { text: d.name }), d.public_route ? el('small', { class: 'muted', text: ' · ' + d.public_route }) : ''),
          el('td', {}, d.versions.length ? d.versions.map((v) => el('a', { href: '#legaldoc/' + d.id + '/' + v.version + '/' + v.language, class: 'pill ' + (v.status === 'published' ? 'verified' : 'pending'), text: 'v' + v.version + ' ' + v.language + ' · ' + (LSTATUS[v.status] || v.status) })) : el('span', { class: 'muted', text: 'No existe' })),
          el('td', { text: pub.length ? pub.map((v) => v.language + (v.source_note === 'baseline' ? ' (texto actual del sitio, sin revisión profesional)' : '')).join(', ') : '—' }),
          el('td', {}, can('legal.write') ? el('a', { href: '#legaldoc/' + d.id + '/new', text: 'Nuevo borrador' }) : ''));
      })),
      el('h2', { text: 'Matriz por país y región' }),
      el('p', { class: 'small muted', text: 'Un requisito se carga solo con fuente oficial y fecha de verificación. Que exista una fila no significa que se cumpla en ese país.' }),
      table(['País', 'Mercado', 'Estado', 'Requisitos', 'Fuente oficial', 'Verificado', 'Próxima revisión', 'Abogado', 'Pendiente', ''], jur.map((j) => el('tr', {},
        el('td', { text: j.name + ' (' + j.code + ')' }), el('td', { text: j.target_market ? 'Prioritario' + (j.priority ? ' #' + j.priority : '') : 'Candidato' }), el('td', {}, statusTag(JSTATUS, j.status)),
        el('td', { text: j.requirements || '—' }), el('td', {}, j.official_sources ? linkify(j.official_sources) : '—'), el('td', { text: j.verified_at || '—' }), el('td', { text: j.next_review_at || '—' }),
        el('td', { text: j.needs_lawyer ? 'Sí' : 'No' }), el('td', { text: j.pending_action || '—' }), el('td', {}, can('legal.write') ? el('a', { href: '#jurisdiction/' + j.code, text: 'Editar' }) : '')))));
  };

  V.jurisdiction = async (code) => {
    const ov = await api('/api/admin/company/overview');
    const j = ov.legal.jurisdictions.find((x) => x.code === code) || { code, name: '' };
    const F = [['name', 'Nombre'], ['priority', 'Prioridad (1 = primero)'], ['requirements', 'Requisitos aplicables'], ['official_sources', 'Fuente oficial (enlace)'], ['verified_at', 'Fecha de verificación (AAAA-MM-DD)'],
      ['next_review_at', 'Próxima revisión'], ['owner_label', 'Responsable'], ['affected_docs', 'Documentos afectados'], ['risk', 'Riesgo identificado'], ['pending_action', 'Acción pendiente'], ['notes', 'Evidencia y observaciones']];
    const inp = {}; for (const [k] of F) { inp[k] = ['requirements', 'notes'].includes(k) ? el('textarea', {}) : el('input', {}); inp[k].value = j[k] == null ? '' : j[k]; }
    const st = el('select', {}, Object.entries(JSTATUS).map(([k, v]) => el('option', { value: k, selected: k === j.status, text: v })));
    const target = el('input', { type: 'checkbox' }); target.checked = !!j.target_market;
    const lawyer = el('input', { type: 'checkbox' }); lawyer.checked = !!j.needs_lawyer;
    main.replaceChildren(el('p', {}, el('a', { href: '#legal', text: '← Legal' })), el('h1', { text: (j.name || code) + ' (' + code + ')' }),
      el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); const b = {}; for (const [k] of F) b[k] = inp[k].value || null; b.priority = b.priority ? Number(b.priority) : null;
        b.status = st.value; b.target_market = target.checked; b.needs_lawyer = lawyer.checked; act(() => api('/api/admin/legal/jurisdictions/' + code, { method: 'PUT', body: b }), 'Guardado.')(); } },
      F.map(([k, t]) => field(t, inp[k])), field('Estado', st), el('label', { class: 'check' }, target, 'Mercado prioritario'), el('label', { class: 'check' }, lawyer, 'Necesita abogado local'),
      el('button', { class: 'btn primary', type: 'submit', text: 'Guardar' })));
  };

  V.legaldoc = async (arg) => {
    const parts = location.hash.replace(/^#legaldoc\//, '').split('?')[0].split('/');
    const [docId, version, language] = parts;
    void arg;
    if (version === 'new') {
      const body = el('textarea', { class: 'code', rows: 18 }); const langSel = el('select', {}, ['es', 'en'].map((l) => el('option', { value: l, text: l })));
      const note = el('input', { placeholder: 'Origen o notas (fuentes consultadas, fecha)' });
      main.replaceChildren(el('p', {}, el('a', { href: '#legal', text: '← Legal' })), el('h1', { text: 'Nuevo borrador · ' + docId }),
        el('form', { class: 'form', onsubmit: (e) => { e.preventDefault(); act(async () => { const r = await api('/api/admin/legal/documents/' + docId + '/drafts', { method: 'POST', body: { language: langSel.value, body: body.value, note: note.value } }); location.hash = 'legaldoc/' + docId + '/' + r.version + '/' + r.language; }, 'Borrador guardado.')(); } },
          field('Idioma', langSel), field('Texto', body), field('Notas', note), el('button', { class: 'btn primary', type: 'submit', text: 'Guardar borrador' })));
      return;
    }
    const v = await api('/api/admin/legal/documents/' + docId + '/' + version + '/' + language);
    const out = [el('p', {}, el('a', { href: '#legal', text: '← Legal' })), el('h1', { text: docId + ' · versión ' + v.version + ' (' + v.language + ')' }),
      el('p', {}, statusTag(LSTATUS, v.status), v.source_note === 'baseline' ? ' Texto que ya estaba publicado en el sitio; sin revisión profesional.' : (v.source_note ? ' ' + v.source_note : ''),
        v.approval_id ? [' · ', el('a', { href: '#approval/' + v.approval_id, text: 'aprobación' })] : ''),
      el('div', { class: 'panel' }, el('div', { class: 'pre legal-text', text: v.body }))];
    if (can('legal.write') && ['draft', 'lawyer_review'].includes(v.status)) out.push(btn('Enviar a aprobación de los CEO', act(async () => { const r = await api('/api/admin/legal/documents/' + docId + '/' + v.version + '/' + v.language + '/submit', { method: 'POST', body: {} }); location.hash = 'approval/' + r.id; }), 'primary'));
    if (can('approvals.decide') && v.status === 'approved') {
      const ev = el('input', { placeholder: 'Evidencia: commit o despliegue que cambió el texto público' });
      out.push(el('div', { class: 'toolbar' }, ev, btn('Registrar publicación', act(() => api('/api/admin/legal/documents/' + docId + '/' + v.version + '/' + v.language + '/published', { method: 'POST', body: { evidence: ev.value } }), 'Publicación registrada.'))));
    }
    main.replaceChildren(...out);
  };

  // ── Mi seguridad ──
  V.security = async () => {
    const s = await api('/api/admin/security/me');
    const out = [el('h1', { text: 'Mi seguridad' })];
    if (s.require_mfa && !s.mfa_enabled) out.push(el('p', { class: 'flash bad', text: 'La política de la empresa exige verificación en dos pasos: activala para seguir usando el panel.' }));
    const mfa = el('div', { class: 'panel', id: 'mfa-panel' }, el('h3', { text: 'Verificación en dos pasos (MFA)' }));
    if (s.mfa_enabled) {
      const pw = el('input', { type: 'password', placeholder: 'Contraseña', autocomplete: 'current-password' }); const code = el('input', { placeholder: 'Código', inputmode: 'numeric', autocomplete: 'one-time-code' });
      mfa.append(el('p', {}, tag('Activa', 'verified'), ' desde ' + fmt(s.mfa_enabled_at) + ' · ' + s.recovery_left + ' códigos de recuperación sin usar.'),
        el('details', {}, el('summary', { text: 'Desactivar' }), el('div', { class: 'toolbar' }, pw, code, btn('Desactivar MFA', act(() => api('/api/admin/security/mfa/disable', { method: 'POST', body: { password: pw.value, code: code.value } }), 'MFA desactivado.')))));
    } else {
      const start = btn('Configurar', async () => {
        try {
          const r = await api('/api/admin/security/mfa/setup', { method: 'POST', body: {} });
          const code = el('input', { id: 'mfa-code', placeholder: 'Código de 6 dígitos', inputmode: 'numeric', autocomplete: 'one-time-code' });
          const result = el('div');
          mfa.replaceChildren(el('h3', { text: 'Verificación en dos pasos (MFA)' }),
            el('ol', {}, el('li', {}, 'Abrí tu aplicación de autenticación (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).'),
              el('li', {}, 'Agregá una cuenta con esta clave: ', el('code', { id: 'mfa-secret', class: 'secret', text: r.secret.replace(/(.{4})/g, '$1 ').trim() }), ' (o, en el teléfono, ', el('a', { href: r.uri, text: 'abrí este enlace' }), ').'),
              el('li', {}, 'Escribí el código que muestra la aplicación.')),
            el('div', { class: 'toolbar' }, code, btn('Activar', async () => {
              try {
                const e = await api('/api/admin/security/mfa/enable', { method: 'POST', body: { code: code.value } });
                result.replaceChildren(el('div', { class: 'flash ok' }, el('strong', { text: 'MFA activo. ' }), 'Guardá estos códigos de recuperación en un lugar seguro: cada uno sirve una sola vez y no se vuelven a mostrar.'),
                  el('ul', { class: 'codes', id: 'recovery-codes' }, e.recovery_codes.map((c) => el('li', {}, el('code', { text: c })))), el('a', { class: 'btn', href: '#security', text: 'Listo, ya los guardé' }));
              } catch (x) { flash(x.message, false); }
            }, 'primary')), result);
        } catch (x) { flash(x.message, false); }
      }, 'primary');
      mfa.append(el('p', {}, tag('Sin activar', 'failed'), ' Con MFA, una contraseña filtrada no alcanza para entrar.'), start);
    }
    out.push(mfa);
    const title = el('input', { value: s.title || '', placeholder: 'Cargo' }); const name = el('input', { value: s.display_name || '', placeholder: 'Nombre visible' });
    out.push(el('div', { class: 'panel' }, el('h3', { text: 'Perfil' }), el('div', { class: 'toolbar' }, name, title, btn('Guardar', act(() => api('/api/admin/security/profile', { method: 'PATCH', body: { title: title.value, display_name: name.value } }), 'Perfil guardado.')))));
    out.push(el('h2', { text: 'Sesiones abiertas' }), table(['Inicio', 'Última actividad', 'Vence', 'Navegador', 'MFA', ''], s.sessions.map((x) => el('tr', {},
      el('td', { text: fmt(x.created_at) }), el('td', { text: fmt(x.last_seen_at) }), el('td', { text: fmt(x.expires_at) }), el('td', {}, el('small', { text: x.user_agent || '—' })), el('td', { text: x.mfa ? 'Sí' : 'No' }),
      el('td', {}, x.current ? '(esta)' : btn('Cerrar', act(() => api('/api/admin/security/sessions/revoke', { method: 'POST', body: { session: x.id } }), 'Sesión cerrada.'), 'small'))))),
    el('p', {}, btn('Cerrar todas las demás sesiones', act(() => api('/api/admin/security/sessions/revoke', { method: 'POST', body: { others: true } }), 'Listo.'))),
    el('p', { class: 'small muted', text: 'Un acceso desde un dispositivo o red nuevos genera una alerta de seguridad. ¿Perdiste el acceso? Otra persona del equipo con permiso puede generarte un enlace de recuperación desde «Equipo».' }));
    main.replaceChildren(...out);
  };

  // ── Público: aceptar invitación y recuperar cuenta ──
  async function publicTokenView(kind) {
    $('#admin-nav').hidden = true; $('#nav-toggle').hidden = true; $('#logout').hidden = true;
    const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token') || '';
    let info;
    try { const r = await fetch('/api/team/token?token=' + encodeURIComponent(token), { credentials: 'same-origin' }); info = await r.json(); if (!r.ok) throw new Error(info.message || 'El enlace no es válido o venció.'); } catch (e) {
      main.replaceChildren(el('div', { class: 'login-box' }, el('h1', { text: 'Enlace no válido' }), el('p', { text: e.message }), el('a', { class: 'btn', href: '#', text: 'Ir al acceso' }))); return;
    }
    const err = el('p', { class: 'field-error', role: 'alert' });
    const send = async (path, body) => {
      const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: Object.assign({ 'content-type': 'application/json' }, csrf ? { 'x-csrf-token': csrf } : {}), body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.message || d.error || 'Error'); return d;
    };
    const done = (msg) => main.replaceChildren(el('div', { class: 'login-box' }, el('h1', { text: 'Listo' }), el('p', { text: msg }), el('a', { class: 'btn primary', href: '#', onclick: () => { history.replaceState(null, '', '/admin'); setTimeout(() => loginView(), 0); }, text: 'Entrar al panel' })));
    if (kind === 'invite' && info.kind === 'invite') {
      const u = el('input', { id: 'i-user', autocomplete: 'username', required: true }); const n = el('input', { id: 'i-name', value: info.display_name || '' });
      const p = el('input', { id: 'i-pass', type: 'password', autocomplete: 'new-password', required: true }); const p2 = el('input', { id: 'i-pass2', type: 'password', autocomplete: 'new-password', required: true });
      main.replaceChildren(el('form', { class: 'form login-box', id: 'invite-form', onsubmit: async (e) => { e.preventDefault(); err.textContent = '';
        if (p.value !== p2.value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
        try { await send('/api/team/accept', { token, username: u.value, password: p.value, display_name: n.value }); done('Tu cuenta está creada. Entrá y activá la verificación en dos pasos desde «Mi seguridad».'); } catch (x) { err.textContent = x.message; } } },
      el('h1', { text: 'Sumate al equipo' }), el('p', { text: 'Te invitaron como ' + (info.title || info.role) + '. Elegí tu usuario y tu contraseña: nadie más la conoce.' }),
      field('Nombre', n), field('Usuario', u), field('Contraseña (10 caracteres o más)', p), field('Repetir contraseña', p2), err, el('button', { class: 'btn primary', type: 'submit', text: 'Crear mi cuenta' })));
      return;
    }
    if (kind === 'reset' && info.kind === 'reset') {
      const p = el('input', { id: 'r-pass', type: 'password', autocomplete: 'new-password', required: true }); const p2 = el('input', { id: 'r-pass2', type: 'password', autocomplete: 'new-password', required: true });
      main.replaceChildren(el('form', { class: 'form login-box', onsubmit: async (e) => { e.preventDefault(); err.textContent = '';
        if (p.value !== p2.value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
        try { await send('/api/team/reset', { token, password: p.value }); done('Contraseña cambiada. Se cerraron tus sesiones y se quitó la verificación en dos pasos: volvé a activarla al entrar.'); } catch (x) { err.textContent = x.message; } } },
      el('h1', { text: 'Recuperar tu cuenta' }), field('Contraseña nueva', p), field('Repetir contraseña', p2), err, el('button', { class: 'btn primary', type: 'submit', text: 'Guardar' })));
      return;
    }
    main.replaceChildren(el('p', { class: 'flash bad', text: 'El enlace no corresponde a esta página.' }));
  }

  async function route() {
    if (!me) return;
    const [name, arg] = location.hash.replace(/^#/, '').split('?')[0].split('/');
    const view = V[name || 'dashboard'] ? (name || 'dashboard') : 'dashboard';
    const PARENT = { player: 'players', game: 'games', clue: 'catalog', submission: 'submissions', source: 'sources', bankaudit: 'bank',
      agent: 'company', task: 'tasks', approval: 'approvals', piece: 'content', socialday: 'social', legaldoc: 'legal', jurisdiction: 'legal' };
    const navKey = PARENT[view] || view;
    document.querySelectorAll('#admin-nav a').forEach((a) => {
      const on = a.getAttribute('href') === '#' + navKey;
      a.classList.toggle('active', on); if (on) { a.setAttribute('aria-current', 'page'); $('#nav-current').textContent = '· ' + a.textContent; } else a.removeAttribute('aria-current');
    });
    $('#nav-toggle').setAttribute('aria-expanded', 'false');
    try { await V[view](arg); main.focus({ preventScroll: true }); } catch (e) {
      if (e.status === 401) return loginView('La sesión expiró.');
      main.replaceChildren(el('p', { class: 'flash bad', text: e.status === 403 ? 'Tu rol no tiene permiso para esta sección.' : 'Error: ' + e.message }));
    }
  }
  window.addEventListener('hashchange', route);
  $('#nav-toggle').addEventListener('click', (e) => { const b = e.currentTarget; b.setAttribute('aria-expanded', b.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'); });
  boot().catch(() => loginView());
})();
