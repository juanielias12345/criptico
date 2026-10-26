/* Play Crípticos: duelos, torneos y amigos. Usa las utilidades públicas de app.js. */
(function () {
  'use strict';

  const C = window.__cripta;
  const root = document.getElementById('arena-root');
  if (!C || !root) return;
  const { el, api, route, toast, authReady } = C;
  const BOOT = JSON.parse(document.getElementById('boot').textContent);
  const SITE = location.origin;
  const MECH = { anagram: 'Anagrama', hidden: 'Palabra oculta', reversal: 'Inversión', container: 'Inserción', deletion: 'Supresión', charade: 'Charada',
    homophone: 'Homófono', double_definition: 'Doble definición', initials: 'Iniciales', spoonerism: 'Intercambio', literal: 'Literal', composite: 'Compuesto' };
  const DIFF = ['', 'Muy fácil', 'Fácil', 'Media', 'Difícil', 'Muy difícil'];
  const ddmm = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
  const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const dayLabel = (s) => DOW[new Date(s + 'T00:00:00Z').getUTCDay()] + ' ' + ddmm(s);
  const errMsg = (e) => (e && e.data && e.data.message) || 'Algo salió mal. Probá de nuevo.';
  const loginHref = () => route('account') + '?next=' + encodeURIComponent(location.pathname);
  const dot = (on) => el('span', { class: 'online-dot' + (on ? ' on' : ''), title: on ? 'Conectado ahora' : 'No conectado', 'aria-label': on ? 'Conectado ahora' : 'No conectado' });
  let pollTimer = null;
  const stopPoll = () => { if (pollTimer) clearInterval(pollTimer); pollTimer = null; };

  // ── Compartir ──
  // Con el menú del teléfono si existe; si no, copia el texto. Siempre con opción de WhatsApp.
  function shareBox(text, url, label) {
    const full = text + ' ' + url;
    const btn = el('button', { class: 'btn small ink', type: 'button', text: label || 'Compartir', onclick: async () => {
      try {
        if (navigator.share) { await navigator.share({ text, url }); return; }
        await navigator.clipboard.writeText(full); toast('Copiado. Pegalo donde quieras.');
      } catch (e) { if (e && e.name !== 'AbortError') toast('No se pudo compartir.'); }
    } });
    const wa = el('a', { class: 'btn small', href: 'https://wa.me/?text=' + encodeURIComponent(full), target: '_blank', rel: 'noopener', text: 'WhatsApp' });
    const copy = el('button', { class: 'btn small quiet', type: 'button', text: 'Copiar enlace', onclick: async () => {
      try { await navigator.clipboard.writeText(url); toast('Enlace copiado.'); } catch (e) { toast(url); }
    } });
    return el('div', { class: 'share-row' }, btn, wa, copy);
  }

  // ── Una ronda ──
  // La partida es una partida normal: se responde con /api/game/:id/*. El tiempo lo mide el servidor.
  async function playRound(startPath, { title, back, pointsOf }) {
    stopPoll();
    let r;
    try { r = await api(startPath, { method: 'POST', body: {} }); } catch (e) { toast(errMsg(e)); return; }
    const view = el('section', { class: 'sheet arena-play', 'aria-labelledby': 'round-t' });
    root.replaceChildren(view);
    window.scrollTo(0, 0);
    const done = async (solution, outcome) => {
      clearInterval(tick);
      let pts = null;
      try { pts = await pointsOf(); } catch (e) { /* se muestra igual */ }
      view.replaceChildren(
        el('p', { class: 'eyebrow', text: title }),
        el('h2', { id: 'round-t', class: 'round-result ' + (outcome === 'solved' ? 'ok' : 'miss'), text: outcome === 'solved' ? '¡Bien resuelto!' : 'Esta vez no salió' }),
        pts !== null ? el('p', { class: 'round-points' }, el('b', { text: String(pts) }), ' puntos') : null,
        solution ? el('div', { class: 'round-solution' }, el('p', { class: 'answer', text: solution.answer }),
          el('ol', { class: 'explain' }, (solution.explanation || []).map((s) => el('li', { text: typeof s === 'string' ? s : (s.text || '') })))) : null,
        el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'button', text: 'Seguir', onclick: back })));
    };
    if (r.finished) { done(r.solution, r.result); return; }
    const t0 = Date.now();
    const clock = el('span', { class: 'round-clock', 'aria-live': 'off', text: '0:00' });
    const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); clock.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 1000);
    const input = el('input', { autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'go', maxlength: '60', 'aria-label': 'Tu respuesta', placeholder: 'Tu respuesta' });
    const fb = el('p', { class: 'feedback', role: 'status' });
    const hints = el('ul', { class: 'round-hints' });
    let shown = 0;
    const hintText = (h) => (h.kind === 'mechanism' ? 'Mecanismo: ' + (MECH[h.mechanism] || h.mechanism) + (h.indicator ? ' (indicador: «' + h.indicator + '»)' : '')
      : h.kind === 'definition' ? (h.text ? 'Definición: «' + h.text + '»' : 'La definición está al principio o al final.')
        : h.kind === 'first_letter' ? 'Empieza con ' + h.letter : h.kind === 'pattern' ? 'Letras: ' + h.pattern.split('').join(' ') : '');
    const hintBtn = el('button', { class: 'btn quiet', type: 'button', text: 'Pista (−20)', onclick: async () => {
      try {
        const h = await api('/api/game/' + r.game_id + '/hint', { method: 'POST', body: { level: shown + 1 } });
        shown = h.hints_used;
        hints.replaceChildren(...h.hints.map((x) => el('li', { text: hintText(x) })));
        if (shown >= h.max_hints) hintBtn.disabled = true;
      } catch (e) { toast(errMsg(e)); }
    } });
    const giveUp = el('button', { class: 'btn quiet', type: 'button', text: 'Me rindo', onclick: async () => {
      try { const x = await api('/api/game/' + r.game_id + '/reveal', { method: 'POST', body: {} }); done(x.solution, 'revealed'); } catch (e) { toast(errMsg(e)); }
    } });
    const form = el('form', { class: 'try-row' }, input, el('button', { class: 'btn ink', type: 'submit', text: 'Comprobar' }));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!input.value.trim()) return;
      try {
        const g = await api('/api/game/' + r.game_id + '/guess', { method: 'POST', body: { answer: input.value } });
        if (g.correct) { done(g.solution, 'solved'); return; }
        const len = (g.feedback || []).find((f) => f.code === 'length');
        fb.textContent = g.repeated ? 'Ya probaste esa.' : len ? 'No. La respuesta tiene ' + len.expected + ' letras.' : 'No es esa. Seguí probando (cada error resta 10).';
        input.select();
      } catch (e) { toast(errMsg(e)); }
    });
    view.append(
      el('div', { class: 'sheet-top' }, el('p', { class: 'eyebrow', text: title }), el('span', { class: 'tag' }, '⏱ ', clock)),
      el('h2', { id: 'round-t', class: 'sr-only', text: title }),
      el('p', { class: 'clue-text', lang: 'es', text: r.clue.clue }),
      el('p', { class: 'small muted', text: (MECH[r.clue.mechanism] ? '' : '') + 'Dificultad: ' + (DIFF[r.clue.difficulty] || r.clue.difficulty) + (r.resumed ? ' · Retomaste la ronda: el reloj siguió corriendo.' : '') }),
      form, fb, hints,
      el('div', { class: 'form-actions' }, hintBtn, giveUp),
      el('p', { class: 'small muted', text: 'Resolver vale 100 puntos, menos 20 por pista y 10 por error, más hasta 100 por velocidad (completo hasta 10 segundos, nada después de 3 minutos).' }));
    input.focus();
  }

  // ═════════════ Torneo ═════════════
  function tournamentCard(tv, me, { full } = {}) {
    const box = el('section', { class: 'sheet arena-card', 'aria-labelledby': 'tour-t' });
    const st = { live: 'En juego', upcoming: 'Empieza pronto', finished: 'Terminado', cancelled: 'Cancelado' }[tv.state];
    box.append(el('p', { class: 'eyebrow', text: st + ' · ' + ddmm(tv.starts_on) + ' al ' + ddmm(tv.ends_on) + ' · ' + tv.standings.players + (tv.standings.players === 1 ? ' inscripto' : ' inscriptos') }),
      el('h2', { id: 'tour-t', text: tv.title }),
      el('p', { class: 'muted', text: 'Un críptico nuevo por día. Cada ronda se abre a las 00:00 UTC (21 h de Argentina) y se puede jugar ese día y el siguiente. Gana quien más puntos sume; si empatan, quien resolvió más rápido.' }));
    const reload = () => main();
    if (!me) {
      box.append(el('div', { class: 'notice info' }, el('p', { text: 'Para jugar el torneo necesitás una cuenta. Es gratis y tarda un minuto.' }),
        el('a', { class: 'btn primary', href: loginHref(), text: 'Crear cuenta o entrar' })));
    } else if (!tv.registered && tv.state !== 'finished') {
      box.append(el('div', { class: 'form-actions' }, el('button', { class: 'btn primary big', type: 'button', text: 'Inscribirme gratis', onclick: async (ev) => {
        ev.target.disabled = true;
        try { await api('/api/tournaments/' + tv.id + '/register', { method: 'POST', body: {} }); toast('¡Listo! Ya estás en el torneo.'); reload(); } catch (e) { ev.target.disabled = false; toast(errMsg(e)); }
      } })), el('p', { class: 'small muted', text: 'Al inscribirte, tu nombre público (o tu usuario) y tus puntos aparecen en el ranking del torneo.' }));
    }
    if (tv.registered) {
      const m = tv.standings.me;
      box.append(el('dl', { class: 'pf-quick arena-me' },
        el('div', {}, el('dt', { text: 'Tu puesto' }), el('dd', { text: m ? m.rank + '°' : '—' })),
        el('div', {}, el('dt', { text: 'Puntos' }), el('dd', { text: String(m ? m.points : 0) })),
        el('div', {}, el('dt', { text: 'Resueltos' }), el('dd', { text: (m ? m.solved : 0) + '/' + tv.days }))));
      const days = el('ol', { class: 'tour-days' });
      for (const r of tv.rounds) {
        const label = el('span', { class: 'd', text: dayLabel(r.day) });
        let action;
        if (r.state === 'played') action = el('span', { class: 'pts', text: r.points + ' pts' });
        else if (r.state === 'open' || r.state === 'playing') {
          action = el('button', { class: 'btn small primary', type: 'button', text: r.state === 'playing' ? 'Seguir' : 'Jugar', onclick: () => playRound('/api/tournaments/' + tv.id + '/rounds/' + r.round + '/start', {
            title: tv.title + ' · día ' + (r.round + 1), back: reload,
            pointsOf: async () => { const x = await api('/api/tournaments/' + encodeURIComponent(tv.slug)); return x.rounds[r.round].points; } }) });
        } else if (r.state === 'missed') action = el('span', { class: 'muted small', text: 'Cerrada' });
        else action = el('span', { class: 'muted small', text: 'Se abre el ' + ddmm(r.day) });
        days.append(el('li', { class: 'state-' + r.state }, label, action));
      }
      box.append(days);
      if (m && m.rounds_played) {
        box.append(el('h3', { class: 'label', text: 'Contá cómo venís' }),
          shareBox('Voy ' + m.rank + '° en el ' + tv.title + ' de Play Crípticos con ' + m.points + ' puntos. ¿Te animás a ganarme?', SITE + route('tournament', '/' + tv.slug)));
      }
    }
    const items = tv.standings.items;
    box.append(el('h3', { class: 'label', text: 'Ranking' }));
    if (!items.length) box.append(el('p', { class: 'muted', text: 'Todavía nadie sumó puntos.' }));
    else {
      box.append(el('table', { class: 'rank-table' }, el('thead', {}, el('tr', {}, el('th', { text: '#' }), el('th', { text: 'Jugador' }), el('th', { text: 'Resueltos' }), el('th', { text: 'Puntos' }))),
        el('tbody', {}, items.map((x) => el('tr', { class: x.me ? 'me' : null }, el('td', { text: String(x.rank) }), el('td', { text: x.name }), el('td', { text: String(x.solved) }), el('td', {}, el('b', { text: String(x.points) })))))));
    }
    if (!full) box.append(el('p', {}, el('a', { href: route('tournament', '/' + tv.slug), text: 'Ver el ranking completo' })));
    return box;
  }

  // ═════════════ Duelos ═════════════
  const STATUS = { open: 'Esperando rival', pending: 'Esperando respuesta', active: 'En juego', finished: 'Terminado', declined: 'Rechazado', expired: 'Vencido', cancelled: 'Cancelado' };
  const duelHref = (d) => route('arena', '/duelo/' + d.token);
  const rivalOf = (d) => (d.me === 'challenger' ? d.opponent : d.challenger);
  const mineOf = (d) => (d.me === 'challenger' ? d.challenger : d.opponent);

  function duelResultText(d) {
    if (d.status !== 'finished') return STATUS[d.status];
    if (!d.winner) return 'Empate';
    return d.winner === d.me ? 'Ganaste' : 'Perdiste';
  }

  function duelDetail(d) {
    const box = el('section', { class: 'sheet arena-card', 'aria-labelledby': 'duel-t' });
    const mine = mineOf(d); const rival = rivalOf(d);
    box.append(el('p', { class: 'eyebrow', text: 'Duelo · ' + d.rounds + ' crípticos · ' + STATUS[d.status] }),
      el('h2', { id: 'duel-t' }, 'Vos ', el('span', { class: 'muted', text: 'vs' }), ' ', rival ? rival.name : 'quien acepte'),
      el('div', { class: 'duel-score' },
        el('div', {}, el('span', { class: 'who', text: 'Vos' }), el('b', { text: String(mine.points) }), el('span', { class: 'small muted', text: mine.done + '/' + d.rounds + ' jugadas' })),
        el('div', {}, el('span', { class: 'who' }, rival ? [dot(rival.online), ' ', rival.name] : '—'),
          el('b', { text: rival && rival.points !== null ? String(rival.points) : '?' }), el('span', { class: 'small muted', text: rival ? rival.done + '/' + d.rounds + ' jugadas' : 'sin rival todavía' }))));
    if (d.status === 'finished') box.append(el('p', { class: 'round-result ' + (d.winner === d.me ? 'ok' : 'miss'), text: duelResultText(d) + (d.winner ? '' : ': mismos puntos y mismo tiempo') }));
    else if (rival && rival.points === null) box.append(el('p', { class: 'small muted', text: 'Los puntos del rival se ven cuando termina el duelo. El duelo vence el ' + new Date(d.expires_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) + '; lo que no se juegue vale 0.' }));
    const canPlay = d.me === 'challenger' ? ['open', 'pending', 'active'].includes(d.status) : d.status === 'active';
    const rounds = el('ol', { class: 'tour-days' });
    const played = Object.fromEntries((d.my_rounds || []).map((x) => [x.round, x]));
    for (let i = 0; i < d.rounds; i++) {
      const p = played[i];
      let action;
      if (p && p.points !== null) action = el('span', { class: 'pts', text: p.points + ' pts' });
      else if (canPlay && (p || i === mine.done)) {
        action = el('button', { class: 'btn small primary', type: 'button', text: p ? 'Seguir' : 'Jugar', onclick: () => playRound('/api/duels/' + d.id + '/rounds/' + i + '/start', {
          title: 'Duelo · críptico ' + (i + 1) + ' de ' + d.rounds, back: () => main(),
          pointsOf: async () => { const x = await api('/api/duels/' + d.id); const r = (x.my_rounds || []).find((y) => y.round === i); return r ? r.points : null; } }) });
      } else action = el('span', { class: 'muted small', text: canPlay ? 'Después de la anterior' : '—' });
      rounds.append(el('li', {}, el('span', { class: 'd', text: 'Críptico ' + (i + 1) }), action));
    }
    box.append(rounds);
    if (d.me === 'challenger' && d.status === 'open') {
      box.append(el('h3', { class: 'label', text: 'Mandale el desafío a quien quieras' }),
        shareBox('Te desafío a un duelo de ' + d.rounds + ' crípticos en Play Crípticos. ¿Te animás?', SITE + duelHref(d), 'Enviar desafío'));
    }
    if (d.status === 'finished' && rival) {
      const txt = d.winner === d.me ? 'Le gané a ' + rival.name + ' ' + mine.points + ' a ' + rival.points + ' en un duelo de crípticos.'
        : d.winner ? rival.name + ' me ganó ' + rival.points + ' a ' + mine.points + ' en un duelo de crípticos. Quiero revancha.' : 'Empatamos con ' + rival.name + ' en un duelo de crípticos.';
      box.append(el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'button', text: 'Revancha', onclick: async () => {
        try { const x = await api('/api/duels/' + d.id + '/rematch', { method: 'POST', body: {} }); location.href = route('arena', '/duelo/' + x.token); } catch (e) { toast(errMsg(e)); }
      } })), shareBox(txt + ' Jugá en Play Crípticos:', SITE + route('arena')));
    }
    if (['open', 'pending'].includes(d.status) && d.me === 'challenger') {
      box.append(el('p', {}, el('button', { class: 'btn small quiet', type: 'button', text: 'Cancelar desafío', onclick: async () => {
        try { await api('/api/duels/' + d.id + '/decline', { method: 'POST', body: {} }); main(); } catch (e) { toast(errMsg(e)); }
      } })));
    }
    box.append(el('p', {}, el('a', { href: route('arena'), text: '← Duelos y torneos' })));
    return box;
  }

  async function duelPage(me) {
    let d;
    try { d = await api('/api/duels/' + encodeURIComponent(BOOT.duelToken)); } catch (e) {
      root.replaceChildren(el('div', { class: 'notice error' }, el('p', { text: 'No encontramos ese desafío.' }), el('a', { class: 'btn', href: route('arena'), text: 'Ir a duelos y torneos' })));
      return;
    }
    if (d.me) {
      if (d.me === 'opponent' && d.status === 'pending') {
        root.replaceChildren(invite(d, me));
      } else {
        root.replaceChildren(duelDetail(d));
        // Mientras el duelo sigue, se actualiza cada 20 segundos (solo con la pestaña visible).
        stopPoll();
        if (['open', 'pending', 'active'].includes(d.status)) {
          pollTimer = setInterval(async () => {
            if (document.hidden || !document.querySelector('#duel-t')) return;
            try { const x = await api('/api/duels/' + d.id); if (JSON.stringify(x) !== JSON.stringify(d)) { d = x; root.replaceChildren(duelDetail(d)); } } catch (e) { /* sin conexión */ }
          }, 20000);
        }
      }
      return;
    }
    root.replaceChildren(invite(d, me));
  }

  function invite(d, me) {
    const box = el('section', { class: 'sheet arena-card' });
    const open = d.status === 'open' || (d.status === 'pending' && me && d.opponent && d.opponent.username === me.username);
    box.append(el('p', { class: 'eyebrow', text: 'Duelo de crípticos' }),
      el('h2', { text: d.challenger.name + ' te desafía' }),
      el('p', { class: 'lead', text: d.rounds + ' crípticos, los mismos para los dos. Cada uno juega cuando puede; gana quien sume más puntos acertando rápido.' }));
    if (!open) { box.append(el('p', { class: 'notice info', text: 'Este desafío ya no está disponible (' + (STATUS[d.status] || d.status).toLowerCase() + ').' })); return box; }
    if (!me) {
      box.append(el('div', { class: 'notice info' }, el('p', { text: 'Para aceptar necesitás una cuenta. Es gratis.' }), el('a', { class: 'btn primary', href: loginHref(), text: 'Crear cuenta o entrar' })));
      return box;
    }
    box.append(el('div', { class: 'form-actions' },
      el('button', { class: 'btn primary big', type: 'button', text: 'Aceptar el duelo', onclick: async () => {
        try { await api('/api/duels/' + d.id + '/accept', { method: 'POST', body: {} }); main(); } catch (e) { toast(errMsg(e)); }
      } }),
      d.status === 'pending' ? el('button', { class: 'btn quiet', type: 'button', text: 'Rechazar', onclick: async () => {
        try { await api('/api/duels/' + d.id + '/decline', { method: 'POST', body: {} }); location.href = route('arena'); } catch (e) { toast(errMsg(e)); }
      } }) : null));
    return box;
  }

  function duelsSection(list, fr) {
    const box = el('section', { class: 'sheet arena-card', 'aria-labelledby': 'duels-t' });
    const rec = list.record;
    box.append(el('p', { class: 'eyebrow', text: 'Ganados ' + rec.won + ' · Perdidos ' + rec.lost + ' · Empates ' + rec.tied }), el('h2', { id: 'duels-t', text: 'Duelos 1 contra 1' }));
    const opp = el('input', { name: 'opponent', list: 'friend-names', autocomplete: 'off', maxlength: '40', placeholder: 'usuario' });
    const dl = el('datalist', { id: 'friend-names' }, fr.friends.map((f) => el('option', { value: f.username })));
    const rounds = el('select', { name: 'rounds' }, el('option', { value: '3', text: '3 crípticos' }), el('option', { value: '5', text: '5 crípticos' }));
    const diff = el('select', { name: 'difficulty' }, el('option', { value: '', text: 'Dificultad mixta' }), [1, 2, 3, 4, 5].map((n) => el('option', { value: String(n), text: DIFF[n] })));
    const create = async (opponent) => {
      try {
        const x = await api('/api/duels', { method: 'POST', body: { opponent: opponent || null, rounds: Number(rounds.value), difficulty: diff.value ? Number(diff.value) : null } });
        location.href = route('arena', '/duelo/' + x.token);
      } catch (e) { toast(errMsg(e)); }
    };
    const f = el('form', { class: 'form duel-form' },
      el('div', { class: 'row' }, el('label', { class: 'field' }, el('span', { text: 'A quién desafiás' }), opp, dl),
        el('label', { class: 'field' }, el('span', { text: 'Largo' }), rounds), el('label', { class: 'field' }, el('span', { text: 'Dificultad' }), diff)),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn primary', type: 'submit', text: 'Desafiar' }),
        el('button', { class: 'btn', type: 'button', text: 'Crear enlace para cualquiera', onclick: () => create(null) })));
    f.addEventListener('submit', (ev) => { ev.preventDefault(); if (!opp.value.trim()) { toast('Escribí el usuario o creá un enlace para cualquiera.'); return; } create(opp.value.trim()); });
    box.append(f);
    const items = list.items.filter((d) => !['cancelled', 'declined'].includes(d.status) || d.me === 'challenger').slice(0, 15);
    if (items.length) {
      box.append(el('ul', { class: 'duel-list' }, items.map((d) => {
        const rival = rivalOf(d); const mine = mineOf(d);
        const needsMe = (d.me === 'opponent' && d.status === 'pending') || (['open', 'pending', 'active'].includes(d.status) && mine.done < d.rounds && (d.me === 'challenger' || d.status === 'active'));
        return el('li', { class: needsMe ? 'todo' : null }, el('a', { href: duelHref(d) },
          el('span', { class: 'who' }, rival ? [dot(rival.online), ' ', rival.name] : 'Enlace abierto'),
          el('span', { class: 'small muted', text: duelResultText(d) + (d.status === 'finished' ? ' · ' + mine.points + ' a ' + rival.points : ' · ' + mine.done + '/' + d.rounds) }),
          needsMe ? el('span', { class: 'tag new', text: d.me === 'opponent' && d.status === 'pending' ? 'Te desafió' : 'Te toca' }) : null));
      })));
    } else box.append(el('p', { class: 'muted', text: 'Todavía no jugaste duelos. Desafiá a un amigo o mandá un enlace para que lo tome cualquiera.' }));
    return box;
  }

  // ═════════════ Amigos ═════════════
  function friendsSection(fr, me) {
    const box = el('section', { class: 'sheet arena-card', 'aria-labelledby': 'friends-t' });
    const reload = () => main();
    box.append(el('p', { class: 'eyebrow', text: fr.friends.filter((f) => f.online).length + ' conectados ahora' }), el('h2', { id: 'friends-t', text: 'Amigos' }));
    const wanted = new URLSearchParams(location.search).get('amigo');
    const known = new Set([...fr.friends, ...fr.outgoing].map((f) => f.username.toLowerCase()));
    if (wanted && wanted.toLowerCase() !== me.username.toLowerCase() && !known.has(wanted.toLowerCase())) {
      box.append(el('div', { class: 'notice ok' }, el('p', { text: '¿Agregar a @' + wanted + ' como amigo?' }), el('button', { class: 'btn small primary', type: 'button', text: 'Agregar', onclick: async () => {
        try { await api('/api/friends', { method: 'POST', body: { username: wanted } }); history.replaceState(null, '', route('arena')); reload(); } catch (e) { toast(errMsg(e)); }
      } })));
    }
    const name = el('input', { autocomplete: 'off', maxlength: '40', placeholder: 'usuario', 'aria-label': 'Usuario de tu amigo' });
    const f = el('form', { class: 'try-row' }, name, el('button', { class: 'btn ink', type: 'submit', text: 'Agregar' }));
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault(); if (!name.value.trim()) return;
      try { const x = await api('/api/friends', { method: 'POST', body: { username: name.value.trim() } }); toast(x.status === 'accepted' ? 'Ya son amigos.' : 'Solicitud enviada.'); reload(); } catch (e) { toast(errMsg(e)); }
    });
    box.append(f);
    for (const x of fr.incoming) {
      box.append(el('div', { class: 'notice info' }, el('p', { text: x.name + ' (@' + x.username + ') quiere ser tu amigo.' }),
        el('button', { class: 'btn small primary', type: 'button', text: 'Aceptar', onclick: async () => { try { await api('/api/friends/' + encodeURIComponent(x.username) + '/accept', { method: 'POST', body: {} }); reload(); } catch (e) { toast(errMsg(e)); } } }),
        el('button', { class: 'btn small quiet', type: 'button', text: 'Rechazar', onclick: async () => { try { await api('/api/friends/' + encodeURIComponent(x.username), { method: 'DELETE', body: {} }); reload(); } catch (e) { toast(errMsg(e)); } } })));
    }
    if (fr.friends.length) {
      box.append(el('ul', { class: 'friend-list' }, fr.friends.map((x) => el('li', {}, el('span', { class: 'who' }, dot(x.online), ' ', x.name, el('span', { class: 'muted small', text: ' @' + x.username })),
        el('button', { class: 'btn small', type: 'button', text: 'Desafiar', onclick: async () => {
          try { const d = await api('/api/duels', { method: 'POST', body: { opponent: x.username, rounds: 3 } }); location.href = route('arena', '/duelo/' + d.token); } catch (e) { toast(errMsg(e)); }
        } })))));
    } else box.append(el('p', { class: 'muted', text: 'Sumá amigos por su usuario o mandales tu enlace.' }));
    if (fr.outgoing.length) box.append(el('p', { class: 'small muted', text: 'Esperando respuesta: ' + fr.outgoing.map((x) => '@' + x.username).join(', ') }));
    box.append(el('h3', { class: 'label', text: 'Tu enlace de amistad' }),
      shareBox('Sumame como amigo en Play Crípticos y juguemos duelos de crípticos:', SITE + route('arena') + '?amigo=' + encodeURIComponent(me.username), 'Invitar amigos'));
    return box;
  }

  function guestIntro() {
    return el('section', { class: 'sheet arena-card' }, el('h2', { text: 'Jugá contra tus amigos' }),
      el('ul', { class: 'arena-list' },
        el('li', { text: 'Duelos 1 contra 1: los mismos crípticos para los dos, cada uno cuando puede.' }),
        el('li', { text: 'Torneo semanal con inscripción: un críptico nuevo por día y ranking en vivo.' }),
        el('li', { text: 'Puntos por acertar y por velocidad. Compartí cómo te va por WhatsApp o redes.' })),
      el('a', { class: 'btn primary', href: loginHref(), text: 'Crear cuenta gratis o entrar' }));
  }

  // ── Armado de la página ──
  async function main() {
    stopPoll();
    await authReady;
    const me = C.getMe();
    if (BOOT.duelToken) return duelPage(me);
    try {
      if (BOOT.tournamentSlug) {
        const tv = await api('/api/tournaments/' + encodeURIComponent(BOOT.tournamentSlug));
        root.replaceChildren(tournamentCard(tv, me, { full: true }));
        return;
      }
      const [tours, duels, fr] = await Promise.all([api('/api/tournaments'), me ? api('/api/duels') : null, me ? api('/api/friends') : null]);
      const parts = [];
      if (!me) parts.push(guestIntro());
      if (tours.current) parts.push(tournamentCard(tours.current, me));
      else parts.push(el('p', { class: 'notice info', text: 'El torneo de esta semana se está armando. Volvé en un rato.' }));
      // Duelos y, debajo, amigos: en la misma columna.
      if (me) parts.push(el('div', { class: 'arena-col' }, duelsSection(duels, fr), friendsSection(fr, me)));
      if (tours.previous && tours.previous.podium.length) {
        parts.push(el('section', { class: 'sheet arena-card' }, el('p', { class: 'eyebrow', text: 'Semana pasada' }), el('h2', { text: tours.previous.title }),
          el('ol', { class: 'podium' }, tours.previous.podium.map((x) => el('li', {}, el('b', { text: x.name }), ' · ' + x.points + ' pts'))),
          el('p', {}, el('a', { href: route('tournament', '/' + tours.previous.slug), text: 'Ver el ranking final' }))));
      }
      root.replaceChildren(el('div', { class: 'arena-grid' }, parts));
    } catch (e) {
      root.replaceChildren(el('div', { class: 'notice error' }, el('p', { text: errMsg(e) })));
    }
  }
  main();
})();
