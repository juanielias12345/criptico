'use strict';

// Google AdSense. Los anuncios salen solo si:
//  1) está configurado el ID de editor (ADSENSE_CLIENT), y
//  2) el ajuste ads.enabled está encendido: se enciende solo cuando se publican la
//     privacidad y las cookies que explican los anuncios (ver services/company.js).
// El ajuste se lee como mucho una vez cada 5 minutos por instancia: cada lectura de la
// base remota cuenta para la cuota.

const crypto = require('crypto');
const { getSetting } = require('./settings');

// Páginas con contenido propio donde pueden ir anuncios. Nunca en el panel, la cuenta,
// el perfil, los legales ni las páginas de error.
const AD_PAGES = new Set(['home', 'play', 'daily', 'archive', 'clue', 'help', 'guide', 'arena', 'tournament']);
const TTL = 5 * 60000;
let cache = { at: 0, value: false };

async function adsEnabled(db, config) {
  if (!config.adsenseClient) return false;
  if (Date.now() - cache.at < TTL) return cache.value;
  let value = false;
  try { value = (await getSetting(db, 'ads.enabled')) === true; } catch { value = cache.value; }
  cache = { at: Date.now(), value };
  return value;
}
const clearCache = () => { cache = { at: 0, value: false }; };

// Política de seguridad para páginas con anuncios, la que recomienda Google para AdSense:
// scripts con nonce y 'strict-dynamic' (los scripts propios llevan el nonce y pueden
// cargar los de Google). 'unsafe-inline' y https: solo los usan navegadores viejos.
function adsCsp(nonce) {
  return [
    "default-src 'self'", `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`, "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:", "font-src 'self'", "connect-src 'self' https:", 'frame-src https:', "frame-ancestors 'none'",
    "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; ');
}
const newNonce = () => crypto.randomBytes(16).toString('base64');

// ads.txt: declara a Google como vendedor autorizado del inventario del sitio.
function adsTxt(config) {
  return config.adsenseClient ? `google.com, ${config.adsenseClient.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` : null;
}

module.exports = { AD_PAGES, adsEnabled, clearCache, adsCsp, newNonce, adsTxt };
