'use strict';

// IndexNow: avisa a Bing (y a los buscadores que comparten el protocolo) qué
// páginas son nuevas, para que no esperen a leer el sitemap. La clave es
// pública por diseño: el buscador la comprueba en /<clave>.txt.

const { UI_LANGS } = require('../i18n');
const { href } = require('../views/layout');
const GUIDE = require('../views/guide');

const KEY = 'f976081f456136a4fab4599b0fb1881f';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const MAX = 10000;

async function pendingUrls(db, siteUrl, since) {
  const urls = [];
  if (!since) {
    for (const l of UI_LANGS) {
      for (const r of ['home', 'play', 'daily', 'archive', 'help']) urls.push(href(l, r));
      if (GUIDE[l]) {
        urls.push(href(l, 'guide'));
        for (const m of Object.values(GUIDE[l].mechs)) urls.push(href(l, 'guide', '/' + m.slug));
      }
    }
  }
  const clues = await db.all(`SELECT slug, language_code FROM clues WHERE status = 'published'
    AND language_code IN (SELECT code FROM languages WHERE enabled = 1) ${since ? 'AND published_at > ?' : ''}
    ORDER BY published_at DESC LIMIT ?`, since ? [since, MAX] : [MAX]);
  for (const c of clues) if (UI_LANGS.includes(c.language_code)) urls.push(href(c.language_code, 'clue', '/' + c.slug));
  return urls.slice(0, MAX).map((u) => siteUrl + u);
}

async function submit(db, { siteUrl, fetchImpl = global.fetch } = {}) {
  // Solo desde el dominio público real: en pruebas y en vistas previas no se avisa nada.
  if (!siteUrl || !/^https:\/\//.test(siteUrl) || /\.vercel\.app$/.test(siteUrl)) return { skipped: 'no_public_domain' };
  const job = await db.get("SELECT last_run_at FROM jobs WHERE name = 'indexnow'");
  const urlList = await pendingUrls(db, siteUrl, job && job.last_run_at);
  if (!urlList.length) return { sent: 0 };
  const host = new URL(siteUrl).host;
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key: KEY, keyLocation: `${siteUrl}/${KEY}.txt`, urlList }),
  });
  // 200 y 202 son aceptación; cualquier otra respuesta hace fallar la tarea para que se reintente.
  if (res.status !== 200 && res.status !== 202) throw new Error(`indexnow_${res.status}`);
  return { sent: urlList.length, status: res.status };
}

module.exports = { submit, pendingUrls, KEY };
