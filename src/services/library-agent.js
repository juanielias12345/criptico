'use strict';

// Agente Autónomo de Biblioteca (ver docs/AGENTE.md).
//
// Cada día (zona horaria del proyecto) intenta sumar crípticos nuevos aprobados
// a cada variante del español que existe en la base, repartidos en partes
// iguales entre los mecanismos configurados, hasta la meta de biblioteca.
//
// Una ejecución:
//   1. toma el bloqueo global (un solo proceso a la vez) y recupera lotes cortados;
//   2. cierra con su informe los ciclos de días anteriores;
//   3. si falta la clave de la API o el presupuesto, deja el ciclo «bloqueado» y avisa;
//   4. si no, corre lotes por variante: planifica, genera, valida (controles A–F),
//      deduplica, guarda todo en una sola escritura atómica y relee la base;
//   5. ajusta la estrategia o pausa la variante si la calidad cae, y actualiza el informe.
//
// Ningún candidato se aprueba por lo que diga un modelo: la aprobación exige
// pasar todos los controles deterministas y, además, la revisión independiente.

const crypto = require('crypto');
const N = require('../lib/normalize');
const dictionary = require('../lib/lexicon');
const { buildClue, CLUE_COLUMNS, slugBase, variantPhonetics } = require('./clues');
const { jaccard } = require('./dedupe');
const { getSetting } = require('./settings');
const { uuid, now, parseJson, HttpError } = require('./util');
const { audit } = require('./audit');
const alerts = require('./alerts');
const { walk, mechanismsIn } = require('../lib/validator/wordplay');
const LLM = require('../lib/agent/llm');

