'use strict';

// Circuito B: propuestas de usuarios. Siempre requieren aprobación manual.
// Ninguna reputación, antigüedad ni cantidad de aportes habilita publicación automática:
// el código no tiene ese camino, y la base lo bloquea con un trigger.

const N = require('../lib/normalize');
const { buildClue, insertClue, setClueStatus } = require('./clues');
const { findDuplicates, recordDuplicateFlags } = require('./dedupe');
const { getSetting } = require('./settings');
const { uuid, now, sha256, randomToken, parseJson, HttpError } = require('./util');

const STATUSES = ['pending', 'in_review', 'needs_changes', 'approved', 'published', 'rejected'];
const TRANSITIONS = {
  pending: ['in_review', 'needs_changes', 'approved', 'rejected'],
  in_review: ['needs_changes', 'approved', 'rejected'],
  needs_changes: ['pending', 'in_review', 'rejected'],
  approved: ['published', 'in_review', 'rejected'],
  published: [],
  rejected: [],
};

// Señales de posibles problemas de derechos de autor.
const RIGHTS_PATTERNS = [/©/, /\(c\)\s*\d{4}/i, /copyright/i, /todos los derechos/i, /all rights reserved/i,
  /\b(the times|the guardian|telegraph|financial times|el país|la nación|clarín|new york times)\b/i];

function spamScore(fields) {
  const text = Object.values(fields).filter(Boolean).join(' ');
  let score = 0;
  if (/https?:\/\/|www\./i.test(text)) score += 3;
  if (/(.)\1{6,}/.test(text)) score += 2;
  if (/\b(viagra|casino|crypto|bitcoin|forex|seo|backlink|apuestas)\b/i.test(text)) score += 3;
  if ((text.match(/[A-ZÁÉÍÓÚÑ]/g) || []).length > text.length * 0.7 && text.length > 40) score += 1;
  return score;
}

