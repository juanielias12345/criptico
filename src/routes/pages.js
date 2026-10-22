'use strict';

const express = require('express');
const { layout, esc, href, ICON } = require('../views/layout');
const CONTENT = require('../views/content');
const { t, ROUTES, UI_LANGS, pickUiLang } = require('../i18n');
const { publicClue } = require('../services/clues');
const { today } = require('../services/game');
const PROFILE = require('../services/profile');
const PTEXT = require('../views/profile-text');
const { cardText } = require('../views/share-card');
const GUIDE = require('../views/guide');
const { indicators: ES_INDICATORS } = require('../lib/lang/es');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const altFor = (route, rest = '') => Object.fromEntries(UI_LANGS.map((l) => [l, href(l, route, rest)]));
// Perfiles oficiales de la marca (para que Google los asocie al sitio).
const SAME_AS = ['https://www.instagram.com/playcripticos/', 'https://www.facebook.com/1372378769297971', 'https://www.youtube.com/channel/UCaaDK6fVoyY060TFhViw-8A'];
const MECHS = ['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone', 'double_definition', 'initials'];

function categoryName(cats, slug, lang) {
  const c = cats.find((x) => x.slug === slug);
  return c ? (lang === 'es' ? c.name_es : c.name_en) : slug;
}

const plural = (lang, n, one, many) => (n === 1 ? t(lang, one) : t(lang, many).replace('{n}', n));
const dots = (n) => `<span class="dots" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</span>`;

// Separa "texto (4)" en texto y longitud para componer la pista.
function clueWithEnum(text) {
  const m = String(text).match(/^(.*?)(\s*\([\d,\s-]+\))\s*$/);
  return m ? `${esc(m[1])}<span class="enum">${esc(m[2])}</span>` : esc(text);
}

// Pista descrita por partes (ejemplos editoriales).
function partsHtml(parts) {
  return parts.map(([txt, role]) => (role === 'enum' ? `<span class="enum">${esc(txt)}</span>` : role ? `<span data-r="${role}">${esc(txt)}</span>` : esc(txt))).join('');
}

// Ejemplo resoluble. Sin JavaScript funciona con <details>; con JavaScript suma el campo de respuesta.
function tryWidget(ex, lang, { label } = {}) {
  return `<div class="try" data-answer="${esc(ex.answer)}" data-ok="${esc(t(lang, 'try_ok'))}" data-bad="${esc(t(lang, 'try_bad'))}">
  <p class="clue-text" lang="${lang}">${partsHtml(ex.parts)}</p>
  <form class="try-row" hidden><label class="sr-only" for="${'t' + ex.answer}">${esc(label || t(lang, 'try_label'))}</label>
    <input id="${'t' + ex.answer}" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" maxlength="${ex.answer.length + 6}" placeholder="${esc(t(lang, 'answer_placeholder'))}">
    <button class="btn ink" type="submit">${esc(t(lang, 'check'))}</button></form>
  <p class="feedback" role="status"></p>
  <div class="try-actions">
    <details class="reveal"><summary>${esc(t(lang, 'lesson_hint'))}</summary><div class="small">${esc(ex.hint)}</div></details>
    <details class="reveal solution-details"><summary>${esc(t(lang, 'try_reveal'))}</summary><div class="try-out"><p class="answer">${esc(ex.answer)}</p>
      <ol class="explain">${ex.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div></details>
  </div>
</div>`;
}

function clueRow(c, lang, cats, { solved, fresh, daily } = {}) {
  const pub = publicClue(c);
  const tags = [
    solved ? `<span class="tag solved">✓ ${esc(t(lang, 'tag_solved'))}</span>` : '',
    fresh ? `<span class="tag new">${esc(t(lang, 'tag_new'))}</span>` : '',
    daily ? `<span class="tag">${esc(t(lang, 'tag_daily'))} · <time datetime="${esc(daily)}">${esc(daily)}</time></span>` : '',
    c.origin === 'community' ? `<span class="tag">${esc(t(lang, 'tag_community'))}</span>` : '',
  ].join('');
  return `<li class="clue-row">
    <a href="${href(lang, 'clue', '/' + encodeURIComponent(pub.slug))}">
      <span class="clue-text" lang="${esc(pub.language)}">${clueWithEnum(pub.clue)}</span>
      <span class="meta-line"><span>${esc(t(lang, 'mech_' + pub.mechanism))}</span><span title="${esc(t(lang, 'diff_' + pub.difficulty))}">${dots(pub.difficulty)} <span class="sr-only">${esc(t(lang, 'diff_' + pub.difficulty))}</span></span><span>${esc(categoryName(cats, pub.category, lang))}</span>${pub.variant ? `<span>${esc(pub.variant)}</span>` : ''}${tags}</span>
      <span class="go">${ICON.arrow}</span>
    </a></li>`;
}

