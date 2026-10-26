/* Play Crípticos Plus: planes, vuelta desde PayPal y comparación con la comunidad. Ver docs/PLUS.md. */
(function () {
  'use strict';
  const C = window.__cripta;
  if (!C) return;
  const { el, api, route, toast } = C;
  const $ = (s) => document.querySelector(s);
  const fmtDate = (iso) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtTime = (ms) => { if (ms == null) return '—'; const s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s'; };
  const pct = (v) => (v == null ? '—' : String(v).replace('.', ',') + '%');
  const dec = (v) => (v == null ? '—' : String(v).replace('.', ','));
  const errText = (x) => (x && x.data && x.data.message) || 'Algo salió mal. Probá de nuevo.';

  async function returnFromPayPal() {
    const q = new URLSearchParams(location.search);
    if (q.get('plus') === 'cancelado') { history.replaceState(null, '', location.pathname); toast('Cancelaste el pago en PayPal: no se te cobró nada.'); return; }
    if (q.get('plus') !== 'ok' || !q.get('subscription_id')) return;
    history.replaceState(null, '', location.pathname);
    await C.authReady;
    if (!C.getMe()) { toast('Entrá con tu cuenta para terminar de activar Plus.'); return; }
    try {
      const r = await api('/api/billing/plus/confirm', { method: 'POST', body: { subscription_id: q.get('subscription_id') } });
      if (r.active) { location.reload(); return; }
      toast('PayPal todavía está procesando el pago. En unos minutos tu cuenta queda Plus.');
    } catch (x) { toast(errText(x) + ' Si PayPal te cobró, escribinos.'); }
  }

  async function plans() {
    const box = $('#plus-plans');
    if (!box) return;
    await C.authReady;
    let st;
    try { st = await api('/api/billing/plus'); } catch (e) { return; }
    const me = C.getMe();
    if (st.active) {
      const sub = st.subscription;
      const renews = sub && sub.status === 'ACTIVE';
      box.replaceChildren(el('article', { class: 'plan mine' }, el('h3', { text: 'Tu suscripción' }),
        el('p', { text: renews ? `Plan ${sub.plan === 'yearly' ? 'anual' : 'mensual'}, activo hasta el ${fmtDate(st.until)}. Se renueva solo.`
          : sub && sub.status === 'CANCELLED' ? `Cancelada: seguís con Plus hasta el ${fmtDate(st.until)}.` : `Sos Plus hasta el ${fmtDate(st.until)}.` }),
        renews ? el('p', {}, el('a', { class: 'btn', href: st.manage_url, target: '_blank', rel: 'noopener', text: 'Administrar o cancelar en PayPal' })) : null));
      return;
    }
    for (const card of box.querySelectorAll('.plan')) {
      const plan = card.dataset.plan;
      const slot = card.querySelector('.plan-cta');
      const info = st.plans[plan];
      if (!info || !info.available) { slot.replaceChildren(el('button', { class: 'btn', type: 'button', disabled: true, text: 'Muy pronto' })); continue; }
      if (!me) { slot.replaceChildren(el('a', { class: 'btn primary', href: route('account') + '?next=' + encodeURIComponent(location.pathname), text: 'Creá tu cuenta y suscribite' })); continue; }
      const err = el('p', { class: 'field-error', role: 'alert' });
      const btn = el('button', { class: 'btn ' + (plan === 'yearly' ? 'primary' : 'ink'), type: 'button', text: plan === 'yearly' ? 'Quiero el anual' : 'Quiero el mensual', onclick: async () => {
        err.textContent = ''; btn.setAttribute('aria-busy', 'true');
        try { const r = await api('/api/billing/plus/checkout', { method: 'POST', body: { plan } }); location.href = r.url; } catch (x) { err.textContent = errText(x); btn.removeAttribute('aria-busy'); }
      } });
      slot.replaceChildren(btn, el('p', { class: 'small muted', text: 'Pagás con PayPal o con tarjeta.' }), err);
    }
  }

  async function comparison() {
    const box = $('#plus-compare');
    if (!box) return;
    let r;
    try { r = await api('/api/plus/comparison'); } catch (e) { box.replaceChildren(el('p', { class: 'muted', text: errText(e) })); return; }
    const rows = r.rows.filter((x) => x.you.games || (x.community && x.community.games));
    box.replaceChildren(el('h2', { text: 'Vos contra la comunidad' }),
      el('p', { class: 'small muted', text: `Últimos ${r.days} días, por dificultad. Sin contar práctica, duelos ni torneos.` }),
      rows.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'pf-table compact plus-table' },
        el('thead', {}, el('tr', {}, ['Dificultad', 'Tus partidas', 'Tus aciertos', 'Comunidad', 'Tu tiempo', 'Comunidad', 'Tus pistas', 'Comunidad'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, rows.map((x) => {
          const c = x.community || {};
          const better = (a, b, lower) => (a == null || b == null ? '' : (lower ? a < b : a > b) ? 'up' : a === b ? '' : 'down');
          return el('tr', {},
            el('th', { scope: 'row', text: '★'.repeat(x.difficulty) }),
            el('td', { text: String(x.you.games) }),
            el('td', { class: better(x.you.solve_rate, c.solve_rate, false), text: pct(x.you.solve_rate) }), el('td', { text: pct(c.solve_rate) }),
            el('td', { class: better(x.you.median_ms, c.median_ms, true), text: fmtTime(x.you.median_ms) }), el('td', { text: fmtTime(c.median_ms) }),
            el('td', { class: better(x.you.avg_hints, c.avg_hints, true), text: dec(x.you.avg_hints) }), el('td', { text: dec(c.avg_hints) }));
        }))))
        : el('p', { class: 'muted', text: 'Todavía no hay partidas suficientes para comparar. ¡Jugá unas cuantas y volvé!' }),
      el('p', { class: 'small muted', text: 'Tiempo: mediana de los crípticos resueltos. Pistas: promedio por partida.' }));
  }

  returnFromPayPal().then(() => Promise.all([plans(), comparison()]));
})();
