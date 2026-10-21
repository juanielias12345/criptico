'use strict';

const { t, ROUTES, T } = require('../i18n');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function href(lang, route, rest = '') {
  const slug = ROUTES[lang][route];
  return `/${lang}${slug ? '/' + slug : ''}${rest}`;
}

const LOGO = `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <rect x="2" y="2" width="28" height="28" rx="7" fill="currentColor"/>
  <path d="M9 11h6v6H9zM17 15h6v6h-6z" fill="var(--bg)"/>
  <path d="M9 21h6" stroke="var(--bg)" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// boot: datos para el script del navegador (no ejecutable, compatible con la CSP).
function layout({ lang, config, title, description, page, path, alternates, body, boot = {}, jsonLd, noindex }) {
  const site = config.siteName;
  const fullTitle = title ? `${title} · ${site}` : `${site} · ${t(lang, 'tagline')}`;
  const canonical = `${config.siteUrl}${path}`;
  const alt = alternates || {};
  const nav = [
    ['play', 'nav_play'], ['daily', 'nav_daily'], ['archive', 'nav_archive'], ['contribute', 'nav_contribute'], ['help', 'nav_help'],
  ];
  const strings = T[lang];
  const bootData = JSON.stringify({ lang, page, site, routes: ROUTES[lang], allRoutes: ROUTES, strings, ...boot }).replace(/</g, '\\u003c');
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
<meta name="theme-color" content="#1f3a5f">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/css/app.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body data-page="${esc(page)}">
<a class="skip-link" href="#main">${lang === 'es' ? 'Saltar al contenido' : 'Skip to content'}</a>
<header class="site-header">
  <a class="brand" href="${href(lang, 'home')}">${LOGO}<span>${esc(site)}</span></a>
  <nav class="main-nav" aria-label="${lang === 'es' ? 'Principal' : 'Main'}">
    <button class="nav-toggle" aria-expanded="false" aria-controls="nav-links"><span class="sr-only">Menú</span><span aria-hidden="true">☰</span></button>
    <ul id="nav-links">
      ${nav.map(([r, k]) => `<li><a href="${href(lang, r)}"${page === r ? ' aria-current="page"' : ''}>${esc(t(lang, k))}</a></li>`).join('')}
      <li><a href="${href(lang, 'profile')}"${page === 'profile' ? ' aria-current="page"' : ''}>${esc(t(lang, 'nav_profile'))}</a></li>
    </ul>
  </nav>
  <div class="header-tools">
    <button type="button" class="chip" id="prefs-button" aria-haspopup="dialog"><span aria-hidden="true">🌐</span> <span id="prefs-label">${esc(t(lang, 'nav_prefs'))}</span></button>
    <button type="button" class="icon-btn" id="theme-button" aria-label="${esc(t(lang, 'theme'))}"><span aria-hidden="true">◐</span></button>
  </div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <p>${esc(t(lang, 'footer_made'))}</p>
  <ul>
    <li><a href="${href(lang, 'help')}">${esc(t(lang, 'nav_help'))}</a></li>
    <li><a href="${href(lang, 'contribute')}">${esc(t(lang, 'nav_contribute'))}</a></li>
    <li><a href="${href(lang, 'privacy')}">${esc(t(lang, 'privacy_title'))}</a></li>
    <li><a href="${href(lang, 'terms')}">${esc(t(lang, 'terms_title'))}</a></li>
    <li><a href="${href(lang, 'account')}">${esc(t(lang, 'nav_account'))}</a></li>
    <li>${lang === 'es' ? `<a href="${alt.en || '/en'}" hreflang="en" lang="en">English</a>` : `<a href="${alt.es || '/es'}" hreflang="es" lang="es">Español</a>`}</li>
  </ul>
</footer>
<div id="dialog-root"></div>
<script type="application/json" id="boot">${bootData}</script>
<script src="/js/app.js" defer></script>
</body>
</html>`;
}

module.exports = { layout, esc, href };
