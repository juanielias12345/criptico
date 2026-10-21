'use strict';

const N = require('../lib/normalize');
const { validateClue } = require('../lib/validator');
const { fingerprint, findDuplicates } = require('./dedupe');
const { CATEGORY_ALIASES } = require('../db/reference');
const { uuid, now, parseJson, HttpError } = require('./util');

const MECHANISM_SLUGS = new Set(['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone',
  'double_definition', 'initials', 'cryptic_definition', 'combination']);

async function variantPhonetics(db, lang) {
  const rows = await db.all('SELECT code, phonetics FROM language_variants WHERE language_code = ? AND enabled = 1', [lang]);
  const table = { [lang]: null };
  for (const r of rows) table[r.code] = parseJson(r.phonetics, []);
  return table;
}

function normalizeCategory(c) {
  if (!c) return 'general';
  const s = N.slugify(c).replace(/-/g, '_');
  return CATEGORY_ALIASES[s] || s;
}

// Valida un críptico y arma la fila lista para guardar (sin decidir el estado).
async function buildClue(db, input) {
  const lang = N.baseLang(input.language_code || input.language);
  const variant = input.variant_code || input.variant || null;
  const report = validateClue({ ...input, language_code: lang, variant_code: variant }, { phonetics: await variantPhonetics(db, lang) });
  const answer = String(input.answer || '').trim().toUpperCase();
  const mechanism = MECHANISM_SLUGS.has(input.mechanism) ? input.mechanism
    : report.mechanisms.length > 1 ? 'combination' : (report.mechanisms[0] || 'cryptic_definition');
  const explanation = report.explanation
    || (input.explanation_text ? String(input.explanation_text).split(/\n+/).map((s) => s.trim()).filter(Boolean) : []);
  if (!explanation.length) report.checks.push({ level: 'error', code: 'explanation_missing', msg: 'Falta la explicación de la solución.' });
  const errors = report.checks.filter((c) => c.level === 'error').length;
  const row = {
    clue_text: String(input.clue_text || input.clue || '').trim(),
    answer,
    answer_key: N.answerKey(answer, lang),
    alt_answers: JSON.stringify((input.alt_answers || []).map((a) => N.answerKey(a, lang))),
    enumeration: N.enumerationOf(answer, lang),
    definition: input.definition || null,
    wordplay: input.wordplay ? JSON.stringify(input.wordplay) : null,
    explanation: JSON.stringify(explanation),
    note: input.note || null,
    language_code: lang,
    variant_code: variant,
    category: normalizeCategory(input.category),
    difficulty: Math.max(1, Math.min(5, Number(input.difficulty) || report.estimatedDifficulty)),
    mechanism,
    proper_noun: input.proper_noun ? 1 : 0,
    validation_status: errors ? 'failed' : report.status,
    validation_errors: errors,
    validation: JSON.stringify({ checks: report.checks, assertions: report.assertions, checked_at: now() }),
  };
  row.fingerprint = fingerprint(lang, row.clue_text, answer);
  return { row, report: { ...report, errors, status: row.validation_status } };
}

async function uniqueSlug(db, base) {
  let slug = N.slugify(base) || 'criptico';
  for (let i = 0; i < 50; i++) {
    const s = i ? `${slug}-${i + 1}` : slug;
    if (!(await db.get('SELECT 1 FROM clues WHERE slug = ?', [s]))) return s;
  }
  return `${slug}-${uuid().slice(0, 8)}`;
}

const CLUE_COLUMNS = ['id', 'slug', 'clue_text', 'answer', 'answer_key', 'alt_answers', 'enumeration', 'definition', 'wordplay',
  'explanation', 'note', 'language_code', 'variant_code', 'category', 'difficulty', 'mechanism', 'origin', 'status',
  'author_name', 'source_id', 'source_url', 'license_id', 'attribution', 'submission_id', 'import_item_id',
  'validation_status', 'validation_errors', 'validation', 'fingerprint', 'proper_noun', 'published_at', 'imported_at'];

