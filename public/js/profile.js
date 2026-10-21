/* Play Crípticos: perfil personal del jugador. Se carga solo en «Mi perfil».
   Cada número sale de la API (/api/me/*), que lo calcula con las partidas reales. */
(function () {
  'use strict';

  const C = window.__cripta;
  const root = document.getElementById('profile-root');
  if (!C || !root) return;
  const { el, t, api, route, toast, authReady, countryName, meta, store } = C;
  const BOOT = JSON.parse(document.getElementById('boot').textContent);
  const L = BOOT.lang;
  const PT = BOOT.ptext;
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), PT);
  const fill = (s, vars) => { let out = String(s); for (const [a, b] of Object.entries(vars || {})) out = out.split('{' + a + '}').join(b); return out; };
  const p = (path, vars) => { const v = get(path); return v == null ? path : typeof v === 'string' ? fill(v, vars) : v; };
  const nf = new Intl.NumberFormat(L);
  const num = (n) => (n == null ? p('none') : nf.format(n));
  const pct = (n) => (n == null ? p('none') : nf.format(n) + (L === 'es' ? ' %' : '%'));
  const ms = (v) => {
    if (v == null) return p('none');
    const s = Math.round(v / 1000);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s';
    return Math.floor(s / 3600) + ' h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ' min';
  };
  const date = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString(L, { day: 'numeric', month: 'short', year: 'numeric' }) : p('none'));
  const shortDate = (iso) => { const d = new Date(iso); return d.toLocaleDateString(L, d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' }); };
  const clock = (iso) => new Date(iso).toLocaleTimeString(L, { hour: '2-digit', minute: '2-digit' });
  const mech = (m) => t('mech_' + m);
  const svgNS = 'http://www.w3.org/2000/svg';
  const S = (tag, attrs, ...kids) => {
    const n = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) add(n, k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  // append/replaceChildren escriben «null» si reciben null: estas versiones lo omiten.
  const clean = (k) => k.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false && x !== '');
  const add = (n, ...k) => n.append(...clean(k));
  const put = (n, ...k) => n.replaceChildren(...clean(k));
  const errText = (e) => (e && e.data && e.data.message && e.data.message !== e.data.error ? e.data.message : t('error_generic'));

  let me = null; let sum = null; let M = null;
  const isUser = () => !!me;
  const prefs = () => (sum && sum.account ? sum.account.prefs : { recommendations: true, achievement_notifications: store.get('cripta.ach_notify') !== false, xp: true });

  // ── Piezas comunes ──
  const loading = () => el('div', { class: 'skeleton', 'aria-label': p('loading') }, el('i', { class: 'big' }), el('i'), el('i', { class: 'mid' }));
  const failBox = (retry) => el('div', { class: 'notice error', role: 'alert' }, el('p', { text: p('error') }), retry ? el('button', { class: 'btn small', type: 'button', text: p('retry'), onclick: retry }) : null);
  const section = (title, ...kids) => el('section', { class: 'pf-sec' }, title ? el('h2', { text: title }) : null, ...kids);
  const emptyBox = (title, lead, cta) => el('div', { class: 'empty pf-empty' }, el('p', { class: 'serif', text: title }), lead ? el('p', { class: 'muted', text: lead }) : null, cta || null);
  const needAccount = () => emptyBox(p('account_needed'), p('account_needed_lead'), el('a', { class: 'btn primary', href: route('account'), text: p('create_account') }));
  const def = (text) => el('details', { class: 'def' }, el('summary', {}, el('span', { class: 'sr-only', text: p('what_is') }), el('span', { 'aria-hidden': 'true', text: '?' })), el('p', { text }));
  function kpi(key, value, extra) {
    const [label, definition] = get('k.' + key) || [key, ''];
    return el('div', { class: 'kpi', 'data-k': key }, el('div', { class: 'kpi-top' }, el('span', { class: 'kpi-label', text: label }), def(definition)),
      el('b', { class: 'kpi-value', text: value }), extra ? el('span', { class: 'kpi-extra', text: extra }) : null);
  }
  const langName = (code) => { const l = M && M.languages.find((x) => x.code === code); return l ? l.name_native : String(code || '').toUpperCase(); };
  const variantName = (code) => { const v = M && M.variants.find((x) => x.code === code); return v ? v.name_native : code; };
  const choiceName = (c) => (!c ? p('none') : c.includes('-') ? variantName(c) : langName(c));
  const catName = (slug) => { const c = M && M.categories.find((x) => x.slug === slug); return c ? (L === 'es' ? c.name_es : c.name_en) : slug; };
  const resultTag = (status) => el('span', { class: 'res res-' + (status === 'started' || status === 'in_progress' ? 'open' : status), text: p('r_' + status) });
  const levelName = (n) => (get('level_names') || [])[n - 1] || '';
  const pager = (page, per, total, go) => {
    const pages = Math.max(1, Math.ceil(total / per));
    if (pages <= 1) return null;
    return el('nav', { class: 'pager', 'aria-label': p('page', { p: page, n: pages }) },
      el('button', { class: 'btn small', type: 'button', disabled: page <= 1, text: p('prev'), onclick: () => go(page - 1) }),
      el('span', { class: 'pos', text: p('page', { p: page, n: pages }) }),
      el('button', { class: 'btn small', type: 'button', disabled: page >= pages, text: p('next'), onclick: () => go(page + 1) }));
  };
  const select = (attrs, options, value) => el('select', attrs, options.map(([v, label]) => el('option', { value: v, selected: String(v) === String(value ?? ''), text: label })));
  const field = (label, control) => el('label', { class: 'field' }, el('span', { text: label }), control);

  // ── Avatar e insignias (dibujos propios) ──
  function avatar(code, name, big) {
    const m = /^(.+)-([0-7])$/.exec(code || '');
    const glyph = m ? m[1] : (String(name || '?').trim()[0] || '?').toUpperCase();
    return el('span', { class: 'pf-avatar av-' + (m ? m[2] : 'x') + (big ? ' big' : ''), 'aria-hidden': 'true', text: glyph });
  }
  const BADGE_SHAPE = {
    first_steps: 'M24 3 43 14v20L24 45 5 34V14z',
    precision: 'M24 3a21 21 0 1 1 0 42a21 21 0 1 1 0-42z',
    mastery: 'M24 2 46 24 24 46 2 24z',
    consistency: 'M8 4h32a4 4 0 0 1 4 4v32a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z',
    exploration: 'M24 3 43 9v14c0 11-8 19-19 23C13 42 5 34 5 23V9z',
  };
  const BADGE_GLYPH = {
    solved: 'M15 25l6 6 12-13', day_streak: 'M14 31c0-7 10-9 8-18 6 4 12 10 12 17a10 10 0 0 1-20 1z', consecutive: 'M12 30l6-12 6 12 6-12 6 12',
    expert: 'M24 13l3.3 6.8 7.5 1.1-5.4 5.3 1.3 7.4L24 30l-6.7 3.6 1.3-7.4-5.4-5.3 7.5-1.1z', no_hints: 'M17 17l14 14M31 17 17 31M24 12a12 12 0 1 0 0 24a12 12 0 1 0 0-24',
    mechanisms: 'M14 16h20M14 24h20M14 32h12', languages: 'M13 17h14M20 13v4M16 17c1 6 5 10 10 12M25 17c-1 6-5 10-11 13M28 33l5-12 5 12M30 29h6',
    days_played: 'M14 15h20v19H14zM14 21h20M19 12v5M29 12v5', completed: 'M15 33V15h14l-3 5 3 5H15', comeback: 'M33 20a10 10 0 1 0 1 9M33 12v8h-8',
    categories: 'M24 12l12 7v10l-12 7-12-7V19z', category_complete: 'M14 24l7 7 13-14M12 12h24v24H12z',
  };
  function badge(family, group, earned, tier) {
    return S('svg', { class: 'badge' + (earned ? ' on' : ''), viewBox: '0 0 48 48', 'aria-hidden': 'true', width: 56, height: 56 },
      S('path', { class: 'b-shape', d: BADGE_SHAPE[group] || BADGE_SHAPE.precision }),
      S('path', { class: 'b-glyph', d: BADGE_GLYPH[family] || BADGE_GLYPH.solved }),
      tier ? S('text', { class: 'b-tier', x: 24, y: 44.5, 'text-anchor': 'middle' }, ['', 'I', 'II', 'III', 'IV', 'V'][tier] || tier) : null);
  }
  const achName = (code) => {
    const m = /^(.+)_(\d+)$/.exec(code);
    const [name] = get('ach.' + m[1]) || [code];
    return name + ' · ' + nf.format(Number(m[2]));
  };

  // ── Gráficos (SVG accesibles, con vista de tabla) ──
  // Paleta validada: serie 1 azul, serie 2 naranja (ver docs/PERFIL.md); un solo eje.
  function chart({ title, labels, series, kind = 'bar', fmt = num, yMax }) {
    const W = 640; const H = 240; const padL = fmt === ms ? 70 : 42; const padB = 26; const padT = 12; const padR = 10;
    const all = series.flatMap((s) => s.values).filter((v) => v != null);
    const top = yMax != null ? yMax : Math.max(1, ...all);
    const nice = (() => { const mag = Math.pow(10, Math.floor(Math.log10(top))); const f = top / mag; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag; })();
    // Conteos chicos: el eje usa enteros (0, 1, 2…) en vez de 1,3 o 3,8.
    const counts = fmt === num && all.every(Number.isInteger) && top <= 20;
    const ymax = yMax != null ? yMax : counts ? 4 * Math.ceil(top / 4) : nice;
    const n = labels.length; const iw = W - padL - padR; const ih = H - padT - padB;
    const x = (i) => padL + (n <= 1 ? iw / 2 : (kind === 'bar' ? (i + 0.5) * (iw / n) : (i * iw) / (n - 1)));
    const y = (v) => padT + ih - (v / ymax) * ih;
    const g = S('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': title });
    for (let k = 0; k <= 4; k++) {
      const v = (ymax * k) / 4; const yy = y(v);
      add(g, S('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: k === 0 ? 'axis' : 'grid' }), S('text', { x: padL - 6, y: yy + 4, 'text-anchor': 'end', class: 'tick' }, fmt(Math.round(v * 10) / 10)));
    }
    const marks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => n > 0 && a.indexOf(v) === i);
    for (const i of marks) add(g, S('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle', class: 'tick' }, labels[i]));
    series.forEach((s, si) => {
      if (kind === 'bar') {
        const bw = Math.max(2, (iw / n) * (series.length > 1 ? 0.38 : 0.7));
        s.values.forEach((v, i) => {
          if (v == null) return;
          const bx = x(i) - (series.length > 1 ? (si === 0 ? bw : 0) : bw / 2);
          add(g, S('rect', { x: bx, y: y(v), width: bw, height: Math.max(0, padT + ih - y(v)), class: 'bar s' + (si + 1) }, S('title', {}, `${labels[i]} · ${s.name}: ${fmt(v)}`)));
        });
      } else {
        let d = ''; let pen = false;
        s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
        if (d) add(g, S('path', { d, class: 'line s' + (si + 1) }));
        s.values.forEach((v, i) => { if (v != null) add(g, S('circle', { cx: x(i), cy: y(v), r: n > 40 ? 2 : 3.5, class: 'dot s' + (si + 1) }, S('title', {}, `${labels[i]} · ${s.name}: ${fmt(v)}`))); });
      }
    });
    const table = el('table', { class: 'pf-table compact', hidden: true },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: p('c_date') }), series.map((s) => el('th', { scope: 'col', text: s.name })))),
      el('tbody', {}, labels.map((lab, i) => el('tr', {}, el('th', { scope: 'row', text: lab }), series.map((s) => el('td', { text: s.values[i] == null ? p('none') : fmt(s.values[i]) }))))));
    const toggle = el('button', { class: 'link-btn', type: 'button', text: p('as_table'), 'aria-expanded': 'false', onclick: () => {
      const show = table.hidden; table.hidden = !show; g.style.display = show ? 'none' : ''; toggle.textContent = show ? p('as_chart') : p('as_table'); toggle.setAttribute('aria-expanded', String(show));
    } });
    return el('figure', { class: 'chart' }, el('figcaption', {}, el('span', { class: 'chart-title', text: title }),
      series.length > 1 ? el('span', { class: 'legend' }, series.map((s, si) => el('span', { class: 'key s' + (si + 1), text: s.name }))) : null, toggle), g, table);
  }
  function barList(items, { label, value, fmt = num, max, note }) {
    const top = max || Math.max(1, ...items.map(value).filter((v) => v != null));
    return el('ul', { class: 'barlist' }, items.map((it) => {
      const v = value(it);
      return el('li', {}, el('span', { class: 'bl-label', text: label(it) }),
        el('span', { class: 'bl-track', 'aria-hidden': 'true' }, el('i', { style: 'width:' + (v == null ? 0 : Math.max(1, (v / top) * 100)) + '%' })),
        el('span', { class: 'bl-value', text: v == null ? p('none') : fmt(v) }), note ? el('span', { class: 'bl-note', text: note(it) }) : null);
    }));
  }

  // ── Cabecera ──
  function header() {
    const a = sum.account; const s = sum.stats || {}; const pr = prefs();
    const prefsLocal = C.getPrefs() || {};
    const name = a ? (a.public_name || a.username) : p('guest');
    const metaBits = a ? [p('joined', { d: date(a.joined_at) }), (get('country') + ': ' + (a.country ? countryName(a.country) : p('no_country'))), get('language') + ': ' + choiceName(a.choice)]
      : [get('language') + ': ' + choiceName(prefsLocal.choice), prefsLocal.country ? get('country') + ': ' + countryName(prefsLocal.country) : null].filter(Boolean);
    const lv = sum.level;
    const quick = [
      [p('k.day_streak')[0], num(s.day_streak || 0) + ' / ' + num(s.day_streak_best || 0), p('k.day_streak_best')[0].toLowerCase()],
      [p('k.unique_solved')[0], num(s.unique_solved || 0)],
      [p('k.games')[0], num(s.games || 0)],
      [p('k.active_ms')[0], ms(s.active_ms || 0)],
      [p('k.solve_rate')[0], pct(s.solve_rate)],
    ];
    return el('header', { class: 'pf-head' },
      el('div', { class: 'pf-id' }, avatar(a && a.avatar, a ? name : '?', true),
        el('div', {}, el('p', { class: 'eyebrow', text: t('nav_profile') }), el('h1', { text: name }),
          el('p', { class: 'pf-meta', text: metaBits.join(' · ') }),
          a && pr.xp !== false ? el('div', { class: 'pf-level' }, el('span', { class: 'lv-name' }, el('b', { text: p('level', { n: lv.level }) }), ' · ' + levelName(lv.level)),
            el('span', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(lv.progress * 100)),
              'aria-label': lv.next ? p('level_progress', { xp: num(lv.xp), next: num(lv.next), n: lv.level + 1 }) : p('level_max', { xp: num(lv.xp) }) }, el('i', { style: '--v:' + Math.round(lv.progress * 100) + '%' })),
            el('span', { class: 'small muted', text: lv.next ? p('level_progress', { xp: num(lv.xp), next: num(lv.next), n: lv.level + 1 }) : p('level_max', { xp: num(lv.xp) }) })) : null,
          !a ? el('p', { class: 'small muted pf-guest', text: p('guest_lead') }) : null)),
      el('dl', { class: 'pf-quick' }, quick.map(([k, v, x]) => el('div', {}, el('dt', { text: k }), el('dd', {}, v, x ? el('span', { class: 'sr-only', text: ' (' + x + ')' }) : null)))),
      el('div', { class: 'pf-actions' },
        a ? el('a', { class: 'btn small', href: '#settings', text: p('edit') }) : el('a', { class: 'btn small primary', href: route('account'), text: p('create_account') }),
        el('a', { class: 'btn small', href: '#history', text: p('see_history') }), el('a', { class: 'btn small', href: '#progress', text: p('see_stats') })));
  }

  const TABS = ['summary', 'history', 'progress', 'strengths', 'achievements', 'records', 'goals', 'library', 'leaderboard', 'settings'];
  function tabsNav(active) {
    return el('nav', { class: 'pf-tabs', 'aria-label': p('tabs_label') }, el('ul', {}, TABS.map((k) => el('li', {}, el('a', { href: '#' + k, 'aria-current': k === active ? 'page' : null, text: p('tabs.' + k) })))));
  }

  // ── Resumen ──
  async function Summary(box) {
    const s = sum.stats;
    if (sum.link_offer) add(box, linkOffer(sum.link_offer.games));
    if (!sum.has_data) {
      add(box, emptyBox(p('empty_title'), p('empty_lead'), el('a', { class: 'btn primary', href: route('play'), text: p('play_now') })));
      add(box, await recoBlock());
      return;
    }
    add(box, section(p('sec_overview'), el('div', { class: 'kpis' },
      kpi('unique_solved', num(s.unique_solved), s.unique_attempted ? `${num(s.unique_attempted)} ${L === 'es' ? 'distintos jugados' : 'distinct played'}` : null),
      kpi('games', num(s.games)), kpi('completed', num(s.completed)), kpi('solved_games', num(s.solved_games)),
      kpi('revealed', num(s.revealed)), kpi('abandoned', num(s.abandoned + s.expired)), kpi('solve_rate', pct(s.solve_rate)),
      kpi('median_solve_ms', ms(s.median_solve_ms)), kpi('avg_solve_ms', ms(s.avg_solve_ms)), kpi('best_solve_ms', ms(s.best_solve_ms)),
      kpi('active_ms', ms(s.active_ms)), kpi('day_streak', num(s.day_streak)), kpi('day_streak_best', num(s.day_streak_best)),
      kpi('consecutive_best', num(s.consecutive_best)), kpi('hints', num(s.hints)), kpi('languages', num(s.languages)),
      kpi('categories', num(s.categories)), kpi('mechanisms_tried', num(s.mechanisms_tried)), kpi('mechanisms_mastered', num(s.mechanisms_mastered)))));
    if (sum.account && prefs().xp !== false) {
      add(box, el('details', { class: 'pf-rules' }, el('summary', { text: p('xp_rules') }), el('ul', {}, get('xp_rules_text').map((x) => el('li', { text: x })))));
    }
    const cols = el('div', { class: 'pf-cols' });
    add(box, cols);
    const recent = await api('/api/me/history?per=10');
    add(cols, section(p('sec_recent'), el('ul', { class: 'mini-games' }, recent.items.slice(0, 6).map((g) => el('li', {},
      el('a', { href: '#game/' + g.id, class: 'clue-text', text: g.clue_text }),
      el('span', { class: 'small muted' }, resultTag(g.status), ' · ' + date(g.started_at) + (g.status === 'solved' && g.duration_ms ? ' · ' + ms(g.duration_ms) : ''))))),
    el('a', { class: 'link-btn', href: '#history', text: p('all_history') + ' →' })));
    const recentAch = sum.achievements.recent;
    add(cols, section(p('sec_ach_recent'), recentAch.length ? el('ul', { class: 'mini-ach' }, recentAch.map((a) => {
      const fam = a.code.replace(/_\d+$/, ''); const grp = (BOOT.achGroups || {})[fam];
      return el('li', {}, badge(fam, grp, true), el('span', {}, el('b', { text: achName(a.code) }), el('span', { class: 'small muted', text: date(a.earned_at) })));
    })) : el('p', { class: 'muted', text: p('ach_count', { e: num(sum.achievements.earned), t: num(sum.achievements.total) }) }),
    el('a', { class: 'link-btn', href: '#achievements', text: p('all_achievements') + ' →' })));
    add(box, await calendarBlock());
    add(box, await recoBlock());
  }

  function linkOffer(n) {
    const box = el('div', { class: 'notice info pf-link', role: 'region', 'aria-label': p('link_title', { n }) },
      el('p', {}, el('b', { text: p('link_title', { n: num(n) }) }), el('br'), p('link_lead')),
      el('div', { class: 'form-actions' },
        el('button', { class: 'btn small ink', type: 'button', id: 'link-yes', text: p('link_yes'), onclick: async (e) => {
          e.target.setAttribute('aria-busy', 'true');
          try { const r = await api('/api/me/link-anonymous', { method: 'POST', body: { confirm: true } }); toast(p('link_done', { n: num(r.games) })); await reload(); }
          catch (err) { toast(errText(err)); e.target.removeAttribute('aria-busy'); }
        } }),
        el('button', { class: 'btn small quiet', type: 'button', text: p('link_no'), onclick: () => box.remove() })));
    return box;
  }

  // Calendario de actividad (estilo contribuciones), con alternativa de texto.
  async function calendarBlock() {
    const wrap = el('div', {});
    const per = select({ 'aria-label': p('cal_period'), id: 'cal-period' }, [[182, p('cal_6')], [365, p('cal_12')], [730, p('cal_24')]], store.get('cripta.cal') || 365);
    async function draw() {
      put(wrap, loading());
      try {
        const d = await api('/api/me/calendar?days=' + per.value);
        store.set('cripta.cal', Number(per.value), false);
        const map = new Map(d.items.map((x) => [x.day, x]));
        const DAY = 86400000;
        const end = Date.parse(new Date().toISOString().slice(0, 10));
        let start = Date.parse(d.since);
        start -= ((new Date(start).getUTCDay() + 6) % 7) * DAY; // lunes
        const weeks = Math.ceil((end - start + DAY) / (7 * DAY));
        const cell = 12; const gap = 3; const left = 26; const topPad = 16;
        const max = Math.max(1, ...d.items.map((x) => x.games));
        const lvl = (g) => (!g ? 0 : g <= max * 0.25 ? 1 : g <= max * 0.5 ? 2 : g <= max * 0.75 ? 3 : 4);
        const g = S('svg', { viewBox: `0 0 ${left + weeks * (cell + gap)} ${topPad + 7 * (cell + gap)}`, class: 'heat', role: 'img', 'aria-label': p('sec_calendar') });
        const dows = L === 'es' ? ['L', '', 'X', '', 'V', '', 'D'] : ['M', '', 'W', '', 'F', '', 'S'];
        dows.forEach((x, i) => x && add(g, S('text', { x: 0, y: topPad + i * (cell + gap) + cell - 2, class: 'tick' }, x)));
        let lastMonth = -1; let lastLabelW = -9;
        for (let w = 0; w < weeks; w++) {
          for (let dd = 0; dd < 7; dd++) {
            const tday = start + (w * 7 + dd) * DAY;
            if (tday > end) continue;
            const key = new Date(tday).toISOString().slice(0, 10);
            if (key < d.since) continue;
            const it = map.get(key);
            const m = new Date(tday).getUTCMonth();
            if (dd === 0 && m !== lastMonth && w - lastLabelW >= 3) { lastMonth = m; lastLabelW = w; add(g, S('text', { x: left + w * (cell + gap), y: 10, class: 'tick' }, new Date(tday).toLocaleDateString(L, { month: 'short', timeZone: 'UTC' }))); }
            add(g, S('rect', { x: left + w * (cell + gap), y: topPad + dd * (cell + gap), width: cell, height: cell, rx: 2, class: 'hm hm-' + lvl(it ? it.games : 0) },
              S('title', {}, it ? p('cal_cell', { d: date(key), g: num(it.games), s: num(it.solved) }) : p('cal_cell_none', { d: date(key) }))));
          }
        }
        const totals = d.items.reduce((a, x) => ({ g: a.g + x.games, s: a.s + x.solved }), { g: 0, s: 0 });
        put(wrap, el('div', { class: 'heat-scroll' }, g),
          el('div', { class: 'heat-legend' }, el('span', { class: 'small muted', text: p('cal_summary', { days: num(d.items.length), games: num(totals.g), solved: num(totals.s) }) }),
            el('span', { class: 'scale', 'aria-hidden': 'true' }, p('cal_less'), [0, 1, 2, 3, 4].map((i) => el('i', { class: 'hm-' + i })), p('cal_more'))),
          el('details', { class: 'pf-rules' }, el('summary', { text: p('cal_text') }), d.items.length ? el('ul', { class: 'plain-list small' }, [...d.items].reverse().map((x) => el('li', { text: p('cal_cell', { d: date(x.day), g: num(x.games), s: num(x.solved) }) }))) : el('p', { class: 'muted', text: p('none') })),
          el('p', { class: 'small muted', text: p('cal_note') }));
      } catch (e) { put(wrap, failBox(draw)); }
    }
    per.addEventListener('change', draw);
    await draw();
    return el('section', { class: 'pf-sec' }, el('div', { class: 'sec-head' }, el('h2', { text: p('sec_calendar') }), field(p('cal_period'), per)), wrap);
  }

  async function recoBlock() {
    const choice = (sum.account && sum.account.choice) || (C.getPrefs() || {}).choice || L;
    let r;
    try { r = await api('/api/me/recommendations?choice=' + encodeURIComponent(choice)); } catch (e) { return failBox(); }
    if (r.disabled) return section(p('sec_reco'), el('p', { class: 'muted', text: p('reco_off') }));
    if (!r.items.length) return section(p('sec_reco'), el('p', { class: 'muted', text: p('reco_thin') }));
    return section(p('sec_reco'), el('ul', { class: 'reco' }, r.items.map((it) => {
      const [title, body] = get('reco.' + it.kind);
      const vars = { m: it.mechanism ? mech(it.mechanism) : '', rate: it.solve_rate != null ? nf.format(it.solve_rate) : '', n: num(it.available), d: it.difficulty, h: it.hints_per_game != null ? nf.format(it.hints_per_game) : '', v: it.variant ? variantName(it.variant) : '' };
      const q = new URLSearchParams(Object.entries(it.params || {}).filter(([, v]) => v != null));
      return el('li', {}, el('div', {}, el('b', { text: fill(title, vars) }), el('p', { class: 'small muted', text: fill(body, vars) })),
        el('a', { class: 'btn small', href: route('play') + (q.toString() ? '?' + q : ''), text: p('reco_go') }));
    })), !r.enough_data ? el('p', { class: 'small muted', text: p('reco_thin') }) : null);
  }

  // ── Historial ──
  const hq = { page: 1, sort: 'recent' };
  async function History(box) {
    const m = M;
    const f = el('form', { class: 'pf-filters', role: 'search', id: 'history-filters' });
    const inp = (name, attrs) => el('input', Object.assign({ name, value: hq[name] || '' }, attrs));
    const mechs = ['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone', 'double_definition', 'initials', 'cryptic_definition'];
    add(f, 
      field(p('f_search'), inp('q', { type: 'search', maxlength: '60' })),
      field(p('f_from'), inp('from', { type: 'date' })), field(p('f_to'), inp('to', { type: 'date' })),
      field(p('f_lang'), select({ name: 'lang' }, [['', p('f_any')], ...m.languages.filter((l) => l.enabled).map((l) => [l.code, l.name_native])], hq.lang)),
      field(p('f_difficulty'), select({ name: 'difficulty' }, [['', p('f_any')], ...[1, 2, 3, 4, 5].map((d) => [d, d + ' · ' + t('diff_' + d)])], hq.difficulty)),
      field(p('f_category'), select({ name: 'category' }, [['', p('f_any')], ...m.categories.map((c) => [c.slug, L === 'es' ? c.name_es : c.name_en])], hq.category)),
      field(p('f_mechanism'), select({ name: 'mechanism' }, [['', p('f_any')], ...mechs.map((x) => [x, mech(x)])], hq.mechanism)),
      field(p('f_result'), select({ name: 'result' }, [['', p('f_any')], ...['solved', 'revealed', 'abandoned', 'expired', 'open'].map((x) => [x, p('r_' + x)])], hq.result)),
      field(p('f_time'), select({ name: 'time' }, [['', p('f_any')], ['under1', p('t_under1')], ['1to5', p('t_1to5')], ['over5', p('t_over5')]], hq.time)),
      field(p('f_hints'), select({ name: 'hints' }, [['', p('f_any')], ['none', p('h_none')], ['used', p('h_used')]], hq.hints)),
      field(p('f_mode'), select({ name: 'mode' }, [['', p('f_any')], ...['infinite', 'quick', 'beginner', 'intermediate', 'expert', 'guided', 'timed', 'themed', 'streak', 'daily', 'shared', 'practice'].map((x) => [x, t('mode_' + x)])], hq.mode)),
      field(p('f_sort'), select({ name: 'sort' }, ['recent', 'oldest', 'fastest', 'slowest', 'hints', 'difficulty'].map((x) => [x, p('s_' + x)]), hq.sort)),
      el('div', { class: 'filters-actions' }, el('button', { class: 'btn ink small', type: 'submit', text: p('f_apply') }),
        el('button', { class: 'link-btn', type: 'button', text: p('f_clear'), onclick: () => { for (const k of Object.keys(hq)) delete hq[k]; hq.page = 1; hq.sort = 'recent'; route_(); } })));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      for (const [k, v] of new FormData(f).entries()) { if (v) hq[k] = v; else delete hq[k]; }
      hq.page = 1; load();
    });
    const out = el('div', { 'aria-live': 'polite' });
    add(box, el('details', { class: 'pf-filter-box', open: window.matchMedia('(min-width: 900px)').matches || Object.keys(hq).length > 2 }, el('summary', { text: p('f_apply') + ' · ' + p('f_sort') }), f), out);
    async function load() {
      put(out, loading());
      try {
        const qs = new URLSearchParams(Object.entries(hq).filter(([, v]) => v !== '' && v != null));
        const h = await api('/api/me/history?' + qs);
        if (!h.items.length) { put(out, emptyBox(p('history_none'), null, sum.has_data ? null : el('a', { class: 'btn primary', href: route('play'), text: p('play_now') }))); return; }
        const cols = ['c_date', 'c_time_local', 'c_clue', 'c_lang', 'c_difficulty', 'c_mode', 'c_result', 'c_time', 'c_attempts', 'c_hints', 'c_revealed', 'c_xp', 'c_mechanism', 'c_details'];
        const cell = (k, v) => el('td', { 'data-label': p(k) }, v);
        put(out, el('p', { class: 'small muted', text: p('history_total', { n: num(h.total) }) }),
          el('div', { class: 'table-wrap' }, el('table', { class: 'pf-table history' },
            el('caption', { class: 'sr-only', text: p('tabs.history') }),
            el('thead', {}, el('tr', {}, cols.map((k) => el('th', { scope: 'col', text: p(k) })))),
            el('tbody', {}, h.items.map((g) => el('tr', {},
              cell('c_date', el('span', { class: 'nowrap', title: date(g.started_at), text: shortDate(g.started_at) })), cell('c_time_local', clock(g.started_at)),
              cell('c_clue', el('span', { class: 'clue-cell' }, el('a', { href: '#game/' + g.id, text: g.clue_text }), g.status === 'solved' ? el('span', { class: 'tag ' + (g.first_solve ? 'new' : ''), text: g.first_solve ? p('first_time') : p('repeat') }) : null)),
              cell('c_lang', g.variant_code ? variantName(g.variant_code) : langName(g.language_code)),
              cell('c_difficulty', el('span', { title: t('diff_' + g.difficulty) }, g.difficulty + '/5')),
              cell('c_mode', t('mode_' + g.mode)), cell('c_result', resultTag(g.status)),
              cell('c_time', g.status === 'solved' ? ms(g.duration_ms) : p('none')), cell('c_attempts', num(g.attempts)), cell('c_hints', num(g.hints_used)),
              cell('c_revealed', g.status === 'revealed' ? p('yes') : p('no')), cell('c_xp', g.mode === 'practice' ? p('none') : num(g.xp)),
              cell('c_mechanism', mech(g.mechanism)),
              cell('c_details', el('a', { class: 'btn small', href: '#game/' + g.id, text: p('details_short'), 'aria-label': p('details') + ': ' + g.clue_text }))))))),
          pager(h.page, h.per_page, h.total, (n) => { hq.page = n; load(); box.scrollIntoView({ block: 'start' }); }));
      } catch (e) { put(out, failBox(load)); }
    }
    await load();
  }

  // ── Detalle de partida ──
  async function GameDetail(box, id) {
    const d = await api('/api/me/games/' + encodeURIComponent(id));
    const g = d.game; const c = d.clue;
    add(box, el('a', { class: 'link-btn', href: '#history', text: p('back_history') }));
    const src = c.source || {};
    const origin = src.name ? p('origin_external') + ' · ' + src.name : src.author ? p('origin_community') + ' · ' + p('by_author', { a: src.author }) : p('origin_' + (src.origin || 'original'));
    const facts = [
      [p('c_result'), resultTag(g.status)], [p('d_started'), date(g.started_at) + ' · ' + clock(g.started_at)],
      g.finished_at ? [p('d_finished'), clock(g.finished_at)] : null,
      [p('d_solve'), ms(g.solve_ms)], [p('d_elapsed'), ms(g.elapsed_ms)], [p('d_active'), ms(g.active_ms)],
      [p('c_attempts'), num(g.attempts)], [p('c_hints'), num(g.hints_used)], [p('c_revealed'), g.status === 'revealed' ? p('yes') : p('no')],
      [p('c_difficulty'), c.difficulty + '/5 · ' + t('diff_' + c.difficulty)], [p('c_mechanism'), mech(c.mechanism)], [p('f_category'), catName(c.category)],
      [p('c_lang'), langName(c.language) + (c.variant ? ' · ' + variantName(c.variant) : '')], [p('c_mode'), t('mode_' + g.mode)], [p('d_source'), origin],
    ].filter(Boolean);
    add(box, el('article', { class: 'sheet pf-detail' },
      el('p', { class: 'eyebrow', text: p('d_title') }),
      el('h2', { class: 'clue-text', text: c.clue }),
      d.solution ? el('p', { class: 'pf-answer' }, el('span', { class: 'small muted', text: p('d_answer') + ': ' }), el('b', { text: d.solution.answer })) : el('p', { class: 'notice info' }, p('d_open')),
      !c.available ? el('p', { class: 'notice', text: p('d_unavailable') }) : null,
      el('dl', { class: 'pf-facts' }, facts.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', {}, v))))));
    if (!d.events_recorded) add(box, el('p', { class: 'notice info', text: p('d_no_events') }));
    else {
      add(box, el('div', { class: 'pf-cols' },
        section(p('d_your_answers'), d.attempts.length ? el('ol', { class: 'attempts' }, d.attempts.map((a) => el('li', { class: a.correct ? 'ok' : a.repeated ? 'rep' : 'bad' },
          el('b', { class: 'mono', text: a.answer || '—' }), el('span', { class: 'small muted', text: (a.correct ? p('d_correct') : a.repeated ? p('d_repeated') : p('d_wrong')) + ' · ' + p('d_at', { t: ms(a.t_ms) }) })))) : el('p', { class: 'muted', text: p('d_no_attempts') })),
        section(p('d_hints'), d.hints.length ? el('ol', { class: 'attempts hints' }, d.hints.map((h) => el('li', {},
          el('b', { text: p('hint_' + (h.kind || 'mechanism')) }), el('span', { class: 'small muted', text: p('d_at', { t: ms(h.t_ms) }) + ' · ' + (h.before_first_attempt ? p('d_hint_before') : p('d_hint_after')) })))) : el('p', { class: 'muted', text: p('d_no_hints') }),
        d.reveal_ms != null ? el('p', { class: 'small', text: p('d_revealed_at', { t: ms(d.reveal_ms) }) }) : null,
        d.solved_after_hint ? el('p', { class: 'small', text: p('d_solved_after_hint') }) : null)));
    }
    if (d.solution) {
      add(box, section(p('d_explanation'), el('div', { class: 'explain' },
        d.solution.definition ? el('p', {}, el('b', { text: p('hint_definition') + ': ' }), d.solution.definition) : null,
        el('ol', {}, (d.solution.explanation || []).map((x) => el('li', { text: x }))), d.solution.note ? el('p', { class: 'small muted', text: d.solution.note }) : null)));
    }
    const actions = el('div', { class: 'form-actions pf-detail-actions' },
      el('a', { class: 'btn small primary', href: route('play') + '?mechanism=' + encodeURIComponent(c.mechanism), text: p('d_practice') }),
      c.available ? el('a', { class: 'btn small', href: route('clue', '/' + c.slug), text: p('d_play_again') }) : null);
    if (isUser() && c.available) {
      const fav = el('button', { class: 'btn small', type: 'button', text: p('save_fav'), onclick: async () => { try { await api('/api/me/favorites/' + c.id, { method: 'POST', body: {} }); fav.textContent = p('saved_fav'); fav.disabled = true; } catch (e) { toast(errText(e)); } } });
      const retry = el('button', { class: 'btn small', type: 'button', text: p('add_retry'), onclick: async () => { try { await api('/api/me/retry/' + c.id, { method: 'POST', body: {} }); retry.textContent = p('in_retry'); retry.disabled = true; } catch (e) { toast(errText(e)); } } });
      add(actions, fav, retry);
      const cols = await api('/api/me/collections').catch(() => ({ items: [] }));
      if (cols.items.length) {
        const sel = select({ 'aria-label': p('col_pick') }, [['', p('col_pick')], ...cols.items.map((x) => [x.id, x.name])]);
        add(actions, el('span', { class: 'inline-pick' }, sel, el('button', { class: 'btn small', type: 'button', text: p('add_collection'), onclick: async () => {
          if (!sel.value) { sel.focus(); return; }
          try { await api('/api/me/collections/' + sel.value + '/items', { method: 'POST', body: { clue_id: c.id } }); toast(p('added')); } catch (e) { toast(errText(e)); }
        } })));
      }
    }
    add(box, actions);
    add(box, shareBlock(d));
  }

  function shareBlock(d) {
    const g = d.game;
    if (['started', 'in_progress'].includes(g.status)) return section(p('share_title'), el('p', { class: 'muted', text: p('share_open') }));
    const sh = d.share;
    const time = el('input', { type: 'checkbox', id: 'share-time', checked: sh ? sh.show_time : false });
    const ans = el('input', { type: 'checkbox', id: 'share-answer', checked: sh ? sh.show_answer : false });
    const out = el('div', { class: 'share-out', 'aria-live': 'polite' });
    const show = (token) => {
      const url = location.origin + '/' + L + '/r/' + token;
      put(out, el('input', { readonly: true, value: url, 'aria-label': p('share_title'), id: 'share-url' }),
        el('div', { class: 'form-actions' },
          el('button', { class: 'btn small', type: 'button', text: p('share_copy'), onclick: async () => { try { await navigator.clipboard.writeText(url); toast(p('share_copied')); } catch (e) { const i = out.querySelector('input'); i.select(); } } }),
          el('a', { class: 'btn small', href: '/api/share/' + token + '.svg?lang=' + L, target: '_blank', rel: 'noopener', text: p('share_image') }),
          el('button', { class: 'link-btn', type: 'button', text: p('share_stop'), onclick: async () => { await api('/api/me/games/' + g.id + '/share', { method: 'DELETE', body: {} }); put(out, el('p', { class: 'small', text: p('share_stopped') })); btn.textContent = p('share_create'); } })));
    };
    const btn = el('button', { class: 'btn small ink', type: 'button', id: 'share-create', text: sh ? p('share_update') : p('share_create'), onclick: async () => {
      try { const r = await api('/api/me/games/' + g.id + '/share', { method: 'POST', body: { show_time: time.checked, show_answer: ans.checked } }); show(r.token); btn.textContent = p('share_update'); } catch (e) { toast(errText(e)); }
    } });
    if (sh) show(sh.token);
    return section(p('share_title'), el('p', { class: 'small muted', text: p('share_lead') }),
      el('label', { class: 'check' }, time, el('span', { text: p('share_time') })),
      ['solved', 'revealed'].includes(g.status) ? el('label', { class: 'check' }, ans, el('span', { text: p('share_answer') })) : null, btn, out);
  }

  // ── Evolución ──
  const eq = { days: '90', unit: '' };
  async function Progress(box) {
    const days = select({ name: 'days', id: 'ev-days' }, [['30', p('d30')], ['90', p('d90')], ['180', p('d180')], ['365', p('d365')], ['custom', p('custom')]], eq.from ? 'custom' : eq.days);
    const unit = select({ name: 'unit', id: 'ev-unit' }, [['', p('u_auto')], ['day', p('u_day')], ['week', p('u_week')], ['month', p('u_month')]], eq.unit);
    const from = el('input', { type: 'date', value: eq.from || '', 'aria-label': p('f_from') });
    const to = el('input', { type: 'date', value: eq.to || '', 'aria-label': p('f_to') });
    const custom = el('div', { class: 'pf-inline', hidden: !eq.from }, field(p('f_from'), from), field(p('f_to'), to),
      el('button', { class: 'btn small ink', type: 'button', text: p('f_apply'), onclick: () => { if (from.value && to.value) { eq.from = from.value; eq.to = to.value; load(); } } }));
    days.addEventListener('change', () => { if (days.value === 'custom') { custom.hidden = false; return; } custom.hidden = true; delete eq.from; delete eq.to; eq.days = days.value; load(); });
    unit.addEventListener('change', () => { eq.unit = unit.value; load(); });
    const out = el('div', { 'aria-live': 'polite' });
    add(box, el('div', { class: 'pf-controls' }, field(p('range'), days), field(p('unit'), unit), custom), out);
    async function load() {
      put(out, loading());
      try {
        const qs = new URLSearchParams(Object.entries({ days: eq.from ? '' : eq.days, from: eq.from, to: eq.to, unit: eq.unit }).filter(([, v]) => v));
        const ev = await api('/api/me/evolution?' + qs);
        const fmtLabel = (k) => (ev.unit === 'month' ? new Date(k + '-15T12:00:00Z').toLocaleDateString(L, { month: 'short', year: '2-digit' }) : new Date(k + 'T12:00:00Z').toLocaleDateString(L, { day: 'numeric', month: 'short' }));
        const labels = ev.series.map((s) => fmtLabel(s.t));
        const col = (k) => ev.series.map((s) => s[k]);
        const insightText = (i) => fill(get('in.' + i.kind), {
          from: i.kind.includes('difficulty') ? ms(i.from) : nf.format(i.from), to: i.kind.includes('difficulty') ? ms(i.to) : nf.format(i.to),
          d: i.difficulty, m: i.mechanism ? mech(i.mechanism) : '', rate: i.solve_rate != null ? nf.format(i.solve_rate) : '', t: ms(i.median_solve_ms) });
        const c = ev.current; const pv = ev.previous;
        const row = (label, a, b, fmt) => el('tr', {}, el('th', { scope: 'row', text: label }), el('td', { text: fmt(a) }), el('td', { text: fmt(b) }));
        put(out, 
          section(p('insights'), el('ul', { class: 'insights' }, ev.insights.map((i) => el('li', { class: 'in-' + i.kind, text: insightText(i) })))),
          el('div', { class: 'charts' },
            chart({ title: p('ch_solved'), labels, series: [{ name: p('series_games'), values: col('games') }, { name: p('series_solved'), values: col('solved') }] }),
            chart({ title: p('ch_rate'), labels, kind: 'line', series: [{ name: p('m_rate'), values: col('solve_rate') }], fmt: pct, yMax: 100 }),
            chart({ title: p('ch_median'), labels, kind: 'line', series: [{ name: p('m_median'), values: col('median_solve_ms') }], fmt: ms }),
            chart({ title: p('ch_hints'), labels, kind: 'line', series: [{ name: p('m_hints'), values: col('hints_per_game') }], fmt: (v) => nf.format(v) }),
            chart({ title: p('ch_days'), labels, series: [{ name: p('ch_days'), values: col('days_played') }] })),
          section(p('compare'), el('div', { class: 'table-wrap' }, el('table', { class: 'pf-table compact' },
            el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '' }), el('th', { scope: 'col', text: p('this_period') + ` (${date(ev.from)} – ${date(ev.to)})` }), el('th', { scope: 'col', text: p('prev_period') }))),
            el('tbody', {}, row(p('m_games'), c.games, pv.games, num), row(p('m_solved'), c.solved, pv.solved, num), row(p('m_rate'), c.solve_rate, pv.solve_rate, pct),
              row(p('m_median'), c.median_solve_ms, pv.median_solve_ms, ms), row(p('m_hints'), c.hints_per_game, pv.hints_per_game, (v) => (v == null ? p('none') : nf.format(v))), row(p('m_revealed'), c.revealed, pv.revealed, num))))),
          el('div', { class: 'pf-cols three' },
            section(p('ch_by_diff'), ev.by_difficulty.length ? barList(ev.by_difficulty, { label: (x) => x.key + ' · ' + t('diff_' + x.key), value: (x) => x.solve_rate, fmt: pct, max: 100,
              note: (x) => `${num(x.solved)}/${num(x.closed)} · ${ms(x.median_solve_ms)}${x.previous ? ' · ' + p('prev_period').toLowerCase() + ' ' + pct(x.previous.solve_rate) : ''}` }) : el('p', { class: 'muted', text: p('none') })),
            section(p('ch_by_mech'), ev.by_mechanism.length ? barList(ev.by_mechanism, { label: (x) => mech(x.key), value: (x) => x.games, note: (x) => `${pct(x.solve_rate)} · ${ms(x.median_solve_ms)}` }) : el('p', { class: 'muted', text: p('none') })),
            section(p('ch_by_lang'), ev.by_language.length ? barList(ev.by_language, { label: (x) => langName(x.key), value: (x) => x.games, note: (x) => pct(x.solve_rate) }) : el('p', { class: 'muted', text: p('none') }))));
      } catch (e) { put(out, failBox(load)); }
    }
    await load();
  }

  // ── Fortalezas ──
  async function Strengths(box) {
    const s = await api('/api/me/strengths');
    const lv = (x) => p('lv.' + x.level);
    add(box, el('p', { class: 'lead small', text: p('st_lead') }),
      section(p('st_map'), el('ul', { class: 'strength-map' }, s.items.map((x) => el('li', { class: 'lv-' + x.level },
        el('span', { class: 'sm-name', text: mech(x.mechanism) }), el('span', { class: 'sm-level', text: lv(x) }),
        el('span', { class: 'sm-num', text: x.games ? pct(x.solve_rate) + ' · ' + p('st_games', { n: num(x.games) }) : p('st_available', { n: num(x.available) }) })))),
      el('ul', { class: 'lv-legend small muted' }, Object.keys(get('lv')).map((k) => el('li', { class: 'lv-' + k }, el('b', { text: p('lv.' + k) }), ': ' + p('lv_def.' + k))))),
      section(p('st_table'), el('div', { class: 'table-wrap' }, el('table', { class: 'pf-table history' },
        el('thead', {}, el('tr', {}, [p('c_mechanism'), p('m_games'), p('m_solved'), p('m_rate'), p('m_median'), p('c_hints'), p('tabs.strengths'), p('st_trend'), ''].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, s.items.map((x) => el('tr', {},
          el('td', { 'data-label': p('c_mechanism') }, el('b', { text: mech(x.mechanism) })), el('td', { 'data-label': p('m_games'), text: num(x.games) }),
          el('td', { 'data-label': p('m_solved'), text: num(x.solved || 0) }), el('td', { 'data-label': p('m_rate'), text: pct(x.solve_rate) }),
          el('td', { 'data-label': p('m_median'), text: ms(x.median_solve_ms) }), el('td', { 'data-label': p('c_hints'), text: num(x.hints || 0) }),
          el('td', { 'data-label': p('tabs.strengths') }, el('span', { class: 'lv-pill lv-' + x.level, text: lv(x) })),
          el('td', { 'data-label': p('st_trend'), text: x.trend ? p('st_trend_v', { d: (x.trend.delta > 0 ? '+' : '') + nf.format(x.trend.delta) }) : p('not_enough') }),
          el('td', { 'data-label': '' }, x.available ? el('a', { class: 'btn small', href: route('play') + '?mechanism=' + x.mechanism, text: p('practice') }) : null))))))));
  }

  // ── Logros ──
  async function Achievements(box) {
    const { items } = await api('/api/me/achievements');
    const earned = items.reduce((s, a) => s + a.tiers.filter((x) => x.earned_at).length, 0);
    const total = items.reduce((s, a) => s + a.tiers.length, 0);
    add(box, el('p', { class: 'small muted', text: p('ach_count', { e: num(earned), t: num(total) }) + ' · ' + p('ach_note') }));
    for (const grp of Object.keys(get('groups'))) {
      const fams = items.filter((a) => a.group === grp);
      if (!fams.length) continue;
      add(box, section(p('groups.' + grp), el('ul', { class: 'ach-grid' }, fams.map((a) => {
        const [name, desc] = get('ach.' + a.family);
        const got = a.tiers.filter((x) => x.earned_at).length;
        return el('li', { class: 'ach-card' + (got ? ' on' : '') },
          badge(a.family, a.group, got > 0, a.tiers.length > 1 ? Math.max(1, got) : 0),
          el('div', {}, el('h3', { text: name }),
            el('ul', { class: 'tiers' }, a.tiers.map((x, i) => el('li', { class: x.earned_at ? 'on' : '' },
              el('span', { class: 'tier-cond', text: x.threshold === 1 && get('ach_one.' + a.family) ? get('ach_one.' + a.family) : fill(desc, { n: nf.format(x.threshold) }) }),
              el('span', { class: 'small ' + (x.earned_at ? 'ok' : 'muted'), text: x.earned_at ? p('ach_earned', { d: date(x.earned_at) }) : p('ach_locked') })))),
            a.next ? el('div', { class: 'ach-next' }, el('span', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(a.next.threshold), 'aria-valuenow': String(Math.min(a.value, a.next.threshold)), 'aria-label': p('ach_next', { v: num(Math.min(a.value, a.next.threshold)), n: num(a.next.threshold) }) },
              el('i', { style: '--v:' + Math.round(a.next.progress * 100) + '%' })), el('span', { class: 'small muted', text: p('ach_next', { v: num(Math.min(a.value, a.next.threshold)), n: num(a.next.threshold) }) }))
              : el('p', { class: 'small ok', text: p('ach_all') })));
      }))));
    }
  }

  // ── Récords ──
  const rq = { lang: '' };
  async function Records(box) {
    const scope = select({ id: 'rec-scope' }, [['', p('rec_all')], ...M.languages.filter((l) => l.enabled).map((l) => [l.code, l.name_native])], rq.lang);
    const out = el('div', { 'aria-live': 'polite' });
    scope.addEventListener('change', () => { rq.lang = scope.value; load(); });
    add(box, el('p', { class: 'lead small', text: p('rec_lead') }), el('div', { class: 'pf-controls' }, field(p('rec_scope'), scope)), out);
    async function load() {
      put(out, loading());
      try {
        const r = await api('/api/me/records' + (rq.lang ? '?lang=' + rq.lang : ''));
        if (r.empty || (!r.by_difficulty.length && !r.consecutive_best && !r.best_session)) { put(out, emptyBox(p('rec_none'))); return; }
        const best = r.by_difficulty.reduce((b, x) => (!b || x.ms < b.ms ? x : b), null);
        const card = (label, value, note, href) => el('div', { class: 'rec' }, el('span', { class: 'kpi-label', text: label }), el('b', { class: 'kpi-value', text: value }), note ? (href ? el('a', { class: 'small', href, text: note }) : el('span', { class: 'small muted', text: note })) : null);
        put(out, el('div', { class: 'kpis' },
          card(p('rec_best_time'), best ? ms(best.ms) : p('none'), best ? best.clue_text : null, best ? '#game/' + best.game_id : null),
          card(p('rec_consecutive'), num(r.consecutive_best)),
          r.day_streak_best != null ? card(p('rec_streak'), num(r.day_streak_best)) : null,
          card(p('rec_session'), r.best_session ? num(r.best_session.solved) : p('none'), r.best_session ? p('rec_session_d', { d: date(r.best_session.start) }) : null),
          card(p('rec_week'), r.best_week ? pct(r.best_week.solve_rate) : p('not_enough'), r.best_week ? p('rec_week_d', { d: date(r.best_week.week), s: num(r.best_week.solved), c: num(r.best_week.closed) }) : null),
          card(p('rec_mechs'), num(r.mechanisms_solved))),
        el('div', { class: 'pf-cols' },
          section(p('rec_by_diff'), r.by_difficulty.length ? el('ul', { class: 'mini-games' }, r.by_difficulty.map((x) => el('li', {}, el('b', { text: x.k + ' · ' + t('diff_' + x.k) + ': ' + ms(x.ms) }), el('a', { class: 'small', href: '#game/' + x.game_id, text: x.clue_text })))) : el('p', { class: 'muted', text: p('none') })),
          section(p('rec_by_mech'), r.by_mechanism.length ? el('ul', { class: 'mini-games' }, r.by_mechanism.map((x) => el('li', {}, el('b', { text: mech(x.k) + ': ' + ms(x.ms) }), el('a', { class: 'small', href: '#game/' + x.game_id, text: x.clue_text })))) : el('p', { class: 'muted', text: p('none') }))));
      } catch (e) { put(out, failBox(load)); }
    }
    await load();
  }

  // ── Objetivos ──
  async function Goals(box) {
    if (!isUser()) { add(box, needAccount()); return; }
    add(box, el('p', { class: 'lead small', text: p('goals_lead') }));
    const list = el('div', {});
    const strengths = await api('/api/me/strengths');
    const mechs = strengths.items.filter((x) => x.available).map((x) => x.mechanism);
    function form(goal, done) {
      const kind = select({ name: 'kind' }, Object.keys(get('goal_kind')).map((k) => [k, p('goal_kind.' + k)]), goal ? goal.kind : 'solve');
      const target = el('input', { name: 'target', type: 'number', min: '1', max: '3600', required: true, value: goal ? goal.target : 5, inputmode: 'numeric' });
      const period = select({ name: 'period' }, ['day', 'week', 'month'].map((k) => [k, p('per.' + k)]), goal ? goal.period : 'day');
      const pm = select({ name: 'param_mech' }, mechs.map((x) => [x, mech(x)]), goal && goal.kind === 'mechanism' ? goal.param : mechs[0]);
      const pl = select({ name: 'param_lang' }, M.languages.filter((l) => l.enabled).map((l) => [l.code, l.name_native]), goal && goal.kind === 'language' ? goal.param : L);
      const fm = field(p('param_mech'), pm); const fl = field(p('param_lang'), pl); const ft = field(p('target'), target);
      const sync = () => { fm.hidden = kind.value !== 'mechanism'; fl.hidden = kind.value !== 'language'; ft.firstChild.textContent = kind.value === 'median_time' ? p('target_s') : p('target'); };
      kind.addEventListener('change', sync); sync();
      const err = el('p', { class: 'field-error', role: 'alert' });
      const f = el('form', { class: 'pf-goal-form' }, field(p('goal_new'), kind), ft, field(p('period'), period), fm, fl, err,
        el('div', { class: 'form-actions' }, el('button', { class: 'btn small ink', type: 'submit', text: p('save') }), goal ? el('button', { class: 'link-btn', type: 'button', text: p('cancel'), onclick: done }) : null));
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); err.textContent = '';
        const body = { kind: kind.value, target: Number(target.value), period: period.value, param: kind.value === 'mechanism' ? pm.value : kind.value === 'language' ? pl.value : null };
        try { await api('/api/me/goals' + (goal ? '/' + goal.id : ''), { method: goal ? 'PUT' : 'POST', body }); toast(p('saved')); await load(); } catch (x) { err.textContent = errText(x); }
      });
      return f;
    }
    async function load() {
      put(list, loading());
      const r = await api('/api/me/goals');
      put(list, r.items.length ? el('ul', { class: 'goals' }, r.items.map((g) => {
        const pr = g.progress;
        const x = g.kind === 'mechanism' ? mech(g.param) : g.kind === 'language' ? langName(g.param) : '';
        const desc = p('goal_desc.' + g.kind, { n: num(g.target), p: p('per.' + g.period), x });
        const ratio = g.kind === 'median_time' ? (pr.value == null ? 0 : pr.done ? 1 : Math.min(0.99, (g.target * 1000) / pr.value)) : Math.min(1, pr.value / g.target);
        const li = el('li', { class: pr.done ? 'done' : '' },
          el('div', { class: 'goal-top' }, el('b', { text: desc }), pr.done ? el('span', { class: 'tag solved', text: p('goal_done') }) : null),
          el('span', { class: 'meter', role: 'progressbar', 'aria-label': desc, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(ratio * 100)) }, el('i', { style: '--v:' + Math.round(ratio * 100) + '%' })),
          el('span', { class: 'small muted', text: (g.kind === 'median_time' ? p('goal_value_time', { v: ms(pr.value) }) : p('goal_value', { v: num(pr.value), n: num(g.target) })) + ' · ' + p('goal_window', { a: date(pr.window.from), b: date(pr.window.to) }) }),
          el('div', { class: 'form-actions' },
            el('button', { class: 'link-btn', type: 'button', text: p('edit_short'), onclick: () => put(li, form(g, load)) }),
            el('button', { class: 'link-btn', type: 'button', text: p('delete'), onclick: async () => { await api('/api/me/goals/' + g.id, { method: 'DELETE', body: {} }); toast(p('goal_deleted')); load(); } })));
        return li;
      })) : el('p', { class: 'muted', text: p('goals_none') }), section(p('goal_add'), form(null)));
    }
    add(box, list);
    await load();
  }

  // ── Biblioteca ──
  const lq = { tab: 'favorites', page: 1 };
  async function Library(box) {
    if (!isUser()) { add(box, needAccount()); return; }
    add(box, el('p', { class: 'lead small', text: p('lib_lead') }));
    const sub = el('div', { class: 'chips', role: 'group', 'aria-label': p('tabs.library') });
    const filters = el('div', { class: 'pf-controls' });
    const out = el('div', { 'aria-live': 'polite' });
    add(box, sub, filters, out);
    const fl = select({ 'aria-label': p('f_lang') }, [['', p('f_lang') + ': ' + p('f_any')], ...M.languages.filter((l) => l.enabled).map((l) => [l.code, l.name_native])], lq.lang);
    const fd = select({ 'aria-label': p('f_difficulty') }, [['', p('f_difficulty') + ': ' + p('f_any')], ...[1, 2, 3, 4, 5].map((d) => [d, d + ' · ' + t('diff_' + d)])], lq.difficulty);
    const fc = select({ 'aria-label': p('f_category') }, [['', p('f_category') + ': ' + p('f_any')], ...M.categories.map((c) => [c.slug, L === 'es' ? c.name_es : c.name_en])], lq.category);
    [[fl, 'lang'], [fd, 'difficulty'], [fc, 'category']].forEach(([s, k]) => s.addEventListener('change', () => { lq[k] = s.value; lq.page = 1; load(); }));
    add(filters, fl, fd, fc);
    const drawTabs = () => put(sub, ...['favorites', 'retry', 'solved', 'collections'].map((k) => el('button', { type: 'button', class: 'chip' + ((lq.tab === k || (k === 'collections' && lq.tab.startsWith('collection:'))) ? ' on' : ''), 'aria-pressed': String(lq.tab === k), text: p('lib_tabs.' + k),
      onclick: () => { lq.tab = k; lq.page = 1; load(); } })));
    async function load() {
      drawTabs(); put(out, loading());
      filters.hidden = lq.tab === 'collections';
      try {
        if (lq.tab === 'collections') return collections();
        const qs = new URLSearchParams(Object.entries(lq).filter(([, v]) => v !== '' && v != null));
        const r = await api('/api/me/library?' + qs);
        const colName = lq.tab.startsWith('collection:') ? (await api('/api/me/collections')).items.find((c) => 'collection:' + c.id === lq.tab) : null;
        const remove = async (c) => {
          if (lq.tab === 'favorites') await api('/api/me/favorites/' + c.id, { method: 'DELETE', body: {} });
          else if (lq.tab === 'retry') await api('/api/me/retry/' + c.id, { method: 'DELETE', body: {} });
          else if (colName) await api('/api/me/collections/' + colName.id + '/items/' + c.id, { method: 'DELETE', body: {} });
          load();
        };
        put(out, 
          colName ? el('div', { class: 'sec-head' }, el('button', { class: 'link-btn', type: 'button', text: p('col_back'), onclick: () => { lq.tab = 'collections'; load(); } }), el('h2', { text: colName.name })) : null,
          r.items.length ? el('ul', { class: 'lib-list' }, r.items.map((c) => c.available ? el('li', {},
            el('a', { class: 'clue-text', href: route('clue', '/' + c.slug), text: c.clue }),
            el('span', { class: 'small muted', text: [langName(c.language), c.difficulty + '/5', mech(c.mechanism), catName(c.category)].filter(Boolean).join(' · ') }),
            c.solution ? el('details', {}, el('summary', { text: p('lib_show_expl') }), el('p', {}, el('b', { text: c.solution.answer })), el('ol', { class: 'small' }, (c.solution.explanation || []).map((x) => el('li', { text: x })))) : null,
            lq.tab !== 'solved' ? el('button', { class: 'link-btn', type: 'button', text: p('lib_remove'), onclick: () => remove(c) }) : null)
            : el('li', { class: 'muted' }, p('lib_unavailable'), lq.tab !== 'solved' ? el('button', { class: 'link-btn', type: 'button', text: p('lib_remove'), onclick: () => remove(c) }) : null))) : emptyBox(p('lib_empty')),
          pager(r.page, r.per_page, r.total, (n) => { lq.page = n; load(); }));
      } catch (e) { put(out, failBox(load)); }
    }
    async function collections() {
      const r = await api('/api/me/collections');
      const name = el('input', { maxlength: '60', required: true, 'aria-label': p('col_name'), placeholder: p('col_name') });
      const f = el('form', { class: 'pf-inline' }, name, el('button', { class: 'btn small ink', type: 'submit', text: p('col_create') }));
      f.addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/api/me/collections', { method: 'POST', body: { name: name.value } }); load(); } catch (x) { toast(errText(x)); } });
      put(out, section(p('col_new'), f), r.items.length ? el('ul', { class: 'lib-list' }, r.items.map((c) => el('li', {},
        el('b', { text: c.name }), el('span', { class: 'small muted', text: p('col_items', { n: num(c.items) }) }),
        el('div', { class: 'form-actions' },
          el('button', { class: 'btn small', type: 'button', text: p('col_open'), onclick: () => { lq.tab = 'collection:' + c.id; lq.page = 1; load(); } }),
          el('button', { class: 'link-btn', type: 'button', text: p('col_rename'), onclick: async () => {
            const n = window.prompt(p('col_name'), c.name); if (!n) return;
            try { await api('/api/me/collections/' + c.id, { method: 'PATCH', body: { name: n } }); load(); } catch (x) { toast(errText(x)); }
          } }),
          el('button', { class: 'link-btn', type: 'button', text: p('delete'), onclick: async () => {
            if (!window.confirm(p('col_delete_q', { n: c.name }))) return;
            await api('/api/me/collections/' + c.id, { method: 'DELETE', body: {} }); load();
          } }))))) : el('p', { class: 'muted', text: p('col_none') }));
    }
    await load();
  }

  // ── Ranking ──
  const bq = { board: 'clean', lang: L, date: new Date().toISOString().slice(0, 10) };
  async function Leaderboard(box) {
    const board = select({ id: 'lb-board' }, [['clean', p('lb_clean')], ['assisted', p('lb_assisted')], ['weekly', p('lb_weekly')]], bq.board);
    const lang = select({ id: 'lb-lang' }, M.languages.filter((l) => l.enabled).map((l) => [l.code, l.name_native]), bq.lang);
    const day = el('input', { type: 'date', value: bq.date, max: new Date().toISOString().slice(0, 10), id: 'lb-date' });
    const dayField = field(p('lb_date'), day);
    const out = el('div', { 'aria-live': 'polite' });
    const go = () => { bq.board = board.value; bq.lang = lang.value; bq.date = day.value || bq.date; dayField.hidden = bq.board === 'weekly'; load(); };
    [board, lang, day].forEach((x) => x.addEventListener('change', go));
    dayField.hidden = bq.board === 'weekly';
    const optedIn = sum.account && sum.account.leaderboard_opt_in;
    add(box, el('p', { class: 'lead small', text: p('lb_lead') }), !optedIn ? el('p', { class: 'notice info', text: p('lb_off') }) : null,
      el('div', { class: 'pf-controls' }, field(p('lb_board'), board), field(p('f_lang'), lang), dayField), out);
    async function load() {
      put(out, loading());
      try {
        const r = await api('/api/leaderboard?' + new URLSearchParams({ board: bq.board, lang: bq.lang, date: bq.date }));
        const weekly = r.board === 'weekly';
        const head = weekly ? [p('lb_rank'), p('lb_name'), p('lb_solved')] : [p('lb_rank'), p('lb_name'), p('lb_attempts'), ...(r.board === 'assisted' ? [p('lb_hints')] : []), p('lb_time')];
        put(out, el('p', { class: 'small muted', text: p('lb_rules.' + r.board) + ' ' + p('lb_valid') + (weekly ? ` (${date(r.from)} – ${date(r.to)})` : '') }),
          r.me ? el('p', { class: 'small', text: p('lb_me', { n: num(r.me) }) }) : null,
          r.items.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'pf-table compact lb' },
            el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col', text: h })))),
            el('tbody', {}, r.items.map((x) => el('tr', { class: x.me ? 'me' : '' }, el('td', { text: num(x.rank) }), el('td', {}, x.name, x.me ? el('span', { class: 'tag new', text: p('lb_you') }) : null),
              weekly ? el('td', { text: num(x.solved) }) : [el('td', { text: num(x.attempts) }), r.board === 'assisted' ? el('td', { text: num(x.hints) }) : null, el('td', { text: ms(x.time_ms) })])))))
            : emptyBox(p('lb_empty')));
      } catch (e) { put(out, failBox(load)); }
    }
    await load();
  }

  // ── Ajustes y privacidad ──
  async function Settings(box) {
    if (!isUser()) {
      const ch = el('input', { type: 'checkbox', id: 'local-notify', checked: store.get('cripta.ach_notify') !== false });
      ch.addEventListener('change', () => store.set('cripta.ach_notify', ch.checked, true));
      add(box, section(p('set_local'), el('label', { class: 'check' }, ch, el('span', { text: p('set_local_notify') }))), needAccount());
      return;
    }
    const a = sum.account;
    const save = async (body, msg) => { try { await api('/api/me/profile', { method: 'PUT', body }); toast(msg || p('saved')); sum = await api('/api/me/profile'); syncLocal(); } catch (e) { toast(errText(e)); } };
    const check = (id, label, checked, onchange) => { const i = el('input', { type: 'checkbox', id, checked }); i.addEventListener('change', () => onchange(i.checked)); return el('label', { class: 'check' }, i, el('span', { text: label })); };
    // Perfil público
    const share = Object.assign({}, a.share);
    const name = el('input', { id: 'public-name', maxlength: '30', value: a.public_name || '', placeholder: a.username, autocomplete: 'nickname' });
    const ach = (await api('/api/me/achievements')).items.flatMap((x) => x.tiers.filter((t2) => t2.earned_at).map((t2) => t2.code));
    const chosen = new Set(share.achievements || []);
    const pubLink = el('p', { class: 'small', hidden: !a.public_profile }, p('set_public_link') + ' ', el('a', { href: '/' + L + '/u/' + encodeURIComponent(a.username), text: location.host + '/' + L + '/u/' + a.username }));
    const avatars = el('div', { class: 'avatar-pick' });
    const drawAvatars = (cur) => {
      const m = /^(.+)-([0-7])$/.exec(cur || ''); const glyph = m ? m[1] : null; const tone = m ? Number(m[2]) : 0;
      const pick = (code) => { save({ avatar: code }); drawAvatars(code); };
      put(avatars,
        el('div', { class: 'av-row', role: 'radiogroup', 'aria-label': p('set_avatar') },
          el('button', { type: 'button', role: 'radio', 'aria-checked': String(!glyph), class: 'av-opt' + (!glyph ? ' on' : ''), text: p('set_avatar_none'), onclick: () => pick(null) }),
          BOOT.avatars.glyphs.map((g) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(glyph === g), 'aria-label': g, class: 'av-opt' + (glyph === g ? ' on' : ''), onclick: () => pick(g + '-' + tone) }, avatar(g + '-' + tone, g)))),
        glyph ? el('div', { class: 'av-row', role: 'radiogroup', 'aria-label': p('set_avatar_tone') },
          Array.from({ length: BOOT.avatars.tones }, (_, k) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(tone === k), 'aria-label': p('set_avatar_tone') + ' ' + (k + 1), class: 'av-opt tone' + (tone === k ? ' on' : ''), onclick: () => pick(glyph + '-' + k) }, el('span', { class: 'swatch av-' + k, 'aria-hidden': 'true' })))) : null);
    };
    drawAvatars(a.avatar);
    add(box, section(p('set_public'), el('p', { class: 'small muted', text: p('set_public_lead') }),
      check('public-on', p('set_public_on'), a.public_profile, (v) => { pubLink.hidden = !v; save({ public_profile: v }); }), pubLink,
      el('div', { class: 'pf-inline' }, field(p('set_public_name'), name), el('button', { class: 'btn small', type: 'button', text: p('save'), onclick: () => save({ public_name: name.value || null }) })),
      el('div', { class: 'field' }, el('span', { text: p('set_avatar') }), avatars),
      el('fieldset', { class: 'pf-fieldset' }, el('legend', { text: p('set_show') }),
        Object.keys(get('sh')).map((k) => check('share-' + k, p('sh.' + k), !!share[k], (v) => { share[k] = v; save({ share: Object.assign({}, share, { achievements: [...chosen] }) }); }))),
      el('fieldset', { class: 'pf-fieldset' }, el('legend', { text: p('set_badges') }), ach.length ? el('div', { class: 'badge-pick' }, ach.map((code) =>
        check('badge-' + code, achName(code), chosen.has(code), (v) => { if (v) chosen.add(code); else chosen.delete(code); save({ share: Object.assign({}, share, { achievements: [...chosen] }) }); })))
        : el('p', { class: 'small muted', text: p('set_badges_none') }))));
    add(box, section(p('set_lb'), check('lb-on', p('set_lb_on'), a.leaderboard_opt_in, (v) => save({ leaderboard_opt_in: v }))));
    add(box, section(p('set_prefs'), Object.keys(get('pr')).map((k) => check('pref-' + k, p('pr.' + k), a.prefs[k] !== false, (v) => save({ prefs: { [k]: v } })))));
    // Propuestas y avisos (antes en «Tus estadísticas»)
    const [subs, notes] = await Promise.all([api('/api/me/submissions').catch(() => ({ items: [] })), api('/api/me/notifications').catch(() => ({ items: [] }))]);
    add(box, el('div', { class: 'pf-cols' },
      section(p('set_subs'), subs.items.length ? el('ul', { class: 'plain-list' }, subs.items.map((x) => el('li', {}, el('span', { class: 'clue-text', text: x.clue_text }), el('span', {}, el('span', { class: 'status-pill ' + x.status, text: t('st_' + x.status) })), x.moderator_note ? el('span', { class: 'small', text: x.moderator_note }) : null))) : el('p', { class: 'muted', text: p('none') })),
      section(p('set_notes'), notes.items.length ? el('ul', { class: 'plain-list' }, notes.items.map((n) => el('li', { class: 'small', text: t('st_' + n.kind.replace('submission_', '')) + ' · ' + new Date(n.created_at).toLocaleString(L) }))) : el('p', { class: 'muted', text: p('none') }))));
    add(box, await dataSection());
    add(box, section(p('set_account'), el('div', { class: 'form-actions' },
      el('button', { class: 'btn', type: 'button', id: 'logout-btn', text: p('logout'), onclick: async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); location.reload(); } }),
      el('button', { class: 'link-btn danger', type: 'button', id: 'delete-account', text: p('delete_account'), onclick: async () => {
        if (!window.confirm(p('delete_q'))) return;
        await api('/api/me/account', { method: 'DELETE', body: {} }); location.href = route('home');
      } }))));
  }

  // Derechos sobre los datos: copia descargable y pedido de corrección.
  async function dataSection() {
    const es = L === 'es';
    const reqs = await api('/api/me/data-requests').catch(() => ({ items: [] }));
    const msg = el('textarea', { id: 'rect-msg', rows: '3', maxlength: '2000', placeholder: es ? '¿Qué dato hay que corregir?' : 'What should be corrected?' });
    const out = el('p', { class: 'small', role: 'status' });
    const label = { access: es ? 'Acceso' : 'Access', rectification: es ? 'Corrección' : 'Correction', deletion: es ? 'Eliminación' : 'Deletion' };
    const st = { open: es ? 'recibida' : 'received', in_progress: es ? 'en curso' : 'in progress', done: es ? 'resuelta' : 'done', rejected: es ? 'rechazada' : 'rejected' };
    return section(p('set_data'), el('div', { class: 'form' },
      el('p', { class: 'small', text: es ? 'Podés descargar una copia de tus datos o pedir que corrijamos algo.' : 'Download a copy of your data or ask us to correct something.' }),
      el('a', { class: 'btn small', href: '/api/me/export', download: 'mis-datos.json', text: es ? 'Descargar mis datos' : 'Download my data' }),
      el('label', { class: 'field' }, el('span', { text: es ? 'Pedir una corrección' : 'Request a correction' }), msg),
      el('button', { class: 'btn small', type: 'button', id: 'rect-send', text: es ? 'Enviar pedido' : 'Send request', onclick: async () => {
        if (!msg.value.trim()) { msg.focus(); return; }
        try { await api('/api/me/data-requests', { method: 'POST', body: { kind: 'rectification', message: msg.value } }); msg.value = ''; out.textContent = es ? 'Recibimos tu pedido.' : 'Request received.'; }
        catch (e) { out.textContent = t('error_generic'); }
      } }), out,
      reqs.items.length ? el('ul', { class: 'plain-list' }, reqs.items.map((r) => el('li', { class: 'small', text: label[r.kind] + ' · ' + st[r.status] + ' · ' + new Date(r.created_at).toLocaleDateString(L) }))) : null));
  }

  // El aviso de logros del juego lee esta preferencia en este navegador.
  function syncLocal() { if (sum && sum.account) store.set('cripta.ach_notify', sum.account.prefs.achievement_notifications !== false, true); }

  // ── Navegación por pestañas (con el historial del navegador) ──
  const VIEWS = { summary: Summary, history: History, progress: Progress, strengths: Strengths, achievements: Achievements, records: Records, goals: Goals, library: Library, leaderboard: Leaderboard, settings: Settings };
  let seq = 0;
  async function route_() {
    const h = decodeURIComponent(location.hash.slice(1));
    const gm = /^game\/([0-9a-f-]{36})$/.exec(h);
    const tab = gm ? 'history' : VIEWS[h] ? h : 'summary';
    const my = ++seq;
    const box = el('div', { class: 'pf-body', id: 'pf-' + (gm ? 'game' : tab) });
    root.classList.toggle('on-summary', tab === 'summary' && !gm);
    put(root, header(), tabsNav(tab), box);
    add(box, loading());
    const body = el('div', {});
    try {
      if (gm) await GameDetail(body, gm[1]); else await VIEWS[tab](body);
      if (my === seq) put(box, body);
    } catch (e) {
      if (my !== seq) return;
      put(box, e.status === 404 ? emptyBox(p('history_none'), null, el('a', { class: 'btn', href: '#history', text: p('back_history') })) : failBox(route_));
    }
    if (h) { const a = root.querySelector('.pf-tabs [aria-current]'); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  }
  async function reload() { sum = await api('/api/me/profile'); syncLocal(); await route_(); }

  (async function boot() {
    await authReady;
    me = C.getMe();
    try {
      [sum, M] = await Promise.all([api('/api/me/profile'), meta()]);
      syncLocal();
      window.addEventListener('hashchange', () => { route_(); const top = root.getBoundingClientRect().top; if (top < 0) root.scrollIntoView({ block: 'start' }); });
      await route_();
    } catch (e) { put(root, failBox(() => location.reload())); }
  })();
})();