// Migas de pan en datos estructurados (schema.org BreadcrumbList).
const breadcrumbs = (siteUrl, items) => ({ '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: siteUrl + path })) });

const skeleton = '<div class="sheet"><div class="skeleton" aria-hidden="true"><i class="mid"></i><i class="big"></i><i class="big"></i><i class="tiles"></i></div></div>';

module.exports = function pages() {
  const r = express.Router();

  r.get('/', (req, res) => {
    // Con un solo idioma de interfaz la portada es siempre la misma: redirección permanente.
    if (UI_LANGS.length === 1) return res.redirect(301, `/${UI_LANGS[0]}`);
    res.set('Vary', 'Accept-Language');
    res.redirect(302, `/${pickUiLang(req.headers['accept-language'])}`);
  });

  r.get('/robots.txt', (req, res) => {
    const { siteUrl } = req.app.locals.config;
    res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /social/\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
  });

  r.get('/sitemap.xml', a(async (req, res) => {
    const { siteUrl } = req.app.locals.config;
    const db = req.app.locals.db;
    const urls = [];
    for (const l of UI_LANGS) for (const route of ['home', 'play', 'daily', 'archive', 'contribute', 'help', 'privacy', 'terms', 'credits']) urls.push(href(l, route));
    for (const l of UI_LANGS.filter((x) => GUIDE[x])) {
      urls.push(href(l, 'guide'));
      for (const m of Object.values(GUIDE[l].mechs)) urls.push(href(l, 'guide', '/' + m.slug));
      if (GUIDE[l].abbr) urls.push(href(l, 'guide', '/' + GUIDE[l].abbr.slug));
    }
    // Solo páginas con contenido real: crípticos publicados, en el idioma de la interfaz que les corresponde.
    const clues = await db.all("SELECT slug, language_code, updated_at FROM clues WHERE status = 'published' AND language_code IN (SELECT code FROM languages WHERE enabled = 1) ORDER BY published_at DESC LIMIT 45000");
    const body = urls.map((u) => `<url><loc>${esc(siteUrl + u)}</loc></url>`).join('')
      + clues.map((c) => `<url><loc>${esc(siteUrl + href(UI_LANGS.includes(c.language_code) ? c.language_code : 'en', 'clue', '/' + c.slug))}</loc><lastmod>${esc(String(c.updated_at).slice(0, 10))}</lastmod></url>`).join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
  }));

  r.get('/admin', (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(require('path').join(__dirname, '..', '..', 'public', 'admin.html'));
  });

  // Títulos y descripciones para buscadores: apuntan a «crípticos», «crucigrama críptico» y «críptico del día».
  const SEO = {
    es: {
      home: ['Crípticos en español: jugá gratis y sin límite | Play Crípticos', 'Resolvé crípticos (pistas de crucigrama críptico) en español, gratis y sin límite: ayudas progresivas, explicación paso a paso y un críptico del día. Con variantes de Argentina, España y México.'],
      play: ['Jugar crípticos online gratis | Play Crípticos', 'Crípticos en español para jugar online, sin registro y sin límite. Elegí la dificultad, pedí pistas y mirá la explicación de cada solución.'],
      daily: ['Críptico del día: el desafío diario | Play Crípticos', 'Un críptico nuevo cada día, el mismo para todos. Resolvelo, compartí tu resultado y repasá los días anteriores.'],
      archive: ['Archivo de crípticos en español | Play Crípticos', 'Todos los crípticos publicados, con filtros por dificultad, tema y mecanismo: anagramas, palabras ocultas, iniciales y más.'],
      help: ['Qué es un críptico y cómo resolverlo, con ejemplos | Play Crípticos', 'Guía paso a paso para aprender a resolver crípticos: la definición, el juego de letras y los mecanismos más comunes, con ejemplos para practicar.'],
    },
  };
  const seo = (lang, key) => (SEO[lang] && SEO[lang][key] ? { seoTitle: SEO[lang][key][0], description: SEO[lang][key][1] } : {});

  // Idiomas de interfaz retirados: cada ruta se redirige a su equivalente en español.
  for (const old of Object.keys(ROUTES).filter((l) => !UI_LANGS.includes(l))) {
    const back = Object.fromEntries(Object.entries(ROUTES[old]).filter(([, seg]) => seg).map(([k, seg]) => [seg, k]));
    r.get(new RegExp(`^/${old}(/.*)?$`), (req, res) => {
      const [, seg = '', ...rest] = (req.params[0] || '').split('/');
      const key = back[seg];
      const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const target = key ? `/es${ROUTES.es[key] ? '/' + ROUTES.es[key] : ''}${rest.length ? '/' + rest.join('/') : ''}` : '/es';
      res.redirect(301, target + qs);
    });
  }

  for (const lang of UI_LANGS) {
    const R = ROUTES[lang];
    const P = (route) => `/${lang}${R[route] ? '/' + R[route] : ''}`;
    const render = (req, res, opts) => res.send(layout({ lang, config: req.app.locals.config, ...opts }));
    const ex = CONTENT.EXAMPLES[lang];

    // ── Inicio ──
    r.get(`/${lang}`, a(async (req, res) => {
      const db = req.app.locals.db;
      const totals = await db.all("SELECT language_code AS l, COUNT(*) AS n FROM clues WHERE status = 'published' AND language_code IN (SELECT code FROM languages WHERE enabled = 1) GROUP BY language_code");
      const total = totals.reduce((s, x) => s + x.n, 0);
      const variants = (await db.get('SELECT COUNT(*) AS n FROM language_variants v JOIN languages l ON l.code = v.language_code AND l.enabled = 1 WHERE v.enabled = 1')).n;
      const mechCounts = Object.fromEntries((await db.all("SELECT mechanism AS m, COUNT(*) AS n FROM clues WHERE status = 'published' AND language_code = ? GROUP BY mechanism", [lang])).map((x) => [x.m, x.n]));
      const mechs = MECHS.filter((m) => mechCounts[m]);
      const sp = ex.specimen;
      const order = [...sp.to];
      const used = new Set();
      const tiles = [...sp.from].map((ch, i) => {
        let to = order.findIndex((c, k) => c === ch && !used.has(k)); used.add(to);
        return `<span data-from="${i}" data-to="${to}" data-n="${i + 1}">${esc(ch)}</span>`;
      });
      render(req, res, {
        page: 'home', path: P('home'), alternates: altFor('home'), ...seo(lang, 'home'),
        jsonLd: { '@context': 'https://schema.org', '@graph': [
          { '@type': 'WebSite', name: req.app.locals.config.siteName, url: req.app.locals.config.siteUrl, inLanguage: UI_LANGS },
          { '@type': 'Organization', name: req.app.locals.config.siteName, url: req.app.locals.config.siteUrl, logo: req.app.locals.config.siteUrl + '/icon-512.png', sameAs: SAME_AS },
        ] },
        body: `
<section class="hero">
  <div>
    <p class="eyebrow">${esc(t(lang, 'home_eyebrow'))}</p>
    <h1>${esc(t(lang, 'home_title_a'))} <em>${esc(t(lang, 'home_title_b'))}</em></h1>
    <p class="lead">${esc(t(lang, 'home_lead'))}</p>
    <div class="hero-actions">
      <a class="btn primary big" href="${P('play')}" id="play-now">${esc(t(lang, 'home_cta'))} <span class="arrow" aria-hidden="true">→</span></a>
      <a class="link-btn" href="${P('archive')}">${esc(t(lang, 'home_explore'))}</a>
    </div>
    ${total ? `<ul class="hero-facts" aria-label="${lang === 'es' ? 'Catálogo' : 'Catalogue'}">
      <li><b>${total}</b><span>${esc(t(lang, 'fact_clues'))}</span></li>
      ${totals.length > 1 ? `<li><b>${totals.length}</b><span>${esc(t(lang, 'fact_langs'))}</span></li>` : ''}
      <li><b>${variants}</b><span>${esc(t(lang, 'fact_variants'))}</span></li>
    </ul>` : ''}
  </div>
  <figure class="specimen" data-label="${esc(t(lang, 'spec_label'))}">
    <p class="clue-text" lang="${lang}">${partsHtml(sp.parts).replace(/data-r="def"/, 'data-r="def" class="m-def"').replace(/data-r="ind"/, 'data-r="ind" class="m-ind"')}</p>
    <ul class="notes">
      <li><span class="key def" aria-hidden="true"></span><span><b>${esc(t(lang, 'spec_def'))}.</b> ${esc(t(lang, 'spec_def_txt'))}</span></li>
      <li><span class="key ind" aria-hidden="true"></span><span><b>${esc(t(lang, 'spec_ind'))}.</b> ${esc(t(lang, 'spec_ind_txt'))}</span></li>
    </ul>
    <div class="shuffle${sp.from.length > 5 ? ' long' : ''}" role="img" aria-label="${esc(sp.from)} → ${esc(sp.to)}">${tiles.join('')}</div>
  </figure>
</section>

<section class="section" aria-labelledby="how-t">
  <div class="section-head"><div><p class="eyebrow">01</p><h2 id="how-t">${esc(t(lang, 'home_how'))}</h2></div><p class="lead">${esc(t(lang, 'home_how_lead'))}</p></div>
  <ol class="steps">
    <li><h3>${esc(t(lang, 'step1_t'))}</h3><p>${esc(t(lang, 'step1'))}</p></li>
    <li><h3>${esc(t(lang, 'step2_t'))}</h3><p>${esc(t(lang, 'step2'))}</p></li>
    <li><h3>${esc(t(lang, 'step3_t'))}</h3><p>${esc(t(lang, 'step3'))}</p></li>
  </ol>
</section>

<section class="section" aria-labelledby="try-t">
  <div class="try-box">
    <div><p class="eyebrow">02</p><h2 id="try-t">${esc(t(lang, 'try_title'))}</h2><p class="lead">${esc(t(lang, 'try_lead'))}</p>
      <p><a class="btn" href="${P('play')}">${esc(t(lang, 'try_more'))} <span class="arrow" aria-hidden="true">→</span></a></p></div>
    ${tryWidget(ex.home_try, lang)}
  </div>
</section>

${mechs.length ? `<section class="section" aria-labelledby="mech-t">
  <div class="section-head"><div><p class="eyebrow">03</p><h2 id="mech-t">${esc(t(lang, 'mech_title'))}</h2></div><p class="lead">${esc(t(lang, 'mech_lead'))}</p></div>
  <ul class="mech-index">${mechs.map((m) => `<li><a href="${P('archive')}?mechanism=${m}"><span class="name">${esc(t(lang, 'mech_' + m))}</span><span class="n">${esc(plural(lang, mechCounts[m], 'n_clue', 'n_clues'))}</span><span class="what">${esc(t(lang, 'mechhelp_' + m))}</span></a></li>`).join('')}</ul>
</section>` : ''}

<section class="section duo" aria-label="${esc(t(lang, 'banner_daily_t'))}">
  <div class="banner"><div><h2>${esc(t(lang, 'banner_daily_t'))}</h2><p>${esc(t(lang, 'banner_daily'))}</p></div><a class="btn" href="${P('daily')}">${esc(t(lang, 'banner_daily_cta'))}</a></div>
  <div class="banner"><div><h2>${esc(t(lang, 'banner_contrib_t'))}</h2><p>${esc(t(lang, 'banner_contrib'))}</p></div><a class="btn" href="${P('contribute')}">${esc(t(lang, 'banner_contrib_cta'))}</a></div>
</section>`,
      });
    }));

    // ── Jugar ──
    r.get(P('play'), (req, res) => render(req, res, {
      page: 'play', path: P('play'), alternates: altFor('play'), title: t(lang, 'nav_play'), ...seo(lang, 'play'),
      boot: { mode: req.query.mode || null },
      body: `<h1 class="sr-only">${esc(t(lang, 'play_title'))}</h1>
<section class="game" id="game">${skeleton}<noscript><p class="notice">${lang === 'es' ? 'El juego necesita JavaScript.' : 'The game needs JavaScript.'}</p></noscript></section>`,
    }));

    // ── Desafío diario con calendario ──
    r.get(P('daily'), a(async (req, res) => {
      const db = req.app.locals.db;
      const now = today();
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.m || '') && req.query.m <= now.slice(0, 7) ? req.query.m : now.slice(0, 7);
      const rows = await db.all(`SELECT d.date, c.slug FROM daily_challenges d JOIN clues c ON c.id = d.clue_id
        WHERE d.language_code = ? AND d.date LIKE ? AND d.date < ? AND c.status = 'published' ORDER BY d.date`, [lang, month + '-%', now]);
      const first = await db.get("SELECT MIN(date) AS d FROM daily_challenges WHERE language_code = ?", [lang]);
      const bySlug = Object.fromEntries(rows.map((x) => [x.date, x.slug]));
      const [y, mo] = month.split('-').map(Number);
      const startDow = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7;     // lunes primero
      const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const loc = lang === 'es' ? 'es' : 'en-GB';
      const monthName = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(loc, { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/^./, (c) => c.toUpperCase());
      const dows = [...Array(7)].map((_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(loc, { weekday: 'short', timeZone: 'UTC' }).replace('.', ''));
      const shift = (n) => { const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
      const prev = shift(-1); const next = shift(1);
      const hasPrev = first && first.d && first.d.slice(0, 7) <= prev;
      const hasNext = next <= now.slice(0, 7);
      const td = new Date(now + 'T00:00:00Z');
      const cells = [];
      for (let i = 0; i < startDow; i++) cells.push('<li class="day empty-cell" aria-hidden="true"></li>');
      for (let d = 1; d <= days; d++) {
        const date = `${month}-${String(d).padStart(2, '0')}`;
        const label = new Date(date + 'T00:00:00Z').toLocaleDateString(loc, { day: 'numeric', month: 'long', timeZone: 'UTC' });
        const isToday = date === now;
        cells.push(bySlug[date]
          ? `<li class="day"><a href="${href(lang, 'clue', '/' + encodeURIComponent(bySlug[date]))}" aria-label="${esc(label)}">${d}</a></li>`
          : `<li class="day${isToday ? ' today' : ''}"${isToday ? ` aria-current="date"` : ''}><span${isToday ? '' : ' aria-hidden="true"'}>${d}</span>${isToday ? `<span class="sr-only"> ${esc(t(lang, 'cal_today'))}</span>` : ''}</li>`);
      }
      render(req, res, {
        page: 'daily', path: P('daily'), alternates: altFor('daily'), title: t(lang, 'daily_title'), ...seo(lang, 'daily'),
        body: `<header class="daily-head">
  <div class="daily-date" aria-hidden="true"><span class="m">${esc(td.toLocaleDateString(loc, { month: 'short', timeZone: 'UTC' }).replace('.', ''))}</span><span class="d">${td.getUTCDate()}</span><span class="w">${esc(td.toLocaleDateString(loc, { weekday: 'long', timeZone: 'UTC' }))}</span></div>
  <div><p class="eyebrow">${esc(t(lang, 'daily_title'))}</p><h1>${esc(td.toLocaleDateString(loc, { day: 'numeric', month: 'long', timeZone: 'UTC' }))}</h1>
  <p class="lead">${esc(t(lang, 'daily_lead'))} <span class="muted small">${esc(t(lang, 'daily_rules'))}</span></p></div>
</header>
<section class="game" id="game">${skeleton}</section>
<section class="calendar" aria-labelledby="cal-t">
  <div class="cal-head"><div><p class="eyebrow">${esc(t(lang, 'cal_title'))}</p><h2 id="cal-t">${esc(monthName)}</h2></div>
    <div class="header-tools">
      ${hasPrev ? `<a class="icon-btn" href="?m=${prev}" aria-label="${esc(t(lang, 'prev_month'))}" rel="prev"><span aria-hidden="true">←</span></a>` : `<span class="icon-btn off" aria-hidden="true">←</span>`}
      ${hasNext ? `<a class="icon-btn" href="?m=${next}" aria-label="${esc(t(lang, 'next_month'))}" rel="next"><span aria-hidden="true">→</span></a>` : `<span class="icon-btn off" aria-hidden="true">→</span>`}
    </div></div>
  <ul class="cal-grid">${dows.map((w) => `<li class="dow" aria-hidden="true">${esc(w)}</li>`).join('')}${cells.join('')}</ul>
  <p class="cal-legend"><span><i></i>${esc(t(lang, 'cal_available'))}</span>${rows.length ? '' : `<span>${esc(t(lang, 'cal_none'))}</span>`}</p>
</section>`,
      });
    }));

    // ── Explorar ──
    r.get(P('archive'), a(async (req, res) => {
      const db = req.app.locals.db; const q = req.query;
      const fl = /^[a-z]{2}$/.test(q.lang || '') ? q.lang : lang;
      const where = ["c.status = 'published'", 'c.language_code = ?', 'c.language_code IN (SELECT code FROM languages WHERE enabled = 1)']; const args = [fl];
      const search = String(q.q || '').trim().slice(0, 60);
      if (search) { where.push("c.clue_text LIKE ? ESCAPE '\\'"); args.push('%' + search.replace(/[\\%_]/g, (m) => '\\' + m) + '%'); }
      if (/^[a-z]{2}-[A-Z]{2}$/.test(q.variant || '')) { where.push('(c.variant_code IS NULL OR c.variant_code = ?)'); args.push(q.variant); }
      if (/^[1-5]$/.test(q.difficulty || '')) { where.push('c.difficulty = ?'); args.push(Number(q.difficulty)); }
      if (/^[a-z_]{2,40}$/.test(q.category || '')) { where.push('c.category = ?'); args.push(q.category); }
      if (/^[a-z_]{2,40}$/.test(q.mechanism || '')) { where.push('c.mechanism = ?'); args.push(q.mechanism); }
      if (q.date === '7' || q.date === '30') { where.push('c.published_at >= ?'); args.push(new Date(Date.now() - Number(q.date) * 86400000).toISOString()); }
      const pid = req.playerId && /^[\w-]{8,64}$/.test(req.playerId) ? req.playerId : null;
      const hasHistory = pid ? !!(await db.get("SELECT 1 FROM games WHERE player_id = ? AND result = 'solved' LIMIT 1", [pid])) : false;
      if (hasHistory && (q.status === 'solved' || q.status === 'unsolved')) {
        where.push(`c.id ${q.status === 'solved' ? 'IN' : 'NOT IN'} (SELECT clue_id FROM games WHERE player_id = ? AND result = 'solved')`); args.push(pid);
      }
      const page = Math.max(1, Math.min(1000, Number(q.page) || 1)); const per = 24;
      const total = (await db.get(`SELECT COUNT(*) AS n FROM clues c WHERE ${where.join(' AND ')}`, args)).n;
      const rows = await db.all(`SELECT c.* FROM clues c WHERE ${where.join(' AND ')} ORDER BY c.published_at DESC, c.id LIMIT ? OFFSET ?`, [...args, per, (page - 1) * per]);
      const ids = rows.map((x) => x.id); const ph = ids.map(() => '?').join(',') || "''";
      const solved = new Set(pid && ids.length ? (await db.all(`SELECT DISTINCT clue_id FROM games WHERE player_id = ? AND result = 'solved' AND clue_id IN (${ph})`, [pid, ...ids])).map((x) => x.clue_id) : []);
      const dailies = Object.fromEntries(ids.length ? (await db.all(`SELECT clue_id, MAX(date) AS d FROM daily_challenges WHERE clue_id IN (${ph}) AND date < ? GROUP BY clue_id`, [...ids, today()])).map((x) => [x.clue_id, x.d]) : []);
      // "Nuevo": entre los diez últimos publicados y con menos de 14 días. Nada inventado.
      const fresh = new Set((await db.all("SELECT id FROM clues WHERE status = 'published' AND language_code = ? AND published_at >= ? ORDER BY published_at DESC LIMIT 10",
        [fl, new Date(Date.now() - 14 * 86400000).toISOString()])).map((x) => x.id));
      const cats = await db.all('SELECT * FROM categories WHERE enabled = 1 ORDER BY slug');
      const langs = await db.all('SELECT code, name_native FROM languages WHERE enabled = 1 ORDER BY sort_order');
      const variants = await db.all('SELECT code, name_native FROM language_variants WHERE enabled = 1 AND language_code = ? ORDER BY code', [fl]);
      const mechCounts = Object.fromEntries((await db.all("SELECT mechanism AS m, COUNT(*) AS n FROM clues WHERE status = 'published' AND language_code = ? GROUP BY mechanism", [fl])).map((x) => [x.m, x.n]));
      const sel = (v, cur) => (String(v) === String(cur || '') ? ' selected' : '');
      const qs = (over) => { const u = new URLSearchParams(Object.entries({ ...q, ...over }).filter(([, v]) => v !== '' && v != null)); const s = u.toString(); return s ? '?' + s : P('archive'); };
      const pages = Math.max(1, Math.ceil(total / per));
      const filtered = search || q.variant || q.difficulty || q.category || q.mechanism || q.date || q.status;
      const opt = (name, label, options) => `<label class="field"><span>${esc(label)}</span><select name="${name}">${options}</select></label>`;
      render(req, res, {
        page: 'archive', path: P('archive') + (page > 1 ? `?page=${page}` : ''), alternates: altFor('archive'), title: t(lang, 'archive_title'), noindex: !!filtered, ...seo(lang, 'archive'),
        body: `<header class="page-head"><p class="eyebrow">${esc(t(lang, 'nav_archive'))}</p><h1>${esc(t(lang, 'archive_title'))}</h1><p class="lead">${esc(t(lang, 'archive_lead'))}</p></header>
<div class="explore">
  <form class="filters" method="get" action="${P('archive')}" role="search" id="filters">
    <label class="field search"><span>${esc(t(lang, 'search'))}</span><span class="search-wrap">${ICON.search}<input type="search" name="q" value="${esc(search)}" placeholder="${esc(t(lang, 'search_ph'))}" maxlength="60"></span></label>
    <button type="button" class="btn small filter-toggle" aria-expanded="false" aria-controls="more-filters">${esc(t(lang, 'filters_btn'))}</button>
    <fieldset class="collapsible" id="more-filters"><legend class="sr-only">${esc(t(lang, 'filters_btn'))}</legend>
      ${opt('lang', t(lang, 'language'), langs.map((l) => `<option value="${l.code}"${sel(l.code, fl)}>${esc(l.name_native)}</option>`).join(''))}
      ${opt('variant', t(lang, 'variant'), `<option value="">${esc(t(lang, 'any'))}</option>${variants.map((v) => `<option value="${v.code}"${sel(v.code, q.variant)}>${esc(v.name_native)}</option>`).join('')}`)}
      ${opt('difficulty', t(lang, 'difficulty'), `<option value="">${esc(t(lang, 'any'))}</option>${[1, 2, 3, 4, 5].map((d) => `<option value="${d}"${sel(d, q.difficulty)}>${esc(t(lang, 'diff_' + d))}</option>`).join('')}`)}
      ${opt('category', t(lang, 'category'), `<option value="">${esc(t(lang, 'all_categories'))}</option>${cats.map((c) => `<option value="${c.slug}"${sel(c.slug, q.category)}>${esc(lang === 'es' ? c.name_es : c.name_en)}</option>`).join('')}`)}
      ${opt('mechanism', t(lang, 'mechanism'), `<option value="">${esc(t(lang, 'any'))}</option>${MECHS.map((m) => `<option value="${m}"${sel(m, q.mechanism)}>${esc(t(lang, 'mech_' + m))}</option>`).join('')}`)}
      ${opt('date', t(lang, 'date_f'), `<option value="">${esc(t(lang, 'date_any'))}</option><option value="7"${sel('7', q.date)}>${esc(t(lang, 'date_7'))}</option><option value="30"${sel('30', q.date)}>${esc(t(lang, 'date_30'))}</option>`)}
      ${hasHistory ? opt('status', t(lang, 'status_f'), `<option value="">${esc(t(lang, 'st_all'))}</option><option value="solved"${sel('solved', q.status)}>${esc(t(lang, 'st_solved_f'))}</option><option value="unsolved"${sel('unsolved', q.status)}>${esc(t(lang, 'st_unsolved'))}</option>`) : ''}
      <div class="filters-actions"><button class="btn ink" type="submit">${esc(t(lang, 'filter'))}</button>${filtered ? `<a class="link-btn" href="${P('archive')}">${esc(t(lang, 'clear'))}</a>` : ''}</div>
    </fieldset>
  </form>
  <div>
    <nav class="mech-chips" aria-label="${esc(t(lang, 'mechanism'))}">
      <a class="chip" href="${esc(qs({ mechanism: '', page: '' }))}"${!q.mechanism ? ' aria-current="true"' : ''}>${esc(t(lang, 'st_all'))}</a>
      ${MECHS.filter((m) => mechCounts[m]).map((m) => `<a class="chip" href="${esc(qs({ mechanism: m, page: '' }))}"${q.mechanism === m ? ' aria-current="true"' : ''}>${esc(t(lang, 'mech_' + m))} <span class="count">${mechCounts[m]}</span></a>`).join('')}
    </nav>
    <div class="results-bar"><span>${esc(plural(lang, total, 'results_1', 'results_n'))}</span>${pages > 1 ? `<span>${esc(t(lang, 'page'))} ${page} / ${pages}</span>` : ''}</div>
    ${rows.length ? `<ul class="clue-list">${rows.map((c) => clueRow(c, lang, cats, { solved: solved.has(c.id), fresh: fresh.has(c.id), daily: dailies[c.id] })).join('')}</ul>`
    : `<div class="empty"><p class="serif">${esc(t(lang, 'no_results'))}</p><p>${esc(t(lang, 'no_results_hint'))}</p><a class="btn" href="${P('archive')}">${esc(t(lang, 'clear'))}</a></div>`}
    ${pages > 1 ? `<nav class="pager" aria-label="${esc(t(lang, 'page'))}">${page > 1 ? `<a class="btn" rel="prev" href="${esc(qs({ page: page - 1 }))}">← ${esc(t(lang, 'prev'))}</a>` : '<span></span>'}<span class="pos">${page} / ${pages}</span>${page < pages ? `<a class="btn" rel="next" href="${esc(qs({ page: page + 1 }))}">${esc(t(lang, 'next_page'))} →</a>` : '<span></span>'}</nav>` : ''}
  </div>
</div>`,
      });
    }));

    // ── Página de un críptico ──
    r.get(`${P('clue')}/:slug`, a(async (req, res, next) => {
      const db = req.app.locals.db;
      const c = await db.get("SELECT * FROM clues WHERE slug = ? AND status = 'published' AND language_code IN (SELECT code FROM languages WHERE enabled = 1)", [req.params.slug]);
      if (!c) return next();
      const pub = publicClue(c);
      const canonicalLang = UI_LANGS.includes(c.language_code) ? c.language_code : lang;
      const source = c.source_id ? await db.get('SELECT name, url FROM sources WHERE id = ?', [c.source_id]) : null;
      // Enlaces internos: crípticos del mismo mecanismo, para que buscadores y jugadores sigan navegando.
      const related = await db.all("SELECT * FROM clues WHERE status = 'published' AND language_code = ? AND mechanism = ? AND id <> ? ORDER BY (id > ?) DESC, id LIMIT 6",
        [c.language_code, c.mechanism, c.id, c.id]);
      const cats = related.length ? await db.all('SELECT * FROM categories WHERE enabled = 1') : [];
      const G = GUIDE[lang] && GUIDE[lang].mechs[pub.mechanism];
      const crumbs = [[t(lang, 'archive_title'), P('archive')], [t(lang, 'mech_' + pub.mechanism), G ? href(lang, 'guide', '/' + G.slug) : P('archive')], [pub.clue, href(canonicalLang, 'clue', '/' + c.slug)]];
      render(req, res, {
        page: 'clue', path: href(canonicalLang, 'clue', '/' + c.slug), title: pub.clue,
        description: `${t(lang, 'mech_' + pub.mechanism)} · ${t(lang, 'diff_' + pub.difficulty)} — ${pub.clue}`,
        alternates: { [canonicalLang]: href(canonicalLang, 'clue', '/' + c.slug) },
        boot: { slug: c.slug, clueLang: c.language_code, clueVariant: c.variant_code },
        jsonLd: { '@context': 'https://schema.org', '@graph': [
          { '@type': 'CreativeWork', name: pub.clue, inLanguage: c.language_code,
            genre: 'cryptic crossword clue', isAccessibleForFree: true, ...(source ? { isBasedOn: c.source_url || source.url } : {}) },
          breadcrumbs(req.app.locals.config.siteUrl, crumbs)] },
        body: `<nav class="crumbs" aria-label="${lang === 'es' ? 'Ruta' : 'Breadcrumb'}"><a href="${P('archive')}">${esc(t(lang, 'archive_title'))}</a> / ${esc(t(lang, 'mech_' + pub.mechanism))}</nav>
<article class="game" id="game"><div class="sheet"><h1 class="clue-text" lang="${esc(c.language_code)}">${clueWithEnum(pub.clue)}</h1></div></article>
${source ? `<p class="attribution">${esc(t(lang, 'source'))}: <a href="${esc(c.source_url || source.url)}" rel="noopener nofollow">${esc(c.attribution || source.name)}</a>${c.license_id ? ` · ${esc(c.license_id)}` : ''}</p>` : ''}
${pub.author && c.origin === 'community' ? `<p class="attribution">${esc(t(lang, 'by'))} ${esc(pub.author)}</p>` : ''}
${G ? `<section class="section about-mech" aria-labelledby="mech-h"><h2 id="mech-h">${esc(t(lang, 'mech_' + pub.mechanism))}</h2><p>${esc(t(lang, 'mechhelp_' + pub.mechanism))} <a href="${href(lang, 'guide', '/' + G.slug)}">${esc(GUIDE[lang].guide_link)}</a></p></section>` : ''}
${related.length ? `<section class="section" aria-labelledby="rel-h"><h2 id="rel-h">${esc(GUIDE[lang] ? GUIDE[lang].related_t : t(lang, 'try_more'))}</h2><ul class="clue-list">${related.map((x) => clueRow(x, lang, cats)).join('')}</ul></section>` : ''}`,
      });
    }));

    // ── Proponer ──
    r.get(P('contribute'), a(async (req, res) => {
      const db = req.app.locals.db;
      const steps = ['sent', 'pending', 'in_review', 'needs_changes', 'approved', 'published'];
      render(req, res, {
        page: 'contribute', path: P('contribute'), alternates: altFor('contribute'), title: t(lang, 'contribute_title'),
        boot: { categories: await db.all('SELECT slug, name_es, name_en FROM categories WHERE enabled = 1 ORDER BY slug') },
        body: `<header class="page-head"><p class="eyebrow">${esc(t(lang, 'nav_contribute'))}</p><h1>${esc(t(lang, 'contribute_title'))}</h1><p class="lead">${esc(t(lang, 'contribute_lead'))}</p></header>
<div class="contribute">
  <section id="contribute-root">${skeleton}</section>
  <aside class="aside-card" aria-labelledby="pub-t"><h2 id="pub-t">${esc(t(lang, 'c_aside_t'))}</h2><p>${esc(t(lang, 'c_aside'))}</p>
    <ol class="timeline">${steps.map((s) => `<li class="${s === 'needs_changes' ? 'branch' : ''}"><span><b>${esc(t(lang, s === 'sent' ? 'st_sent' : 'st_' + s))}</b>${esc(t(lang, 'st_' + s + '_d'))}</span></li>`).join('')}</ol>
    <p class="small"><a href="${P('submission')}">${esc(t(lang, 'status_title'))} →</a></p>
  </aside>
</div>`,
      });
    }));

    r.get(P('submission'), (req, res) => render(req, res, {
      page: 'submission', path: P('submission'), alternates: altFor('submission'), title: t(lang, 'status_title'), noindex: true,
      body: `<header class="page-head"><p class="eyebrow">${esc(t(lang, 'nav_contribute'))}</p><h1>${esc(t(lang, 'status_title'))}</h1><p class="lead">${esc(t(lang, 'status_lead'))}</p></header><section id="submission-root" class="sub-view"></section>`,
    }));

    // ── Cómo jugar: lecciones con ejemplos resolubles ──
    r.get(P('help'), (req, res) => render(req, res, {
      page: 'help', path: P('help'), alternates: altFor('help'), title: t(lang, 'help_title'), ...seo(lang, 'help'),
      body: `<header class="page-head"><p class="eyebrow">${esc(t(lang, 'nav_help'))}</p><h1>${esc(t(lang, 'help_title'))}</h1><p class="lead">${esc(t(lang, 'help_lead'))}</p></header>
<div class="lessons">${CONTENT.LESSONS[lang].map((l, i) => `<section class="lesson" aria-labelledby="l${i}">
  <div class="lesson-num"><small>${esc(l.kicker)}</small></div>
  <div class="body"><h2 id="l${i}">${esc(l.title)}</h2><p>${esc(l.text)}</p>
    ${l.signals ? `<p class="small muted signals-label">${esc(t(lang, 'lesson_signals'))}</p><ul class="signals">${l.signals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${l.tries.map((x) => tryWidget(x, lang, { label: t(lang, 'lesson_try') })).join('')}
  </div></section>`).join('')}</div>
<section class="section"><article class="prose">${CONTENT[lang].help}</article></section>
${GUIDE[lang] ? `<section class="banner section"><div><h2>${esc(GUIDE[lang].title)}</h2><p>${esc(GUIDE[lang].lead)}</p></div><a class="btn" href="${P('guide')}">${esc(t(lang, 'nav_guide'))}</a></section>` : ''}
<section class="banner"><div><h2>${esc(t(lang, 'try_more'))}</h2><p>${esc(t(lang, 'play_lead'))}</p></div><a class="btn" href="${P('play')}">${esc(t(lang, 'home_cta'))}</a></section>`,
    }));

    // ── Guía de mecanismos: índice y una página por mecanismo ──
    const G = GUIDE[lang];
    if (G) {
      const site = (req) => req.app.locals.config.siteUrl;
      const countsFor = async (db) => Object.fromEntries((await db.all("SELECT mechanism AS m, COUNT(*) AS n FROM clues WHERE status = 'published' AND language_code = ? GROUP BY mechanism", [lang])).map((x) => [x.m, x.n]));
      r.get(P('guide'), a(async (req, res) => {
        const counts = await countsFor(req.app.locals.db);
        render(req, res, {
          page: 'guide', path: P('guide'), alternates: { [lang]: P('guide') }, title: G.title, seoTitle: G.seoTitle, description: G.description,
          jsonLd: { '@context': 'https://schema.org', '@graph': [
            { '@type': 'Article', headline: G.title, description: G.description, inLanguage: lang, isAccessibleForFree: true },
            breadcrumbs(site(req), [[t(lang, 'nav_help'), P('help')], [G.title, P('guide')]])] },
          body: `<header class="page-head"><p class="eyebrow">${esc(t(lang, 'nav_help'))}</p><h1>${esc(G.title)}</h1><p class="lead">${esc(G.lead)}</p></header>
<ul class="mech-index">${MECHS.filter((m) => G.mechs[m]).map((m) => `<li><a href="${P('guide')}/${G.mechs[m].slug}"><span class="name">${esc(t(lang, 'mech_' + m))}</span><span class="n">${counts[m] ? esc(plural(lang, counts[m], 'n_clue', 'n_clues')) : ''}</span><span class="what">${esc(t(lang, 'mechhelp_' + m))}</span></a></li>`).join('')}</ul>
${G.abbr ? `<section class="banner section"><div><h2>${esc(G.abbr.title)}</h2><p>${esc(G.abbr.lead)}</p></div><a class="btn" href="${P('guide')}/${G.abbr.slug}">${esc(G.abbr.title)}</a></section>` : ''}
<section class="banner section"><div><h2>${esc(t(lang, 'help_title'))}</h2><p>${esc(t(lang, 'help_lead'))}</p></div><a class="btn" href="${P('help')}">${esc(t(lang, 'nav_help'))}</a></section>`,
        });
      }));
      if (G.abbr) {
        const A = G.abbr; const path = `${P('guide')}/${A.slug}`;
        r.get(path, (req, res) => render(req, res, {
          page: 'guide', path, alternates: { [lang]: path }, title: A.title, seoTitle: A.seoTitle, description: A.description,
          jsonLd: { '@context': 'https://schema.org', '@graph': [
            { '@type': 'Article', headline: A.title, description: A.description, inLanguage: lang, isAccessibleForFree: true },
            breadcrumbs(site(req), [[t(lang, 'nav_help'), P('help')], [G.title, P('guide')], [A.title, path]])] },
          body: `<nav class="crumbs" aria-label="Ruta"><a href="${P('guide')}">${esc(G.title)}</a> / ${esc(A.title)}</nav>
<header class="page-head"><p class="eyebrow">${esc(G.title)}</p><h1>${esc(A.title)}</h1><p class="lead">${esc(A.lead)}</p></header>
<article class="prose"><p>${esc(A.tip)}</p></article>
${A.groups.map(([name, rows], i) => `<section class="section" aria-labelledby="ab${i}"><h2 id="ab${i}">${esc(name)}</h2>
<table class="abbr-table"><thead><tr><th scope="col">${esc(A.word_t)}</th><th scope="col">${esc(A.abbr_t)}</th></tr></thead><tbody>${rows.map(([w, v]) => `<tr><td>${esc(w)}</td><td><strong>${esc(v)}</strong></td></tr>`).join('')}</tbody></table></section>`).join('')}
<section class="banner section"><div><h2>${esc(t(lang, 'mech_container'))}</h2><p>${esc(t(lang, 'mechhelp_container'))}</p></div><a class="btn" href="${P('guide')}/${G.mechs.container.slug}">${esc(t(lang, 'nav_guide'))}</a></section>`,
        }));
      }
      for (const m of MECHS.filter((x) => G.mechs[x])) {
        const M = G.mechs[m];
        const path = `${P('guide')}/${M.slug}`;
        const words = [...new Set(M.ind.flatMap((k) => (lang === 'es' ? ES_INDICATORS[k] || [] : [])))];
        r.get(path, a(async (req, res) => {
          const db = req.app.locals.db;
          const [rows, cats, counts] = await Promise.all([
            db.all("SELECT * FROM clues WHERE status = 'published' AND language_code = ? AND mechanism = ? ORDER BY difficulty, published_at DESC LIMIT 10", [lang, m]),
            db.all('SELECT * FROM categories WHERE enabled = 1'), countsFor(db)]);
          const name = t(lang, 'mech_' + m);
          render(req, res, {
            page: 'guide', path, alternates: { [lang]: path }, title: name, seoTitle: M.seoTitle, description: M.description,
            jsonLd: { '@context': 'https://schema.org', '@graph': [
              { '@type': 'Article', headline: M.seoTitle.split(' | ')[0], description: M.description, inLanguage: lang, isAccessibleForFree: true },
              breadcrumbs(site(req), [[t(lang, 'nav_help'), P('help')], [G.title, P('guide')], [name, path]])] },
            body: `<nav class="crumbs" aria-label="Ruta"><a href="${P('guide')}">${esc(G.title)}</a> / ${esc(name)}</nav>
<header class="page-head"><p class="eyebrow">${esc(G.title)}</p><h1>${esc(M.seoTitle.split(' | ')[0])}</h1></header>
<article class="prose">${M.intro.map((x) => `<p>${esc(x)}</p>`).join('')}</article>
<section class="section" aria-labelledby="ex-h"><h2 id="ex-h">${esc(G.example_t)}</h2>${tryWidget(M.example, lang)}</section>
${words.length ? `<section class="section" aria-labelledby="ind-h"><h2 id="ind-h">${esc(G.indicators_t)}</h2><p class="small muted">${esc(G.indicators_note)}</p><ul class="signals">${words.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></section>` : ''}
${rows.length ? `<section class="section" aria-labelledby="more-h"><h2 id="more-h">${esc(G.more_t)}</h2><ul class="clue-list">${rows.map((x) => clueRow(x, lang, cats)).join('')}</ul>
<p><a class="btn" href="${P('archive')}?mechanism=${m}">${esc(G.all_t)}${counts[m] ? ` (${counts[m]})` : ''}</a></p></section>` : ''}
<nav class="section" aria-labelledby="oth-h"><h2 id="oth-h">${esc(G.others_t)}</h2><ul class="signals">${MECHS.filter((x) => x !== m && G.mechs[x]).map((x) => `<li><a href="${P('guide')}/${G.mechs[x].slug}">${esc(t(lang, 'mech_' + x))}</a></li>`).join('')}</ul></nav>`,
          });
        }));
      }
    }

    for (const key of ['privacy', 'terms', 'credits']) {
      r.get(P(key), (req, res) => render(req, res, {
        page: key, path: P(key), alternates: altFor(key), title: t(lang, key + '_title'),
        body: `<article class="prose"><h1>${esc(t(lang, key + '_title'))}</h1>${CONTENT[lang][key]}</article>`,
      }));
    }

    const PT = PTEXT[lang];
    r.get(P('profile'), (req, res) => render(req, res, {
      page: 'profile', path: P('profile'), alternates: altFor('profile'), title: t(lang, 'nav_profile'), noindex: true,
      boot: { ptext: PT, achGroups: Object.fromEntries(PROFILE.ACHIEVEMENTS.map((x) => [x.family, x.group])), avatars: { glyphs: PROFILE.AVATAR_GLYPHS, tones: PROFILE.AVATAR_TONES } },
      scripts: ['/js/profile.js'],
      body: `<section id="profile-root" class="profile" aria-live="polite"><h1 class="sr-only">${esc(t(lang, 'nav_profile'))}</h1>${skeleton}</section>
<noscript><p class="notice">${esc(lang === 'es' ? 'Tu perfil necesita JavaScript activado.' : 'Your profile needs JavaScript enabled.')}</p></noscript>`,
    }));

    // Perfil público: solo lo que la persona eligió mostrar. No se indexa.
    r.get(`/${lang}/u/:username`, a(async (req, res) => {
      const pub = await PROFILE.publicProfile(req.app.locals.db, req.params.username);
      const path = `/${lang}/u/${encodeURIComponent(req.params.username)}`;
      if (!pub) {
        return res.status(404).send(layout({ lang, config: req.app.locals.config, page: 'public-profile', path, noindex: true, title: PT.pub_private,
          body: `<section class="lost"><h1>${esc(PT.pub_private)}</h1><div class="hero-actions"><a class="btn primary big" href="${P('play')}">${esc(t(lang, 'home_cta'))}</a></div></section>` }));
      }
      const m = /^(.+)-([0-7])$/.exec(pub.avatar || '');
      const glyph = m ? m[1] : (pub.name[0] || '?').toUpperCase();
      const levelName = pub.level ? PT.level_names[pub.level - 1] : null;
      const country = pub.country ? (() => { try { return new Intl.DisplayNames([lang], { type: 'region' }).of(pub.country); } catch { return pub.country; } })() : null;
      const langName = (c) => ({ es: 'Español', en: 'English' }[c] || c.toUpperCase());
      const items = [
        pub.level ? [PT.pub_level, `${pub.level} · ${levelName}`] : null,
        pub.unique_solved !== undefined ? [PT.pub_solved, String(pub.unique_solved)] : null,
        pub.streaks ? [PT.pub_streak, String(pub.streaks.current)] : null,
        pub.streaks ? [PT.pub_best, String(pub.streaks.best)] : null,
        pub.languages && pub.languages.length ? [PT.pub_langs, pub.languages.map(langName).join(' · ')] : null,
        country ? [PT.pub_country, country] : null,
      ].filter(Boolean);
      const achName = (code) => { const x = /^(.+)_(\d+)$/.exec(code); return x ? `${PT.ach[x[1]][0]} · ${x[2]}` : code; };
      res.set('Cache-Control', 'no-store');
      render(req, res, {
        page: 'public-profile', path, noindex: true, title: PT.pub_title.replace('{n}', pub.name),
        body: `<article class="pub-profile">
  <header class="pf-head"><div class="pf-id"><span class="pf-avatar big av-${m ? m[2] : 'x'}" aria-hidden="true">${esc(glyph)}</span>
    <div><p class="eyebrow">${esc(t(lang, 'nav_profile'))}</p><h1>${esc(pub.name)}</h1><p class="pf-meta">@${esc(pub.username)}</p></div></div>
  ${items.length ? `<dl class="pf-quick">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}</header>
  ${pub.badges && pub.badges.length ? `<section class="pf-sec"><h2>${esc(PT.pub_badges)}</h2><ul class="mini-ach">${pub.badges.map((b) => `<li><svg class="badge on" viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><path class="b-shape" d="M24 3a21 21 0 1 1 0 42a21 21 0 1 1 0-42z"/><path class="b-glyph" d="M15 25l6 6 12-13"/></svg><span><b>${esc(achName(b.code))}</b><span class="small muted">${esc(b.earned_on)}</span></span></li>`).join('')}</ul></section>` : ''}
  <p class="small muted">${esc(PT.pub_note)}</p>
  <p><a class="btn primary" href="${P('play')}">${esc(t(lang, 'home_cta'))}</a></p>
</article>`,
      });
    }));

    // Resultado compartido: la tarjeta y un enlace para jugar el mismo críptico.
    r.get(`/${lang}/r/:token`, a(async (req, res) => {
      const c = await PROFILE.sharedCard(req.app.locals.db, req.params.token);
      const path = `/${lang}/r/${encodeURIComponent(req.params.token)}`;
      if (!c) {
        return res.status(404).send(layout({ lang, config: req.app.locals.config, page: 'share', path, noindex: true, title: '404',
          body: `<section class="lost"><h1>${esc(t(lang, 'not_found'))}</h1><div class="hero-actions"><a class="btn primary big" href="${P('play')}">${esc(t(lang, 'home_cta'))}</a></div></section>` }));
      }
      const x = cardText(c, lang);
      const img = `/api/share/${encodeURIComponent(req.params.token)}.svg?lang=${lang}`;
      const clueLang = UI_LANGS.includes(c.language) ? c.language : lang;
      res.set('Cache-Control', 'no-store');
      render(req, res, {
        page: 'share', path, noindex: true, title: `${x.result} · ${c.clue}`, description: `${x.result} · ${c.clue}`,
        ogImage: req.app.locals.config.siteUrl + img,
        body: `<article class="share-page">
  <p class="eyebrow">${esc(x.result)}</p>
  <img class="share-card" src="${esc(img)}" width="1200" height="630" alt="${esc(x.result + ' — ' + c.clue + ' — ' + x.meta + (x.answer ? ' — ' + x.answer : ''))}">
  <p class="clue-text">${clueWithEnum(c.clue)}</p>
  <p class="small muted">${esc(x.meta)}${c.attempts && c.result === 'solved' ? ' · ' + esc(c.attempts === 1 ? PT.card_attempt : PT.card_attempts.replace('{n}', c.attempts)) : ''}</p>
  ${x.answer ? `<p><b>${esc(x.answer)}</b></p>` : ''}
  <p><a class="btn primary big" href="${href(clueLang, 'clue', '/' + encodeURIComponent(c.slug))}">${esc(PT.card_play)}</a></p>
  <p class="small muted">${esc(PT.card_note)}</p>
</article>`,
      });
    }));

    r.get(P('account'), (req, res) => render(req, res, {
      page: 'account', path: P('account'), alternates: altFor('account'), title: t(lang, 'account_title'), noindex: true,
      body: `<header class="page-head"><p class="eyebrow">${esc(t(lang, 'nav_account'))}</p><h1>${esc(t(lang, 'account_title'))}</h1><p class="lead">${esc(t(lang, 'account_lead'))}</p></header><section id="account-root"></section>`,
    }));
  }

  r.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    const lang = req.path.startsWith('/en') ? 'en' : 'es';
    res.status(404).send(layout({ lang, config: req.app.locals.config, page: 'notfound', path: req.path, noindex: true, title: '404',
      body: `<section class="lost"><p class="eyebrow">404</p><h1>${esc(t(lang, 'not_found'))}</h1><p class="lead">${esc(t(lang, 'not_found_lead'))}</p>
<div class="hero-actions"><a class="btn primary big" href="${href(lang, 'play')}">${esc(t(lang, 'home_cta'))}</a><a class="link-btn" href="${href(lang, 'archive')}">${esc(t(lang, 'home_explore'))}</a></div></section>` }));
  });

  return r;
};
