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
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
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
  };
  function flash(msg, ok) { const f = el('div', { class: 'flash ' + (ok ? 'ok' : 'bad'), role: 'status', text: msg }); main.prepend(f); setTimeout(() => f.remove(), 6000); }
  const checksList = (checks) => el('ul', { class: 'checks' }, (checks || []).map((c) => el('li', { class: c.level, text: c.msg || c.code })));
  const table = (head, rows) => el('div', { class: 'tbl-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, head.map((h) => el('th', { text: h })))), el('tbody', {}, rows)));
  const btn = (text, onclick, cls) => el('button', { class: 'btn ' + (cls || ''), type: 'button', onclick, text });
  const act = (fn, okMsg) => async () => { try { await fn(); if (okMsg) flash(okMsg, true); route(); } catch (e) { flash(e.message, false); } };

  // ── Acceso ──
  function loginView(msg) {
    $('#admin-nav').hidden = true; $('#logout').hidden = true;
    const u = el('input', { id: 'a-user', autocomplete: 'username', required: true });
    const p = el('input', { id: 'a-pass', type: 'password', autocomplete: 'current-password', required: true });
    const err = el('p', { class: 'field-error', role: 'alert', text: msg || '' });
    const f = el('form', { class: 'form login-box', id: 'admin-login' }, el('h1', { text: 'Panel privado' }), el('label', {}, 'Usuario', u), el('label', {}, 'Contraseña', p), err,
      el('button', { class: 'btn primary', type: 'submit', text: 'Entrar' }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/auth/login', { method: 'POST', body: { username: u.value, password: p.value, admin: true } }); csrf = r.csrf; await boot(); } catch (x) { err.textContent = x.message; }
    });
    main.replaceChildren(f); u.focus();
  }

  async function boot() {
    const s = await api('/api/auth/me'); csrf = s.csrf;
    if (!s.user || s.user.role === 'player') return loginView();
    const m = await api('/api/admin/me'); me = m.user; perms = m.permissions;
    $('#who').textContent = me.username + ' · ' + me.role;
    $('#logout').hidden = false;
    $('#admin-nav').hidden = false;
    document.querySelectorAll('#admin-nav a').forEach((a) => { a.hidden = !can(a.dataset.perm); });
    route();
  }
  $('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); csrf = null; loginView(); });

  // ── Vistas ──
  const V = {};

  V.dashboard = async () => {
    const d = await api('/api/admin/dashboard');
    const card = (v, label, warn) => el('div', { class: 'card' + (warn && v ? ' warn' : '') }, el('b', { text: String(v) }), el('span', { text: label }));
    const pub = d.clues.filter((c) => c.status === 'published').reduce((s, c) => s + c.n, 0);
    const maxDay = Math.max(1, ...d.activity.map((x) => x.games));
    main.replaceChildren(el('h1', { text: 'Resumen' }),
      el('div', { class: 'cards' },
        card(d.users, 'Usuarios registrados'), card(d.games.started, 'Partidas iniciadas'), card(d.games.finished, 'Partidas terminadas'),
        card(d.games.solve_rate + '%', 'Tasa de resolución'), card(d.games.last7, 'Partidas (7 días)'), card(pub, 'Crípticos publicados'),
        card(d.new_clues_7d, 'Nuevos crípticos (7 días)'), card(d.pending_submissions, 'Propuestas pendientes', true), card(d.import_review, 'Importaciones en revisión', true),
        card(d.sources_with_errors, 'Fuentes con errores', true), card(d.duplicates_open, 'Duplicados por revisar', true), card(d.reports_open, 'Errores informados', true),
        card(d.errors_7d, 'Errores del sistema (7 días)', true), card(d.retention.rate + '%', 'Retención 30 días (' + d.retention.returning_30d + '/' + d.retention.active_30d + ')')),
      el('div', { class: 'cols' },
        el('div', { class: 'panel' }, el('h3', { text: 'Idiomas jugados' }), table(['Idioma', 'Partidas'], d.languages.map((x) => el('tr', {}, el('td', { text: x.lang }), el('td', { text: x.games }))))),
        el('div', { class: 'panel' }, el('h3', { text: 'Variantes elegidas' }), table(['Variante', 'Partidas'], d.variants.map((x) => el('tr', {}, el('td', { text: x.variant }), el('td', { text: x.games }))))),
        el('div', { class: 'panel' }, el('h3', { text: 'Países más activos' }), table(['País', 'Partidas'], d.countries.map((x) => el('tr', {}, el('td', { text: x.country }), el('td', { text: x.games }))))),
        el('div', { class: 'panel' }, el('h3', { text: 'Publicados por origen' }), table(['Origen', 'Crípticos'], d.published_by_origin.map((x) => el('tr', {}, el('td', { text: LABELS[x.origin] }), el('td', { text: x.n })))))),
      el('div', { class: 'panel' }, el('h3', { text: 'Actividad (30 días)' }), table(['Día', 'Partidas', 'Jugadores', ''], d.activity.map((x) => el('tr', {}, el('td', { text: x.day }), el('td', { text: x.games }), el('td', { text: x.players }), el('td', { style: 'width:40%' }, el('div', { class: 'bar', style: 'width:' + Math.round((x.games / maxDay) * 100) + '%' })))))),
      el('div', { class: 'panel' }, el('h3', { text: 'Tareas programadas' }), table(['Tarea', 'Estado', 'Última', 'Próxima', 'Error'], d.jobs.map((j) => el('tr', {}, el('td', { text: j.name }), el('td', {}, j.last_status ? pill(j.last_status) : '—'), el('td', { text: fmt(j.last_run_at) }), el('td', { text: fmt(j.next_run_at) }), el('td', { text: j.last_error || '' }))))),
      d.last_errors.length ? el('div', { class: 'panel' }, el('h3', { text: 'Últimos errores' }), table(['Ámbito', 'Mensaje', 'Fecha'], d.last_errors.map((e) => el('tr', {}, el('td', { text: e.scope }), el('td', { text: e.message }), el('td', { text: fmt(e.created_at) }))))) : '');
  };

  async function catalogList(fixed, title) {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    const params = new URLSearchParams(Object.assign({}, Object.fromEntries(q), fixed || {}));
    const d = await api('/api/admin/clues?' + params);
    const search = el('input', { type: 'search', placeholder: 'Buscar pista o respuesta', value: q.get('q') || '' });
    const mk = (name, opts) => { const s = el('select', { name }, el('option', { value: '', text: name }), opts.map((o) => el('option', { value: o, selected: q.get(name) === o, text: LABELS[o] || o }))); return s; };
    const sStatus = mk('status', ['published', 'draft', 'review', 'disabled']);
    const sOrigin = mk('origin', ['original', 'generated', 'external', 'community']);
    const sLang = mk('language_code', ['es', 'en', 'fr', 'pt', 'it', 'de']);
    const sVal = mk('validation_status', ['verified', 'asserted', 'failed', 'unchecked']);
    const go = () => { const p = new URLSearchParams(); for (const [k, v] of [['q', search.value], ['status', sStatus.value], ['origin', sOrigin.value], ['language_code', sLang.value], ['validation_status', sVal.value]]) if (v) p.set(k, v); location.hash = location.hash.split('?')[0] + '?' + p; };
    const page = Number(q.get('page') || 1);
    main.replaceChildren(el('h1', { text: title }),
      fixed ? '' : el('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); go(); } }, search, sStatus, sOrigin, sLang, sVal, el('button', { class: 'btn', type: 'submit', text: 'Filtrar' })),
      el('p', { class: 'muted small', text: d.total + ' crípticos' }),
      table(['Pista', 'Respuesta', 'Idioma', 'Origen', 'Estado', 'Validación', ''], d.items.map((c) => el('tr', {},
        el('td', {}, el('a', { href: '#clue/' + c.id, text: c.clue_text })), el('td', { text: c.answer }), el('td', { text: c.language_code + (c.variant_code ? ' · ' + c.variant_code : '') }),
        el('td', { text: LABELS[c.origin] }), el('td', {}, pill(c.status)), el('td', {}, pill(c.validation_status)),
        el('td', {}, c.status !== 'published' && c.validation_errors === 0 && can('catalog.write') ? btn('Publicar', act(() => api('/api/admin/clues/' + c.id + '/status', { method: 'POST', body: { status: 'published' } }), 'Publicado.')) : '')))),
      el('div', { class: 'toolbar' }, page > 1 ? btn('← Anterior', () => { q.set('page', page - 1); location.hash = location.hash.split('?')[0] + '?' + q; }) : '',
        d.total > page * d.per_page ? btn('Siguiente →', () => { q.set('page', page + 1); location.hash = location.hash.split('?')[0] + '?' + q; }) : ''));
  }
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
        el('td', {}, w ? btn('Guardar', act(() => api('/api/admin/settings/' + encodeURIComponent(k), { method: 'PUT', body: { value: read() } }), 'Guardado.')) : ''));
    });
    const slug = el('input', { placeholder: 'slug' }); const es = el('input', { placeholder: 'Nombre (es)' }); const en = el('input', { placeholder: 'Name (en)' });
    main.replaceChildren(el('h1', { text: 'Reglas y funciones' }), table(['Opción', 'Valor', ''], rows),
      el('h2', { text: 'Categorías' }), table(['Slug', 'Español', 'English', 'Activa'], cats.items.map((c) => el('tr', {}, el('td', { text: c.slug }), el('td', { text: c.name_es }), el('td', { text: c.name_en }),
        el('td', {}, w ? btn(c.enabled ? 'Desactivar' : 'Activar', act(() => api('/api/admin/categories', { method: 'POST', body: { ...c, enabled: !c.enabled } }))) : (c.enabled ? 'sí' : 'no'))))),
      w ? el('div', { class: 'toolbar' }, slug, es, en, btn('Agregar categoría', act(() => api('/api/admin/categories', { method: 'POST', body: { slug: slug.value, name_es: es.value, name_en: en.value } }), 'Categoría guardada.'))) : '');
  };

  V.users = async () => {
    const d = await api('/api/admin/users');
    const u = el('input', { placeholder: 'usuario' }); const p = el('input', { type: 'password', placeholder: 'contraseña (10+)', autocomplete: 'new-password' });
    const r = el('select', {}, ['moderator', 'editor', 'owner'].map((x) => el('option', { value: x, text: x })));
    main.replaceChildren(el('h1', { text: 'Equipo' }), el('p', { class: 'muted', text: d.players + ' jugadores con cuenta.' }),
      el('div', { class: 'panel' }, el('h3', { text: 'Roles' }), el('ul', {}, el('li', { text: 'owner: todo, incluida la configuración y el equipo.' }), el('li', { text: 'editor: catálogo, fuentes e importaciones.' }), el('li', { text: 'moderator: propuestas de usuarios y reportes.' }))),
      table(['Usuario', 'Rol', 'Estado', 'Último acceso', ''], d.items.map((x) => el('tr', {}, el('td', { text: x.username }), el('td', { text: x.role }), el('td', { text: x.disabled ? 'desactivado' : 'activo' }), el('td', { text: fmt(x.last_login_at) }),
        el('td', {}, x.id !== me.id ? btn(x.disabled ? 'Reactivar' : 'Desactivar', act(() => api('/api/admin/users/' + x.id, { method: 'PATCH', body: { disabled: !x.disabled } }))) : '(vos)')))),
      el('h2', { text: 'Agregar integrante' }), el('div', { class: 'toolbar' }, u, p, r, btn('Crear', act(() => api('/api/admin/users', { method: 'POST', body: { username: u.value, password: p.value, role: r.value } }), 'Cuenta creada.'), 'primary')));
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

  async function route() {
    if (!me) return;
    const [name, arg] = location.hash.replace(/^#/, '').split('?')[0].split('/');
    const view = V[name || 'dashboard'] ? (name || 'dashboard') : 'dashboard';
    document.querySelectorAll('#admin-nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + view));
    try { await V[view](arg); main.focus({ preventScroll: true }); } catch (e) {
      if (e.status === 401) return loginView('La sesión expiró.');
      main.replaceChildren(el('p', { class: 'flash bad', text: e.status === 403 ? 'Tu rol no tiene permiso para esta sección.' : 'Error: ' + e.message }));
    }
  }
  window.addEventListener('hashchange', route);
  boot().catch(() => loginView());
})();
