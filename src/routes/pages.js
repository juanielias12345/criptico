'use strict';

const express = require('express');
const { layout, esc, href } = require('../views/layout');
const CONTENT = require('../views/content');
const { t, ROUTES, UI_LANGS, pickUiLang } = require('../i18n');
const { publicClue } = require('../services/clues');
const { today } = require('../services/game');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const altFor = (route, rest = '') => Object.fromEntries(UI_LANGS.map((l) => [l, href(l, route, rest)]));

function categoryName(cats, slug, lang) {
  const c = cats.find((x) => x.slug === slug);
  return c ? (lang === 'es' ? c.name_es : c.name_en) : slug;
}

function clueCard(c, lang, cats) {
  const pub = publicClue(c);
  return `<li class="clue-card">
    <a href="${href(lang, 'clue', '/' + encodeURIComponent(pub.slug))}">
      <span class="clue-text" lang="${esc(pub.language)}">${esc(pub.clue)}</span>
      <span class="meta">${esc(t(lang, 'mech_' + pub.mechanism))} · ${esc(t(lang, 'diff_' + pub.difficulty))} · ${esc(categoryName(cats, pub.category, lang))}${pub.variant ? ' · ' + esc(pub.variant) : ''}</span>
    </a></li>`;
}

module.exports = function pages() {
  const r = express.Router();

  r.get('/', (req, res) => {
    res.set('Vary', 'Accept-Language');
    res.redirect(302, `/${pickUiLang(req.headers['accept-language'])}`);
  });

  r.get('/robots.txt', (req, res) => {
    const { siteUrl } = req.app.locals.config;
    res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`);
  });

  r.get('/sitemap.xml', a(async (req, res) => {
    const { siteUrl } = req.app.locals.config;
    const db = req.app.locals.db;
    const urls = [];
    for (const l of UI_LANGS) for (const route of ['home', 'play', 'daily', 'archive', 'contribute', 'help', 'privacy', 'terms']) urls.push(href(l, route));
    // Solo páginas con contenido real: crípticos publicados, en el idioma de la interfaz que les corresponde.
    const clues = await db.all("SELECT slug, language_code, updated_at FROM clues WHERE status = 'published' ORDER BY published_at DESC LIMIT 45000");
    const body = urls.map((u) => `<url><loc>${esc(siteUrl + u)}</loc></url>`).join('')
      + clues.map((c) => `<url><loc>${esc(siteUrl + href(UI_LANGS.includes(c.language_code) ? c.language_code : 'en', 'clue', '/' + c.slug))}</loc><lastmod>${esc(String(c.updated_at).slice(0, 10))}</lastmod></url>`).join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
  }));

  r.get('/admin', (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(require('path').join(__dirname, '..', '..', 'public', 'admin.html'));
  });

  for (const lang of UI_LANGS) {
    const R = ROUTES[lang];
    const P = (route) => `/${lang}${R[route] ? '/' + R[route] : ''}`;
    const render = (req, res, opts) => res.send(layout({ lang, config: req.app.locals.config, ...opts }));

    r.get(`/${lang}`, a(async (req, res) => {
      const db = req.app.locals.db;
      const totals = await db.all("SELECT language_code AS l, COUNT(*) AS n FROM clues WHERE status = 'published' GROUP BY language_code");
      const total = totals.reduce((s, x) => s + x.n, 0);
      const mechs = ['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone', 'double_definition'];
      render(req, res, {
        page: 'home', path: P('home'), alternates: altFor('home'),
        jsonLd: { '@context': 'https://schema.org', '@type': 'WebSite', name: req.app.locals.config.siteName, url: req.app.locals.config.siteUrl, inLanguage: ['es', 'en'] },
        body: `
<section class="hero">
  <h1>${esc(t(lang, 'home_title'))}</h1>
  <p class="lead">${esc(t(lang, 'home_lead'))}</p>
  <div class="actions">
    <a class="btn primary big" href="${P('play')}">${esc(t(lang, 'home_cta'))}</a>
    <a class="btn ghost" href="${P('daily')}">${esc(t(lang, 'home_daily'))}</a>
  </div>
  <p class="muted small">${total} ${lang === 'es' ? 'crípticos publicados en' : 'clues published in'} ${totals.length} ${lang === 'es' ? (totals.length === 1 ? 'idioma' : 'idiomas') : (totals.length === 1 ? 'language' : 'languages')}.</p>
</section>
<section class="how">
  <h2>${esc(t(lang, 'home_how'))}</h2>
  <ol class="steps"><li>${esc(t(lang, 'home_how_1'))}</li><li>${esc(t(lang, 'home_how_2'))}</li><li>${esc(t(lang, 'home_how_3'))}</li></ol>
  <figure class="example">
    <figcaption>${esc(t(lang, 'home_example'))}</figcaption>
    <blockquote class="clue-text">${esc(t(lang, 'home_example_clue'))}</blockquote>
    <p>${esc(t(lang, 'home_example_expl'))}</p>
  </figure>
</section>
<section class="mechs">
  <ul class="mech-grid">${mechs.map((m) => `<li><strong>${esc(t(lang, 'mech_' + m))}</strong><span>${esc(t(lang, 'mechhelp_' + m))}</span></li>`).join('')}</ul>
</section>`,
      });
    }));

    r.get(P('play'), (req, res) => render(req, res, {
      page: 'play', path: P('play'), alternates: altFor('play'), title: t(lang, 'nav_play'),
      boot: { mode: req.query.mode || null },
      body: `<section class="game-shell" id="game" aria-live="polite"><p class="muted">${esc(t(lang, 'loading'))}</p><noscript>${lang === 'es' ? 'El juego necesita JavaScript.' : 'The game needs JavaScript.'}</noscript></section>`,
    }));

    r.get(P('daily'), a(async (req, res) => {
      const db = req.app.locals.db;
      const past = await db.all(`SELECT d.date, c.* FROM daily_challenges d JOIN clues c ON c.id = d.clue_id
        WHERE d.language_code = ? AND d.date < ? AND c.status = 'published' ORDER BY d.date DESC LIMIT 30`, [lang, today()]);
      const cats = await db.all('SELECT * FROM categories');
      render(req, res, {
        page: 'daily', path: P('daily'), alternates: altFor('daily'), title: t(lang, 'daily_title'),
        body: `<header class="page-head"><h1>${esc(t(lang, 'daily_title'))}</h1><p class="lead">${esc(t(lang, 'daily_lead'))}</p></header>
<section class="game-shell" id="game" aria-live="polite"><p class="muted">${esc(t(lang, 'loading'))}</p></section>
${past.length ? `<section><h2>${esc(t(lang, 'past_dailies'))}</h2><ul class="clue-list">${past.map((c) => clueCard(c, lang, cats).replace('<span class="meta">', `<span class="meta"><time datetime="${esc(c.date)}">${esc(c.date)}</time> · `)).join('')}</ul></section>` : ''}`,
      });
    }));

    r.get(P('archive'), a(async (req, res) => {
      const db = req.app.locals.db; const q = req.query;
      const fl = /^[a-z]{2}$/.test(q.lang || '') ? q.lang : lang;
      const where = ["status = 'published'", 'language_code = ?']; const args = [fl];
      if (/^[a-z]{2}-[A-Z]{2}$/.test(q.variant || '')) { where.push('(variant_code IS NULL OR variant_code = ?)'); args.push(q.variant); }
      if (/^[1-5]$/.test(q.difficulty || '')) { where.push('difficulty = ?'); args.push(Number(q.difficulty)); }
      if (/^[a-z_]{2,40}$/.test(q.category || '')) { where.push('category = ?'); args.push(q.category); }
      if (/^[a-z_]{2,40}$/.test(q.mechanism || '')) { where.push('mechanism = ?'); args.push(q.mechanism); }
      const page = Math.max(1, Math.min(1000, Number(q.page) || 1)); const per = 24;
      const total = (await db.get(`SELECT COUNT(*) AS n FROM clues WHERE ${where.join(' AND ')}`, args)).n;
      const rows = await db.all(`SELECT * FROM clues WHERE ${where.join(' AND ')} ORDER BY published_at DESC, id LIMIT ? OFFSET ?`, [...args, per, (page - 1) * per]);
      const cats = await db.all('SELECT * FROM categories WHERE enabled = 1 ORDER BY slug');
      const langs = await db.all('SELECT code, name_native FROM languages WHERE enabled = 1 ORDER BY sort_order');
      const variants = await db.all('SELECT code, name_native FROM language_variants WHERE enabled = 1 AND language_code = ? ORDER BY code', [fl]);
      const mechs = ['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone', 'double_definition', 'initials'];
      const sel = (v, cur) => (String(v) === String(cur || '') ? ' selected' : '');
      const qs = (p) => { const u = new URLSearchParams({ ...q, page: String(p) }); return '?' + u.toString(); };
      const pages = Math.max(1, Math.ceil(total / per));
      const filtered = q.variant || q.difficulty || q.category || q.mechanism;
      render(req, res, {
        page: 'archive', path: P('archive') + (page > 1 ? `?page=${page}` : ''), alternates: altFor('archive'), title: t(lang, 'archive_title'), noindex: !!filtered,
        body: `<header class="page-head"><h1>${esc(t(lang, 'archive_title'))}</h1><p class="lead">${esc(t(lang, 'archive_lead'))}</p></header>
<form class="filters" method="get" action="${P('archive')}">
  <label>${esc(t(lang, 'language'))}<select name="lang">${langs.map((l) => `<option value="${l.code}"${sel(l.code, fl)}>${esc(l.name_native)}</option>`).join('')}</select></label>
  <label>${esc(t(lang, 'variant'))}<select name="variant"><option value="">${esc(t(lang, 'any'))}</option>${variants.map((v) => `<option value="${v.code}"${sel(v.code, q.variant)}>${esc(v.name_native)}</option>`).join('')}</select></label>
  <label>${esc(t(lang, 'difficulty'))}<select name="difficulty"><option value="">${esc(t(lang, 'any'))}</option>${[1, 2, 3, 4, 5].map((d) => `<option value="${d}"${sel(d, q.difficulty)}>${esc(t(lang, 'diff_' + d))}</option>`).join('')}</select></label>
  <label>${esc(t(lang, 'category'))}<select name="category"><option value="">${esc(t(lang, 'all_categories'))}</option>${cats.map((c) => `<option value="${c.slug}"${sel(c.slug, q.category)}>${esc(lang === 'es' ? c.name_es : c.name_en)}</option>`).join('')}</select></label>
  <label>${esc(t(lang, 'mechanism'))}<select name="mechanism"><option value="">${esc(t(lang, 'any'))}</option>${mechs.map((m) => `<option value="${m}"${sel(m, q.mechanism)}>${esc(t(lang, 'mech_' + m))}</option>`).join('')}</select></label>
  <button class="btn" type="submit">${esc(t(lang, 'filter'))}</button>
</form>
<p class="muted small">${total} ${lang === 'es' ? 'resultados' : 'results'}</p>
${rows.length ? `<ul class="clue-list">${rows.map((c) => clueCard(c, lang, cats)).join('')}</ul>` : `<p class="empty">${esc(t(lang, 'no_results'))}</p>`}
${pages > 1 ? `<nav class="pager" aria-label="${esc(t(lang, 'page'))}">${page > 1 ? `<a class="btn ghost" rel="prev" href="${esc(qs(page - 1))}">${esc(t(lang, 'prev'))}</a>` : ''}<span>${page} / ${pages}</span>${page < pages ? `<a class="btn ghost" rel="next" href="${esc(qs(page + 1))}">${esc(t(lang, 'next_page'))}</a>` : ''}</nav>` : ''}`,
      });
    }));

    r.get(`${P('clue')}/:slug`, a(async (req, res, next) => {
      const db = req.app.locals.db;
      const c = await db.get("SELECT * FROM clues WHERE slug = ? AND status = 'published'", [req.params.slug]);
      if (!c) return next();
      const pub = publicClue(c);
      const cats = await db.all('SELECT * FROM categories');
      const canonicalLang = UI_LANGS.includes(c.language_code) ? c.language_code : lang;
      const source = c.source_id ? await db.get('SELECT name, url FROM sources WHERE id = ?', [c.source_id]) : null;
      render(req, res, {
        page: 'clue', path: href(canonicalLang, 'clue', '/' + c.slug), title: pub.clue,
        description: `${t(lang, 'mech_' + pub.mechanism)} · ${t(lang, 'diff_' + pub.difficulty)} — ${pub.clue}`,
        alternates: { [canonicalLang]: href(canonicalLang, 'clue', '/' + c.slug) },
        boot: { slug: c.slug, clueLang: c.language_code, clueVariant: c.variant_code },
        jsonLd: { '@context': 'https://schema.org', '@type': 'CreativeWork', name: pub.clue, inLanguage: c.language_code,
          genre: 'cryptic crossword clue', isAccessibleForFree: true, ...(source ? { isBasedOn: c.source_url || source.url } : {}) },
        body: `<nav class="crumbs"><a href="${P('archive')}">${esc(t(lang, 'archive_title'))}</a></nav>
<article class="clue-page">
  <p class="meta">${esc(t(lang, 'mech_' + pub.mechanism))} · ${esc(t(lang, 'diff_' + pub.difficulty))} · ${esc(categoryName(cats, pub.category, lang))}${pub.variant ? ' · ' + esc(pub.variant) : ''}</p>
  <section class="game-shell" id="game" aria-live="polite"><h1 class="clue-text" lang="${esc(c.language_code)}">${esc(pub.clue)}</h1></section>
  ${source ? `<p class="attribution">${esc(t(lang, 'source'))}: <a href="${esc(c.source_url || source.url)}" rel="noopener nofollow">${esc(c.attribution || source.name)}</a>${c.license_id ? ` · ${esc(c.license_id)}` : ''}</p>` : ''}
  ${pub.author && c.origin === 'community' ? `<p class="attribution">${esc(t(lang, 'by'))} ${esc(pub.author)}</p>` : ''}
</article>`,
      });
    }));

    r.get(P('contribute'), a(async (req, res) => {
      const db = req.app.locals.db;
      render(req, res, {
        page: 'contribute', path: P('contribute'), alternates: altFor('contribute'), title: t(lang, 'contribute_title'),
        boot: { categories: await db.all('SELECT slug, name_es, name_en FROM categories WHERE enabled = 1 ORDER BY slug') },
        body: `<header class="page-head"><h1>${esc(t(lang, 'contribute_title'))}</h1><p class="lead">${esc(t(lang, 'contribute_lead'))}</p></header>
<section id="contribute-root"></section>`,
      });
    }));

    r.get(P('submission'), (req, res) => render(req, res, {
      page: 'submission', path: P('submission'), alternates: altFor('submission'), title: t(lang, 'status_title'), noindex: true,
      body: `<header class="page-head"><h1>${esc(t(lang, 'status_title'))}</h1></header><section id="submission-root"></section>`,
    }));

    for (const key of ['help', 'privacy', 'terms']) {
      r.get(P(key), (req, res) => render(req, res, {
        page: key, path: P(key), alternates: altFor(key), title: t(lang, key + '_title'),
        body: `<article class="prose"><h1>${esc(t(lang, key + '_title'))}</h1>${CONTENT[lang][key]}</article>`,
      }));
    }

    r.get(P('profile'), (req, res) => render(req, res, {
      page: 'profile', path: P('profile'), alternates: altFor('profile'), title: t(lang, 'profile_title'), noindex: true,
      body: `<header class="page-head"><h1>${esc(t(lang, 'profile_title'))}</h1></header><section id="profile-root"><p class="muted">${esc(t(lang, 'loading'))}</p></section>`,
    }));

    r.get(P('account'), (req, res) => render(req, res, {
      page: 'account', path: P('account'), alternates: altFor('account'), title: t(lang, 'account_title'), noindex: true,
      body: `<header class="page-head"><h1>${esc(t(lang, 'account_title'))}</h1><p class="lead">${esc(t(lang, 'account_lead'))}</p></header><section id="account-root"></section>`,
    }));
  }

  r.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    const lang = req.path.startsWith('/en') ? 'en' : 'es';
    res.status(404).send(layout({ lang, config: req.app.locals.config, page: 'notfound', path: req.path, noindex: true, title: '404',
      body: `<section class="hero"><h1>404</h1><p class="lead">${lang === 'es' ? 'No encontramos esta página.' : "We couldn't find that page."}</p><a class="btn primary" href="/${lang}">${esc(t(lang, 'home_cta'))}</a></section>` }));
  });

  return r;
};