function cleanText(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

async function automaticChecks(db, sub) {
  const checks = [];
  const { row, report } = await buildClue(db, {
    clue_text: sub.clue_text, answer: sub.answer, definition: sub.definition, wordplay: parseJson(sub.wordplay, null),
    explanation_text: sub.explanation, language_code: sub.language_code, variant_code: sub.variant_code,
    category: sub.category, difficulty: sub.difficulty, mechanism: sub.mechanism,
  });
  checks.push(...report.checks);
  const dup = await findDuplicates(db, { ...row }, await getSetting(db, 'publishing.semantic_duplicate_threshold'));
  for (const m of dup.matches) {
    checks.push({ level: m.kind === 'exact' ? 'error' : 'warning', code: m.kind === 'exact' ? 'duplicate_exact' : 'duplicate_semantic',
      msg: m.kind === 'exact' ? 'Ya existe un críptico idéntico en el catálogo.' : `Se parece a un críptico existente (similitud ${m.similarity}).`, params: { clue_id: m.clue_id } });
  }
  const all = [sub.clue_text, sub.explanation, sub.reference || ''].join(' ');
  if (RIGHTS_PATTERNS.some((r) => r.test(all))) {
    checks.push({ level: 'warning', code: 'rights_signal', msg: 'El texto menciona derechos de autor o una publicación conocida: verificá que el contenido sea original.' });
  }
  const spam = spamScore({ a: sub.clue_text, b: sub.explanation, c: sub.public_name, d: sub.reference });
  if (spam >= 3) checks.push({ level: 'error', code: 'spam', msg: 'El envío parece spam.' });
  return { checks, row, report, duplicates: dup.matches };
}

async function createSubmission(db, input, { userId, ipHash }) {
  const sub = {
    clue_text: cleanText(input.clue_text, 300),
    answer: cleanText(input.answer, 60),
    explanation: cleanText(input.explanation, 2000),
    definition: cleanText(input.definition, 200) || null,
    mechanism: input.mechanism || null,
    language_code: N.baseLang(input.language_code),
    variant_code: input.variant_code && String(input.variant_code).includes('-') ? input.variant_code : null,
    category: input.category || 'general',
    difficulty: Number(input.difficulty),
    public_name: cleanText(input.public_name, 60) || null,
    reference: cleanText(input.reference, 300) || null,
  };
  const errors = [];
  if (sub.clue_text.length < 5) errors.push('clue_text');
  if (N.answerKey(sub.answer, sub.language_code).length < 2) errors.push('answer');
  if (sub.explanation.length < 10) errors.push('explanation');
  if (!(sub.difficulty >= 1 && sub.difficulty <= 5)) errors.push('difficulty');
  if (input.rights_confirmed !== true) errors.push('rights_confirmed');
  if (input.terms_accepted !== true) errors.push('terms_accepted');
  const lang = await db.get('SELECT code FROM languages WHERE code = ?', [sub.language_code]);
  if (!lang) errors.push('language_code');
  if (sub.variant_code && !(await db.get('SELECT 1 FROM language_variants WHERE code = ? AND language_code = ?', [sub.variant_code, sub.language_code]))) errors.push('variant_code');
  if (sub.mechanism && !(await db.get('SELECT 1 FROM mechanisms WHERE slug = ?', [sub.mechanism]))) errors.push('mechanism');
  if (!(await db.get('SELECT 1 FROM categories WHERE slug = ?', [sub.category]))) errors.push('category');
  if (errors.length) throw new HttpError(400, 'invalid_fields', 'Revisá los campos marcados.', { fields: errors });

  const { checks } = await automaticChecks(db, sub);
  if (checks.some((c) => c.code === 'spam')) throw new HttpError(400, 'spam_detected', 'No pudimos aceptar el envío.');

  const id = uuid();
  const token = randomToken(18);
  await db.run(
    `INSERT INTO submissions(id, tracking_token, user_id, public_name, clue_text, answer, enumeration, explanation, mechanism, definition,
      language_code, variant_code, category, difficulty, reference, rights_confirmed, terms_accepted, status, checks, ip_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,'pending',?,?)`,
    [id, sha256(token), userId || null, sub.public_name, sub.clue_text, sub.answer.toUpperCase(), N.enumerationOf(sub.answer, sub.language_code),
      sub.explanation, sub.mechanism, sub.definition, sub.language_code, sub.variant_code, sub.category, sub.difficulty, sub.reference,
      JSON.stringify(checks), ipHash || null]);
  await db.run('INSERT INTO submission_events(submission_id, to_status, note) VALUES (?,?,?)', [id, 'pending', 'Recibida']);
  return { id, tracking_code: token, status: 'pending' };
}

function publicSubmission(s, events) {
  return {
    id: s.id, status: s.status, clue_text: s.clue_text, answer: s.answer, explanation: s.explanation,
    language_code: s.language_code, variant_code: s.variant_code, category: s.category, difficulty: s.difficulty,
    moderator_note: s.status === 'needs_changes' || s.status === 'rejected' ? s.moderator_note : null,
    created_at: s.created_at, updated_at: s.updated_at,
    history: (events || []).map((e) => ({ status: e.to_status, at: e.created_at })),
  };
}

async function getByTracking(db, token) {
  const s = await db.get('SELECT * FROM submissions WHERE tracking_token = ?', [sha256(String(token || ''))]);
  if (!s) throw new HttpError(404, 'not_found');
  const events = await db.all('SELECT to_status, created_at FROM submission_events WHERE submission_id = ? ORDER BY id', [s.id]);
  return publicSubmission(s, events);
}

// El autor corrige una propuesta a la que se le pidieron cambios; vuelve a "pendiente".
async function resubmit(db, token, input) {
  const s = await db.get('SELECT * FROM submissions WHERE tracking_token = ?', [sha256(String(token || ''))]);
  if (!s) throw new HttpError(404, 'not_found');
  if (s.status !== 'needs_changes') throw new HttpError(409, 'not_editable', 'Solo se pueden editar propuestas con correcciones solicitadas.');
  const merged = {
    ...s,
    clue_text: cleanText(input.clue_text ?? s.clue_text, 300),
    answer: cleanText(input.answer ?? s.answer, 60).toUpperCase(),
    explanation: cleanText(input.explanation ?? s.explanation, 2000),
    definition: input.definition !== undefined ? cleanText(input.definition, 200) || null : s.definition,
  };
  const { checks } = await automaticChecks(db, merged);
  await db.run(`UPDATE submissions SET clue_text = ?, answer = ?, enumeration = ?, explanation = ?, definition = ?, checks = ?,
    status = 'pending', updated_at = ? WHERE id = ?`,
  [merged.clue_text, merged.answer, N.enumerationOf(merged.answer, s.language_code), merged.explanation, merged.definition, JSON.stringify(checks), now(), s.id]);
  await db.run('INSERT INTO submission_events(submission_id, from_status, to_status, note) VALUES (?,?,?,?)', [s.id, s.status, 'pending', 'Corregida por el autor']);
  return { status: 'pending' };
}

async function notify(db, userId, kind, payload) {
  if (!userId) return;
  await db.run('INSERT INTO notifications(user_id, kind, payload) VALUES (?,?,?)', [userId, kind, JSON.stringify(payload)]);
}

// Moderación manual. `actor` debe ser una persona con rol owner o moderator.
async function moderate(db, submissionId, { action, note, wordplay, definition, edits }, actor) {
  if (!actor || !['owner', 'moderator'].includes(actor.role)) throw new HttpError(403, 'forbidden');
  const s = await db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  if (!s) throw new HttpError(404, 'not_found');
  const target = { review: 'in_review', request_changes: 'needs_changes', approve: 'approved', reject: 'rejected' }[action];
  if (!target) throw new HttpError(400, 'invalid_action');
  if (!TRANSITIONS[s.status].includes(target) && s.status !== target) {
    throw new HttpError(409, 'invalid_transition', `No se puede pasar de «${s.status}» a «${target}».`);
  }
  if (action === 'request_changes' && !note) throw new HttpError(400, 'note_required', 'Indicá qué hay que corregir.');

  // El moderador puede completar el desglose para que el validador lo compruebe.
  if (wordplay !== undefined || definition !== undefined || edits) {
    const e = edits || {};
    await db.run('UPDATE submissions SET wordplay = ?, definition = ?, clue_text = ?, answer = ?, explanation = ?, mechanism = ?, variant_code = ?, updated_at = ? WHERE id = ?',
      [wordplay !== undefined ? (wordplay ? JSON.stringify(wordplay) : null) : s.wordplay,
        definition !== undefined ? definition : s.definition,
        e.clue_text ?? s.clue_text, (e.answer ?? s.answer).toUpperCase(), e.explanation ?? s.explanation,
        e.mechanism ?? s.mechanism, e.variant_code !== undefined ? e.variant_code : s.variant_code, now(), s.id]);
  }
  const fresh = await db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  const { checks, row, duplicates } = await automaticChecks(db, fresh);
  await db.run('UPDATE submissions SET checks = ? WHERE id = ?', [JSON.stringify(checks), s.id]);

  if (target !== 'approved') {
    await db.run('UPDATE submissions SET status = ?, moderator_note = ?, updated_at = ? WHERE id = ?', [target, note || null, now(), s.id]);
    await db.run('INSERT INTO submission_events(submission_id, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?)', [s.id, actor.id, s.status, target, note || null]);
    await notify(db, s.user_id, 'submission_' + target, { submission_id: s.id, note: note || null });
    return { status: target, checks };
  }

  // Aprobación humana registrada…
  await db.run('UPDATE submissions SET status = ?, approved_by = ?, approved_at = ?, moderator_note = ?, updated_at = ? WHERE id = ?',
    ['approved', actor.id, now(), note || null, now(), s.id]);
  await db.run('INSERT INTO submission_events(submission_id, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?)', [s.id, actor.id, s.status, 'approved', note || null]);

  // …y controles finales: con errores críticos no se publica aunque esté aprobada.
  const blocking = checks.filter((c) => c.level === 'error');
  if (blocking.length) {
    await db.run('INSERT INTO submission_events(submission_id, actor_id, from_status, to_status, note) VALUES (?,?,?,?,?)',
      [s.id, actor.id, 'approved', 'approved', 'Publicación bloqueada: ' + blocking.map((c) => c.code).join(', ')]);
    return { status: 'approved', published: false, blocked: blocking, checks };
  }
  const clue = await insertClue(db, {
    ...row, origin: 'community', status: 'draft', submission_id: s.id, author_name: s.public_name || null,
  }, { actorKind: 'admin', actorId: actor.id });
  await recordDuplicateFlags(db, 'clue', clue.id, duplicates.filter((d) => d.kind === 'semantic'));
  await setClueStatus(db, clue.id, 'published', { actorKind: 'admin', actorId: actor.id });
  await db.run('UPDATE submissions SET status = ?, clue_id = ?, updated_at = ? WHERE id = ?', ['published', clue.id, now(), s.id]);
  await db.run('INSERT INTO submission_events(submission_id, actor_id, from_status, to_status) VALUES (?,?,?,?)', [s.id, actor.id, 'approved', 'published']);
  await notify(db, s.user_id, 'submission_published', { submission_id: s.id, clue_slug: clue.slug });
  return { status: 'published', published: true, clue_id: clue.id, checks };
}

// Reintenta publicar una propuesta aprobada cuyo bloqueo ya se resolvió.
async function publishApproved(db, submissionId, actor) {
  const s = await db.get('SELECT * FROM submissions WHERE id = ?', [submissionId]);
  if (!s) throw new HttpError(404, 'not_found');
  if (s.status !== 'approved') throw new HttpError(409, 'not_approved');
  return moderate(db, submissionId, { action: 'approve', note: s.moderator_note }, actor);
}

module.exports = { createSubmission, getByTracking, resubmit, moderate, publishApproved, STATUSES, TRANSITIONS, spamScore };
