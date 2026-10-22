'use strict';

// Circuito A: importación de fuentes externas autorizadas.
// Un elemento se publica solo si supera TODAS las condiciones; si falla una,
// va a la cola de revisión de importaciones (separada de las propuestas de usuarios).

const N = require('../lib/normalize');
const { buildClue, insertClue, rightsStatusFor } = require('./clues');
const { findDuplicates, recordDuplicateFlags } = require('./dedupe');
const { getSetting } = require('./settings');
const { logError } = require('./audit');
const { uuid, now, sha256, parseJson, HttpError } = require('./util');

const USER_AGENT = 'PlayCripticosBot/1.0 (+importador de fuentes autorizadas)';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_METHODS = new Set(['json_feed', 'rss', 'csv', 'api', 'manual_upload']);

// ── Lectura de formatos ──

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') q = false; else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; if (row.some((f) => f !== '')) rows.push(row); row = [];
    } else field += ch;
  }
  row.push(field); if (row.some((f) => f !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] !== undefined ? r[i] : ''])));
}

function xmlText(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

// RSS con elementos del espacio de nombres criptico: (ver docs/FUENTES.md).
function parseRss(text) {
  const items = [];
  for (const m of text.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const get = (tag) => { const r = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return r ? xmlText(r[1]) : undefined; };
    const wp = get('criptico:wordplay');
    items.push({
      id: get('guid') || get('link'), url: get('link'), clue: get('criptico:clue') || get('title'), answer: get('criptico:answer'),
      definition: get('criptico:definition'), explanation: get('criptico:explanation') || get('description'),
      wordplay: wp ? parseJson(wp, undefined) : undefined, language: get('criptico:language'), variant: get('criptico:variant'),
      category: get('criptico:category'), difficulty: get('criptico:difficulty'), mechanism: get('criptico:mechanism'),
    });
  }
  return items;
}

function parseFeed(method, text) {
  if (method === 'csv') {
    return parseCsv(text).map((r) => ({ ...r, wordplay: r.wordplay ? parseJson(r.wordplay, undefined) : undefined }));
  }
  if (method === 'rss') return parseRss(text);
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  throw new Error('formato_no_reconocido');
}

// ── Acceso HTTP respetuoso ──

async function robotsAllows(url, fetchImpl) {
  try {
    const u = new URL(url);
    const res = await fetchImpl(`${u.origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return true;
    const txt = await res.text();
    let applies = false; const disallow = [];
    for (const line of txt.split(/\r?\n/)) {
      const [k, ...rest] = line.split(':'); const v = rest.join(':').trim();
      if (/^user-agent$/i.test(k.trim())) applies = v === '*' || /criptabot/i.test(v);
      else if (applies && /^disallow$/i.test(k.trim()) && v) disallow.push(v);
    }
    return !disallow.some((p) => u.pathname.startsWith(p));
  } catch {
    return true;
  }
}

async function fetchSource(source, { fetchImpl = fetch, env = process.env, attempts = 3, backoffMs = 400 } = {}) {
  if (!ALLOWED_METHODS.has(source.access_method) || source.access_method === 'manual_upload') {
    throw Object.assign(new Error('metodo_no_descargable'), { permanent: true });
  }
  if (source.access_method !== 'api' && !(await robotsAllows(source.url, fetchImpl))) {
    throw Object.assign(new Error('robots_txt_prohibe_el_acceso'), { permanent: true });
  }
  const headers = { 'user-agent': USER_AGENT, accept: 'application/json, application/rss+xml, text/csv, */*;q=0.5' };
  if (source.auth_env_var) {
    const token = env[source.auth_env_var];
    if (!token) throw Object.assign(new Error(`falta_credencial:${source.auth_env_var}`), { permanent: true });
    headers.authorization = `Bearer ${token}`;
  }
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchImpl(source.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (res.status === 401 || res.status === 403) {
        // Sin permiso: no se reintenta ni se intenta eludir.
        throw Object.assign(new Error(`acceso_denegado_http_${res.status}`), { permanent: true, httpStatus: res.status });
      }
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get('retry-after')) || 3600;
        throw Object.assign(new Error(`limite_de_solicitudes_http_${res.status}`), { retryAfter, httpStatus: res.status, permanent: true });
      }
      if (!res.ok) throw Object.assign(new Error(`http_${res.status}`), { httpStatus: res.status });
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) throw Object.assign(new Error('respuesta_demasiado_grande'), { permanent: true });
      const text = await res.text();
      if (text.length > MAX_BYTES) throw Object.assign(new Error('respuesta_demasiado_grande'), { permanent: true });
      return { text, httpStatus: res.status, attempt: i };
    } catch (e) {
      lastErr = e;
      if (e.permanent || i === attempts) break;
      await new Promise((r) => setTimeout(r, backoffMs * 2 ** (i - 1)));
    }
  }
  throw lastErr;
}

// ── Condiciones de publicación automática ──

function sameSite(a, b) {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, ''); const hb = new URL(b).hostname.replace(/^www\./, '');
    return ha === hb || ha.endsWith('.' + hb) || hb.endsWith('.' + ha);
  } catch { return false; }
}

function conditionChecks({ source, license, item, report, duplicates, allowAsserted }) {
  const c = [];
  const add = (ok, code, okMsg, failMsg) => c.push({ level: ok ? 'ok' : 'error', code, msg: ok ? okMsg : failMsg });
  add(source.status === 'active', 'source_enabled', 'La fuente está habilitada.', 'La fuente no está habilitada.');
  add(!!source.admin_approved_by, 'source_admin_approved', 'Un administrador revisó y aprobó la fuente.', 'La fuente no fue aprobada por un administrador.');
  add(!!(license && license.allows_republish && source.republish_allowed && source.content_type === 'clues'), 'license_allows_republish',
    'La licencia o el permiso permiten republicar el contenido.', 'No hay licencia ni permiso que permita republicar.');
  add(!!source.access_authorized && ALLOWED_METHODS.has(source.access_method), 'access_method_authorized',
    'El método de obtención está autorizado.', 'El método de obtención no está autorizado.');
  const needsAttribution = source.attribution_required || (license && license.requires_attribution);
  add(!needsAttribution || !!(source.attribution_text && source.attribution_text.trim()), 'attribution_ok',
    'Se cumplen las condiciones de atribución.', 'Falta el texto de atribución exigido.');
  add(report.errors === 0, 'no_critical_errors', 'La pista, la respuesta y la explicación no tienen errores críticos.', 'Hay errores críticos en la pista, la respuesta o la explicación.');
  add(report.errors === 0 && (report.status === 'verified' || allowAsserted), 'validation_passed', 'Supera las validaciones automáticas.',
    report.errors ? 'No supera las validaciones automáticas.' : 'Tiene afirmaciones semánticas sin comprobar: requiere revisión humana.');
  const lang = N.baseLang(item.language || source.language_code);
  const variantOk = !item.variant || String(item.variant).startsWith(lang + '-') || item.variant === lang;
  add(lang === source.language_code && variantOk && !!N.enumerationInClue(item.clue || ''), 'language_format_ok',
    'Idioma, región y formato correctos.', 'El idioma, la región o el formato no coinciden con la fuente.');
  add(!duplicates.length, 'not_duplicate', 'No hay duplicados.', 'Hay un críptico igual o muy parecido en el catálogo.');
  add(!!(item.url && sameSite(item.url, source.url)), 'provenance_verifiable', 'La procedencia es verificable (URL de origen en el dominio de la fuente).',
    'La procedencia no es verificable: falta la URL de origen o no pertenece al dominio de la fuente.');
  const unsafe = report.checks.some((x) => x.code === 'unsafe_content');
  add(!unsafe, 'integrity_ok', 'No hay problemas de seguridad ni de integridad.', 'El contenido incluye HTML, enlaces o caracteres no permitidos.');
  return c;
}

// Normaliza un elemento recibido al formato interno.
function normalizeItem(raw) {
  return {
    id: raw.id != null ? String(raw.id).slice(0, 200) : undefined,
    url: raw.url || raw.link || undefined,
    clue: raw.clue ?? raw.clue_text,
    answer: raw.answer,
    definition: raw.definition || undefined,
    wordplay: raw.wordplay && typeof raw.wordplay === 'object' ? raw.wordplay : undefined,
    explanation: Array.isArray(raw.explanation) ? raw.explanation.join('\n') : raw.explanation,
    language: raw.language || raw.language_code,
    variant: raw.variant || raw.variant_code || undefined,
    category: raw.category, difficulty: raw.difficulty ? Number(raw.difficulty) : undefined,
    mechanism: raw.mechanism, proper_noun: raw.proper_noun === true || raw.proper_noun === 'true',
  };
}

async function processItem(db, { source, license, runId, raw, settings }) {
  const item = normalizeItem(raw);
  const externalId = item.id || sha256(`${item.clue}|${item.answer}`);
  if (await db.get('SELECT 1 FROM import_items WHERE source_id = ? AND external_id = ?', [source.id, externalId])) {
    return 'already_imported';
  }
  const itemId = uuid();
  const save = async (status, checks, extra = {}, payload = item) => {
    await db.run(`INSERT INTO import_items(id, source_id, run_id, external_id, source_url, payload, status, checks, clue_id, duplicate_of)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [itemId, source.id, runId, externalId, item.url || null, JSON.stringify(payload), status,
      JSON.stringify(checks), extra.clue_id || null, extra.duplicate_of || null]);
  };

  // Sin permiso de republicación: no se guarda ni la pista ni la respuesta, solo la referencia.
  if (source.content_type !== 'clues' || !source.republish_allowed || !(license && license.allows_republish)) {
    await save('discarded', [{ level: 'error', code: 'no_republish_rights', msg: 'La fuente no permite republicar: solo se guarda la referencia.' }],
      {}, { id: item.id || null, url: item.url || null });
    return 'discarded';
  }
  if (!item.clue || !item.answer) {
    await save('error', [{ level: 'error', code: 'missing_fields', msg: 'Faltan la pista o la respuesta.' }]);
    return 'error';
  }
  const { row, report } = await buildClue(db, {
    clue_text: item.clue, answer: item.answer, definition: item.definition, wordplay: item.wordplay, explanation_text: item.explanation,
    language_code: item.language || source.language_code, variant_code: item.variant || source.variant_code || null,
    category: item.category, difficulty: item.difficulty, mechanism: item.mechanism, proper_noun: item.proper_noun,
  });
  const dup = await findDuplicates(db, row, settings.threshold);
  const conditions = conditionChecks({ source, license, item, report, duplicates: dup.matches, allowAsserted: settings.allowAsserted });
  const checks = [...conditions, ...report.checks.map((c) => ({ ...c, code: 'validation:' + c.code }))];

  const exact = dup.matches.find((m) => m.kind === 'exact');
  if (exact) {
    await save('duplicate', checks, { duplicate_of: exact.clue_id });
    return 'duplicate';
  }
  const allPass = conditions.every((c) => c.level === 'ok');
  if (allPass && settings.autopublish) {
    const clue = await insertClue(db, {
      ...row, origin: 'external', status: 'published', source_id: source.id, source_url: item.url,
      license_id: source.license_id, attribution: source.attribution_text || source.name, import_item_id: itemId, imported_at: now(),
      ...externalRights(source, item),
    }, { actorKind: 'importer' });
    await save('auto_published', checks, { clue_id: clue.id });
    return 'published';
  }
  await save('review', checks);
  await recordDuplicateFlags(db, 'import_item', itemId, dup.matches);
  return dup.matches.length ? 'duplicate_review' : 'review';
}

// Procedencia de un críptico externo. Si no se conoce el autor se registra como
// desconocido (NULL, y la interfaz muestra «desconocido»): nunca se inventa un nombre.
function externalRights(source, item) {
  return {
    rights_status: rightsStatusFor(source.license_id),
    author_name: (item.author && String(item.author).trim()) || source.author_name || null, // NULL = desconocido
    source_title: item.title || source.title || source.name,
    source_accessed_at: now(),
  };
}

async function processItems(db, source, runId, rawItems) {
  const license = source.license_id ? await db.get('SELECT * FROM licenses WHERE id = ?', [source.license_id]) : null;
  const settings = {
    autopublish: await getSetting(db, 'publishing.external_autopublish'),
    allowAsserted: await getSetting(db, 'publishing.external_allow_asserted'),
    threshold: await getSetting(db, 'publishing.semantic_duplicate_threshold'),
  };
  const counts = { fetched: rawItems.length, published: 0, queued: 0, duplicates: 0, discarded: 0, errors: 0, skipped: 0 };
  for (const raw of rawItems.slice(0, 2000)) {
    let r;
    try { r = await processItem(db, { source, license, runId, raw, settings }); } catch (e) { r = 'error'; await logError(db, 'import_item', e, { source: source.id }); }
    if (r === 'published') counts.published++;
    else if (r === 'review') counts.queued++;
    else if (r === 'duplicate') counts.duplicates++;
    else if (r === 'duplicate_review') { counts.duplicates++; counts.queued++; }
    else if (r === 'discarded') counts.discarded++;
    else if (r === 'already_imported') counts.skipped++;
    else counts.errors++;
  }
  return counts;
}

// Ejecuta una sincronización completa de una fuente y deja registro.
async function runSource(db, sourceId, opts = {}) {
  const source = await db.get('SELECT * FROM sources WHERE id = ?', [sourceId]);
  if (!source) throw new HttpError(404, 'not_found');
  if (!opts.force && !['active', 'error'].includes(source.status)) throw new HttpError(409, 'source_not_active', 'La fuente no está activa.');
  const runId = uuid();
  const started = now();
  await db.run("INSERT INTO import_runs(id, source_id, started_at, status) VALUES (?,?,?,'running')", [runId, source.id, started]);
  try {
    const { text, httpStatus, attempt } = opts.text !== undefined
      ? { text: opts.text, httpStatus: null, attempt: 1 }
      : await fetchSource(source, opts);
    const items = parseFeed(source.access_method === 'manual_upload' ? (opts.format || 'json_feed') : source.access_method, text);
    const counts = await processItems(db, source, runId, items);
    const status = counts.errors ? 'partial' : 'success';
    await db.run(`UPDATE import_runs SET finished_at = ?, status = ?, http_status = ?, fetched = ?, published = ?, queued = ?, duplicates = ?, discarded = ?, attempt = ? WHERE id = ?`,
      [now(), status, httpStatus, counts.fetched, counts.published, counts.queued, counts.duplicates, counts.discarded, attempt, runId]);
    await db.run(`UPDATE sources SET last_checked_at = ?, last_success_at = ?, consecutive_failures = 0, last_error = NULL,
      items_imported = items_imported + ?, next_run_at = ?, status = CASE WHEN status = 'error' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?`,
    [now(), now(), counts.published + counts.queued, new Date(Date.now() + source.frequency_minutes * 60000).toISOString(), now(), source.id]);
    return { run_id: runId, status, ...counts };
  } catch (e) {
    const failures = source.consecutive_failures + 1;
    const delayMin = e.retryAfter ? Math.ceil(e.retryAfter / 60) : Math.min(source.frequency_minutes * 2 ** (failures - 1), 7 * 1440);
    await db.run('UPDATE import_runs SET finished_at = ?, status = ?, http_status = ?, error = ? WHERE id = ?',
      [now(), 'failed', e.httpStatus || null, String(e.message).slice(0, 500), runId]);
    await db.run(`UPDATE sources SET last_checked_at = ?, consecutive_failures = ?, last_error = ?, next_run_at = ?,
      status = CASE WHEN ? >= 5 OR ? THEN 'error' ELSE status END, updated_at = ? WHERE id = ?`,
    [now(), failures, String(e.message).slice(0, 500), new Date(Date.now() + delayMin * 60000).toISOString(), failures, e.permanent && !e.retryAfter ? 1 : 0, now(), source.id]);
    await logError(db, 'import', e, { source: source.id });
    return { run_id: runId, status: 'failed', error: e.message };
  }
}

// Publicación manual desde la cola de revisión de importaciones.
async function publishImportItem(db, itemId, actor, overrides = {}) {
  const it = await db.get('SELECT * FROM import_items WHERE id = ?', [itemId]);
  if (!it) throw new HttpError(404, 'not_found');
  if (it.status !== 'review') throw new HttpError(409, 'not_in_review');
  const source = await db.get('SELECT * FROM sources WHERE id = ?', [it.source_id]);
  const item = { ...parseJson(it.payload, {}), ...overrides };
  const { row, report } = await buildClue(db, {
    clue_text: item.clue, answer: item.answer, definition: item.definition, wordplay: item.wordplay, explanation_text: item.explanation,
    language_code: item.language || source.language_code, variant_code: item.variant || source.variant_code || null,
    category: item.category, difficulty: item.difficulty, mechanism: item.mechanism, proper_noun: item.proper_noun,
  });
  if (report.errors) throw new HttpError(422, 'publish_blocked_validation', 'El elemento tiene errores críticos.', { checks: report.checks });
  const dup = await findDuplicates(db, row);
  if (dup.matches.some((m) => m.kind === 'exact')) throw new HttpError(409, 'duplicate');
  let clue;
  try {
    clue = await insertClue(db, {
      ...row, origin: 'external', status: 'published', source_id: source.id, source_url: item.url, license_id: source.license_id,
      attribution: source.attribution_text || source.name, import_item_id: it.id, imported_at: it.imported_at,
      ...externalRights(source, item),
    }, { actorKind: 'admin', actorId: actor.id });
  } catch (e) {
    if (/publish_blocked: rights/.test(e.message)) throw new HttpError(422, 'publish_blocked_rights', 'La fuente no tiene permiso de republicación aprobado.');
    throw e;
  }
  await db.run('UPDATE import_items SET status = ?, clue_id = ?, payload = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
    ['published', clue.id, JSON.stringify(item), actor.id, now(), it.id]);
  return { clue_id: clue.id };
}

async function discardImportItem(db, itemId, actor) {
  const r = await db.run("UPDATE import_items SET status = 'discarded', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status IN ('review','error','duplicate')",
    [actor.id, now(), itemId]);
  if (!r.changes) throw new HttpError(409, 'not_discardable');
}

module.exports = { runSource, processItems, parseFeed, parseCsv, parseRss, fetchSource, conditionChecks, publishImportItem, discardImportItem, robotsAllows, USER_AGENT };
