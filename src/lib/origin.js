'use strict';

// Origen de una visita: de qué red, buscador o sitio llegó y con qué campaña.
// Solo se guarda el dominio del sitio que trajo la visita, nunca la dirección completa.

// [patrón del dominio, canal, tipo]
const KNOWN = [
  [/(^|\.)instagram\.com$/, 'Instagram', 'social'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'Facebook', 'social'],
  [/(^|\.)tiktok\.com$/, 'TikTok', 'social'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube', 'social'],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, 'X', 'social'],
  [/(^|\.)threads\.net$/, 'Threads', 'social'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'WhatsApp', 'social'],
  [/(^|\.)(t\.me|telegram\.org)$/, 'Telegram', 'social'],
  [/(^|\.)reddit\.com$/, 'Reddit', 'social'],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/, 'LinkedIn', 'social'],
  [/(^|\.)pinterest\.[a-z.]+$/, 'Pinterest', 'social'],
  [/(^|\.)google\.[a-z.]+$/, 'Google', 'search'],
  [/(^|\.)bing\.com$/, 'Bing', 'search'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo', 'search'],
  [/(^|\.)search\.yahoo\.com$|(^|\.)yahoo\.com$/, 'Yahoo', 'search'],
  [/(^|\.)ecosia\.org$/, 'Ecosia', 'search'],
  [/(^|\.)yandex\.[a-z.]+$/, 'Yandex', 'search'],
  [/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/, 'Asistentes de IA', 'ai'],
  [/(^|\.)(mail\.google\.com|outlook\.live\.com|mail\.yahoo\.com)$/, 'Correo', 'email'],
];

const SOURCE_ALIASES = {
  ig: 'Instagram', instagram: 'Instagram', fb: 'Facebook', facebook: 'Facebook', tiktok: 'TikTok', tt: 'TikTok',
  youtube: 'YouTube', yt: 'YouTube', x: 'X', twitter: 'X', threads: 'Threads', whatsapp: 'WhatsApp', wa: 'WhatsApp',
  telegram: 'Telegram', reddit: 'Reddit', linkedin: 'LinkedIn', google: 'Google', bing: 'Bing', newsletter: 'Correo', email: 'Correo',
};

const MEDIUM_LABELS = { social: 'Redes sociales', search: 'Buscadores', referral: 'Otros sitios', direct: 'Directo', email: 'Correo', ai: 'Asistentes de IA', campaign: 'Campaña' };

const clip = (v, n) => String(v || '').trim().slice(0, n);

function hostOf(ref) {
  const s = clip(ref, 300).toLowerCase();
  if (!s) return '';
  try { return new URL(s.includes('://') ? s : 'https://' + s).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// raw: { ref, us, um, uc, landing } tal como lo manda el navegador.
// Devuelve null si la visita viene del mismo sitio (no es una entrada).
function classify(raw, siteHost) {
  if (!raw || typeof raw !== 'object') return null;
  const host = hostOf(raw.ref);
  const own = String(siteHost || '').toLowerCase().replace(/^www\./, '');
  const internal = host && own && (host === own || host.endsWith('.' + own));
  const us = clip(raw.us, 60).toLowerCase(); const um = clip(raw.um, 40).toLowerCase(); const uc = clip(raw.uc, 80);
  if (internal && !us) return null;
  let source = ''; let medium = '';
  if (us) {
    source = SOURCE_ALIASES[us] || clip(raw.us, 60);
    const known = KNOWN.find(([, name]) => name === source);
    medium = /mail|newsletter/.test(um) ? 'email' : /cpc|ppc|paid|ads/.test(um) ? 'campaign' : known ? known[2] : 'campaign';
  } else if (host) {
    const k = KNOWN.find(([re]) => re.test(host));
    source = k ? k[1] : host; medium = k ? k[2] : 'referral';
  } else { source = 'Directo'; medium = 'direct'; }
  const landing = clip(raw.landing, 200).split('?')[0];
  return { source, medium, campaign: uc, referrer: internal ? '' : host, landing: /^\/[\w\-./%]*$/.test(landing) ? landing : '' };
}

module.exports = { classify, hostOf, MEDIUM_LABELS };
