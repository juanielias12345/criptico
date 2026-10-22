/* Play Crípticos: script público. Sin dependencias ni paso de compilación. */
(function () {
  'use strict';

  const BOOT = JSON.parse(document.getElementById('boot').textContent);
  const L = BOOT.lang;
  const S = BOOT.strings;
  const t = (k, vars) => { let s = S[k] || k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b); return s; };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'style') n.style.cssText = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false && kid !== '') n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  };
  const svg = (paths, extra) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', extra || '1.6'); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = paths; return s;
  };
  const IC = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    skip: '<path d="M5 6l7 6-7 6M13 6l7 6-7 6"/>',
    share: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v6h14v-6"/>',
    flag: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
    star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
    redo: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const LICENSE_NAMES = { 'cc0-1.0': 'CC0 1.0', 'public-domain': L === 'es' ? 'dominio público' : 'public domain', 'cc-by-4.0': 'CC BY 4.0',
    'cc-by-sa-4.0': 'CC BY-SA 4.0', 'written-permission': L === 'es' ? 'permiso escrito del titular' : 'written permission' };
  const route = (key, rest) => '/' + L + (BOOT.routes[key] ? '/' + BOOT.routes[key] : '') + (rest || '');
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Almacenamiento con consentimiento ──
  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key) || sessionStorage.getItem(key) || 'null'); } catch (e) { return null; }
    },
    set(key, value, remember) {
      try {
        const v = JSON.stringify(value);
        if (remember) { localStorage.setItem(key, v); sessionStorage.removeItem(key); } else { sessionStorage.setItem(key, v); localStorage.removeItem(key); }
      } catch (e) { /* almacenamiento bloqueado: se usa solo en memoria */ }
    },
  };
  let memoryPrefs = null;
  // Solo se juega en español: una preferencia guardada con otro idioma vuelve a «es».
  const getPrefs = () => {
    const p = store.get('cripta.prefs') || memoryPrefs;
    if (p && p.choice && !/^es(-|$)/.test(p.choice)) p.choice = 'es';
    return p;
  };
  const setPrefs = (p) => { memoryPrefs = p; store.set('cripta.prefs', p, p.remember); };
  // Contadores de la sesión de juego (solo en esta pestaña).
  const session = {
    get() { try { return JSON.parse(sessionStorage.getItem('cripta.session') || 'null') || { seen: 0, solved: 0 }; } catch (e) { return { seen: 0, solved: 0 }; } },
    bump(k) { const s = this.get(); s[k]++; try { sessionStorage.setItem('cripta.session', JSON.stringify(s)); } catch (e) { /* sin almacenamiento */ } return s; },
  };

  // ── API ──
  let csrf = null;
  let me = null;
  const authReady = fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => { csrf = d.csrf; me = d.user; }).catch(() => {});
  async function api(path, opts) {
    await authReady;
    const o = Object.assign({ method: 'GET', credentials: 'same-origin', headers: {} }, opts || {});
    if (o.body !== undefined) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(o.body); }
    if (csrf) o.headers['x-csrf-token'] = csrf;
    const res = await fetch(path, o);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) { const err = new Error((data && data.message) || 'error'); err.status = res.status; err.data = data; throw err; }
    return data;
  }
  let metaPromise = null;
  const meta = () => (metaPromise = metaPromise || api('/api/meta'));

  function toast(msg) {
    $$('.toast').forEach((n) => n.remove());
    const n = el('div', { class: 'toast', role: 'status', text: msg });
    document.body.append(n);
    setTimeout(() => n.remove(), 2800);
  }

  // ── Tema y menú ──
  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }
  applyTheme((getPrefs() || {}).theme);
  $('#theme-button').addEventListener('click', () => {
    const p = getPrefs() || { remember: false };
    const order = ['auto', 'light', 'dark'];
    p.theme = order[(order.indexOf(p.theme || 'auto') + 1) % 3];
    setPrefs(p); applyTheme(p.theme);
    toast(t('theme') + ': ' + t('theme_' + p.theme));
  });
  const navToggle = $('.nav-toggle');
  const nav = $('#main-nav');
  const setNav = (open) => { nav.classList.toggle('open', open); navToggle.setAttribute('aria-expanded', String(open)); };
  navToggle.addEventListener('click', () => setNav(!nav.classList.contains('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { setNav(false); navToggle.focus(); } });
  document.addEventListener('click', (e) => { if (nav.classList.contains('open') && !nav.contains(e.target) && !navToggle.contains(e.target)) setNav(false); });

  // ── País e idioma ──
  const COUNTRIES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
  let regionNames;
  try { regionNames = new Intl.DisplayNames([L], { type: 'region' }); } catch (e) { regionNames = { of: (c) => c }; }
  const countryName = (c) => { try { return regionNames.of(c) || c; } catch (e) { return c; } };

  function browserSuggestion(variants) {
    const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'es']).map(String);
    let country = null; let choice = null;
    for (const raw of langs) {
      const [base, region] = raw.split('-');
      if (!country && region && /^[A-Za-z]{2}$/.test(region)) country = region.toUpperCase();
      if (!choice) {
        const exact = variants.find((v) => v.code.toLowerCase() === raw.toLowerCase() && v.enabled);
        if (exact) choice = exact.code;
        else if (base.toLowerCase() === 'es') choice = 'es';
      }
    }
    return { country, choice: choice || 'es' };
  }

  function choiceLabel(choice, m) {
    if (!choice) return '';
    const v = m.variants.find((x) => x.code === choice);
    if (v) return v.name_native;
    const l = m.languages.find((x) => x.code === choice);
    return l ? l.name_native + ' (' + t('prefs_all_variants') + ')' : choice;
  }
  function choiceShort(choice, m) {
    const v = m.variants.find((x) => x.code === choice);
    if (v) return v.name_native;
    const l = m.languages.find((x) => x.code === choice);
    return l ? l.name_native : choice;
  }

  async function updatePrefsLabel() {
    const p = getPrefs();
    if (!p) return;
    const m = await meta();
    const label = $('#prefs-label');
    label.replaceChildren(el('span', { text: choiceShort(p.choice, m) }), p.country ? el('span', { class: 'sep', 'aria-hidden': 'true' }) : '', p.country ? el('span', { class: 'long', text: p.country }) : '');
    $('#prefs-button').setAttribute('aria-label', t('nav_prefs') + ': ' + choiceLabel(p.choice, m) + (p.country ? ' · ' + countryName(p.country) : ''));
  }

  function picker({ label, why, placeholder, items, selected, onSelect }) {
    const id = 'p' + Math.random().toString(36).slice(2, 8);
    const search = el('input', { type: 'search', placeholder, 'aria-label': placeholder, 'aria-controls': id, autocomplete: 'off' });
    const list = el('div', { class: 'options', role: 'listbox', id, 'aria-label': label, tabindex: '-1' });
    const currentText = el('span', { class: 'current-text' });
    // La elección se ve como un botón; la lista se abre al tocarlo y se cierra al elegir.
    const toggle = el('button', { type: 'button', class: 'picker-toggle', 'aria-expanded': 'false', 'aria-controls': id + '-pop' },
      currentText, el('span', { class: 'change', text: t('prefs_change') }));
    const pop = el('div', { class: 'picker-pop', id: id + '-pop', hidden: true }, search, list);
    let cur = selected;
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const setOpen = (open) => {
      pop.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
      if (open) {
        search.value = ''; render(); search.focus();
        const s = list.querySelector('[aria-selected="true"]'); if (s) list.scrollTop = s.offsetTop - list.offsetTop - 60;
      }
    };
    function render() {
      const q = norm(search.value.trim());
      list.textContent = '';
      const it0 = items.find((x) => x.value === cur);
      currentText.textContent = it0 ? it0.label : '—';
      for (const it of items) {
        if (q && !norm(it.label + ' ' + it.value).includes(q)) continue;
        const opt = el('div', { class: 'opt' + (it.sub ? ' sub' : ''), role: 'option', tabindex: '0', 'aria-selected': String(it.value === cur), 'aria-disabled': it.disabled ? 'true' : null, 'data-value': it.value },
          el('span', { text: it.label }), it.extra ? el('span', { class: 'count', text: it.extra }) : null);
        const choose = () => { if (it.disabled) return; cur = it.value; onSelect(it.value); render(); setOpen(false); toggle.focus(); };
        opt.addEventListener('click', choose);
        opt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
          if (e.key === 'ArrowDown' && opt.nextElementSibling) { e.preventDefault(); opt.nextElementSibling.focus(); }
          if (e.key === 'ArrowUp') { e.preventDefault(); (opt.previousElementSibling || search).focus(); }
        });
        list.append(opt);
      }
      if (!list.children.length) list.append(el('p', { class: 'opt', text: '—', 'aria-disabled': 'true' }));
    }
    toggle.addEventListener('click', () => setOpen(pop.hidden));
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && list.firstElementChild) { e.preventDefault(); list.firstElementChild.focus(); } });
    // Escape cierra la lista sin cerrar todo el diálogo.
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); toggle.focus(); } });
    render();
    return el('div', { class: 'picker' }, el('span', { class: 'label' }, label), toggle, el('p', { class: 'small muted', text: why }), pop);
  }

  async function openPrefs({ first } = {}) {
    const m = await meta();
    const existing = getPrefs();
    const sug = browserSuggestion(m.variants);
    const state = { country: (existing && existing.country) || sug.country, choice: (existing && existing.choice) || sug.choice,
      remember: existing ? !!existing.remember : true, theme: existing && existing.theme };
    const countryItems = COUNTRIES.map((c) => ({ value: c, label: countryName(c) })).sort((a, b) => a.label.localeCompare(b.label, L));
    const total = (code) => (m.totals.find((x) => x.code === code) || { n: 0 }).n;
    const langItems = [];
    for (const lang of m.languages) {
      if (!lang.enabled) continue;
      langItems.push({ value: lang.code, label: lang.name_native + ' — ' + t('prefs_all_variants'), extra: String(total(lang.code)) });
      for (const v of m.variants.filter((x) => x.language_code === lang.code && x.enabled)) {
        langItems.push({ value: v.code, label: v.name_native, extra: v.own + ' + ' + v.general, sub: true });
      }
    }
    const remember = el('input', { type: 'checkbox', id: 'pref-remember' });
    remember.checked = state.remember;
    let saved = false;
    const dlg = el('dialog', { 'aria-labelledby': 'prefs-title', 'aria-describedby': 'prefs-note' },
      el('form', { method: 'dialog', class: 'dialog-body' },
        el('div', { class: 'dialog-head' },
          el('div', {}, el('h2', { id: 'prefs-title', text: t('prefs_title') }), el('p', { id: 'prefs-note', text: t('prefs_note') })),
          first ? null : el('button', { type: 'button', class: 'icon-btn dialog-close', 'aria-label': t('close'), onclick: () => dlg.close() }, svg(IC.close))),
        (!existing && sug.country) ? el('p', { class: 'detected', text: t('prefs_detected') + ': ' + countryName(sug.country) + ' · ' + choiceLabel(sug.choice, m) }) : null,
        el('div', { class: 'pickers' },
          picker({ label: t('prefs_country'), why: t('prefs_country_why'), placeholder: t('prefs_search_country'), items: countryItems, selected: state.country, onSelect: (v) => { state.country = v; } }),
          picker({ label: t('prefs_language'), why: t('prefs_language_why'), placeholder: t('prefs_search_language'), items: langItems, selected: state.choice, onSelect: (v) => { state.choice = v; } })),
        el('div', { class: 'dialog-actions' },
          el('label', { class: 'check', for: 'pref-remember' }, remember, t('prefs_remember')),
          el('div', { class: 'end' },
            first ? null : el('button', { type: 'button', class: 'btn quiet', onclick: () => dlg.close(), text: t('cancel') }),
            el('button', { type: 'submit', class: 'btn primary', id: 'prefs-save', text: t('prefs_save'), autofocus: matchMedia('(pointer: coarse)').matches ? '' : null })))));
    const save = (rememberIt) => {
      const before = getPrefs();
      setPrefs({ country: state.country, choice: state.choice, remember: rememberIt, theme: state.theme });
      updatePrefsLabel();
      if (me) api('/api/me/prefs', { method: 'PUT', body: { country: state.country, choice: state.choice, ui: L, timezone: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone } }).catch(() => {});
      document.dispatchEvent(new CustomEvent('prefs-changed', { detail: { before, after: getPrefs() } }));
    };
    dlg.querySelector('form').addEventListener('submit', () => { saved = true; save(remember.checked); });
    dlg.addEventListener('close', () => {
      // En la primera visita, cerrar sin guardar usa la sugerencia solo durante esta sesión.
      if (first && !saved) save(false);
      dlg.remove(); const b = $('#prefs-button'); if (b && !first) b.focus();
    });
    $('#dialog-root').append(dlg);
    dlg.showModal();
  }
  $('#prefs-button').addEventListener('click', () => openPrefs());
  updatePrefsLabel();
  // Visita agregada (sin identificadores): «first» es verdadero si este navegador todavía no eligió idioma y país.
  if (navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl) {
    const p0 = getPrefs();
    api('/api/visit', { method: 'POST', body: { ui: L, country: p0 && p0.country, first: !p0 }, keepalive: true }).catch(() => {});
  }
  if (!getPrefs() && ['home', 'play', 'daily', 'clue'].includes(BOOT.page)) openPrefs({ first: true });

  // ── Utilidades de texto ──
  const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  function lettersOf(s) {
    return String(s || '').toUpperCase().normalize('NFC').split('').map((ch) => (ch === 'Ñ' ? ch : stripAccents(ch)))
      .join('').replace(/[^A-ZÑ]/g, '');
  }
  // Pista con la longitud separada y, si se conoce, la definición marcada.
  function clueNode(tag, text, lang, def) {
    const n = el(tag, { class: 'clue-text', lang, id: 'clue-text' });
    const m = String(text).match(/^(.*?)(\s*\([\d,\s-]+\))\s*$/);
    const body = m ? m[1] : text;
    if (def) {
      const i = stripAccents(body).toLowerCase().indexOf(stripAccents(def).toLowerCase());
      if (i >= 0) n.append(body.slice(0, i), el('mark', { class: 'def', text: body.slice(i, i + def.length) }), body.slice(i + def.length));
      else n.append(body);
    } else n.append(body);
    if (m) n.append(el('span', { class: 'enum', text: m[2] }));
    return n;
  }
  const dots = (n) => el('span', { class: 'dots', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5].map((i) => el('i', { class: i <= n ? 'on' : null })));
  const lengthOf = (enumeration) => String(enumeration).split(/[,-]/).reduce((s, x) => s + (Number(x) || 0), 0);

  // Logros nuevos que devuelve el servidor al cerrar una partida (se pueden apagar en el perfil).
  function announceAchievements(codes) {
    if (!codes || !codes.length || store.get('cripta.ach_notify') === false) return;
    const PB = BOOT.pmini || {};
    const names = codes.map((c) => { const m = /^(.+)_(\d+)$/.exec(c); return m && PB.ach && PB.ach[m[1]] ? PB.ach[m[1]] + ' · ' + m[2] : c; });
    toast((PB.ach_new || '{name}').replace('{name}', names.join(', ')));
  }

  // ── Juego ──
  function Game(root, { kind }) {
    const st = { game: null, clue: null, hints: [], solved: false, finished: false, streak: 0, timer: null, mode: BOOT.mode || 'infinite', category: null, tried: [] };
    let busy = false;
    let shownId = null;
    // Práctica dirigida desde el perfil: ?mechanism=…&difficulty=…&choice=… (no cambia tus preferencias).
    const qp = new URLSearchParams(location.search);
    const focus = kind === 'play' ? {
      mechanism: /^[a-z_]{2,40}$/.test(qp.get('mechanism') || '') ? qp.get('mechanism') : null,
      difficulty: /^[1-5]$/.test(qp.get('difficulty') || '') ? Number(qp.get('difficulty')) : null,
      choice: /^[a-z]{2}(-[A-Z]{2})?$/.test(qp.get('choice') || '') ? qp.get('choice') : null,
    } : {};
    if (focus.mechanism || focus.difficulty || focus.choice) {
      const PB = BOOT.pmini || {};
      const label = [focus.mechanism ? t('mech_' + focus.mechanism) : null, focus.difficulty ? t('diff_' + focus.difficulty) : null, focus.choice ? focus.choice : null].filter(Boolean).join(' · ');
      root.before(el('div', { class: 'notice info practice-focus', id: 'practice-focus' }, el('p', { text: (PB.practice_banner || '{x}').replace('{x}', label) }),
        el('a', { class: 'link-btn', href: route('play'), text: PB.practice_clear || '×' })));
    }

    function enumTiles(enumeration, value, { ok, shown } = {}) {
      const letters = lettersOf(value);
      const total = lengthOf(enumeration);
      const box = el('div', { class: 'tiles' + (total > 9 ? ' many' : ''), 'aria-hidden': 'true' });
      let k = 0;
      String(enumeration).split(/([,-])/).forEach((part) => {
        if (part === ',' || part === '-') { box.append(el('span', { class: 'tile gap' + (part === '-' ? ' hyphen' : '') })); return; }
        for (let i = 0; i < Number(part); i++) {
          const ch = letters[k] || '';
          box.append(el('span', { class: 'tile' + (ch ? ' filled' : '') + (ok ? ' ok' : '') + (shown ? ' shown' : ''), text: ch, style: ok ? '--i:' + k : null }));
          k++;
        }
      });
      return box;
    }

    async function modeBlock() {
      if (kind !== 'play') {
        return el('section', { class: 'rail-block' }, el('h2', { text: t('in_mode') }), el('p', { class: 'small', text: t(kind === 'daily' ? 'mode_daily' : 'mode_shared') }),
          kind === 'clue' ? el('a', { class: 'btn small', href: route('play'), text: t('home_cta') }) : null);
      }
      const m = await meta();
      const playable = ['infinite', 'quick', 'beginner', 'intermediate', 'expert', 'guided', 'timed', 'themed', 'practice', 'streak'].filter((x) => m.modes.includes(x));
      const sel = el('select', { 'aria-label': t('mode'), id: 'mode-select' }, playable.map((x) => el('option', { value: x, selected: x === st.mode, text: t('mode_' + x) })));
      sel.addEventListener('change', () => { st.mode = sel.value; st.streak = 0; start(); });
      const cat = el('select', { 'aria-label': t('category'), id: 'category-select', hidden: st.mode !== 'themed' },
        m.categories.map((c) => el('option', { value: c.slug, selected: c.slug === st.category, text: L === 'es' ? c.name_es : c.name_en })));
      cat.addEventListener('change', () => { st.category = cat.value || null; start(); });
      return el('section', { class: 'rail-block' }, el('h2', {}, el('label', { for: 'mode-select', text: t('in_mode') })), el('div', { class: 'field' }, sel, cat));
    }

    async function languageBlock() {
      const m = await meta();
      const p = getPrefs() || {};
      const choice = kind === 'clue' ? (BOOT.clueVariant || BOOT.clueLang) : p.choice;
      return el('section', { class: 'rail-block' }, el('h2', { text: t('language') }),
        el('p', { class: 'small', style: 'margin-bottom:8px' }, choiceLabel(choice, m), p.country ? el('span', { class: 'muted', text: ' · ' + countryName(p.country) }) : ''),
        kind === 'clue' ? null : el('button', { class: 'link-btn', type: 'button', onclick: () => openPrefs(), text: t('change_prefs') }));
    }

    function sessionBlock() {
      const s = session.get();
      return el('section', { class: 'rail-block', 'aria-label': t('session') }, el('h2', { text: t('session') }),
        el('div', { class: 'session' },
          el('div', {}, el('b', { text: String(s.solved) }), el('span', { text: t('s_solved') })),
          el('div', {}, el('b', { text: String(s.seen) }), el('span', { text: t('s_seen') })),
          el('div', {}, el('b', { text: String(st.streak) }), el('span', { text: t('s_streak') }))));
    }

    function stopTimer() { if (st.timer) { clearInterval(st.timer); st.timer = null; } }

    async function start() {
      stopTimer();
      const prefs = getPrefs() || browserSuggestion([]);
      if (st.mode === 'themed' && !st.category) {
        const m = await meta(); st.category = (m.categories[0] || {}).slug || null;
      }
      root.setAttribute('aria-busy', 'true');
      const nb = $('#next-btn', root); if (nb) { nb.setAttribute('aria-busy', 'true'); nb.disabled = true; }
      try {
        const body = { choice: kind === 'clue' ? (BOOT.clueVariant || BOOT.clueLang) : focus.choice || prefs.choice, country: prefs.country, mode: kind === 'clue' ? 'shared' : st.mode, category: st.category,
          mechanism: focus.mechanism || undefined, difficulty: focus.difficulty || undefined };
        if (kind === 'clue') body.slug = BOOT.slug;
        const data = await api(kind === 'daily' ? '/api/daily/start' : '/api/game/start', { method: 'POST', body });
        Object.assign(st, { game: data.game_id, clue: data.clue, notice: data.notice, recycled: data.recycled, hints: [], solved: false, finished: false,
          solution: null, maxHints: data.max_hints, timed: data.timed_seconds, dailyDone: data.finished, attempts: 0, hintsUsed: 0, feedback: null, daily: null, tried: [] });
        if (data.finished) { st.finished = true; st.solved = data.finished.result === 'solved'; st.solution = data.finished.solution; st.attempts = data.finished.attempts; st.hintsUsed = data.finished.hints_used; }
        if (st.clue && !data.finished) session.bump('seen');
        if (st.mode === 'guided' && st.game && !st.finished) await hint(true);
        await render();
        if (st.timed && !st.finished) startTimer(st.timed);
      } catch (e) {
        root.textContent = '';
        root.append(el('div', { class: 'sheet' }, el('div', { class: 'empty' },
          el('p', { class: 'serif', text: (e.data && e.data.message) || t('error_generic') }),
          el('button', { class: 'btn', type: 'button', onclick: start, text: t('restart') }))));
      } finally { root.removeAttribute('aria-busy'); }
    }

    // Latido para estimar el tiempo activo: solo con la pestaña visible y si hubo
    // interacción en el último minuto. Si falla, no pasa nada: la partida sigue igual.
    let lastInput = Date.now();
    ['keydown', 'pointerdown', 'input'].forEach((ev) => root.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));
    const beat = () => {
      if (!st.game || st.finished || document.visibilityState !== 'visible' || Date.now() - lastInput > 60000) return;
      api('/api/game/' + st.game + '/ping', { method: 'POST', body: {} }).catch(() => {});
    };
    setInterval(beat, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { lastInput = Date.now(); beat(); } });

    function startTimer(seconds) {
      const end = Date.now() + seconds * 1000;
      st.timer = setInterval(async () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        const n = $('.timer', root);
        if (n) { n.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); n.classList.toggle('low', left <= 20); }
        if (left === 0) {
          stopTimer();
          try { await api('/api/game/' + st.game + '/skip', { method: 'POST', body: { reason: 'timeout' } }); const r = await api('/api/game/' + st.game + '/reveal', { method: 'POST', body: {} }); st.solution = r.solution; } catch (e) { /* sin penalidad */ }
          st.finished = true; st.feedback = { cls: 'info', text: t('time_up') }; st.streak = 0; render();
        }
      }, 250);
    }

    async function guess(value) {
      if (busy || st.finished) return;
      const key = lettersOf(value);
      if (!key) { const i = $('#answer', root); if (i) i.focus(); return; }
      if (st.tried.includes(key)) { st.feedback = { cls: 'info', text: t('same_guess'), shake: true }; render(value); return; }
      busy = true;
      const btn = $('#check-btn', root);
      if (btn) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; }
      let failed = false;
      try {
        const r = await api('/api/game/' + st.game + '/guess', { method: 'POST', body: { answer: value } });
        st.attempts = r.attempts || st.attempts;
        if (r.correct) {
          stopTimer(); st.solved = true; st.finished = true; st.solution = r.solution; st.daily = r.daily; st.streak++;
          st.feedback = null; session.bump('solved'); announceAchievements(r.achievements);
        } else if (!r.empty) {
          st.tried.push(key);
          const fb = (r.feedback || [])[0];
          st.feedback = { cls: 'bad', text: fb && fb.code === 'length' ? t('fb_length', { n: fb.expected }) : fb && fb.code === 'enye' ? t('fb_enye') : t('incorrect'), shake: true };
        }
      } catch (e) {
        failed = true;
        st.feedback = { cls: 'error', text: t('error_net') };
      } finally { busy = false; }
      render(value, { keepFocus: failed });
    }

    async function hint(silent) {
      const b = $('#hint-btn', root); if (b) b.setAttribute('aria-busy', 'true');
      try {
        const r = await api('/api/game/' + st.game + '/hint', { method: 'POST', body: { level: (st.hintsUsed || 0) + 1 } });
        st.hints = r.hints; st.hintsUsed = r.hints_used; st.maxHints = r.max_hints;
      } catch (e) { st.feedback = { cls: 'error', text: t('error_generic') }; }
      if (!silent) render($('#answer', root) ? $('#answer', root).value : '');
    }

    async function reveal() {
      try {
        const r = await api('/api/game/' + st.game + '/reveal', { method: 'POST', body: {} });
        stopTimer(); st.solution = r.solution; st.daily = r.daily; st.finished = true; st.streak = 0;
        st.feedback = null; announceAchievements(r.achievements);
      } catch (e) { st.feedback = { cls: 'error', text: t('error_generic') }; }
      render();
    }

    async function next() {
      if (st.game && !st.finished) { try { const r = await api('/api/game/' + st.game + '/skip', { method: 'POST', body: {} }); announceAchievements(r.achievements); } catch (e) { /* ignorar */ } if (st.mode === 'streak') st.streak = 0; }
      if (kind === 'clue' || kind === 'daily') { location.href = route('play'); return; }
      start();
    }

    async function restart() {
      try {
        const r = await api('/api/game/' + st.game + '/restart', { method: 'POST', body: {} });
        Object.assign(st, { game: r.game_id, finished: false, solved: false, solution: null, hints: [], hintsUsed: 0, attempts: 0, feedback: null, tried: [] });
        render();
        if (st.timed) startTimer(st.timed);
      } catch (e) { st.feedback = { cls: 'error', text: t('error_generic') }; render(); }
    }

    async function share() {
      const url = location.origin + route('clue', '/' + st.clue.slug);
      const head = kind === 'daily' ? t('shared_daily', { date: new Date().toISOString().slice(0, 10), site: BOOT.site }) : t('shared_text', { site: BOOT.site });
      const line = (st.solved ? '✅' : '🔎') + ' ' + t('attempts') + ': ' + st.attempts + ' · ' + t('hints_used') + ': ' + st.hintsUsed;
      const text = head + '\n«' + st.clue.clue + '»\n' + line;
      try {
        if (navigator.share) await navigator.share({ text, url });
        else { await navigator.clipboard.writeText(text + '\n' + url); toast(t('copied')); }
      } catch (e) { /* cancelado */ }
    }

    function report() {
      const reasons = ['wrong_answer', 'bad_explanation', 'typo', 'offensive', 'rights', 'other'];
      const sel = el('select', { id: 'report-reason' }, reasons.map((r) => el('option', { value: r, text: t('rr_' + r) })));
      const msg = el('textarea', { id: 'report-msg', maxlength: '1000', rows: '3' });
      const dlg = el('dialog', { 'aria-labelledby': 'report-title' }, el('form', { method: 'dialog', class: 'dialog-body form' },
        el('div', { class: 'dialog-head' }, el('h2', { id: 'report-title', text: t('report_title') }),
          el('button', { type: 'button', class: 'icon-btn dialog-close', 'aria-label': t('close'), onclick: () => dlg.close() }, svg(IC.close))),
        el('p', { class: 'small muted', text: '«' + st.clue.clue + '»' }),
        el('label', { class: 'field' }, el('span', { text: t('report_reason') }), sel), el('label', { class: 'field' }, el('span', { text: t('moderator_note') === 'moderator_note' ? '' : (L === 'es' ? 'Comentario (opcional)' : 'Comment (optional)') }), msg),
        el('div', { class: 'dialog-actions' }, el('span'), el('div', { class: 'end' }, el('button', { type: 'button', class: 'btn quiet', onclick: () => dlg.close(), text: t('cancel') }),
          el('button', { type: 'submit', class: 'btn primary', text: t('report_send') })))));
      dlg.querySelector('form').addEventListener('submit', async () => {
        try { await api('/api/clues/' + st.clue.id + '/report', { method: 'POST', body: { reason: sel.value, message: msg.value } }); toast(t('report_thanks')); } catch (e) { toast(t('error_generic')); }
      });
      dlg.addEventListener('close', () => dlg.remove());
      $('#dialog-root').append(dlg); dlg.showModal();
    }

    async function favorite() {
      try { await api('/api/me/favorites/' + st.clue.id, { method: 'POST', body: {} }); toast('★ ' + t('favorite')); } catch (e) { location.href = route('account'); }
    }

    function noticeBox() {
      const n = st.notice;
      if (st.recycled) return el('div', { class: 'notice' }, el('p', { text: t('recycled') }));
      if (!n) return null;
      if (n.kind === 'few_regional') return el('div', { class: 'notice' }, el('p', { text: t('notice_few_regional', { n: n.regional }) }), el('button', { class: 'link-btn', type: 'button', onclick: () => openPrefs(), text: t('change_prefs') }));
      return null;
    }

    function hintItems() {
      return st.hints.map((h) => {
        if (h.kind === 'mechanism') return el('li', {}, el('b', { text: t('mechanism') }), t('mech_' + h.mechanism) + '. ' + t('mechhelp_' + h.mechanism),
          h.indicator ? el('span', { class: 'hint-ind' }, ' ', el('b', { text: t('indicator_hint') }), '«' + h.indicator + '»') : null);
        if (h.kind === 'definition') return el('li', {}, el('b', { text: t('definition_hint') }), h.text ? '«' + h.text + '»' : '—');
        if (h.kind === 'first_letter') return el('li', {}, el('b', { text: t('first_letter') }), h.letter);
        if (h.kind === 'pattern') return el('li', {}, el('b', { text: t('pattern') }), el('code', { text: h.pattern.split('').join(' ') }));
        return null;
      });
    }

    async function render(typed, { keepFocus } = {}) {
      await authReady;
      const m = await meta();
      const rail = el('aside', { class: 'rail', 'aria-label': t('tools_more') }, await modeBlock(), await languageBlock(), kind === 'play' ? sessionBlock() : null);
      if (!st.clue) {
        const n = st.notice || { kind: 'empty' };
        const box = el('div', { class: 'empty', role: 'status' }, el('p', { class: 'serif', text: n.kind === 'language_unavailable' ? t('notice_language_unavailable') : t('notice_empty') }));
        if (n.alternatives && n.alternatives.length) {
          box.append(el('p', { text: t('notice_empty_alt') }), el('div', { class: 'mech-chips', style: 'justify-content:center' }, n.alternatives.map((alt) => {
            const choice = alt.variant || alt.lang;
            return el('button', { class: 'chip', type: 'button', text: choiceLabel(choice, m) + ' · ' + alt.n, onclick: () => { const p = getPrefs() || {}; p.choice = choice; setPrefs(p); updatePrefsLabel(); start(); } });
          })));
        }
        box.append(el('button', { class: 'btn', type: 'button', onclick: () => openPrefs(), text: t('change_prefs') }));
        root.replaceChildren(el('div', { class: 'sheet' }, box), rail);
        return;
      }
      const c = st.clue;
      const isNew = shownId !== c.id + ':' + st.game; shownId = c.id + ':' + st.game;
      const defHint = st.hints.find((h) => h.kind === 'definition');
      const sheet = el('div', { class: 'sheet' + (isNew && !reduceMotion() ? ' clue-enter' : '') });
      const total = lengthOf(c.enumeration);
      sheet.append(el('div', { class: 'sheet-top' },
        el('div', { class: 'meta-line' },
          el('span', { text: kind === 'play' ? t('mode_' + st.mode) : t(kind === 'daily' ? 'mode_daily' : 'mode_shared') }),
          el('span', { title: t('diff_' + c.difficulty) }, dots(c.difficulty), el('span', { class: 'sr-only', text: t('diff_' + c.difficulty) })),
          el('span', { text: t('letters_n', { n: total }) }),
          c.variant ? el('span', { text: choiceShort(c.variant, m) }) : null,
          st.solution || st.hints.some((h) => h.kind === 'mechanism') ? el('span', { text: t('mech_' + c.mechanism) }) : null),
        el('div', { class: 'meta-line' },
          st.timed && !st.finished ? el('span', {}, t('time_left') + ' ', el('span', { class: 'timer', text: '' })) : null,
          (st.mode === 'streak' || st.streak > 1) && kind === 'play' ? el('span', { class: 'tag new', text: t('streak') + ' · ' + st.streak }) : null)));
      const nb = noticeBox(); if (nb) sheet.append(nb);
      sheet.append(clueNode(kind === 'clue' ? 'h1' : 'p', c.clue, c.language, st.solution ? st.solution.definition : defHint && defHint.text));
      const tilesWrap = el('div', { id: 'tiles' }, enumTiles(c.enumeration, st.solution ? st.solution.answer : typed, { ok: st.solved, shown: st.solution && !st.solved }));
      sheet.append(tilesWrap);

      if (!st.finished) {
        const input = el('input', { id: 'answer', class: 'answer-input', name: 'answer', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go',
          'aria-label': t('answer_label'), 'aria-describedby': 'answer-help feedback', placeholder: t('answer_placeholder'), maxlength: String(Math.max(20, total + 12)), lang: c.language });
        if (typed) input.value = typed;
        input.addEventListener('input', () => { tilesWrap.replaceChildren(enumTiles(c.enumeration, input.value)); const f = $('#feedback', root); if (f && st.feedback && st.feedback.cls !== 'error') { f.textContent = ''; f.className = 'feedback'; } });
        const form = el('form', { class: 'answer-form', onsubmit: (e) => { e.preventDefault(); guess(input.value); } },
          input, el('button', { class: 'btn primary', type: 'submit', id: 'check-btn', text: t('check') }));
        sheet.append(form, el('p', { class: 'answer-help', id: 'answer-help', text: t('answer_help') }));
        sheet.append(el('p', { class: 'feedback' + (st.feedback ? ' ' + st.feedback.cls : ''), role: 'status', id: 'feedback', text: st.feedback ? st.feedback.text : '' }));
        if (st.hints.length) sheet.append(el('ul', { class: 'hint-list hints', 'aria-label': t('hints_title') }, hintItems()));
        const max = st.maxHints || m.max_hints || 4;
        const canHint = st.hintsUsed < max;
        sheet.append(el('div', { class: 'tools' },
          el('button', { class: 'btn small', type: 'button', id: 'hint-btn', disabled: !canHint, onclick: () => hint(), 'aria-describedby': 'hint-meter' }, svg(IC.bulb), canHint ? t('hint_ask') : t('hints_done'),
            el('span', { class: 'hint-meter', id: 'hint-meter', 'aria-label': st.hintsUsed + '/' + max }, [...Array(max)].map((_, i) => el('i', { class: i < st.hintsUsed ? 'on' : null })))),
          el('span', { class: 'grow' }),
          el('button', { class: 'link-btn', type: 'button', id: 'reveal-btn', onclick: reveal }, svg(IC.eye), t('reveal')),
          kind === 'play' ? el('button', { class: 'link-btn', type: 'button', id: 'skip-btn', onclick: next }, svg(IC.skip), t('skip')) : null,
          el('button', { class: 'link-btn', type: 'button', id: 'report-btn', onclick: report }, svg(IC.flag), t('report'))));
        if (st.feedback && st.feedback.shake && !reduceMotion()) { form.classList.add('shake'); tilesWrap.firstChild.classList.add('shake'); setTimeout(() => { form.classList.remove('shake'); }, 400); }
        const focusInput = () => input.focus({ preventScroll: true });
        // En móvil no abrimos el teclado al llegar; sí después de un intento.
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (!coarse || typed !== undefined || keepFocus) setTimeout(focusInput, 0);
      } else {
        const s = st.solution;
        const meta2 = st.solved
          ? t('solved_meta', { a: st.attempts === 1 ? t('attempt_1') : t('attempts_n', { n: st.attempts }), h: st.hintsUsed === 0 ? t('hint_0') : st.hintsUsed === 1 ? t('hint_1') : t('hints_n', { n: st.hintsUsed }) })
          : t('revealed_meta');
        sheet.append(el('div', { class: 'solved-mark' + (st.solved ? '' : ' revealed'), role: 'status' },
          el('span', { class: 'seal' }, svg(st.solved ? IC.check : IC.eye, '2.4')),
          el('p', {}, st.solved ? t('solved_title') : t('revealed_title'), el('small', { text: meta2 }))));
        if (st.feedback) sheet.append(el('p', { class: 'feedback ' + st.feedback.cls, role: 'status', id: 'feedback', text: st.feedback.text }));
        const sol = el('section', { class: 'solution', 'aria-labelledby': 'sol-title' },
          el('p', { class: 'answer', id: 'solution-answer', lang: c.language, text: s.answer }),
          el('h2', { id: 'sol-title', text: t('explanation') }),
          s.definition ? el('p', { class: 'legend' }, el('span', {}, el('i'), t('legend_def') + ': «' + s.definition + '»')) : null,
          el('ol', { class: 'explain', id: 'explanation' }, s.explanation.map((x) => el('li', { text: x }))),
          s.note ? el('p', { class: 'muted', text: s.note }) : null,
          st.mode === 'guided' ? el('p', { class: 'muted small', text: t('mechhelp_' + s.mechanism) }) : null,
          st.daily && st.daily.players ? el('p', { class: 'small', text: t('daily_stats', { p: st.daily.players, s: st.daily.solved }) }) : null,
          kind === 'daily' && st.dailyDone ? el('p', { class: 'small muted', text: t('daily_done') }) : null,
          c.origin === 'external' ? el('p', { class: 'attribution' }, t('source') + ': ', c.source_url ? el('a', { href: c.source_url, rel: 'noopener nofollow', text: c.attribution || c.source_url }) : (c.attribution || '—'),
            ' · ', c.author ? t('author_label') + ': ' + c.author : t('author_unknown'), c.license ? ' · ' + t('license_label') + ': ' + (LICENSE_NAMES[c.license] || c.license) : null) : null,
          c.origin === 'generated' ? el('p', { class: 'attribution' }, t('gen_by') + ' · ', el('a', { href: route('credits'), text: t('gen_sources') })) : null,
          c.author && c.origin === 'community' ? el('p', { class: 'attribution', text: t('by') + ' ' + c.author }) : null);
        sheet.append(sol);
        sheet.append(el('div', { class: 'next-row' },
          el('button', { class: 'btn primary', type: 'button', id: 'next-btn', onclick: next }, t('next'), el('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' })),
          !st.solved && kind !== 'daily' ? el('button', { class: 'btn', type: 'button', id: 'restart-btn', onclick: restart }, svg(IC.redo), t('restart')) : null));
        sheet.append(el('div', { class: 'tools' },
          el('button', { class: 'link-btn', type: 'button', id: 'share-btn', onclick: share }, svg(IC.share), t('share')),
          me ? el('button', { class: 'link-btn', type: 'button', onclick: favorite }, svg(IC.star), t('favorite')) : null,
          el('span', { class: 'grow' }),
          el('button', { class: 'link-btn', type: 'button', id: 'report-btn', onclick: report }, svg(IC.flag), t('report'))));
        setTimeout(() => { const b = $('#next-btn', root); if (b) b.focus({ preventScroll: true }); }, 0);
      }
      root.replaceChildren(sheet, rail);
      if (st.finished && isNew === false && !reduceMotion()) {
        const top = sheet.getBoundingClientRect().top;
        if (top < 0) sheet.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    document.addEventListener('prefs-changed', (e) => {
      const { before, after } = e.detail;
      if (kind === 'clue') return;
      if (!before || before.choice !== after.choice) start();   // el país solo no reinicia la partida
      else render($('#answer', root) ? $('#answer', root).value : undefined);
    });
    // Sin preferencias, el diálogo de primera visita dispara el inicio al guardar.
    if (getPrefs() || kind === 'clue') start();
  }

  // ── Ejemplos resolubles (inicio y lecciones) ──
  function TryWidget(box) {
    const form = $('form', box); const input = $('input', form); const fb = $('.feedback', box);
    const answer = lettersOf(box.dataset.answer);
    form.hidden = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = lettersOf(input.value);
      if (!v) { input.focus(); return; }
      if (v === answer) {
        box.classList.add('solved'); fb.className = 'feedback ok'; fb.textContent = box.dataset.ok;
        const d = $('.solution-details', box); if (d) d.open = true;
        input.setAttribute('aria-invalid', 'false');
      } else {
        fb.className = 'feedback bad'; fb.textContent = box.dataset.bad;
        if (!reduceMotion()) { form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); }
      }
    });
    $('.solution-details', box).addEventListener('toggle', (e) => { if (e.target.open) box.classList.add('solved'); });
  }
  $$('.try').forEach(TryWidget);
  $$('.shuffle span').forEach((s) => { s.style.setProperty('--from', s.dataset.from); s.style.setProperty('--to', s.dataset.to); s.style.setProperty('--i', s.dataset.from); });
  const ft = $('.filter-toggle');
  if (ft) {
    const f = $('#filters');
    if (location.search.length > 1) { f.classList.add('open'); ft.setAttribute('aria-expanded', 'true'); }
    ft.addEventListener('click', () => { const open = !f.classList.contains('open'); f.classList.toggle('open', open); ft.setAttribute('aria-expanded', String(open)); });
    $$('select', f).forEach((s) => s.addEventListener('change', () => { if (window.matchMedia('(min-width: 901px)').matches) f.submit(); }));
  }

  // ── Contribuciones ──
  async function Contribute(root) {
    const m = await meta();
    const prefs = getPrefs() || {};
    const startedAt = Date.now();
    const langSel = el('select', { name: 'language_code', id: 'f-language', required: true }, m.languages.filter((l) => l.enabled).map((l) => el('option', { value: l.code, selected: (prefs.choice || L).startsWith(l.code), text: l.name_native })));
    const varSel = el('select', { name: 'variant_code', id: 'f-variant' });
    const fillVariants = () => {
      varSel.replaceChildren(el('option', { value: '', text: t('f_variant_general') }), ...m.variants.filter((v) => v.language_code === langSel.value).map((v) => el('option', { value: v.code, selected: v.code === prefs.choice, text: v.name_native })));
    };
    langSel.addEventListener('change', fillVariants); fillVariants();
    const mechs = ['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone', 'double_definition', 'initials', 'cryptic_definition', 'combination'];
    const field = (label, input, hint) => el('label', { class: 'field' }, el('span', {}, label, hint ? el('span', { class: 'hint', text: ' — ' + hint }) : null), input);
    const errBox = el('p', { class: 'field-error', role: 'alert', id: 'form-error' });
    const clueIn = el('input', { name: 'clue_text', id: 'f-clue', required: true, maxlength: '300', placeholder: L === 'es' ? 'Ramo revuelto para el sentimiento (4)' : 'Cheater reformed as an educator (7)' });
    const sendBtn = el('button', { class: 'btn primary', type: 'submit', id: 'f-send', text: t('f_send') });
    const form = el('form', { class: 'form', id: 'contribute-form', novalidate: true },
      el('div', { class: 'form-section' }, el('h2', { text: t('c_sec_clue') }),
        field(t('f_clue'), clueIn, t('f_clue_hint')),
        el('div', { class: 'row' },
          field(t('f_answer'), el('input', { name: 'answer', id: 'f-answer', required: true, maxlength: '60', autocapitalize: 'characters' })),
          field(t('f_definition'), el('input', { name: 'definition', id: 'f-definition', maxlength: '200' })))),
      el('div', { class: 'form-section' }, el('h2', { text: t('c_sec_how') }),
        field(t('f_explanation'), el('textarea', { name: 'explanation', id: 'f-explanation', required: true, maxlength: '2000' }), t('f_expl_hint')),
        field(t('f_mechanism'), el('select', { name: 'mechanism', id: 'f-mechanism' }, mechs.map((x) => el('option', { value: x, text: t('mech_' + x) }))))),
      el('div', { class: 'form-section' }, el('h2', { text: t('c_sec_data') }),
        el('div', { class: 'row' }, field(t('f_language'), langSel), field(t('f_variant'), varSel)),
        el('div', { class: 'row' },
          field(t('f_category'), el('select', { name: 'category', id: 'f-category' }, BOOT.categories.map((c) => el('option', { value: c.slug, text: L === 'es' ? c.name_es : c.name_en })))),
          field(t('f_difficulty'), el('select', { name: 'difficulty', id: 'f-difficulty' }, [1, 2, 3, 4, 5].map((d) => el('option', { value: d, selected: d === 2, text: t('diff_' + d) }))))),
        el('div', { class: 'row' }, field(t('f_name'), el('input', { name: 'public_name', id: 'f-name', maxlength: '60' })), field(t('f_reference'), el('input', { name: 'reference', id: 'f-reference', maxlength: '300' })))),
      el('label', { class: 'hp', 'aria-hidden': 'true' }, 'Website', el('input', { name: 'website', tabindex: '-1', autocomplete: 'off' })),
      el('div', { class: 'form-section' }, el('h2', { text: t('c_sec_rights') }),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'rights_confirmed', id: 'f-rights', required: true }), el('span', { text: t('f_rights') })),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'terms_accepted', id: 'f-terms', required: true }), el('span', {}, t('f_terms'), ' ', el('a', { href: route('terms'), target: '_blank', rel: 'noopener', text: t('terms_title') + ' ↗' })))),
      errBox,
      el('div', { class: 'form-actions' }, sendBtn, el('span', { class: 'small muted', text: t('c_aside') })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); errBox.textContent = '';
      $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      body.rights_confirmed = form.rights_confirmed.checked; body.terms_accepted = form.terms_accepted.checked;
      body.difficulty = Number(body.difficulty); body.form_started_at = startedAt;
      if (!body.variant_code) delete body.variant_code;
      sendBtn.setAttribute('aria-busy', 'true'); sendBtn.disabled = true;
      try {
        const r = await api('/api/submissions', { method: 'POST', body });
        root.replaceChildren(el('div', { class: 'done-box', role: 'status' },
          el('p', { class: 'eyebrow', text: t('st_sent') }), el('h2', { text: t('sent_title') }), el('p', { text: t('sent_lead') }), el('p', { class: 'code-box', id: 'tracking-code', text: r.tracking_code }),
          el('div', { class: 'form-actions' }, el('a', { class: 'btn ink', href: route('submission', '?code=' + encodeURIComponent(r.tracking_code)), text: t('status_title') }),
            el('a', { class: 'link-btn', href: route('play'), text: t('home_cta') }))));
        window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
      } catch (err) {
        const fields = (err.data && err.data.details && err.data.details.fields) || [];
        errBox.textContent = (err.data && err.data.message) || t('error_generic');
        fields.forEach((f) => { const n = form.elements[f]; if (n && n.setAttribute) n.setAttribute('aria-invalid', 'true'); });
        const firstBad = fields.length && form.elements[fields[0]]; if (firstBad && firstBad.focus) firstBad.focus();
      } finally { sendBtn.removeAttribute('aria-busy'); sendBtn.disabled = false; }
    });
    root.replaceChildren(form);
  }

  async function SubmissionStatus(root) {
    const params = new URLSearchParams(location.search);
    const code = el('input', { id: 's-code', required: true, value: params.get('code') || '', autocomplete: 'off', spellcheck: 'false' });
    const out = el('div', { id: 'status-out', 'aria-live': 'polite' });
    const form = el('form', { class: 'answer-form' }, code, el('button', { class: 'btn ink', type: 'submit', text: t('status_check') }));
    const order = ['pending', 'in_review', 'needs_changes', 'approved', 'published'];
    async function load() {
      out.textContent = '';
      if (!code.value.trim()) return;
      try {
        const s = await api('/api/submissions/status?code=' + encodeURIComponent(code.value.trim()));
        const seen = new Set(s.history.map((h) => h.status));
        const at = Object.fromEntries(s.history.map((h) => [h.status, h.at]));
        const steps = s.status === 'rejected' ? [...order.filter((x) => seen.has(x)), 'rejected'] : order.filter((x) => x !== 'needs_changes' || seen.has('needs_changes'));
        out.append(el('div', { class: 'sub-view' },
          el('p', {}, el('span', { class: 'status-pill ' + s.status, id: 'status-pill', text: t('st_' + s.status) })),
          el('p', { class: 'clue-text', text: s.clue_text }), el('p', { class: 'muted', text: t('f_answer') + ': ' + s.answer }),
          s.moderator_note ? el('div', { class: 'notice' }, el('p', {}, el('strong', { text: t('moderator_note') + ': ' }), s.moderator_note)) : null,
          el('ol', { class: 'timeline' }, steps.map((x) => el('li', { class: x === s.status ? 'current' : seen.has(x) ? 'done' : '' },
            el('span', {}, el('b', { text: t('st_' + x) }), at[x] ? new Date(at[x]).toLocaleString(L) : t('st_' + x + '_d')))))));
        if (s.status === 'needs_changes') {
          const c2 = el('input', { value: s.clue_text, maxlength: '300' }); const a2 = el('input', { value: s.answer, maxlength: '60' });
          const e2 = el('textarea', { maxlength: '2000' }); e2.value = s.explanation;
          const f2 = el('form', { class: 'form' }, el('label', { class: 'field' }, el('span', { text: t('f_clue') }), c2), el('label', { class: 'field' }, el('span', { text: t('f_answer') }), a2),
            el('label', { class: 'field' }, el('span', { text: t('f_explanation') }), e2), el('div', {}, el('button', { class: 'btn primary', type: 'submit', text: t('resubmit') })));
          f2.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try { await api('/api/submissions/resubmit', { method: 'POST', body: { code: code.value.trim(), clue_text: c2.value, answer: a2.value, explanation: e2.value } }); load(); } catch (err) { toast((err.data && err.data.message) || t('error_generic')); }
          });
          out.append(f2);
        }
      } catch (e) { out.append(el('div', { class: 'notice error' }, el('p', { text: e.status === 404 ? (L === 'es' ? 'No encontramos una propuesta con ese código.' : 'No submission matches that code.') : t('error_generic') }))); }
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
    root.append(el('label', { class: 'field' }, el('span', { text: t('status_code') }), form), out);
    if (code.value) load();
  }

  // ── Cuenta (el perfil vive en /js/profile.js) ──
  async function Account(root) {
    await authReady;
    if (me) {
      root.append(el('div', { class: 'auth-card' }, el('p', { class: 'serif', style: 'font-size:1.6rem', text: me.username }),
        el('div', { class: 'form-actions' }, el('a', { class: 'btn ink', href: route('profile'), text: t('nav_profile') }),
          el('button', { class: 'btn', type: 'button', id: 'logout-btn', text: t('logout'), onclick: async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); location.reload(); } }))));
      return;
    }
    const mk = (kind) => {
      const u = el('input', { name: 'username', autocomplete: 'username', required: true, maxlength: '30' });
      const p = el('input', { name: 'password', type: 'password', autocomplete: kind === 'login' ? 'current-password' : 'new-password', required: true, minlength: kind === 'login' ? null : '10' });
      const e = el('input', { name: 'email', type: 'email', autocomplete: 'email' });
      const err = el('p', { class: 'field-error', role: 'alert' });
      const btn = el('button', { class: 'btn ' + (kind === 'login' ? 'ink' : 'primary'), type: 'submit', text: t(kind) });
      const f = el('form', { class: 'form auth-card', id: kind + '-form' }, el('h2', { text: t(kind) }),
        el('label', { class: 'field' }, el('span', { text: t('username') }), u), el('label', { class: 'field' }, el('span', {}, t('password'), kind === 'register' ? el('span', { class: 'hint', text: ' — ' + t('pw_rules') }) : null), p),
        kind === 'register' ? el('label', { class: 'field' }, el('span', { text: t('email_optional') }), e) : null, err, el('div', {}, btn));
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault(); err.textContent = ''; btn.setAttribute('aria-busy', 'true');
        try { await api('/api/auth/' + kind, { method: 'POST', body: { username: u.value, password: p.value, email: e.value || null } }); location.href = route('profile'); } catch (x) { err.textContent = (x.data && x.data.message) || t('error_generic'); btn.removeAttribute('aria-busy'); }
      });
      return f;
    };
    root.append(el('div', { class: 'cols' }, mk('login'), mk('register')));
  }

  // ── Arranque por página ──
  const game = $('#game');
  if (game) Game(game, { kind: BOOT.page === 'daily' ? 'daily' : BOOT.page === 'clue' ? 'clue' : 'play' });
  if ($('#contribute-root')) Contribute($('#contribute-root'));
  if ($('#submission-root')) SubmissionStatus($('#submission-root'));
  if ($('#account-root')) Account($('#account-root'));
  window.__cripta = { openPrefs, getPrefs, el, t, api, route, toast, authReady, getMe: () => me, countryName, meta, store };
})();
