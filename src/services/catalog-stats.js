'use strict';

// Conteos del catálogo con memoria de corta duración.
//
// Turso cobra (y con el cupo agotado, bloquea) por cada fila leída. Un COUNT(*) sobre
// los crípticos publicados lee el catálogo entero, y la portada, la guía, Explorar,
// /api/meta y el sitemap lo hacían en cada visita. Estos números cambian solo cuando se
// publica un lote, así que se guardan unos minutos en la instancia del servidor y se
// comparten entre visitas. En pruebas y en desarrollo no se guardan (TTL 0).

const DEFAULT_TTL = process.env.NODE_ENV === 'production' ? 10 * 60 * 1000 : 0;
let ttl = Number.isFinite(Number(process.env.STATS_CACHE_MS)) && process.env.STATS_CACHE_MS !== undefined
  ? Number(process.env.STATS_CACHE_MS) : DEFAULT_TTL;

const caches = new WeakMap(); // una memoria por conexión: las pruebas abren varias bases
const MAX_KEYS = 500;

function setTtl(ms) { ttl = ms; }
function clear(db) { if (db) caches.delete(db); }

// Devuelve el valor guardado si sigue vigente; si no, lo calcula una sola vez aunque
// lleguen varias visitas juntas. Un error no queda guardado.
function memo(db, key, fn) {
  if (!ttl) return fn();
  let m = caches.get(db);
  if (!m) { m = new Map(); caches.set(db, m); }
  const hit = m.get(key);
  if (hit && hit.exp > Date.now()) return hit.p;
  if (m.size >= MAX_KEYS) m.clear();
  const p = Promise.resolve().then(fn);
  m.set(key, { exp: Date.now() + ttl, p });
  p.catch(() => { if (m.get(key) && m.get(key).p === p) m.delete(key); });
  return p;
}

const ENABLED = 'language_code IN (SELECT code FROM languages WHERE enabled = 1)';

// Publicados por idioma activo: [{ code, n }].
const totalsByLanguage = (db) => memo(db, 'totals', () =>
  db.all(`SELECT language_code AS code, COUNT(*) AS n FROM clues WHERE status = 'published' AND ${ENABLED} GROUP BY language_code`));

// Publicados por mecanismo en un idioma: { mecanismo: n }.
const mechanismCounts = (db, lang) => memo(db, 'mech:' + lang, async () => Object.fromEntries(
  (await db.all("SELECT mechanism AS m, COUNT(*) AS n FROM clues WHERE status = 'published' AND language_code = ? GROUP BY mechanism", [lang]))
    .map((x) => [x.m, x.n])));

// Publicados por idioma y variante (variant null = general), en una sola lectura del catálogo.
const variantCounts = (db) => memo(db, 'variants', () =>
  db.all("SELECT language_code AS lang, variant_code AS variant, COUNT(*) AS n FROM clues WHERE status = 'published' GROUP BY language_code, variant_code"));

// Para el índice del sitemap: cuántos publicados hay y la última modificación.
const sitemapInfo = (db) => memo(db, 'sitemap', () =>
  db.get(`SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM clues WHERE status = 'published' AND ${ENABLED}`));

// Un conteo con filtros públicos (Explorar, /api/clues). Nunca con datos de un jugador.
const filteredCount = (db, sql, args) => memo(db, 'count:' + sql + '|' + JSON.stringify(args), async () => (await db.get(sql, args)).n);

module.exports = { memo, setTtl, clear, totalsByLanguage, mechanismCounts, variantCounts, sitemapInfo, filteredCount };