const VERSION = 'agent-1.0';
const LANG = 'es';
const LEASE_MS = 15 * 60 * 1000;
const SCHEDULE_MINUTE = 7;                     // la GitHub Action corre cada hora a los :07 (UTC)
const STOP = new Set(['EL', 'LA', 'LOS', 'LAS', 'UN', 'UNA', 'DE', 'DEL', 'EN', 'Y', 'QUE', 'CON', 'POR', 'PARA', 'A', 'AL', 'ES', 'SE', 'LO']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const contentWords = (text) => new Set(N.words(N.stripEnumeration(text), LANG).filter((w) => !STOP.has(w)));
const round4 = (x) => Math.round(x * 10000) / 10000;

let bankGen = null;
const gen = () => (bankGen || (bankGen = require('../lib/bank/generate')));
const lex = () => require('../lib/bank/lexicon').load(LANG);

// ───────────── configuración ─────────────
const KEYS = ['daily_target_per_variant', 'library_target_per_variant', 'mechanisms', 'timezone', 'daily_budget_usd', 'variant_budget_usd',
  'batch_size', 'pilot_batch_size', 'chunk_size', 'generator_model', 'reviewer_model', 'generator_effort', 'reviewer_effort', 'prices_usd_per_mtok',
  'max_reject_rate', 'max_duplicate_rate', 'min_approval_rate', 'max_cost_per_approved_usd', 'max_consecutive_failures', 'max_template_share', 'audit_rate'];

async function settings(db) {
  const s = {};
  for (const k of KEYS) s[k] = await getSetting(db, 'agent.' + k);
  s.perAnswer = await getSetting(db, 'bank.max_clues_per_answer');
  s.perAnswerMechanism = await getSetting(db, 'bank.max_per_answer_mechanism');
  s.semantic = await getSetting(db, 'publishing.semantic_duplicate_threshold');
  s.mechanisms = (s.mechanisms || []).filter((m) => LLM.MECHANISM_HELP[m]);
  return s;
}

function dateIn(tz, t = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

// Cuota por mecanismo: partes iguales; el resto se reparte de a uno entre los primeros.
function quotas(target, mechanisms) {
  const out = {};
  const n = mechanisms.length || 1;
  mechanisms.forEach((m, k) => { out[m] = Math.floor(target / n) + (k < target % n ? 1 : 0); });
  return out;
}

// Clase de mecanismo de un árbol: uno solo, o «combination» si mezcla varios.
function mechanismClass(tree) {
  const set = mechanismsIn(tree);
  if (set.size > 1) return 'combination';
  return [...set][0];
}

function nextScheduled(t = Date.now()) {
  const d = new Date(t);
  d.setUTCSeconds(0, 0);
  if (d.getUTCMinutes() >= SCHEDULE_MINUTE) d.setUTCHours(d.getUTCHours() + 1);
  d.setUTCMinutes(SCHEDULE_MINUTE);
  return d.toISOString();
}

// ───────────── variantes reales del proyecto ─────────────
async function syncVariants(db) {
  await db.run(`INSERT OR IGNORE INTO agent_variants(variant_code)
    SELECT v.code FROM language_variants v JOIN languages l ON l.code = v.language_code WHERE v.language_code = ? AND v.enabled = 1 AND l.enabled = 1`, [LANG]);
  return db.all(`SELECT a.*, v.name_native AS name FROM agent_variants a JOIN language_variants v ON v.code = a.variant_code
    JOIN languages l ON l.code = v.language_code WHERE v.language_code = ? AND v.enabled = 1 AND l.enabled = 1 ORDER BY a.variant_code`, [LANG]);
}

// Biblioteca: publicados con esa variante (cualquier origen). Los generales (sin variante) se informan aparte.
async function libraryCounts(db) {
  const rows = await db.all("SELECT variant_code AS v, COUNT(*) AS n FROM clues WHERE language_code = ? AND status = 'published' GROUP BY variant_code", [LANG]);
  const out = { general: 0 };
  for (const r of rows) { if (r.v === null) out.general = r.n; else out[r.v] = r.n; }
  return out;
}

// Aprobados del día por variante y mecanismo: registros del agente vigentes (no invalidados).
async function dayCounts(db, cycleId) {
  const rows = await db.all(`SELECT variant_code AS v, mechanism AS m, status, COUNT(*) AS n FROM agent_candidates
    WHERE cycle_id = ? AND invalidated_at IS NULL GROUP BY variant_code, mechanism, status`, [cycleId]);
  const out = {};
  for (const r of rows) {
    const v = out[r.v] || (out[r.v] = { approved: 0, needs_review: 0, rejected: 0, byMechanism: {} });
    v[r.status] += r.n;
    const m = v.byMechanism[r.m || 'unknown'] || (v.byMechanism[r.m || 'unknown'] = { approved: 0, needs_review: 0, rejected: 0 });
    m[r.status] += r.n;
  }
  return out;
}

// ───────────── control administrativo y bloqueo ─────────────
async function control(db) {
  return db.get('SELECT * FROM agent_control WHERE id = 1');
}

async function setControl(db, state, actor, reason) {
  if (!['active', 'paused', 'stopped'].includes(state)) throw new HttpError(400, 'invalid_state');
  await db.run('UPDATE agent_control SET state = ?, reason = ?, updated_by = ?, updated_at = ? WHERE id = 1',
    [state, reason ? String(reason).slice(0, 300) : null, actor ? actor.id : null, now()]);
  if (state === 'stopped') {
    // Detener corta el ciclo de hoy: no sigue hasta que un administrador lo reanude.
    await db.run("UPDATE agent_cycles SET status = 'stopped', blocked_reason = 'detenido por un administrador', last_activity_at = ? WHERE finished_at IS NULL AND status IN ('running','blocked')", [now()]);
  }
  if (state === 'active') {
    await db.run("UPDATE agent_cycles SET status = 'running', blocked_reason = NULL WHERE finished_at IS NULL AND status IN ('stopped','blocked')");
  }
  await audit(db, { actorId: actor ? actor.id : null, action: 'agent.control', targetKind: 'agent', targetId: 'library', details: { state, reason: reason || null } });
}

async function setVariant(db, code, { status, library_target }, actor) {
  const v = await db.get('SELECT * FROM agent_variants WHERE variant_code = ?', [code]);
  if (!v) throw new HttpError(404, 'not_found');
  if (status !== undefined) {
    if (!['active', 'paused'].includes(status)) throw new HttpError(400, 'invalid_status');
    await db.run('UPDATE agent_variants SET status = ?, paused_reason = ?, probation = CASE WHEN ? = \'active\' THEN 1 ELSE probation END, updated_at = ? WHERE variant_code = ?',
      [status, status === 'paused' ? 'pausada por un administrador' : null, status, now(), code]);
  }
  if (library_target !== undefined) {
    const t = library_target === null ? null : Number(library_target);
    if (t !== null && (!Number.isInteger(t) || t < 0 || t > 10000000)) throw new HttpError(400, 'invalid_target');
    await db.run('UPDATE agent_variants SET library_target = ?, updated_at = ? WHERE variant_code = ?', [t, now(), code]);
  }
  await audit(db, { actorId: actor.id, action: 'agent.variant', targetKind: 'variant', targetId: code, details: { status, library_target } });
}

async function acquireLock(db, holder) {
  const t = now(); const until = new Date(Date.now() + LEASE_MS).toISOString();
  const r = await db.run('UPDATE agent_control SET lease_holder = ?, lease_until = ? WHERE id = 1 AND (lease_until IS NULL OR lease_until < ? OR lease_holder = ?)', [holder, until, t, holder]);
  return r.changes === 1;
}
const renewLock = (db, holder) => db.run('UPDATE agent_control SET lease_until = ? WHERE id = 1 AND lease_holder = ?', [new Date(Date.now() + LEASE_MS).toISOString(), holder]);
const releaseLock = (db, holder) => db.run('UPDATE agent_control SET lease_holder = NULL, lease_until = NULL WHERE id = 1 AND lease_holder = ?', [holder]);

// ───────────── ciclos ─────────────
async function ensureCycle(db, date, tz) {
  await db.run('INSERT OR IGNORE INTO agent_cycles(id, cycle_date, timezone) VALUES (?,?,?)', [uuid(), date, tz]);
  return db.get('SELECT * FROM agent_cycles WHERE cycle_date = ?', [date]);
}

// Lotes que quedaron «en curso» de un proceso cortado. La escritura es atómica:
// si hay registros del lote, se guardó entero y se verifica; si no, se abandona.
async function recover(db) {
  const stuck = await db.all("SELECT * FROM agent_batches WHERE status IN ('running','committed')");
  const out = [];
  for (const b of stuck) {
    const n = (await db.get('SELECT COUNT(*) AS n FROM agent_candidates WHERE batch_id = ?', [b.id])).n;
    if (n > 0) { await verifyBatch(db, b.id); out.push({ id: b.id, result: 'verified' }); }
    else {
      await db.run("UPDATE agent_batches SET status = 'abandoned', finished_at = ?, error = COALESCE(error, 'interrumpido antes de guardar') WHERE id = ?", [now(), b.id]);
      out.push({ id: b.id, result: 'abandoned' });
    }
  }
  return out;
}

async function verifyBatch(db, batchId) {
  const b = await db.get('SELECT * FROM agent_batches WHERE id = ?', [batchId]);
  if (!b) return { ok: false };
  const c = await db.get(`SELECT COUNT(*) AS n, SUM(status = 'approved') AS a, SUM(status = 'needs_review') AS r, SUM(status = 'rejected') AS x,
    SUM(clue_id IS NOT NULL) AS linked FROM agent_candidates WHERE batch_id = ?`, [batchId]);
  const clues = (await db.get('SELECT COUNT(*) AS n FROM clues WHERE batch_id = ?', [batchId])).n;
  const ok = c.n > 0 && clues === (c.linked || 0);
  if (ok && b.status !== 'verified' && b.status !== 'suspended') {
    await db.run("UPDATE agent_batches SET status = 'verified', approved = ?, needs_review = ?, rejected = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ?",
      [c.a || 0, c.r || 0, c.x || 0, now(), batchId]);
  }
  return { ok, candidates: c.n, clues };
}

// ───────────── controles deterministas de un candidato ─────────────
let sortedIndex = null;
function anagramIndex(L) {
  if (sortedIndex) return sortedIndex;
  sortedIndex = new Map();
  L.words.forEach((w, i) => {
    if (!L.single(i)) return;
    const k = [...L.key(i)].sort().join('');
    if (!sortedIndex.has(k)) sortedIndex.set(k, []);
    sortedIndex.get(k).push(i);
  });
  return sortedIndex;
}

// Otras respuestas igual de válidas: misma definición en el léxico y mismo material.
function alternatives(L, tree, answerKey, definition) {
  if (!definition) return [];
  const def = String(definition).toLowerCase();
  const alt = new Set();
  walk(tree, (n) => {
    if (n.op === 'anagram' && Array.isArray(n.of) && n.of.every((p) => p.op === 'lit')) {
      const k = [...N.letters(n.of.map((p) => p.text).join(''), LANG)].sort().join('');
      for (const i of anagramIndex(L).get(k) || []) if (L.key(i) !== answerKey && L.supports(L.text(i), def)) alt.add(L.text(i).toUpperCase());
    }
    if (n.op === 'hidden' && n.in) {
      const s = N.letters(n.in, LANG);
      for (let a = 0; a + answerKey.length <= s.length; a++) {
        const sub = s.slice(a, a + answerKey.length);
        if (sub === answerKey) continue;
        for (const i of L.withKey(sub)) if (L.supports(L.text(i), def)) alt.add(L.text(i).toUpperCase());
      }
    }
  });
  return [...alt];
}

// Evidencia léxica independiente: la definición y cada sinónimo figuran en el léxico.
function evidenceFor(L, answerText, definition, tree) {
  const items = [];
  const sup = (w, d) => Boolean(L.supports(String(w).toLowerCase(), String(d).toLowerCase()) || L.supports(String(d).toLowerCase(), String(w).toLowerCase()));
  if (tree && tree.op === 'double') for (const d of tree.definitions || []) items.push({ role: 'definition', word: answerText, def: d, ok: Boolean(L.supports(answerText, String(d).toLowerCase())) });
  else if (definition) items.push({ role: 'definition', word: answerText, def: definition, ok: Boolean(L.supports(answerText, String(definition).toLowerCase())) });
  walk(tree, (n) => { if (n.op === 'syn') items.push({ role: 'piece', word: n.text, def: n.from, ok: sup(n.text, n.from) }); });
  return items;
}

const check = (ok, items) => ({ ok, items });

// Palabras gramaticales e indicadores conocidos: las listas de palabras no las traen todas.
let fnWords = null;
function functionWords() {
  if (fnWords) return fnWords;
  const es = require('../lib/lang/es');
  fnWords = new Set([...STOP, 'Y', 'O', 'E', 'U', 'NI', 'SU', 'SUS', 'MI', 'MIS', 'TU', 'TUS', 'LE', 'LES', 'NOS', 'ME', 'TE', 'MAS', 'SIN', 'SOBRE', 'TRAS', 'ENTRE', 'HASTA', 'DESDE']);
  for (const w of es.linkWords) N.words(w, LANG).forEach((x) => fnWords.add(x));
  for (const list of Object.values(es.indicators)) for (const w of list) N.words(w, LANG).forEach((x) => fnWords.add(x));
  return fnWords;
}

// Controles A, B, C y E (los de duplicación, D, y la revisión final, F, se agregan después).
async function evaluate(db, cand, slot, ctx) {
  const reasons = []; const review = []; const checks = {};
  const L = ctx.L;
  // estructura
  let tree = null;
  try { tree = JSON.parse(cand.wordplay_json); } catch { /* inválido */ }
  if (!tree || typeof tree !== 'object' || !tree.op) {
    checks.A = check(false, ['El desglose del juego de palabras no es un árbol JSON válido.']);
    return { status: 'rejected', checks, reasons: ['structure_invalid'] };
  }
  const answer = slot.answer.toUpperCase();
  const input = { clue_text: cand.clue, answer, definition: tree.op === 'double' ? null : cand.definition, wordplay: tree, language_code: LANG,
    variant_code: ctx.variant.variant_code, difficulty: slot.difficulty, mechanism: undefined, category: slot.category };
  const { row, report } = await buildClue(db, input, { phonetics: ctx.phonetics });

  // A. lógica
  const mech = mechanismClass(tree);
  const A = [];
  const errors = report.checks.filter((c) => c.level === 'error');
  const warnings = report.checks.filter((c) => c.level === 'warning');
  for (const e of errors) { A.push(e.msg); reasons.push(e.code); }
  if (mech !== slot.mechanism) { A.push(`Mecanismo pedido ${slot.mechanism}, el desglose es ${mech}.`); reasons.push('mechanism_not_requested'); }
  const alts = errors.length ? [] : alternatives(L, tree, row.answer_key, input.definition);
  if (alts.length) { A.push(`Otras respuestas igual de válidas: ${alts.join(', ')}.`); review.push('ambiguous_alternatives'); }
  for (const w of warnings) { A.push(w.msg); review.push(w.code); }
  if (errors.length || mech !== slot.mechanism) {
    checks.A = check(false, A);
    return { status: 'rejected', checks, reasons, row, report, tree, mech };
  }
  checks.A = check(A.length === 0, A.length ? A : ['El juego de palabras produce exactamente la respuesta; enumeración, indicadores y abreviaturas válidos; sin otras respuestas en el léxico.']);

  // B. lingüística: palabras del diccionario, definición y sinónimos respaldados por el léxico
  const B = [];
  const unknown = N.words(N.stripEnumeration(row.clue_text), LANG).filter((w) => !dictionary.has(LANG, w) && !functionWords().has(w));
  if (unknown.length) { B.push(`Palabras que no están en el diccionario: ${unknown.join(', ')}.`); review.push('unknown_words'); }
  const ev = evidenceFor(L, slot.answerText, input.definition, tree);
  const bad = ev.filter((e) => !e.ok);
  if (!ev.length || bad.length) { B.push(`Sin respaldo léxico: ${bad.map((e) => `${e.word} → ${e.def}`).join('; ') || 'falta la definición'}.`); review.push('lexicon_evidence_missing'); }
  if (!slot.definitions.includes(String(input.definition || '').toLowerCase()) && tree.op !== 'double') { B.push('La definición no es una de las admitidas para la respuesta.'); review.push('definition_not_offered'); }
  checks.B = check(B.length === 0, B.length ? B : ['Todas las palabras están en el diccionario; la definición y cada sinónimo figuran en el léxico.']);

  // C. regional
  const C = [];
  if (!ctx.variantCodes.has(ctx.variant.variant_code)) { C.push('La variante no existe en el proyecto.'); reasons.push('variant_unknown'); }
  const regional = (cand.regional_words || []).filter(Boolean);
  if (regional.length) { C.push(`Usa regionalismos sin fuente que los respalde: ${regional.join(', ')}.`); review.push('regional_unverified'); }
  checks.C = check(C.length === 0, C.length ? C : ['Sin regionalismos que verificar; homófonos comprobados con la fonética de la variante.']);

  // E. integridad y procedencia
  const E = [];
  if (!row.clue_text || !row.answer || !parseJson(row.explanation, []).length) { E.push('Falta pista, respuesta o explicación.'); reasons.push('incomplete'); }
  if (!row.definition && tree.op !== 'double') { E.push('Falta la definición.'); reasons.push('incomplete'); }
  checks.E = check(E.length === 0, E.length ? E : ['Pista, respuesta, explicación y metadatos completos; contenido original del agente.']);

  if (reasons.length) return { status: 'rejected', checks, reasons, row, report, tree, mech };
  return { status: review.length ? 'needs_review' : 'pass', checks, reasons: review, row, report, tree, mech, evidence: ev };
}

// Estructura de la pista sin su material: detecta plantillas repetidas.
function skeleton(row, tree) {
  const material = new Set();
  const add = (t) => N.words(t || '', LANG).forEach((w) => material.add(w));
  add(row.definition);
  walk(tree, (n) => { add(n.text); add(n.from); add(n.in); (n.definitions || []).forEach(add); });
  return N.words(N.stripEnumeration(row.clue_text), LANG).map((w) => (material.has(w) ? '_' : w)).join(' ');
}

// ───────────── un lote de una variante ─────────────
class Blocked extends Error { constructor(reason, msg) { super(msg || reason); this.reason = reason; } }

async function spend(db, batchId, cycleId, cost, usage) {
  await db.run('UPDATE agent_batches SET cost_usd = cost_usd + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?',
    [cost, usage.input_tokens, usage.output_tokens, batchId]);
  await db.run('UPDATE agent_cycles SET cost_usd = cost_usd + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, last_activity_at = ? WHERE id = ?',
    [cost, usage.input_tokens, usage.output_tokens, now(), cycleId]);
}

async function budgetLeft(db, s, cycleId, variantCode, nVariants) {
  const day = (await db.get('SELECT cost_usd FROM agent_cycles WHERE id = ?', [cycleId])).cost_usd;
  const mine = (await db.get('SELECT COALESCE(SUM(cost_usd), 0) AS c FROM agent_batches WHERE cycle_id = ? AND variant_code = ?', [cycleId, variantCode])).c;
  const perVariant = s.variant_budget_usd > 0 ? s.variant_budget_usd : s.daily_budget_usd / Math.max(1, nVariants);
  return { day: s.daily_budget_usd - day, variant: perVariant - mine };
}

let retryBaseMs = 1000;
async function callWithRetry(fn, attempts = 3) {
  let last;
  for (let k = 0; k < attempts; k++) {
    try { return await fn(); } catch (e) {
      if (e.critical) throw e;
      last = e;
      await sleep(Math.min(8000, retryBaseMs * 2 ** k));
    }
  }
  throw last;
}

// Elige respuestas y arma los pedidos del lote, repartidos entre los mecanismos con faltante.
async function planSlots(db, ctx, deficits, size) {
  const L = ctx.L; const E = gen().engine(LANG);
  const answers = E.answers();
  const mechs = Object.keys(deficits).filter((m) => deficits[m] > 0 && !ctx.disabled.has(m));
  const slots = [];
  if (!mechs.length) return { slots, cursorEnd: ctx.variant.cursor };
  // reparto por turnos: nunca más pedidos de un mecanismo que su faltante
  const want = {}; let left = size;
  while (left > 0 && mechs.some((m) => (want[m] || 0) < deficits[m])) {
    for (const m of mechs) { if (left <= 0) break; if ((want[m] || 0) < deficits[m]) { want[m] = (want[m] || 0) + 1; left--; } }
  }
  const queue = []; for (const m of mechs) for (let k = 0; k < (want[m] || 0); k++) queue.push(m);
  // intercalar mecanismos
  queue.sort((a, b) => mechs.indexOf(a) - mechs.indexOf(b));
  const order = []; const byM = {}; for (const m of queue) (byM[m] || (byM[m] = [])).push(m);
  while (Object.values(byM).some((x) => x.length)) for (const m of mechs) if (byM[m] && byM[m].length) order.push(byM[m].pop());

  // cada variante recorre la lista desde un punto propio, para no competir por las mismas respuestas
  const offset = crypto.createHash('sha1').update(ctx.variant.variant_code).digest().readUInt32BE(0) % Math.max(1, answers.length);
  let pos = (offset + ctx.variant.cursor) % Math.max(1, answers.length);
  const start = pos; let scanned = 0;
  const usage = new Map();
  while (slots.length < order.length && scanned < answers.length) {
    const batch = [];
    while (batch.length < 60 && scanned < answers.length) { batch.push(answers[pos]); pos = (pos + 1) % answers.length; scanned++; }
    const keys = batch.map((i) => L.key(i));
    for (const part of chunk(keys, 150)) {
      // los jugadores de una variante ven sus crípticos y los generales: el tope de usos se cuenta ahí
      const rows = await db.all(`SELECT answer_key, COUNT(*) AS n FROM clues WHERE language_code = ? AND (variant_code = ? OR variant_code IS NULL)
        AND answer_key IN (${part.map(() => '?').join(',')}) GROUP BY answer_key`, [LANG, ctx.variant.variant_code, ...part]);
      for (const r of rows) usage.set(r.answer_key, r.n);
    }
    for (const i of batch) {
      if (slots.length >= order.length) break;
      if ((usage.get(L.key(i)) || 0) >= ctx.s.perAnswer) continue;
      const defs = L.definitions(i).filter((d) => d.text.split(' ').length <= 3).slice(0, 4).map((d) => d.text);
      if (!defs.length) continue;
      const k = slots.length;
      const mechanism = order[k];
      const text = L.text(i);
      const sense = L.synsets[L.senses(i)[0]];
      slots.push({ slot: k + 1, answerText: text, answer: text.toUpperCase(), enumeration: N.enumerationOf(text.toUpperCase(), LANG), mechanism,
        difficulty: ((ctx.variant.cursor + k) % 5) + 1, definitions: defs, category: (sense && gen().CATEGORY_BY_LEX[sense.x]) || 'general' });
      usage.set(L.key(i), (usage.get(L.key(i)) || 0) + 1);
    }
  }
  return { slots, cursorStart: start, cursorEnd: ctx.variant.cursor + scanned, exhausted: scanned >= answers.length && slots.length < order.length };
}

async function runVariantBatch(db, ctx) {
  const { s, cycle, variant, llm, holder, log } = ctx;
  const started = Date.now();
  const target = s.daily_target_per_variant;
  const q = quotas(target, s.mechanisms);
  const counts = (await dayCounts(db, cycle.id))[variant.variant_code] || { approved: 0, byMechanism: {} };
  const deficits = {};
  for (const m of s.mechanisms) deficits[m] = Math.max(0, q[m] - ((counts.byMechanism[m] || {}).approved || 0));
  const lib = (await libraryCounts(db))[variant.variant_code] || 0;
  const libTarget = variant.library_target ?? s.library_target_per_variant;
  if (lib >= libTarget) {
    await db.run("UPDATE agent_variants SET status = 'maintenance', paused_reason = 'meta de biblioteca alcanzada', updated_at = ? WHERE variant_code = ?", [now(), variant.variant_code]);
    return { variant: variant.variant_code, maintenance: true };
  }
  const totalDeficit = Math.min(Object.values(deficits).reduce((a, b) => a + b, 0), libTarget - lib);
  if (totalDeficit <= 0) return { variant: variant.variant_code, done: true };

  const kind = !variant.pilot_done ? 'pilot' : variant.probation ? 'probation' : 'normal';
  const size = Math.min(kind === 'normal' ? s.batch_size : s.pilot_batch_size, totalDeficit);
  // mecanismos que hoy fallan casi siempre en esta variante: no se insiste de la misma forma
  // (pedidos del día que el generador salteó por no salir naturales o que fueron rechazados)
  ctx.disabled = new Set();
  const asked = {}; const skipped = {};
  for (const r of await db.all('SELECT details FROM agent_batches WHERE cycle_id = ? AND variant_code = ?', [cycle.id, variant.variant_code])) {
    const j = parseJson(r.details, {});
    for (const [m, n] of Object.entries(j.requested_by_mechanism || {})) asked[m] = (asked[m] || 0) + n;
    for (const [m, n] of Object.entries(j.skipped_by_mechanism || {})) skipped[m] = (skipped[m] || 0) + n;
  }
  for (const m of s.mechanisms) {
    const c = counts.byMechanism[m] || { approved: 0, needs_review: 0, rejected: 0 };
    const req = asked[m] || 0;
    if (req >= 15 && c.approved === 0 && ((skipped[m] || 0) + c.rejected) / req > 0.8) ctx.disabled.add(m);
  }
  const plan = await planSlots(db, ctx, deficits, size);
  if (!plan.slots.length) return { variant: variant.variant_code, exhausted: true, disabled: [...ctx.disabled] };

  const seq = ((await db.get('SELECT MAX(seq) AS m FROM agent_batches WHERE cycle_id = ? AND variant_code = ?', [cycle.id, variant.variant_code])).m || 0) + 1;
  const batchId = uuid();
  await db.run(`INSERT INTO agent_batches(id, cycle_id, variant_code, seq, kind, holder, generator_version, generator_model, reviewer_model, requested, cursor_start)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [batchId, cycle.id, variant.variant_code, seq, kind, holder, VERSION, s.generator_model, s.reviewer_model, plan.slots.length, variant.cursor]);
  const det = { kind, deficits, disabled_mechanisms: [...ctx.disabled], reasons: {}, models_served: {}, llm_stops: {}, prompt_version: LLM.PROMPT_VERSION,
    requested_by_mechanism: {}, skipped_by_mechanism: {} };
  for (const x of plan.slots) det.requested_by_mechanism[x.mechanism] = (det.requested_by_mechanism[x.mechanism] || 0) + 1;
  const bump = (k) => { det.reasons[k] = (det.reasons[k] || 0) + 1; };

  try {
    const L = ctx.L;
    const langData = require('../lib/lang/es');
    const indicators = {};
    const IND = { anagram: ['anagram'], hidden: ['hidden'], reversal: ['reversal'], container: ['container', 'insertion'], deletion: ['deletion_first', 'deletion_last', 'deletion_letter'],
      homophone: ['homophone'], initials: ['initials'], charade: ['charade'], combination: ['reversal', 'anagram', 'container', 'insertion', 'deletion_first', 'deletion_last', 'charade'] };
    for (const m of new Set(plan.slots.map((x) => x.mechanism))) for (const k of IND[m] || []) indicators[k] = langData.indicators[k];

    // 1) generación por partes, con control de presupuesto antes de cada llamada
    const proposals = [];
    let servedGenerator = null;
    for (const part of chunk(plan.slots, Math.max(1, s.chunk_size))) {
      const user = LLM.generatorUser({ variant: { code: variant.variant_code, name: variant.name }, slots: part, indicators, abbreviations: langData.abbreviations });
      const maxTokens = 16000;
      const est = LLM.maxCostOf(s.prices_usd_per_mtok, s.generator_model, Math.ceil((user.length + 3000) / 3), maxTokens);
      if (est === null) throw new Blocked('price_missing', `Sin precio configurado para ${s.generator_model}`);
      const left = await budgetLeft(db, s, cycle.id, variant.variant_code, ctx.nVariants);
      if (left.day < est) throw new Blocked('budget_exhausted', 'Presupuesto diario agotado');
      if (left.variant < est) throw new Blocked('variant_budget_exhausted', 'Presupuesto de la variante agotado');
      const r = await callWithRetry(() => llm.json({ model: s.generator_model, system: LLM.generatorSystem(), user, schema: LLM.GENERATOR_SCHEMA, maxTokens, effort: s.generator_effort }));
      const cost = LLM.costOf(s.prices_usd_per_mtok, r.model, r.usage);
      if (cost === null) throw new Blocked('price_missing', `Respondió ${r.model}, que no tiene precio configurado`);
      await spend(db, batchId, cycle.id, cost, r.usage);
      servedGenerator = r.model; det.models_served[r.model] = (det.models_served[r.model] || 0) + 1;
      if (!r.data) { det.llm_stops[r.stop] = (det.llm_stops[r.stop] || 0) + 1; continue; }
      const perSlot = cost / part.length;
      const answered = new Set((r.data.candidates || []).map((c) => c.slot));
      for (const x of part) if (!answered.has(x.slot)) { bump('slot_unanswered'); det.skipped_by_mechanism[x.mechanism] = (det.skipped_by_mechanism[x.mechanism] || 0) + 1; }
      for (const c of r.data.candidates || []) {
        const slot = part.find((x) => x.slot === c.slot);
        if (!slot || c.skip) {
          if (slot) { bump('skipped_unnatural'); det.skipped_by_mechanism[slot.mechanism] = (det.skipped_by_mechanism[slot.mechanism] || 0) + 1; }
          continue;
        }
        proposals.push({ c, slot, cost: perSlot, model: r.model });
      }
      await renewLock(db, holder);
    }

    // 2) controles deterministas A, B, C, E
    const evaluated = [];
    for (const p of proposals) evaluated.push({ ...p, ev: await evaluate(db, p.c, p.slot, ctx) });

    // 3) D. duplicados: exactos, de juego de palabras, semánticos, sobreuso y plantillas
    const live = evaluated.filter((x) => x.ev.status !== 'rejected');
    const keys = [...new Set(live.map((x) => x.ev.row.answer_key))];
    const prior = new Map();
    for (const part of chunk(keys, 150)) {
      const rows = await db.all(`SELECT answer_key, mechanism, clue_text, dedup_key, fingerprint FROM clues WHERE language_code = ? AND (variant_code = ? OR variant_code IS NULL)
        AND answer_key IN (${part.map(() => '?').join(',')})`, [LANG, variant.variant_code, ...part]);
      for (const r of rows) (prior.get(r.answer_key) || prior.set(r.answer_key, []).get(r.answer_key)).push(r);
    }
    const fps = new Set();
    for (const part of chunk(live.map((x) => x.ev.row.fingerprint), 150)) {
      (await db.all(`SELECT fingerprint FROM clues WHERE fingerprint IN (${part.map(() => '?').join(',')})`, part)).forEach((r) => fps.add(r.fingerprint));
    }
    // el mismo juego de palabras no se repite en ninguna variante (índice único en la base)
    const dedupKeys = new Set();
    const E0 = gen().engine(LANG);
    const wanted = live.map((x) => E0.dedupKey(x.ev.row.answer_key, x.ev.mech, x.ev.tree));
    for (const part of chunk(wanted, 150)) {
      (await db.all(`SELECT dedup_key FROM clues WHERE dedup_key IN (${part.map(() => '?').join(',')})`, part)).forEach((r) => dedupKeys.add(r.dedup_key));
    }
    const templCap = Math.max(5, Math.ceil(target * s.max_template_share));
    const templToday = new Map();
    for (const r of await db.all("SELECT details FROM agent_batches WHERE cycle_id = ? AND variant_code = ? AND status = 'verified'", [cycle.id, variant.variant_code])) {
      for (const [k, n] of Object.entries(parseJson(r.details, {}).templates || {})) templToday.set(k, (templToday.get(k) || 0) + n);
    }
    det.templates = {};
    const E = gen().engine(LANG);
    const mine = [];
    let duplicates = 0;
    for (const x of evaluated) {
      if (x.ev.status === 'rejected') { x.ev.checks.D = check(null, ['No llegó a este control.']); continue; }
      const row = x.ev.row;
      const dedupKey = `${E.dedupKey(row.answer_key, x.ev.mech, x.ev.tree)}`;
      const before = [...(prior.get(row.answer_key) || []), ...mine.filter((m) => m.answer_key === row.answer_key)];
      const words = contentWords(row.clue_text);
      const tpl = skeleton(row, x.ev.tree);
      let dup = null;
      if (fps.has(row.fingerprint) || mine.some((m) => m.fingerprint === row.fingerprint)) dup = 'dup_exact';
      else if (dedupKeys.has(dedupKey) || mine.some((m) => m.dedup_key === dedupKey)) dup = 'dup_wordplay';
      else if (before.some((p) => jaccard(words, contentWords(p.clue_text)) >= s.semantic)) dup = 'dup_semantic';
      else if (before.length >= s.perAnswer) dup = 'answer_overused';
      else if (before.filter((p) => p.mechanism === x.ev.mech).length >= s.perAnswerMechanism) dup = 'mechanism_overused';
      else if ((templToday.get(tpl) || 0) + (det.templates[tpl] || 0) >= templCap) dup = 'dup_template';
      if (dup) {
        duplicates++; bump(dup);
        x.ev.status = 'rejected'; x.ev.reasons = [...x.ev.reasons, dup]; x.duplicate = true;
        x.ev.checks.D = check(false, [{ dup_exact: 'Pista idéntica ya existente.', dup_wordplay: 'Mismo juego de palabras ya existente (en esta u otra variante).', dup_semantic: 'Pista casi igual para la misma respuesta.',
          answer_overused: 'La respuesta ya tiene demasiadas pistas.', mechanism_overused: 'La respuesta ya tiene pistas con este mecanismo.', dup_template: 'Plantilla repetida hoy en esta variante.' }[dup]]);
        continue;
      }
      det.templates[tpl] = (det.templates[tpl] || 0) + 1;
      x.dedupKey = dedupKey;
      mine.push({ answer_key: row.answer_key, mechanism: x.ev.mech, clue_text: row.clue_text, dedup_key: dedupKey, fingerprint: row.fingerprint });
      x.ev.checks.D = check(true, ['Sin pista idéntica, juego de palabras repetido, versión casi igual ni plantilla repetida.']);
    }

    // 4) F. evaluación final independiente (otro modelo), solo para lo que pasó todo lo anterior
    const toReview = evaluated.filter((x) => x.ev.status !== 'rejected');
    for (const part of chunk(toReview, 20)) {
      const items = part.map((x, k) => ({ id: String(k + 1), variant: variant.variant_code, variantName: variant.name, clue: x.ev.row.clue_text, answer: x.ev.row.answer,
        definition: x.ev.row.definition, explanation: parseJson(x.ev.row.explanation, []) }));
      const user = LLM.reviewerUser(items);
      const est = LLM.maxCostOf(s.prices_usd_per_mtok, s.reviewer_model, Math.ceil((user.length + 2000) / 3), 8000);
      if (est === null) throw new Blocked('price_missing', `Sin precio configurado para ${s.reviewer_model}`);
      const left = await budgetLeft(db, s, cycle.id, variant.variant_code, ctx.nVariants);
      let r = null;
      if (left.day >= est && left.variant >= est) {
        r = await callWithRetry(() => llm.json({ model: s.reviewer_model, system: LLM.reviewerSystem(), user, schema: LLM.REVIEWER_SCHEMA, maxTokens: 8000, effort: s.reviewer_effort }));
        const cost = LLM.costOf(s.prices_usd_per_mtok, r.model, r.usage);
        if (cost === null) throw new Blocked('price_missing', `Respondió ${r.model}, que no tiene precio configurado`);
        await spend(db, batchId, cycle.id, cost, r.usage);
        part.forEach((x) => { x.cost += cost / part.length; });
        det.models_served[r.model] = (det.models_served[r.model] || 0) + 1;
      }
      part.forEach((x, k) => {
        const rv = r && r.data ? (r.data.reviews || []).find((v) => v.id === String(k + 1)) : null;
        const F = [];
        let ok = false;
        if (!rv) F.push(r ? 'La revisión final no devolvió veredicto.' : 'Sin presupuesto para la revisión final.');
        else if (r.model === x.model) F.push('La revisión final la hizo el mismo modelo que generó la pista: no es independiente.');
        else {
          ok = rv.verdict === 'ok' && rv.solves && rv.fair && rv.natural && rv.variant_ok && !rv.alternative_answer && !rv.copied_suspect;
          F.push(`Revisor ${r.model}: ${rv.verdict}${rv.issues.length ? ' · ' + rv.issues.join('; ') : ''}${rv.alternative_answer ? ' · otra respuesta: ' + rv.alternative_answer : ''}`);
        }
        x.reviewerModel = r ? r.model : null;
        x.ev.checks.F = check(ok, F);
        if (!ok) {
          const bad = rv && (rv.verdict === 'bad' || !rv.solves || rv.copied_suspect);
          x.ev.status = bad ? 'rejected' : 'needs_review';
          x.ev.reasons = [...x.ev.reasons, bad ? 'final_review_rejected' : 'final_review_doubt'];
        } else if (x.ev.status === 'pass') x.ev.status = 'approved';
      });
    }
    for (const x of evaluated) if (!x.ev.checks.F) x.ev.checks.F = check(null, ['No llegó a este control.']);

    // 5) escritura atómica: crípticos + historial + registros auditables + lote + cursor
    const stmts = [];
    const tally = { candidates: evaluated.length, approved: 0, needs_review: 0, rejected: 0, duplicates };
    const approvedIds = [];
    for (const x of evaluated) {
      const st = x.ev.status === 'pass' ? 'needs_review' : x.ev.status;
      tally[st]++;
      for (const r of x.ev.reasons) if (!x.duplicate || r.startsWith('dup') || r.endsWith('overused')) bump(r);
      let clueId = null;
      if (st !== 'rejected') {
        clueId = uuid();
        const row = x.ev.row;
        const full = {
          ...row, id: clueId, slug: `${slugBase(row)}-${crypto.createHash('sha1').update(x.dedupKey).digest('hex').slice(0, 7)}`,
          mechanism: x.ev.mech, mechanisms_secondary: JSON.stringify([...mechanismsIn(x.ev.tree)].filter((m) => m !== x.ev.mech)),
          origin: 'generated', status: st === 'approved' ? 'published' : 'review', author_name: null, attribution: null, rights_status: 'original',
          hints: JSON.stringify(gen().hintsFor({ ...row, wordplay: x.ev.tree, mechanism: x.ev.mech }, LANG)), answer_length: row.answer_key.length,
          dedup_key: x.dedupKey, batch_id: batchId, generator_version: VERSION, evidence: JSON.stringify(x.ev.evidence || []),
          published_at: st === 'approved' ? now() : null, shuffle: crypto.randomInt(0, 1e9),
          note: row.note || null,
        };
        const cols = CLUE_COLUMNS.filter((c) => full[c] !== undefined);
        stmts.push({ sql: `INSERT INTO clues(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, args: cols.map((c) => full[c]) });
        stmts.push({ sql: "INSERT INTO clue_events(clue_id, actor_kind, action, to_status, diff) VALUES (?, 'generator', 'create', ?, ?)",
          args: [clueId, full.status, JSON.stringify({ agent: VERSION, batch: batchId, auto_approved: st === 'approved' })] });
        if (st === 'approved') approvedIds.push(clueId);
      }
      stmts.push({
        sql: `INSERT INTO agent_candidates(id, batch_id, cycle_id, variant_code, clue_id, status, mechanism, difficulty, clue_text, answer, checks, reasons,
          generator_version, generator_model, reviewer_model, cost_usd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [uuid(), batchId, cycle.id, variant.variant_code, clueId, st, x.ev.mech || x.slot.mechanism, x.slot.difficulty,
          String((x.ev.row && x.ev.row.clue_text) || x.c.clue || '').slice(0, 300), x.slot.answer, JSON.stringify({ ...x.ev.checks, provenance: { engine: 'llm', prompt: LLM.PROMPT_VERSION, generator: x.model, slot: x.slot.slot } }),
          JSON.stringify(x.ev.reasons), VERSION, x.model, x.reviewerModel || null, round4(x.cost || 0)],
      });
    }
    det.cursor_from = variant.cursor; det.cursor_to = plan.cursorEnd;
    stmts.push({
      sql: `UPDATE agent_batches SET status = 'committed', candidates = ?, approved = ?, needs_review = ?, rejected = ?, duplicates = ?, cursor_end = ?, details = ?,
        finished_at = ?, duration_ms = ? WHERE id = ?`,
      args: [tally.candidates, tally.approved, tally.needs_review, tally.rejected, tally.duplicates, plan.cursorEnd, JSON.stringify(det), now(), Date.now() - started, batchId],
    });
    stmts.push({ sql: 'UPDATE agent_variants SET cursor = ?, pilot_done = 1, updated_at = ? WHERE variant_code = ?', args: [plan.cursorEnd, now(), variant.variant_code] });
    if (tally.candidates === 0) {
      // nada que guardar: el lote se cierra sin registros (no hay nada que verificar)
      await db.client.batch(stmts.filter((x) => !/^INSERT INTO (clues|clue_events|agent_candidates)/.test(x.sql.trim())), 'write');
      await db.run("UPDATE agent_batches SET status = 'verified' WHERE id = ?", [batchId]);
    } else {
      await callWithRetry(async () => {
        const b = await db.get('SELECT status FROM agent_batches WHERE id = ?', [batchId]);
        if (b && b.status !== 'running') return;          // la escritura anterior llegó aunque no hubo respuesta
        await db.client.batch(stmts, 'write');
      });
      const v = await verifyBatch(db, batchId);
      if (!v.ok) throw new Error(`verificación fallida: ${v.clues} crípticos y ${v.candidates} registros`);
    }

    // 6) muestra para auditoría humana
    if (approvedIds.length) {
      const n = Math.min(approvedIds.length, Math.max(1, Math.ceil(approvedIds.length * s.audit_rate)));
      const pick = [...approvedIds].sort(() => Math.random() - 0.5).slice(0, n);
      await db.client.batch(pick.flatMap((id) => [{ sql: 'INSERT OR IGNORE INTO clue_audits(clue_id, batch_id) VALUES (?,?)', args: [id, batchId] },
        { sql: "UPDATE clues SET audit_status = 'pending' WHERE id = ?", args: [id] }]), 'write');
    }

    // 7) calidad del lote: estrategia corregida (prueba controlada) o pausa con alerta
    const spent = (await db.get('SELECT cost_usd FROM agent_batches WHERE id = ?', [batchId])).cost_usd;
    const quality = await qualityGate(db, ctx, { batchId, tally, spent, kind, det });
    log(`${variant.variant_code} lote ${seq} (${kind}): ${tally.candidates} candidatos, ${tally.approved} aprobados, ${tally.needs_review} a revisión, ${tally.rejected} rechazados, ${tally.duplicates} duplicados, US$ ${round4(spent)}${quality ? ' · ' + quality : ''}`);
    return { variant: variant.variant_code, batch_id: batchId, seq, kind, ...tally, cost_usd: round4(spent), quality, served: servedGenerator };
  } catch (e) {
    await db.run("UPDATE agent_batches SET status = 'failed', error = ?, finished_at = ?, duration_ms = ?, details = ? WHERE id = ? AND status = 'running'",
      [String(e.message).slice(0, 500), now(), Date.now() - started, JSON.stringify(det), batchId]).catch(() => {});
    await db.run('INSERT INTO error_log(scope, message, details) VALUES (?,?,?)', ['agent', String(e.message).slice(0, 500), JSON.stringify({ variant: variant.variant_code, batchId })]).catch(() => {});
    throw e;
  }
}

async function qualityGate(db, ctx, { tally, spent, kind }) {
  const { s, variant } = ctx;
  const n = tally.candidates;
  const problems = [];
  // en la prueba controlada alcanza una muestra chica: no se vuelve a producir en volumen sin evidencia
  const sample = kind === 'normal' ? 5 : 1;
  if (n >= sample) {
    if (tally.rejected / n > s.max_reject_rate) problems.push(`rechazo ${Math.round((100 * tally.rejected) / n)} %`);
    if (tally.duplicates / n > s.max_duplicate_rate) problems.push(`duplicados ${Math.round((100 * tally.duplicates) / n)} %`);
    if (tally.approved / n < s.min_approval_rate) problems.push(`aprobación ${Math.round((100 * tally.approved) / n)} %`);
  }
  if (tally.approved > 0 && spent / tally.approved > s.max_cost_per_approved_usd) problems.push(`costo US$ ${round4(spent / tally.approved)} por aprobado`);
  if (tally.approved === 0 && spent > s.max_cost_per_approved_usd * 5) problems.push(`US$ ${round4(spent)} sin aprobados`);
  if (!problems.length) {
    if (variant.probation && n >= sample) await db.run('UPDATE agent_variants SET probation = 0, updated_at = ? WHERE variant_code = ?', [now(), variant.variant_code]);
    return null;
  }
  const text = problems.join(', ');
  if (kind === 'normal') {
    await db.run('UPDATE agent_variants SET probation = 1, updated_at = ? WHERE variant_code = ?', [now(), variant.variant_code]);
    await alerts.raise(db, { key: `agent:quality:${variant.variant_code}:${ctx.cycle.cycle_date}`, kind: 'agent', severity: 'warning',
      title: `Agente: lote defectuoso en ${variant.variant_code} (${text}); el próximo es una prueba controlada`, details: { variant: variant.variant_code, problems } });
    return 'prueba controlada: ' + text;
  }
  await db.run("UPDATE agent_variants SET status = 'paused', paused_reason = ?, probation = 1, updated_at = ? WHERE variant_code = ?", [`calidad: ${text}`, now(), variant.variant_code]);
  await alerts.raise(db, { key: `agent:paused:${variant.variant_code}`, kind: 'agent', severity: 'critical',
    title: `Agente: variante ${variant.variant_code} pausada por calidad (${text})`, details: { variant: variant.variant_code, problems } });
  return 'variante pausada: ' + text;
}

// ───────────── una ejecución (la llama la tarea programada) ─────────────
async function runOnce(db, { llm = LLM.createLlm(), holder = 'cli', deadline, log = () => {}, evidence = null, retryMs } = {}) {
  if (retryMs !== undefined) retryBaseMs = retryMs;
  if (!(await acquireLock(db, holder))) return { skipped: 'locked' };
  const startedAt = now();
  const out = { holder, batches: [], recovered: [] };
  try {
    out.recovered = await recover(db);
    const s = await settings(db);
    const today = dateIn(s.timezone);
    out.finalized = await finalizeOldCycles(db, today, s);
    const cycle = await ensureCycle(db, today, s.timezone);
    await db.run('UPDATE agent_cycles SET runs = runs + 1, last_activity_at = ? WHERE id = ?', [now(), cycle.id]);
    out.cycle = cycle.cycle_date;
    const variants = await syncVariants(db);
    out.variants = variants.length;
    const ctl = await control(db);
    const block = async (reason, title, severity = 'critical') => {
      await db.run("UPDATE agent_cycles SET status = 'blocked', blocked_reason = ? WHERE id = ? AND finished_at IS NULL AND status <> 'stopped'", [reason, cycle.id]);
      await alerts.raise(db, { key: `agent:blocked:${reason}:${today}`, kind: 'agent', severity, title, details: { reason } });
      out.blocked = reason;
    };
    if (ctl.state === 'stopped') { out.stopped = true; await db.run("UPDATE agent_cycles SET status = 'stopped', blocked_reason = 'detenido por un administrador' WHERE id = ? AND finished_at IS NULL", [cycle.id]); }
    else if (ctl.state === 'paused') out.paused = true;
    else if (!variants.length) await block('no_variants', 'Agente: no hay variantes activas del español');
    else if (!s.mechanisms.length) await block('no_mechanisms', 'Agente: no hay mecanismos configurados');
    else if (!llm.available) await block('missing_credentials', 'Agente bloqueado: falta la clave ANTHROPIC_API_KEY en los secretos de GitHub');
    else if (!(s.daily_budget_usd > 0)) await block('no_budget', 'Agente bloqueado: no hay presupuesto diario (agent.daily_budget_usd = 0)');
    else {
      await db.run("UPDATE agent_cycles SET status = 'running', blocked_reason = NULL WHERE id = ? AND status = 'blocked'", [cycle.id]);
      const L = lex();
      if (!L) throw new Error('falta el léxico del español (data/lexicon/es.json.gz)');
      const phonetics = await variantPhonetics(db, LANG);
      const variantCodes = new Set(variants.map((v) => v.variant_code));
      const failures = {};
      // ronda por variantes: un lote por variante y se vuelve a empezar, para repartir el tiempo y el presupuesto
      let progress = true;
      const finished = new Set();
      const budgetOut = new Set();
      while (progress) {
        progress = false;
        for (const v0 of variants) {
          if (finished.has(v0.variant_code)) continue;
          if (deadline && Date.now() > deadline) { out.deadline = true; progress = false; break; }
          if ((await control(db)).state !== 'active') { out.interrupted = (await control(db)).state; progress = false; break; }
          const variant = await db.get('SELECT a.*, v.name_native AS name FROM agent_variants a JOIN language_variants v ON v.code = a.variant_code WHERE a.variant_code = ?', [v0.variant_code]);
          if (variant.status !== 'active') { finished.add(variant.variant_code); continue; }
          try {
            const r = await runVariantBatch(db, { s, cycle, variant, llm, holder, log, L, phonetics, variantCodes, nVariants: variants.length });
            out.batches.push(r);
            failures[variant.variant_code] = 0;
            if (r.done || r.maintenance || r.exhausted) finished.add(variant.variant_code);
            else progress = true;
          } catch (e) {
            out.batches.push({ variant: variant.variant_code, error: e.message, reason: e.reason || e.code || null });
            log(`${variant.variant_code}: ${e.message}`);
            if (e instanceof Blocked && e.reason === 'budget_exhausted') { await block('budget_exhausted', 'Agente: presupuesto diario agotado antes de cumplir la meta', 'warning'); progress = false; break; }
            if (e instanceof Blocked && e.reason === 'variant_budget_exhausted') { finished.add(variant.variant_code); budgetOut.add(variant.variant_code); continue; }
            if (e instanceof Blocked || e.critical) { await block(e.reason || e.code || 'critical_error', `Agente detenido: ${e.message}`.slice(0, 200)); progress = false; break; }
            failures[variant.variant_code] = (failures[variant.variant_code] || 0) + 1;
            if (failures[variant.variant_code] >= s.max_consecutive_failures) {
              await db.run("UPDATE agent_variants SET status = 'paused', paused_reason = ?, updated_at = ? WHERE variant_code = ?", [`fallos repetidos: ${e.message}`.slice(0, 200), now(), variant.variant_code]);
              await alerts.raise(db, { key: `agent:failures:${variant.variant_code}`, kind: 'agent', severity: 'critical', title: `Agente: variante ${variant.variant_code} pausada por fallos repetidos`, details: { error: e.message } });
              finished.add(variant.variant_code);
            } else progress = true;
          }
          await renewLock(db, holder);
        }
      }
      if (budgetOut.size && !out.blocked) {
        const pending = (await buildReport(db, cycle.id, s)).variants.filter((v) => v.missing_today > 0 && v.status === 'active');
        if (pending.length && pending.every((v) => budgetOut.has(v.variant))) await block('variant_budget_exhausted', 'Agente: el presupuesto por variante no alcanza para seguir', 'warning');
        else await alerts.raise(db, { key: `agent:variant_budget:${today}`, kind: 'agent', severity: 'warning', title: `Agente: sin presupuesto para ${[...budgetOut].join(', ')}`, details: { variants: [...budgetOut] } });
      }
    }
    const report = await buildReport(db, cycle.id, s);
    const allDone = report.variants.length > 0 && report.variants.every((v) => v.missing_today === 0 || v.status === 'maintenance');
    await db.run('UPDATE agent_cycles SET report = ?, last_activity_at = ?, status = CASE WHEN ? AND status = \'running\' THEN \'completed\' ELSE status END, finished_at = CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE finished_at END WHERE id = ?',
      [JSON.stringify(report), now(), allDone ? 1 : 0, allDone ? 1 : 0, now(), cycle.id]);
    out.approved_today = report.totals.approved;
    return out;
  } finally {
    const status = out.blocked ? 'blocked' : out.stopped ? 'stopped' : out.paused ? 'paused' : out.batches.some((b) => b.error) ? 'error' : 'ok';
    const summary = out.blocked ? `bloqueado: ${out.blocked}` : `${out.batches.filter((b) => b.batch_id).length} lotes, ${out.batches.reduce((a, b) => a + (b.approved || 0), 0)} aprobados`;
    await db.run('UPDATE agent_control SET last_run_at = ?, last_run_status = ?, last_run_evidence = ?, last_run_summary = ? WHERE id = 1', [startedAt, status, evidence, summary]).catch(() => {});
    await releaseLock(db, holder).catch(() => {});
    out.status = status; out.summary = summary;
  }
}

// ───────────── informe diario ─────────────
const SHORTFALL = {
  missing_credentials: 'falta la clave de la API de Claude (ANTHROPIC_API_KEY)',
  no_budget: 'no hay presupuesto diario configurado',
  budget_exhausted: 'se agotó el presupuesto diario',
  variant_budget_exhausted: 'el presupuesto por variante se agotó o no alcanza para una llamada más',
  price_missing: 'un modelo no tiene precio configurado',
  credentials_rejected: 'la API rechazó la clave',
  bad_request: 'la API rechazó el pedido (configuración)',
  stopped: 'el agente fue detenido por un administrador',
};

async function buildReport(db, cycleId, s) {
  s = s || await settings(db);
  const cycle = await db.get('SELECT * FROM agent_cycles WHERE id = ?', [cycleId]);
  const variants = await syncVariants(db);
  const counts = await dayCounts(db, cycleId);
  const lib = await libraryCounts(db);
  const q = quotas(s.daily_target_per_variant, s.mechanisms);
  const batches = await db.all(`SELECT variant_code AS v, COUNT(*) AS n, SUM(candidates) AS candidates, SUM(duplicates) AS duplicates, SUM(cost_usd) AS cost,
    SUM(status = 'failed') AS failed, AVG(duration_ms) AS ms, GROUP_CONCAT(CASE WHEN error IS NOT NULL THEN error END, ' | ') AS errors
    FROM agent_batches WHERE cycle_id = ? GROUP BY variant_code`, [cycleId]);
  const details = await db.all('SELECT variant_code AS v, details FROM agent_batches WHERE cycle_id = ?', [cycleId]);
  const rows = variants.map((v) => {
    const c = counts[v.variant_code] || { approved: 0, needs_review: 0, rejected: 0, byMechanism: {} };
    const b = batches.find((x) => x.v === v.variant_code) || {};
    const reasons = {}; const disabled = new Set(); const actions = [];
    for (const d of details.filter((x) => x.v === v.variant_code)) {
      const j = parseJson(d.details, {});
      for (const [k, n] of Object.entries(j.reasons || {})) reasons[k] = (reasons[k] || 0) + n;
      (j.disabled_mechanisms || []).forEach((m) => disabled.add(m));
      if (j.kind === 'probation') actions.push('prueba controlada tras un lote defectuoso');
    }
    if (disabled.size) actions.push(`mecanismos suspendidos por fallas: ${[...disabled].join(', ')}`);
    const libTarget = v.library_target ?? s.library_target_per_variant;
    const mech = s.mechanisms.map((m) => ({ mechanism: m, target: q[m], approved: ((c.byMechanism[m] || {}).approved) || 0 }));
    const missing = mech.reduce((a, m) => a + Math.max(0, m.target - m.approved), 0);
    let why = null;
    if (missing > 0) {
      if (cycle.blocked_reason) why = SHORTFALL[cycle.blocked_reason] || cycle.blocked_reason;
      else if (cycle.status === 'stopped') why = SHORTFALL.stopped;
      else if (v.status === 'paused') why = `variante pausada (${v.paused_reason || 'sin motivo'})`;
      else if (!b.n) why = 'todavía no se procesó en este ciclo';
      else why = 'la producción aprobada no alcanzó la cuota: ' + Object.entries(reasons).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', ');
    }
    return {
      variant: v.variant_code, name: v.name, status: v.status, paused_reason: v.paused_reason, daily_target: s.daily_target_per_variant,
      candidates: b.candidates || 0, approved: c.approved, needs_review: c.needs_review, rejected: c.rejected, duplicates: b.duplicates || 0,
      compliance: s.daily_target_per_variant ? Math.floor((c.approved / s.daily_target_per_variant) * 1000) / 10 : 0,
      approval_rate: b.candidates ? Math.round((c.approved / b.candidates) * 1000) / 10 : null,
      cost_usd: round4(b.cost || 0), cost_per_approved_usd: c.approved ? round4((b.cost || 0) / c.approved) : null,
      batches: b.n || 0, failed_batches: b.failed || 0, avg_batch_ms: b.ms ? Math.round(b.ms) : null, errors: b.errors || null,
      quality_issues: reasons, corrective_actions: actions, by_mechanism: mech, missing_today: missing, shortfall_reason: why,
      library: lib[v.variant_code] || 0, library_target: libTarget, library_missing: Math.max(0, libTarget - (lib[v.variant_code] || 0)),
    };
  });
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return {
    date: cycle.cycle_date, timezone: cycle.timezone, status: cycle.status, blocked_reason: cycle.blocked_reason, generated_at: now(),
    generator_version: VERSION, models: { generator: s.generator_model, reviewer: s.reviewer_model },
    variants: rows, general_clues: lib.general,
    totals: { variants: rows.length, daily_target: rows.length * s.daily_target_per_variant, candidates: sum('candidates'), approved: sum('approved'), needs_review: sum('needs_review'),
      rejected: sum('rejected'), duplicates: sum('duplicates'), cost_usd: round4(cycle.cost_usd), input_tokens: cycle.input_tokens, output_tokens: cycle.output_tokens,
      library: sum('library'), library_target: sum('library_target'), library_missing: sum('library_missing') },
  };
}

async function finalizeOldCycles(db, today, s) {
  const old = await db.all('SELECT * FROM agent_cycles WHERE cycle_date < ? AND finished_at IS NULL', [today]);
  for (const c of old) {
    const report = await buildReport(db, c.id, s);
    const met = report.variants.length > 0 && report.variants.every((v) => v.missing_today === 0 || v.status === 'maintenance');
    const status = c.status === 'stopped' ? 'stopped' : met ? 'completed' : c.status === 'blocked' && report.totals.approved === 0 ? 'blocked' : 'partial';
    await db.run('UPDATE agent_cycles SET status = ?, report = ?, finished_at = ? WHERE id = ?', [status, JSON.stringify({ ...report, status, final: true }), now(), c.id]);
    if (!met) {
      await alerts.raise(db, { key: `agent:shortfall:${c.cycle_date}`, kind: 'agent', severity: 'warning',
        title: `Agente: el ${c.cycle_date} no se cumplió la cuota (${report.totals.approved} de ${report.totals.daily_target} aprobados)`, details: { date: c.cycle_date } });
    }
  }
  return old.map((c) => c.cycle_date);
}

// ───────────── panel ─────────────
async function overview(db) {
  const s = await settings(db);
  const ctl = await control(db);
  const today = dateIn(s.timezone);
  const cycle = await db.get('SELECT * FROM agent_cycles WHERE cycle_date = ?', [today]);
  const live = cycle ? await buildReport(db, cycle.id, s) : null;
  const history = await db.all('SELECT id, cycle_date, status, blocked_reason, runs, cost_usd, started_at, last_activity_at, finished_at, report FROM agent_cycles ORDER BY cycle_date DESC LIMIT 30');
  const lastBatches = await db.all('SELECT id, cycle_id, variant_code, seq, kind, status, candidates, approved, needs_review, rejected, duplicates, cost_usd, error, started_at, finished_at, duration_ms FROM agent_batches ORDER BY started_at DESC LIMIT 40');
  const openAlerts = await db.all("SELECT id, severity, title, last_seen_at, occurrences FROM alerts WHERE kind = 'agent' AND status <> 'resolved' ORDER BY last_seen_at DESC LIMIT 20");
  const leased = ctl.lease_until && ctl.lease_until > now();
  const variants = live ? live.variants : (await buildReport(db, (await ensureCycle(db, today, s.timezone)).id, s)).variants;
  let state = ctl.state === 'active' ? 'active' : ctl.state;
  if (ctl.state === 'active' && cycle && cycle.status === 'blocked') state = 'blocked';
  if (ctl.state === 'active' && ctl.last_run_status === 'error') state = 'error';
  return {
    state, control: { state: ctl.state, reason: ctl.reason, updated_at: ctl.updated_at, running: Boolean(leased), holder: leased ? ctl.lease_holder : null },
    last_run: { at: ctl.last_run_at, status: ctl.last_run_status, summary: ctl.last_run_summary, evidence: ctl.last_run_evidence },
    next_run: ctl.state === 'active' ? nextScheduled() : null,
    schedule: 'GitHub Actions «Agente de biblioteca», cada hora a los :07 (UTC)',
    settings: { daily_target: s.daily_target_per_variant, library_target: s.library_target_per_variant, mechanisms: s.mechanisms, quotas: quotas(s.daily_target_per_variant, s.mechanisms),
      timezone: s.timezone, daily_budget_usd: s.daily_budget_usd, variant_budget_usd: s.variant_budget_usd, batch_size: s.batch_size, pilot_batch_size: s.pilot_batch_size,
      generator_model: s.generator_model, reviewer_model: s.reviewer_model },
    today: live ? { date: live.date, status: live.status, blocked_reason: live.blocked_reason, totals: live.totals, started_at: cycle.started_at, last_activity_at: cycle.last_activity_at, finished_at: cycle.finished_at }
      : { date: today, status: 'not_started', totals: null },
    variants,
    history: history.map((h) => { const r = parseJson(h.report, null); return { ...h, report: undefined, totals: r ? r.totals : null }; }),
    batches: lastBatches, alerts: openAlerts,
  };
}

async function cycleReport(db, date) {
  const c = await db.get('SELECT * FROM agent_cycles WHERE cycle_date = ?', [date]);
  if (!c) throw new HttpError(404, 'not_found');
  return c.finished_at ? parseJson(c.report, null) : buildReport(db, c.id);
}

async function candidates(db, { cycle, variant, status, limit = 50 } = {}) {
  const where = ['1=1']; const args = [];
  if (cycle) { where.push('c.cycle_id = (SELECT id FROM agent_cycles WHERE cycle_date = ?)'); args.push(cycle); }
  if (variant) { where.push('c.variant_code = ?'); args.push(variant); }
  if (status) { where.push('c.status = ?'); args.push(status); }
  const rows = await db.all(`SELECT c.* FROM agent_candidates c WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT ?`, [...args, Math.min(200, Number(limit) || 50)]);
  return rows.map((r) => ({ ...r, checks: parseJson(r.checks, {}), reasons: parseJson(r.reasons, []) }));
}

module.exports = { VERSION, runOnce, runVariantBatch, overview, cycleReport, candidates, setControl, setVariant, control, quotas, dateIn, nextScheduled,
  syncVariants, buildReport, recover, verifyBatch, evaluate, mechanismClass, settings, acquireLock, releaseLock, Blocked };
