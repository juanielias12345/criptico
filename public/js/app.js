/* Cripta: script público. Sin dependencias ni paso de compilación. */
(function () {
  'use strict';

  const BOOT = JSON.parse(document.getElementById('boot').textContent);
  const L = BOOT.lang;
  const S = BOOT.strings;
  const t = (k, vars) => { let s = S[k] || k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b); return s; };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  };
  const route = (key, rest) => '/' + L + (BOOT.routes[key] ? '/' + BOOT.routes[key] : '') + (rest || '');

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
  const getPrefs = () => store.get('cripta.prefs') || memoryPrefs;
  const setPrefs = (p) => { memoryPrefs = p; store.set('cripta.prefs', p, p.remember); };

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
    const n = el('div', { class: 'toast', role: 'status', text: msg });
    document.body.append(n);
    setTimeout(() => n.remove(), 2600);
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
  navToggle.addEventListener('click', () => {
    const nav = $('.main-nav'); const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open); navToggle.setAttribute('aria-expanded', String(open));
  });

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
        else if (['es', 'en'].includes(base.toLowerCase())) choice = base.toLowerCase();
      }
    }
    return { country, choice: choice || (L === 'en' ? 'en' : 'es') };
  }

  function choiceLabel(choice, m) {
    if (!choice) return '';
    const v = m.variants.find((x) => x.code === choice);
    if (v) return v.name_native;
    const l = m.languages.find((x) => x.code === choice);
    return l ? l.name_native + ' (' + t('prefs_all_variants') + ')' : choice;
  }

  async function updatePrefsLabel() {
    const p = getPrefs();
    if (!p) return;
    const m = await meta();
    $('#prefs-label').textContent = (p.country ? p.country + ' · ' : '') + choiceLabel(p.choice, m);
  }

  function picker({ label, placeholder, items, selected, onSelect }) {
    const id = 'p' + Math.random().toString(36).slice(2, 8);
    const search = el('input', { type: 'search', placeholder, 'aria-label': placeholder, 'aria-controls': id, autocomplete: 'off' });
    const list = el('div', { class: 'options', role: 'listbox', id, 'aria-label': label, tabindex: '-1' });
    let current = selected;
    function render() {
      const q = search.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      list.textContent = '';
      for (const it of items) {
        const hay = (it.label + ' ' + it.value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (q && !hay.includes(q)) continue;
        const opt = el('div', { class: 'opt', role: 'option', tabindex: '0', 'aria-selected': String(it.value === current), 'aria-disabled': it.disabled ? 'true' : null, 'data-value': it.value },
          el('span', { text: it.label }), it.extra ? el('span', { class: 'count', text: it.extra }) : null);
        const choose = () => { if (it.disabled) return; current = it.value; onSelect(it.value); render(); };
        opt.addEventListener('click', choose);
        opt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
          if (e.key === 'ArrowDown' && opt.nextElementSibling) { e.preventDefault(); opt.nextElementSibling.focus(); }
          if (e.key === 'ArrowUp') { e.preventDefault(); (opt.previousElementSibling || search).focus(); }
        });
        list.append(opt);
      }
    }
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && list.firstElementChild) { e.preventDefault(); list.firstElementChild.focus(); } });
    render();
    setTimeout(() => { const s = list.querySelector('[aria-selected="true"]'); if (s) s.scrollIntoView({ block: 'nearest' }); }, 0);
    return el('div', { class: 'picker' }, el('strong', { text: label }), search, list);
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
      if (!lang.enabled) { langItems.push({ value: lang.code, label: lang.name_native, disabled: true, extra: t('prefs_soon') }); continue; }
      langItems.push({ value: lang.code, label: lang.name_native + ' — ' + t('prefs_all_variants'), extra: String(total(lang.code)) });
      for (const v of m.variants.filter((x) => x.language_code === lang.code && x.enabled)) {
        langItems.push({ value: v.code, label: v.name_native, extra: v.own + ' + ' + v.general });
      }
    }
    const remember = el('input', { type: 'checkbox', id: 'pref-remember' });
    remember.checked = state.remember;
    const dlg = el('dialog', { 'aria-labelledby': 'prefs-title' },
      el('form', { method: 'dialog', class: 'dialog-body' },
        el('h2', { id: 'prefs-title', text: t('prefs_title') }),
        el('p', { class: 'muted small', text: t('prefs_note') }),
        (!existing && sug.country) ? el('p', { class: 'small', text: t('prefs_detected') + ': ' + countryName(sug.country) + ' · ' + choiceLabel(sug.choice, m) }) : null,
        picker({ label: t('prefs_country'), placeholder: t('prefs_search_country'), items: countryItems, selected: state.country, onSelect: (v) => { state.country = v; } }),
        picker({ label: t('prefs_language'), placeholder: t('prefs_search_language'), items: langItems, selected: state.choice, onSelect: (v) => { state.choice = v; } }),
        el('label', { class: 'check small', for: 'pref-remember' }, remember, ' ', t('prefs_remember')),
        el('div', { class: 'dialog-actions' },
          first ? null : el('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close(), text: t('cancel') }),
          el('button', { type: 'submit', class: 'btn primary', id: 'prefs-save', text: t('prefs_save') }))));
    dlg.querySelector('form').addEventListener('submit', async () => {
      const before = getPrefs();
      setPrefs({ country: state.country, choice: state.choice, remember: remember.checked, theme: state.theme });
      updatePrefsLabel();
      if (me) api('/api/me/prefs', { method: 'PUT', body: { country: state.country, choice: state.choice, ui: L } }).catch(() => {});
      document.dispatchEvent(new CustomEvent('prefs-changed', { detail: { before, after: getPrefs() } }));
    });
    dlg.addEventListener('close', () => dlg.remove());
    $('#dialog-root').append(dlg);
    dlg.showModal();
  }
  $('#prefs-button').addEventListener('click', () => openPrefs());
  updatePrefsLabel();
  if (!getPrefs() && ['home', 'play', 'daily', 'clue'].includes(BOOT.page)) openPrefs({ first: true });

  // ── Juego ──
  function highlight(text, phrase) {
    const span = el('span');
    if (!phrase) { span.textContent = text; return span; }
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const i = norm(text).indexOf(norm(phrase));
    if (i < 0) { span.textContent = text; return span; }
    span.append(text.slice(0, i), el('mark', { text: text.slice(i, i + phrase.length) }), text.slice(i + phrase.length));
    return span;
  }

  function lettersOf(s) {
    return String(s || '').toUpperCase().normalize('NFC').split('').map((ch) => (ch === 'Ñ' ? ch : ch.normalize('NFD').replace(/[̀-ͯ]/g, '')))
      .join('').replace(/[^A-ZÑ]/g, '');
  }

  function Game(root, { kind }) {
    const st = { game: null, clue: null, hints: [], solved: false, finished: false, streak: 0, timer: null, mode: BOOT.mode || 'infinite', category: null };
    let busy = false;

    function enumTiles(enumeration, value, ok) {
      const letters = lettersOf(value);
      const box = el('div', { class: 'tiles', 'aria-hidden': 'true' });
      let k = 0;
      String(enumeration).split(/([,-])/).forEach((part) => {
        if (part === ',' || part === '-') { box.append(el('span', { class: 'tile gap', text: part === '-' ? '-' : '' })); return; }
        for (let i = 0; i < Number(part); i++) {
          const ch = letters[k++] || '';
          box.append(el('span', { class: 'tile' + (ch ? ' filled' : '') + (ok ? ' ok' : ''), text: ch }));
        }
      });
      return box;
    }

    async function modesBar() {
      if (kind !== 'play') return null;
      const m = await meta();
      const playable = ['infinite', 'quick', 'beginner', 'intermediate', 'expert', 'guided', 'timed', 'themed', 'practice', 'streak'].filter((x) => m.modes.includes(x));
      const sel = el('select', { 'aria-label': t('mode'), id: 'mode-select' }, playable.map((x) => el('option', { value: x, selected: x === st.mode, text: t('mode_' + x) })));
      sel.addEventListener('change', () => { st.mode = sel.value; st.streak = 0; start(); });
      const cat = el('select', { 'aria-label': t('category'), id: 'category-select', hidden: st.mode !== 'themed' },
        el('option', { value: '', text: t('all_categories') }),
        m.categories.map((c) => el('option', { value: c.slug, selected: c.slug === st.category, text: L === 'es' ? c.name_es : c.name_en })));
      cat.addEventListener('change', () => { st.category = cat.value || null; start(); });
      return el('div', { class: 'badges' }, sel, cat);
    }

    function stopTimer() { if (st.timer) { clearInterval(st.timer); st.timer = null; } }

    async function start() {
      stopTimer();
      const prefs = getPrefs() || browserSuggestion([]);
      if (st.mode === 'themed' && !st.category) {
        const m = await meta(); st.category = (m.categories[0] || {}).slug || null;
      }
      root.setAttribute('aria-busy', 'true');
      try {
        const body = { choice: kind === 'clue' ? (BOOT.clueVariant || BOOT.clueLang) : prefs.choice, country: prefs.country, mode: kind === 'clue' ? 'shared' : st.mode, category: st.category };
        if (kind === 'clue') body.slug = BOOT.slug;
        const data = await api(kind === 'daily' ? '/api/daily/start' : '/api/game/start', { method: 'POST', body });
        Object.assign(st, { game: data.game_id, clue: data.clue, notice: data.notice, recycled: data.recycled, hints: [], solved: false, finished: false,
          solution: null, maxHints: data.max_hints, timed: data.timed_seconds, dailyDone: data.finished, attempts: 0, hintsUsed: 0, feedback: null, daily: null });
        if (data.finished) { st.finished = true; st.solved = data.finished.result === 'solved'; st.solution = data.finished.solution; st.attempts = data.finished.attempts; st.hintsUsed = data.finished.hints_used; }
        if (st.mode === 'guided' && st.game && !st.finished) await hint(true);
        await render();
        if (st.timed && !st.finished) startTimer(st.timed);
      } catch (e) {
        root.textContent = '';
        root.append(el('p', { class: 'notice error', role: 'alert', text: (e.data && e.data.message) || t('error_generic') }), el('button', { class: 'btn', onclick: start, text: t('restart') }));
      } finally { root.removeAttribute('aria-busy'); }
    }

    function startTimer(seconds) {
      const end = Date.now() + seconds * 1000;
      st.timer = setInterval(async () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        const n = $('.timer', root);
        if (n) { n.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'); n.classList.toggle('low', left <= 20); }
        if (left === 0) {
          stopTimer();
          try { await api('/api/game/' + st.game + '/skip', { method: 'POST', body: { reason: 'timeout' } }); const r = await api('/api/game/' + st.game + '/reveal', { method: 'POST', body: {} }); st.solution = r.solution; } catch (e) { /* sin penalidad */ }
          st.finished = true; st.feedback = { cls: 'bad', text: t('time_up') }; st.streak = 0; render();
        }
      }, 250);
    }

    async function guess(value) {
      if (busy || st.finished) return;
      if (!lettersOf(value)) return;
      busy = true;
      try {
        const r = await api('/api/game/' + st.game + '/guess', { method: 'POST', body: { answer: value } });
        st.attempts = r.attempts || st.attempts;
        if (r.correct) {
          stopTimer(); st.solved = true; st.finished = true; st.solution = r.solution; st.daily = r.daily; st.streak++;
          st.feedback = { cls: 'ok', text: t('correct') };
        } else if (!r.empty) {
          const fb = (r.feedback || [])[0];
          st.feedback = { cls: 'bad', text: fb && fb.code === 'length' ? t('fb_length', { n: fb.expected }) : fb && fb.code === 'enye' ? t('fb_enye') : t('incorrect'), shake: true };
        }
      } catch (e) {
        st.feedback = { cls: 'bad', text: t('error_generic') };
      } finally { busy = false; }
      render(value);
    }

    async function hint(silent) {
      try {
        const r = await api('/api/game/' + st.game + '/hint', { method: 'POST', body: {} });
        st.hints = r.hints; st.hintsUsed = r.hints_used; st.maxHints = r.max_hints;
      } catch (e) { st.feedback = { cls: 'bad', text: t('error_generic') }; }
      if (!silent) render($('#answer', root) ? $('#answer', root).value : '');
    }

    async function reveal() {
      try {
        const r = await api('/api/game/' + st.game + '/reveal', { method: 'POST', body: {} });
        stopTimer(); st.solution = r.solution; st.daily = r.daily; st.finished = true; st.streak = 0;
        st.feedback = { cls: '', text: t('revealed') };
      } catch (e) { st.feedback = { cls: 'bad', text: t('error_generic') }; }
      render();
    }

    async function next() {
      if (st.game && !st.finished) { try { await api('/api/game/' + st.game + '/skip', { method: 'POST', body: {} }); } catch (e) { /* ignorar */ } if (st.mode === 'streak') st.streak = 0; }
      if (kind === 'clue' || kind === 'daily') { location.href = route('play'); return; }
      start();
    }

    async function restart() {
      try {
        const r = await api('/api/game/' + st.game + '/restart', { method: 'POST', body: {} });
        Object.assign(st, { game: r.game_id, finished: false, solved: false, solution: null, hints: [], hintsUsed: 0, attempts: 0, feedback: null });
        render();
        if (st.timed) startTimer(st.timed);
      } catch (e) { st.feedback = { cls: 'bad', text: t('error_generic') }; render(); }
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
        el('h2', { id: 'report-title', text: t('report_title') }),
        el('label', {}, t('report_reason'), sel), el('label', {}, 'Mensaje', msg),
        el('div', { class: 'dialog-actions' }, el('button', { type: 'button', class: 'btn ghost', onclick: () => dlg.close(), text: t('cancel') }),
          el('button', { type: 'submit', class: 'btn primary', text: t('report_send') }))));
      dlg.querySelector('form').addEventListener('submit', async () => {
        try { await api('/api/clues/' + st.clue.id + '/report', { method: 'POST', body: { reason: sel.value, message: msg.value } }); toast(t('report_thanks')); } catch (e) { toast(t('error_generic')); }
      });
      dlg.addEventListener('close', () => dlg.remove());
      $('#dialog-root').append(dlg); dlg.showModal();
    }

    async function favorite() {
      try { await api('/api/me/favorites/' + st.clue.id, { method: 'POST', body: {} }); toast('★'); } catch (e) { location.href = route('account'); }
    }

    function noticeBox() {
      const n = st.notice;
      if (st.recycled) return el('p', { class: 'notice', text: t('recycled') });
      if (!n) return null;
      if (n.kind === 'few_regional') return el('p', { class: 'notice' }, t('notice_few_regional', { n: n.regional }), ' ', el('button', { class: 'btn ghost', type: 'button', onclick: () => openPrefs(), text: t('change_prefs') }));
      return null;
    }

    async function render(typed) {
      await authReady;
      root.textContent = '';
      if (!st.clue) {
        const n = st.notice || { kind: 'empty' };
        const box = el('div', { class: 'notice', role: 'status' }, el('p', { text: n.kind === 'language_unavailable' ? t('notice_language_unavailable') : t('notice_empty') }));
        if (n.alternatives && n.alternatives.length) {
          const m = await meta();
          box.append(el('p', { text: t('notice_empty_alt') }), el('div', { class: 'inline-links' }, n.alternatives.map((alt) => {
            const choice = alt.variant || alt.lang;
            return el('button', { class: 'btn ghost', type: 'button', text: choiceLabel(choice, m) + ' (' + alt.n + ')', onclick: () => { const p = getPrefs() || {}; p.choice = choice; setPrefs(p); updatePrefsLabel(); start(); } });
          })));
        }
        box.append(el('button', { class: 'btn', type: 'button', onclick: () => openPrefs(), text: t('change_prefs') }));
        const bar = await modesBar();
        root.append(bar ? el('div', { class: 'game-top' }, bar) : '', box);
        return;
      }
      const c = st.clue;
      const top = el('div', { class: 'game-top' }, await modesBar(),
        el('div', { class: 'badges' },
          st.hints.length || st.solution ? el('span', { class: 'badge', text: t('mech_' + c.mechanism) }) : null,
          el('span', { class: 'badge', text: t('diff_' + c.difficulty) }),
          c.variant ? el('span', { class: 'badge', text: c.variant }) : null,
          (st.mode === 'streak' || st.streak > 1) && kind === 'play' ? el('span', { class: 'badge streak', text: t('streak') + ': ' + st.streak }) : null,
          st.timed && !st.finished ? el('span', { class: 'badge' }, t('time_left') + ' ', el('span', { class: 'timer', text: '' })) : null));
      const defHint = st.hints.find((h) => h.kind === 'definition');
      const clueNode = el(kind === 'clue' ? 'h1' : 'p', { class: 'clue-text', lang: c.language, id: 'clue-text' }, highlight(c.clue, st.solution ? st.solution.definition : defHint && defHint.text));
      root.append(top, noticeBox() || '', clueNode);

      const tilesWrap = el('div', { id: 'tiles' }, enumTiles(c.enumeration, st.solution ? st.solution.answer : typed, st.solved));
      root.append(tilesWrap);

      if (!st.finished) {
        const input = el('input', { id: 'answer', name: 'answer', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'go',
          'aria-label': t('answer_label'), placeholder: t('answer_label'), maxlength: '60', lang: c.language });
        if (typed) input.value = typed;
        input.addEventListener('input', () => { tilesWrap.replaceChildren(enumTiles(c.enumeration, input.value)); });
        const form = el('form', { class: 'answer-row', onsubmit: (e) => { e.preventDefault(); guess(input.value); } },
          input, el('button', { class: 'btn primary', type: 'submit', id: 'check-btn', text: t('check') }));
        root.append(form);
        const canHint = st.hintsUsed < (st.maxHints || 4);
        root.append(el('div', { class: 'game-actions' },
          el('button', { class: 'btn', type: 'button', id: 'hint-btn', disabled: !canHint, onclick: () => hint(), text: t('hint') + ' (' + st.hintsUsed + '/' + (st.maxHints || 4) + ')' }),
          el('button', { class: 'btn ghost', type: 'button', id: 'reveal-btn', onclick: reveal, text: t('reveal') }),
          kind === 'play' ? el('button', { class: 'btn ghost', type: 'button', id: 'skip-btn', onclick: next, text: t('skip') }) : null));
        setTimeout(() => { if (document.activeElement === document.body || !document.activeElement || document.activeElement.id === 'check-btn') input.focus({ preventScroll: true }); }, 0);
      }
      if (st.feedback) {
        const fb = el('p', { class: 'feedback ' + st.feedback.cls, role: 'status', id: 'feedback', text: st.feedback.text });
        root.append(fb);
        if (st.feedback.shake) { const f = $('.answer-row', root); if (f) { f.classList.add('shake'); setTimeout(() => f.classList.remove('shake'), 350); } }
      }
      if (st.hints.length && !st.solution) {
        root.append(el('ul', { class: 'hints', 'aria-label': t('hint') }, st.hints.map((h) => {
          if (h.kind === 'mechanism') return el('li', {}, el('strong', { text: t('mechanism') + ': ' }), t('mech_' + h.mechanism) + '. ' + t('mechhelp_' + h.mechanism));
          if (h.kind === 'definition') return el('li', {}, el('strong', { text: t('definition_hint') + ': ' }), h.text ? '«' + h.text + '»' : '—');
          if (h.kind === 'first_letter') return el('li', {}, el('strong', { text: t('first_letter') + ': ' }), h.letter);
          if (h.kind === 'pattern') return el('li', {}, el('strong', { text: t('pattern') + ': ' }), el('code', { text: h.pattern.split('').join(' ') }));
          return null;
        })));
      }
      if (st.solution) {
        const s = st.solution;
        const sol = el('section', { class: 'solution', 'aria-labelledby': 'sol-title' },
          el('p', { class: 'answer', id: 'solution-answer', text: s.answer }),
          el('h2', { id: 'sol-title', text: t('explanation') }),
          el('ol', { id: 'explanation' }, s.explanation.map((x) => el('li', { text: x }))),
          s.note ? el('p', { class: 'muted', text: s.note }) : null,
          st.mode === 'guided' ? el('p', { class: 'muted small', text: t('mechhelp_' + s.mechanism) }) : null,
          st.daily && st.daily.players ? el('p', { class: 'small', text: t('daily_stats', { p: st.daily.players, s: st.daily.solved }) }) : null,
          kind === 'daily' && st.dailyDone ? el('p', { class: 'small muted', text: t('daily_done') }) : null,
          c.attribution && c.origin === 'external' ? el('p', { class: 'attribution' }, t('source') + ': ', c.source_url ? el('a', { href: c.source_url, rel: 'noopener nofollow', text: c.attribution }) : c.attribution) : null);
        root.append(sol);
        root.append(el('div', { class: 'game-actions' },
          el('button', { class: 'btn primary', type: 'button', id: 'next-btn', onclick: next, text: t('next') }),
          !st.solved && kind !== 'daily' ? el('button', { class: 'btn', type: 'button', id: 'restart-btn', onclick: restart, text: t('restart') }) : null,
          el('button', { class: 'btn ghost', type: 'button', id: 'share-btn', onclick: share, text: t('share') }),
          me ? el('button', { class: 'btn ghost', type: 'button', onclick: favorite, text: '★ ' + t('favorite') }) : null,
          el('button', { class: 'btn ghost', type: 'button', id: 'report-btn', onclick: report, text: t('report') })));
        setTimeout(() => { const b = $('#next-btn', root); if (b) b.focus({ preventScroll: true }); }, 0);
      } else if (st.clue) {
        root.append(el('p', { class: 'small' }, el('button', { class: 'btn ghost', type: 'button', onclick: report, text: t('report') })));
      }
    }

    document.addEventListener('prefs-changed', (e) => {
      const { before, after } = e.detail;
      if (kind === 'clue') return;
      if (!before || before.choice !== after.choice) start();   // el país solo no reinicia la partida
    });
    // Sin preferencias, el diálogo de primera visita dispara el inicio al guardar.
    if (getPrefs() || kind === 'clue') start();
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
    const field = (label, input) => el('label', {}, label, input);
    const errBox = el('p', { class: 'field-error', role: 'alert', id: 'form-error' });
    const form = el('form', { class: 'form', id: 'contribute-form', novalidate: true },
      field(t('f_clue'), el('input', { name: 'clue_text', id: 'f-clue', required: true, maxlength: '300', placeholder: L === 'es' ? 'Ramo revuelto para el sentimiento (4)' : 'Cheater reformed as an educator (7)' })),
      el('div', { class: 'row' },
        field(t('f_answer'), el('input', { name: 'answer', id: 'f-answer', required: true, maxlength: '60', autocapitalize: 'characters' })),
        field(t('f_definition'), el('input', { name: 'definition', id: 'f-definition', maxlength: '200' }))),
      field(t('f_explanation'), el('textarea', { name: 'explanation', id: 'f-explanation', required: true, maxlength: '2000' })),
      el('div', { class: 'row' },
        field(t('f_mechanism'), el('select', { name: 'mechanism', id: 'f-mechanism' }, mechs.map((x) => el('option', { value: x, text: t('mech_' + x) })))),
        field(t('f_language'), langSel), field(t('f_variant'), varSel)),
      el('div', { class: 'row' },
        field(t('f_category'), el('select', { name: 'category', id: 'f-category' }, BOOT.categories.map((c) => el('option', { value: c.slug, text: L === 'es' ? c.name_es : c.name_en })))),
        field(t('f_difficulty'), el('select', { name: 'difficulty', id: 'f-difficulty' }, [1, 2, 3, 4, 5].map((d) => el('option', { value: d, selected: d === 2, text: t('diff_' + d) })))),
        field(t('f_name'), el('input', { name: 'public_name', id: 'f-name', maxlength: '60' }))),
      field(t('f_reference'), el('input', { name: 'reference', id: 'f-reference', maxlength: '300' })),
      el('label', { class: 'hp', 'aria-hidden': 'true' }, 'Website', el('input', { name: 'website', tabindex: '-1', autocomplete: 'off' })),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'rights_confirmed', id: 'f-rights', required: true }), t('f_rights')),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', name: 'terms_accepted', id: 'f-terms', required: true }), el('span', {}, t('f_terms'), ' ', el('a', { href: route('terms'), target: '_blank', text: '↗' }))),
      errBox,
      el('button', { class: 'btn primary', type: 'submit', id: 'f-send', text: t('f_send') }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); errBox.textContent = '';
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      body.rights_confirmed = form.rights_confirmed.checked; body.terms_accepted = form.terms_accepted.checked;
      body.difficulty = Number(body.difficulty); body.form_started_at = startedAt;
      if (!body.variant_code) delete body.variant_code;
      try {
        const r = await api('/api/submissions', { method: 'POST', body });
        root.replaceChildren(el('div', { class: 'form' },
          el('h2', { text: t('sent_title') }), el('p', { text: t('sent_lead') }), el('p', { class: 'code-box', id: 'tracking-code', text: r.tracking_code }),
          el('a', { class: 'btn', href: route('submission', '?code=' + encodeURIComponent(r.tracking_code)), text: t('status_title') })));
      } catch (err) {
        const fields = err.data && err.data.details && err.data.details.fields;
        errBox.textContent = (err.data && err.data.message) || t('error_generic');
        if (fields) errBox.textContent += ' (' + fields.join(', ') + ')';
      }
    });
    root.append(form);
  }

  async function SubmissionStatus(root) {
    const params = new URLSearchParams(location.search);
    const code = el('input', { id: 's-code', required: true, value: params.get('code') || '' });
    const out = el('div', { id: 'status-out', 'aria-live': 'polite' });
    const form = el('form', { class: 'form' }, el('label', {}, t('status_code'), code), el('button', { class: 'btn primary', type: 'submit', text: t('status_check') }));
    async function load() {
      out.textContent = '';
      try {
        const s = await api('/api/submissions/status?code=' + encodeURIComponent(code.value.trim()));
        out.append(el('div', { class: 'form' },
          el('p', {}, el('span', { class: 'status-pill ' + s.status, id: 'status-pill', text: t('st_' + s.status) })),
          el('p', { class: 'clue-text', text: s.clue_text }), el('p', { text: t('f_answer') + ': ' + s.answer }),
          s.moderator_note ? el('p', {}, el('strong', { text: t('moderator_note') + ': ' }), s.moderator_note) : null,
          el('ol', { class: 'small muted' }, s.history.map((h) => el('li', { text: t('st_' + h.status) + ' · ' + new Date(h.at).toLocaleString(L) })))));
        if (s.status === 'needs_changes') {
          const c2 = el('input', { value: s.clue_text, maxlength: '300' }); const a2 = el('input', { value: s.answer, maxlength: '60' });
          const e2 = el('textarea', { maxlength: '2000' }); e2.value = s.explanation;
          const f2 = el('form', { class: 'form' }, el('label', {}, t('f_clue'), c2), el('label', {}, t('f_answer'), a2), el('label', {}, t('f_explanation'), e2),
            el('button', { class: 'btn primary', type: 'submit', text: t('resubmit') }));
          f2.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try { await api('/api/submissions/resubmit', { method: 'POST', body: { code: code.value.trim(), clue_text: c2.value, answer: a2.value, explanation: e2.value } }); load(); } catch (err) { toast((err.data && err.data.message) || t('error_generic')); }
          });
          out.append(f2);
        }
      } catch (e) { out.append(el('p', { class: 'notice error', text: e.status === 404 ? '—' : t('error_generic') })); }
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
    root.append(form, out);
    if (code.value) load();
  }

  // ── Perfil y cuenta ──
  async function Profile(root) {
    await authReady;
    const s = await api('/api/me/stats');
    root.textContent = '';
    const stat = (v, k) => el('div', { class: 'stat' }, el('b', { text: String(v) }), el('span', { text: t(k) }));
    root.append(el('div', { class: 'stats-grid', id: 'stats' }, stat(s.played, 'played'), stat(s.solved, 'solved'), stat(s.solve_rate + '%', 'solve_rate'),
      stat(s.current_streak, 'streak'), stat(s.best_streak, 'best_streak'), stat(s.daily_streak, 'daily_streak')));
    root.append(el('h2', { text: t('achievements') }), s.achievements.length ? el('ul', { class: 'ach' }, s.achievements.map((a) => el('li', { text: t('ach_' + a) }))) : el('p', { class: 'muted', text: '—' }));
    if (!me) { root.append(el('p', {}, el('a', { class: 'btn', href: route('account'), text: t('login') + ' / ' + t('register') }))); return; }
    const [fav, subs, notes] = await Promise.all([api('/api/me/favorites'), api('/api/me/submissions'), api('/api/me/notifications')]);
    root.append(el('h2', { text: t('favorites') }), fav.items.length ? el('ul', { class: 'clue-list' }, fav.items.map((c) => el('li', { class: 'clue-card' }, el('a', { href: route('clue', '/' + c.slug) }, el('span', { class: 'clue-text', text: c.clue }))))) : el('p', { class: 'muted', text: '—' }));
    root.append(el('h2', { text: t('my_submissions') }), subs.items.length ? el('ul', { class: 'clue-list' }, subs.items.map((x) => el('li', { class: 'clue-card' }, el('div', { class: 'form' }, el('span', { class: 'clue-text', text: x.clue_text }), el('span', { class: 'status-pill ' + x.status, text: t('st_' + x.status) }), x.moderator_note ? el('span', { class: 'small', text: x.moderator_note }) : null)))) : el('p', { class: 'muted', text: '—' }));
    root.append(el('h2', { text: t('notifications') }), notes.items.length ? el('ul', {}, notes.items.map((n) => el('li', { text: t('st_' + n.kind.replace('submission_', '')) + ' · ' + new Date(n.created_at).toLocaleString(L) }))) : el('p', { class: 'muted', text: '—' }));
    root.append(el('p', {}, el('button', { class: 'btn ghost', type: 'button', text: L === 'es' ? 'Eliminar mi cuenta' : 'Delete my account', onclick: async () => {
      if (!window.confirm(L === 'es' ? '¿Eliminar tu cuenta? No se puede deshacer.' : 'Delete your account? This cannot be undone.')) return;
      await api('/api/me/account', { method: 'DELETE', body: {} }); location.href = route('home');
    } })));
  }

  async function Account(root) {
    await authReady;
    if (me) {
      root.append(el('div', { class: 'form' }, el('p', { text: me.username }), el('button', { class: 'btn', type: 'button', id: 'logout-btn', text: t('logout'), onclick: async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); location.reload(); } })));
      return;
    }
    const mk = (kind) => {
      const u = el('input', { name: 'username', autocomplete: 'username', required: true, maxlength: '30' });
      const p = el('input', { name: 'password', type: 'password', autocomplete: kind === 'login' ? 'current-password' : 'new-password', required: true, minlength: kind === 'login' ? null : '10' });
      const e = el('input', { name: 'email', type: 'email', autocomplete: 'email' });
      const err = el('p', { class: 'field-error', role: 'alert' });
      const f = el('form', { class: 'form', id: kind + '-form' }, el('h2', { text: t(kind) }), el('label', {}, t('username'), u), el('label', {}, t('password'), p),
        kind === 'register' ? el('p', { class: 'small muted', text: t('pw_rules') }) : null, kind === 'register' ? el('label', {}, t('email_optional'), e) : null, err,
        el('button', { class: 'btn primary', type: 'submit', text: t(kind) }));
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault(); err.textContent = '';
        try { await api('/api/auth/' + kind, { method: 'POST', body: { username: u.value, password: p.value, email: e.value || null } }); location.href = route('profile'); } catch (x) { err.textContent = (x.data && x.data.message) || t('error_generic'); }
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
  if ($('#profile-root')) Profile($('#profile-root')).catch(() => { $('#profile-root').textContent = t('error_generic'); });
  if ($('#account-root')) Account($('#account-root'));
  window.__cripta = { openPrefs, getPrefs };
})();