async function insertClue(db, row, { actorKind, actorId }) {
  const id = row.id || uuid();
  const full = { ...row, id, slug: row.slug || await uniqueSlug(db, `${row.answer}-${row.language_code}`) };
  if (full.status === 'published' && !full.published_at) full.published_at = now();
  const cols = CLUE_COLUMNS.filter((c) => full[c] !== undefined);
  await db.run(`INSERT INTO clues(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => full[c]));
  await db.run('INSERT INTO clue_events(clue_id, actor_id, actor_kind, action, to_status) VALUES (?,?,?,?,?)',
    [id, actorId || null, actorKind, 'create', full.status]);
  return full;
}

// Cambio de estado. Las reglas duras (validación, aprobación humana, derechos)
// las aplica la base con triggers; acá se traducen a errores comprensibles.
async function setClueStatus(db, clueId, status, { actorKind, actorId }) {
  const clue = await db.get('SELECT id, status, published_at FROM clues WHERE id = ?', [clueId]);
  if (!clue) throw new HttpError(404, 'not_found');
  try {
    await db.run('UPDATE clues SET status = ?, published_at = ?, updated_at = ? WHERE id = ?',
      [status, status === 'published' ? (clue.published_at || now()) : clue.published_at, now(), clueId]);
  } catch (e) {
    const m = String(e.message).match(/publish_blocked: (\w+)/);
    if (m) throw new HttpError(422, 'publish_blocked_' + m[1], publishBlockedMessage(m[1]));
    throw e;
  }
  await db.run('INSERT INTO clue_events(clue_id, actor_id, actor_kind, action, from_status, to_status) VALUES (?,?,?,?,?,?)',
    [clueId, actorId || null, actorKind, 'status', clue.status, status]);
}

function publishBlockedMessage(kind) {
  return {
    validation: 'No se puede publicar: el críptico tiene errores críticos de validación. Corregilos primero.',
    manual_approval_required: 'No se puede publicar: las propuestas de usuarios requieren aprobación manual de un moderador.',
    rights: 'No se puede publicar: la fuente no tiene permiso de republicación aprobado.',
  }[kind] || 'No se puede publicar.';
}

// Edición desde el panel: revalida y, si deja de ser válida, la retira de las partidas.
async function updateClue(db, clueId, changes, { actorId }) {
  const current = await db.get('SELECT * FROM clues WHERE id = ?', [clueId]);
  if (!current) throw new HttpError(404, 'not_found');
  const merged = {
    clue_text: changes.clue_text ?? current.clue_text,
    answer: changes.answer ?? current.answer,
    definition: changes.definition !== undefined ? changes.definition : current.definition,
    wordplay: changes.wordplay !== undefined ? changes.wordplay : parseJson(current.wordplay, null),
    explanation_text: changes.explanation_text,
    note: changes.note !== undefined ? changes.note : current.note,
    language_code: current.language_code,
    variant_code: changes.variant_code !== undefined ? changes.variant_code : current.variant_code,
    category: changes.category ?? current.category,
    difficulty: changes.difficulty ?? current.difficulty,
    mechanism: changes.mechanism ?? current.mechanism,
    proper_noun: changes.proper_noun ?? current.proper_noun,
    alt_answers: changes.alt_answers ?? parseJson(current.alt_answers, []),
  };
  if (!merged.explanation_text && !merged.wordplay) merged.explanation_text = parseJson(current.explanation, []).join('\n');
  const { row, report } = await buildClue(db, merged);
  const dup = await findDuplicates(db, { ...row, excludeId: clueId });
  if (dup.matches.some((m) => m.kind === 'exact')) throw new HttpError(409, 'duplicate', 'Ya existe un críptico idéntico.');
  const nextStatus = current.status === 'published' && row.validation_errors > 0 ? 'review' : current.status;
  const fields = ['clue_text', 'answer', 'answer_key', 'alt_answers', 'enumeration', 'definition', 'wordplay', 'explanation', 'note',
    'variant_code', 'category', 'difficulty', 'mechanism', 'proper_noun', 'validation_status', 'validation_errors', 'validation', 'fingerprint'];
  await db.run(`UPDATE clues SET ${fields.map((f) => `${f} = ?`).join(', ')}, status = ?, updated_at = ? WHERE id = ?`,
    [...fields.map((f) => row[f]), nextStatus, now(), clueId]);
  const diff = {};
  for (const f of fields) if (String(row[f]) !== String(current[f])) diff[f] = { from: current[f], to: row[f] };
  await db.run('INSERT INTO clue_events(clue_id, actor_id, actor_kind, action, from_status, to_status, diff) VALUES (?,?,?,?,?,?,?)',
    [clueId, actorId || null, 'admin', 'edit', current.status, nextStatus, JSON.stringify(diff)]);
  return { report, status: nextStatus };
}

// Vista pública: nunca incluye la respuesta ni el desglose.
function publicClue(c) {
  return {
    id: c.id, slug: c.slug, clue: c.clue_text, enumeration: c.enumeration, language: c.language_code,
    variant: c.variant_code, category: c.category, difficulty: c.difficulty, mechanism: c.mechanism,
    origin: c.origin, author: c.author_name || null, attribution: c.attribution || null,
    source_url: c.origin === 'external' ? c.source_url : null, published_at: c.published_at,
  };
}

function solutionView(c) {
  return {
    answer: c.answer, definition: c.definition, explanation: parseJson(c.explanation, []), note: c.note,
    mechanism: c.mechanism,
  };
}

module.exports = { buildClue, insertClue, setClueStatus, updateClue, publicClue, solutionView, uniqueSlug, normalizeCategory, variantPhonetics, publishBlockedMessage };
