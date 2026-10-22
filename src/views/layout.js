'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { t, ROUTES, T } = require('../i18n');
const PTEXT = require('./profile-text');

// Versión de los archivos estáticos: cambia en cada despliegue para que nadie
// quede con un CSS o JS viejo en caché junto a páginas nuevas.
const ASSET_V = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 10);
  try {
    const h = crypto.createHash('sha256');
    for (const f of ['css/app.css', 'js/app.js', 'js/profile.js']) h.update(fs.readFileSync(path.join(__dirname, '..', '..', 'public', f)));
    return h.digest('hex').slice(0, 10);
  } catch { return Date.now().toString(36); }
})();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function href(lang, route, rest = '') {
  const slug = ROUTES[lang][route];
  return `/${lang}${slug ? '/' + slug : ''}${rest}`;
}

const LOGO = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <rect width="32" height="32" fill="var(--accent)"/>
  <path d="M10.5 7.5 25 16 10.5 24.5z" fill="var(--accent-ink)" stroke="var(--accent-ink)" stroke-width="1.6" stroke-linejoin="round"/>
  <rect x="12.4" y="14" width="4" height="4" fill="var(--accent)"/>
</svg>`;

// Nombre de la marca: la primera palabra ("Play") va en itálica y en el color de acento.
const brandName = (site) => {
  const [first, ...rest] = String(site).split(' ');
  return rest.length ? `<span class="brand-name"><span class="brand-first">${esc(first)}</span> ${esc(rest.join(' '))}</span>` : `<span class="brand-name">${esc(site)}</span>`;
};

// Iconos de trazo propios (24 × 24, 1.6 px), coherentes entre sí.
const ICON = {
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.8 3.8 5.8 3.8 9s-1.2 6.2-3.8 9c-2.6-2.8-3.8-5.8-3.8-9S9.4 5.8 12 3z"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg>',
};

// boot: datos para el script del navegador (no ejecutable, compatible con la CSP).
function layout({ lang, config, title, description, page, path, alternates, body, boot = {}, jsonLd, noindex, scripts = [], ogImage }) {
  const site = config.siteName;
  const fullTitle = title ? `${title} · ${site}` : `${site} · ${t(lang, 'tagline')}`;
  const canonical = `${config.siteUrl}${path}`;
  const alt = alternates || {};
  const nav = [['play', 'nav_play'], ['archive', 'nav_archive'], ['daily', 'nav_daily'], ['help', 'nav_help']];
  const strings = T[lang];
  // pmini: lo mínimo del perfil que usa el juego (avisos de logros y práctica dirigida).
  const PT = PTEXT[lang];
  const pmini = { ach: Object.fromEntries(Object.entries(PT.ach).map(([k, v]) => [k, v[0]])), ach_new: PT.ach_new, practice_banner: PT.practice_banner, practice_clear: PT.practice_clear };
  const bootData = JSON.stringify({ lang, page, site, routes: ROUTES[lang], allRoutes: ROUTES, strings, pmini, ...boot }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || t(lang, 'home_lead'))}">
<link rel="canonical" href="${esc(canonical)}">
${Object.entries(alt).map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${esc(config.siteUrl + p)}">`).join('\n')}
${alt.es ? `<link rel="alternate" hreflang="x-default" href="${esc(config.siteUrl + alt.es)}">` : ''}
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || t(lang, 'home_lead'))}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="#f4eee2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15130f" media="(prefers-color-scheme: dark)">
<link rel="preload" href="/fonts/fraunces-latin-opsz-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrument-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/css/app.css?v=${ASSET_V}">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body data-page="${esc(page)}">
<a class="skip-link" href="#main">${lang === 'es' ? 'Saltar al contenido' : 'Skip to content'}</a>
<header class="site-header">
  <div class="bar">
    <a class="brand" href="${href(lang, 'home')}" aria-label="${esc(site)} — ${lang === 'es' ? 'inicio' : 'home'}">${LOGO}${brandName(site)}</a>
    <nav class="main-nav" id="main-nav" aria-label="${lang === 'es' ? 'Principal' : 'Main'}">
      <ul id="nav-links">
        ${[...nav, ['profile', 'nav_profile']].map(([r, k]) => `<li><a href="${href(lang, r)}"${page === r || (r === 'archive' && page === 'clue') ? ' aria-current="page"' : ''}>${esc(t(lang, k))}</a></li>`).join('')}
      </ul>
    </nav>
    <div class="header-tools">
      <button type="button" class="prefs-btn" id="prefs-button" aria-haspopup="dialog" title="${esc(t(lang, 'nav_prefs'))}">${ICON.globe}<span id="prefs-label">${esc(t(lang, 'nav_prefs'))}</span></button>
      <button type="button" class="icon-btn" id="theme-button" aria-label="${esc(t(lang, 'theme'))}">${ICON.theme}</button>
      <a class="icon-btn profile-link" href="${href(lang, 'profile')}" aria-label="${esc(t(lang, 'nav_profile'))}"${page === 'profile' ? ' aria-current="page"' : ''}>${ICON.user}</a>
      <button type="button" class="icon-btn nav-toggle" aria-expanded="false" aria-controls="main-nav" aria-label="${lang === 'es' ? 'Menú' : 'Menu'}">${ICON.menu}</button>
    </div>
  </div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <div class="inner">
    <div class="about">
      <a class="brand" href="${href(lang, 'home')}">${LOGO}${brandName(site)}</a>
      <p>${esc(t(lang, 'footer_made'))}</p>
    </div>
    <nav aria-label="${lang === 'es' ? 'Jugar' : 'Play'}">
      <h2>${esc(t(lang, 'footer_play'))}</h2>
      <ul>${nav.map(([r, k]) => `<li><a href="${href(lang, r)}">${esc(t(lang, k))}</a></li>`).join('')}</ul>
    </nav>
    <nav aria-label="${lang === 'es' ? 'Comunidad' : 'Community'}">
      <h2>${esc(t(lang, 'footer_community'))}</h2>
      <ul>
        <li><a href="${href(lang, 'contribute')}">${esc(t(lang, 'nav_contribute'))}</a></li>
        <li><a href="${href(lang, 'submission')}">${esc(t(lang, 'status_title'))}</a></li>
        <li><a href="${href(lang, 'profile')}">${esc(t(lang, 'nav_profile'))}</a></li>
        <li><a href="${href(lang, 'account')}">${esc(t(lang, 'nav_account'))}</a></li>
      </ul>
    </nav>
    <div class="fine">
      <span><a href="${href(lang, 'privacy')}">${esc(t(lang, 'privacy_title'))}</a> · <a href="${href(lang, 'terms')}">${esc(t(lang, 'terms_title'))}</a> · <a href="${href(lang, 'credits')}">${esc(t(lang, 'credits_title'))}</a></span>
      <span>${esc(t(lang, 'ui_language'))}: ${lang === 'es' ? `<strong>Español</strong> · <a href="${alt.en || '/en'}" hreflang="en" lang="en">English</a>` : `<a href="${alt.es || '/es'}" hreflang="es" lang="es">Español</a> · <strong>English</strong>`}</span>
    </div>
  </div>
</footer>
<div id="dialog-root"></div>
<script type="application/json" id="boot">${bootData}</script>
<script src="/js/app.js?v=${ASSET_V}" defer></script>
${scripts.map((src) => `<script src="${esc(src)}?v=${ASSET_V}" defer></script>`).join('\n')}
</body>
</html>`;
}

module.exports = { layout, esc, href, ICON, LOGO, ASSET_V };
