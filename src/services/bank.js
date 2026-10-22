'use strict';

// Banco de crípticos: metas de 10.000 por idioma y dificultad, lotes de
// generación reanudables, verificación en base y auditoría humana por muestra.
//
// Ciclo de un lote (ver docs/BANCO.md):
//   1. toma la celda (idioma × dificultad) con un arriendo para que no la procesen dos procesos;
//   2. genera candidatos desde el último cursor confirmado;
//   3. valida cada uno (validador + evidencia léxica independiente);
//   4. descarta duplicados exactos, de juego de palabras y semánticos;
//   5. guarda todo en una sola escritura atómica junto con el cursor nuevo;
//   6. relee la base y solo entonces marca el lote como verificado;
//   7. separa una muestra de lo publicado para auditoría humana.
// Si algo falla a mitad, la escritura no ocurre y el lote siguiente retoma
// desde el mismo cursor: no se pierde ni se repite nada.

const crypto = require('crypto');
const N = require('../lib/normalize');
const { buildClue, CLUE_COLUMNS, slugBase, variantPhonetics } = require('./clues');
const { jaccard } = require('./dedupe');
const { getSetting } = require('./settings');
const { uuid, now, parseJson, HttpError } = require('./util');
const { audit } = require('./audit');

const LEASE_MS = 10 * 60 * 1000;
const STOP = new Set(['EL', 'LA', 'LOS', 'LAS', 'UN', 'UNA', 'DE', 'DEL', 'EN', 'Y', 'QUE', 'CON', 'POR', 'PARA', 'A', 'AL', 'ES', 'SE', 'LO',
  'THE', 'AN', 'OF', 'TO', 'IN', 'AND', 'FOR', 'IS', 'AS', 'IT', 'ON', 'BY', 'OR', 'S']);

let generatorModule = null;
function generator() {
  // El generador y su léxico se cargan solo cuando se ejecuta un lote.
  if (!generatorModule) generatorModule = require('../lib/bank/generate');
  return generatorModule;
}

const contentWords = (text, lang) => new Set(N.words(N.stripEnumeration(text), lang).filter((w) => !STOP.has(w)));
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, { attempts = 3, base = 500, onRetry } = {}) {
  let last;
  for (let k = 0; k < attempts; k++) {
    try { return await fn(k); } catch (e) {
      last = e;
      if (/publish_blocked|UNIQUE|constraint/i.test(String(e.message))) throw e;   // no transitorio
      if (onRetry) await onRetry(e, k);
      await sleep(base * 2 ** k);
    }
  }
  throw last;
}

async function settings(db) {
  return {
    target: await getSetting(db, 'bank.target_per_cell'),
    size: await getSetting(db, 'bank.batch_size'),
    auditRate: await getSetting(db, 'bank.audit_rate'),
    auditMin: await getSetting(db, 'bank.audit_min'),
    maxReject: await getSetting(db, 'bank.audit_max_reject_rate'),
    perAnswer: await getSetting(db, 'bank.max_clues_per_answer'),
    perMechanism: await getSetting(db, 'bank.max_per_answer_mechanism'),
    autopublish: await getSetting(db, 'bank.autopublish_strict'),
    threshold: await getSetting(db, 'publishing.semantic_duplicate_threshold'),
  };
}

// Una fila de meta por idioma activo y dificultad. Agregar un idioma nuevo solo
// agrega sus filas: no toca lo ya generado.
async function ensureTargets(db) {
  const target = await getSetting(db, 'bank.target_per_cell');
  const langs = await db.all('SELECT code FROM languages WHERE enabled = 1');
  for (const { code } of langs) {
    for (let d = 1; d <= 5; d++) {
      await db.run('INSERT OR IGNORE INTO bank_targets(language_code, difficulty, target) VALUES (?,?,?)', [code, d, target]);
    }
  }
}

// ── arriendo de una celda ──
async function acquire(db, lang, d, holder) {
  const t = now(); const until = new Date(Date.now() + LEASE_MS).toISOString();
  const r = await db.run(`UPDATE bank_targets SET lease_until = ?, status = 'running', last_error = NULL, updated_at = ?
    WHERE language_code = ? AND difficulty = ? AND (lease_until IS NULL OR lease_until < ?) AND status <> 'paused'`, [until, t, lang, d, t]);
  return r.changes === 1 ? { holder, until } : null;
}

async function release(db, lang, d, status, error) {
  await db.run('UPDATE bank_targets SET lease_until = NULL, status = ?, last_error = ?, last_run_at = ?, updated_at = ? WHERE language_code = ? AND difficulty = ?',
    [status, error || null, now(), now(), lang, d]);
}

// Lotes que quedaron a medias (proceso cortado): si su escritura llegó a la base
// se completan y verifican; si no, se marcan abandonados y se retoma del cursor.
async function recoverCell(db, lang, d) {
  const stuck = await db.all("SELECT * FROM generation_batches WHERE language_code = ? AND difficulty = ? AND status IN ('running','committed')", [lang, d]);
  for (const b of stuck) {
    const n = await db.get('SELECT COUNT(*) AS n FROM clues WHERE batch_id = ?', [b.id]);
    if (n.n > 0) await verifyBatch(db, b.id);
    else await db.run("UPDATE generation_batches SET status = 'abandoned', finished_at = ?, error = COALESCE(error, 'interrumpido antes de guardar') WHERE id = ?", [now(), b.id]);
  }
}

// ── evidencia léxica: se recalcula desde el léxico, sin confiar en el generador ──
function verifyEvidence(lang, clue) {
  const L = require('../lib/bank/lexicon').load(lang);
  if (!L) return { ok: false, failed: ['lexicon_missing'] };
  const failed = [];
  for (const e of clue.evidence || []) {
    const s = L.supports(e.word, e.def);
    if (!s) failed.push(`${e.word} → ${e.def}`);
  }
  return { ok: failed.length === 0 && (clue.evidence || []).length > 0, failed };
}

// Existentes que chocan con los candidatos: misma huella, mismo juego de palabras,
// misma respuesta con pista muy parecida, o demasiados usos de la misma respuesta.
async function existingFor(db, lang, rows) {
  const keys = [...new Set(rows.map((r) => r.answer_key))];
  const byAnswer = new Map();
  for (const part of chunk(keys, 150)) {
    const found = await db.all(`SELECT answer_key, mechanism, clue_text, dedup_key, fingerprint FROM clues
      WHERE language_code = ? AND answer_key IN (${part.map(() => '?').join(',')})`, [lang, ...part]);
    for (const f of found) {
      if (!byAnswer.has(f.answer_key)) byAnswer.set(f.answer_key, []);
      byAnswer.get(f.answer_key).push(f);
    }
  }
  const fps = new Set();
  for (const part of chunk(rows.map((r) => r.fingerprint), 150)) {
    const found = await db.all(`SELECT fingerprint FROM clues WHERE fingerprint IN (${part.map(() => '?').join(',')})`, part);
    found.forEach((f) => fps.add(f.fingerprint));
  }
  return { byAnswer, fps };
}

function insertStatement(row) {
  const cols = CLUE_COLUMNS.filter((c) => row[c] !== undefined);
  return { sql: `INSERT INTO clues(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, args: cols.map((c) => row[c]) };
}

// ── un lote ──
async function runBatch(db, { lang, difficulty, size, runId = uuid(), holder = 'cli', log = () => {} }) {
  const cfg = await settings(db);
  size = Math.max(1, Math.min(2000, Number(size) || cfg.size));
  await ensureTargets(db);
  const lease = await acquire(db, lang, difficulty, holder);
  if (!lease) return { skipped: 'busy_or_paused' };
  const started = Date.now();
  let batchId = null;
  try {
    await recoverCell(db, lang, difficulty);
    const gen = generator();
    const cell = await db.get('SELECT * FROM bank_targets WHERE language_code = ? AND difficulty = ?', [lang, difficulty]);
    const published = (await db.get("SELECT COUNT(*) AS n FROM clues WHERE language_code = ? AND difficulty = ? AND status = 'published'", [lang, difficulty])).n;
    if (published >= cell.target) { await release(db, lang, difficulty, 'done'); return { done: true, published }; }

    const engine = gen.engine(lang);
    const answers = engine.answers();
    const cursor = cell.generator_version === gen.VERSION ? cell.cursor : 0;
    if (cursor >= answers.length) { await release(db, lang, difficulty, 'exhausted'); return { exhausted: true, published, cursor }; }
    const seq = ((await db.get('SELECT MAX(seq) AS m FROM generation_batches WHERE language_code = ? AND difficulty = ? AND generator_version = ?',
      [lang, difficulty, gen.VERSION])).m || 0) + 1;
    batchId = uuid();
    await db.run(`INSERT INTO generation_batches(id, run_id, language_code, difficulty, seq, generator_version, cursor_start, requested)
      VALUES (?,?,?,?,?,?,?,?)`, [batchId, runId, lang, difficulty, seq, gen.VERSION, cursor, size]);

    // 1) candidatos desde el cursor
    const phonetics = await variantPhonetics(db, lang);
    const reasons = {};
    const counts = { candidates: 0, validated: 0, published: 0, pending: 0, rejected: 0, duplicates: 0 };
    const accepted = []; const seenDedup = new Set(); const seenFp = new Set();
    let pos = cursor;
    const want = Math.min(size, cell.target - published + Math.ceil(size / 4));
    while (pos < answers.length && accepted.length < want) {
      const slice = answers.slice(pos, pos + 50);
      const cands = [];
      slice.forEach((i, k) => { for (const c of engine.forDifficulty(i, difficulty)) cands.push({ ...c, at: pos + k }); });
      pos += slice.length;
      counts.candidates += cands.length;
      const built = [];
      for (const c of cands) {
        const { row, report } = await buildClue(db, c, { phonetics });
        if (row.validation_errors) {
          counts.rejected++;
          for (const ch of report.checks.filter((x) => x.level === 'error')) reasons[ch.code] = (reasons[ch.code] || 0) + 1;
          continue;
        }
        built.push({ c, row, report });
      }
      const ex = await existingFor(db, lang, built.map((b) => b.row));
      for (const { c, row, report } of built) {
        const prior = ex.byAnswer.get(row.answer_key) || [];
        const mine = accepted.filter((a) => a.row.answer_key === row.answer_key);
        const sameMech = [...prior, ...mine.map((a) => a.row)].filter((p) => p.mechanism === row.mechanism).length;
        const words = contentWords(row.clue_text, lang);
        const semantic = [...prior, ...mine.map((a) => a.row)].some((p) => jaccard(words, contentWords(p.clue_text, lang)) >= cfg.threshold);
        let dupReason = null;
        if (seenDedup.has(c.dedup_key) || prior.some((p) => p.dedup_key === c.dedup_key)) dupReason = 'dup_wordplay';
        else if (seenFp.has(row.fingerprint) || ex.fps.has(row.fingerprint)) dupReason = 'dup_exact';
        else if (semantic) dupReason = 'dup_semantic';
        else if (prior.length + mine.length >= cfg.perAnswer) dupReason = 'answer_overused';
        else if (sameMech >= cfg.perMechanism) dupReason = 'mechanism_overused';
        if (dupReason) { counts.duplicates++; reasons[dupReason] = (reasons[dupReason] || 0) + 1; continue; }
        seenDedup.add(c.dedup_key); seenFp.add(row.fingerprint);

        // 2) criterio estricto: sin errores, sin advertencias y con toda la evidencia léxica comprobada
        const ev = verifyEvidence(lang, c);
        const strict = report.warnings === 0 && ev.ok;
        const checks = parseJson(row.validation, { checks: [] });
        checks.checks.push(ev.ok
          ? { level: 'ok', code: 'lexicon_evidence_ok', msg: 'Cada definición y cada sinónimo figuran en el léxico de referencia.' }
          : { level: 'warning', code: 'lexicon_evidence_missing', msg: `Sin respaldo léxico: ${ev.failed.join('; ')}` });
        checks.evidence_ok = ev.ok;
        const status = strict && cfg.autopublish ? 'published' : 'review';
        if (strict) counts.validated++;
        if (!strict) for (const w of report.checks.filter((x) => x.level === 'warning')) reasons['warn:' + w.code] = (reasons['warn:' + w.code] || 0) + 1;
        accepted.push({
          c,
          row: {
            ...row,
            validation: JSON.stringify(checks),
            origin: 'generated',
            status,
            author_name: null,
            attribution: null,
            rights_status: 'original',
            mechanisms_secondary: JSON.stringify(c.mechanisms_secondary || []),
            hints: JSON.stringify(c.hints || []),
            answer_length: row.answer_key.length,
            dedup_key: c.dedup_key,
            batch_id: batchId,
            generator_version: gen.VERSION,
            evidence: JSON.stringify(c.evidence || []),
            difficulty,
            published_at: status === 'published' ? now() : null,
          },
        });
        if (accepted.length >= want) break;
      }
      if (accepted.length >= want) {
        // el cursor avanza solo hasta la respuesta del último aceptado, para no saltear candidatos
        pos = Math.min(pos, accepted[accepted.length - 1].c.at + 1);
      }
    }
    // 3) escritura atómica: cripticos + eventos + lote + cursor. Si otro proceso
    //    guardó entretanto el mismo juego de palabras (índice único), se quitan
    //    esos candidatos, se cuentan como duplicados y se reintenta.
    const det = { reasons, cursor_from: cursor, cursor_to: pos, answers_total: answers.length };
    const statements = () => {
      counts.published = accepted.filter((a) => a.row.status === 'published').length;
      counts.pending = accepted.length - counts.published;
      const stmts = [];
      for (const a of accepted) {
        const id = a.id || (a.id = uuid());
        const slug = `${slugBase(a.row)}-${crypto.createHash('sha1').update(a.row.dedup_key).digest('hex').slice(0, 7)}`;
        stmts.push(insertStatement({ ...a.row, id, slug, shuffle: crypto.randomInt(0, 1e9) }));
        stmts.push({ sql: "INSERT INTO clue_events(clue_id, actor_kind, action, to_status) VALUES (?, 'generator', 'create', ?)", args: [id, a.row.status] });
      }
      stmts.push({
        sql: `UPDATE generation_batches SET status = 'committed', cursor_end = ?, candidates = ?, validated = ?, published = ?, pending = ?,
          rejected = ?, duplicates = ?, details = ?, rows_written = ?, finished_at = ?, duration_ms = ? WHERE id = ?`,
        args: [pos, counts.candidates, counts.validated, counts.published, counts.pending, counts.rejected, counts.duplicates,
          JSON.stringify(det), accepted.length * 2 + 2, now(), Date.now() - started, batchId],
      });
      stmts.push({ sql: 'UPDATE bank_targets SET cursor = ?, generator_version = ?, updated_at = ? WHERE language_code = ? AND difficulty = ?',
        args: [pos, gen.VERSION, now(), lang, difficulty] });
      return stmts;
    };
    for (let round = 0; ; round++) {
      try {
        await withRetry(async (k) => {
          if (k > 0) {
            // ¿la escritura anterior llegó aunque no recibimos respuesta?
            const b = await db.get('SELECT status FROM generation_batches WHERE id = ?', [batchId]);
            if (b && b.status !== 'running') return;
          }
          await db.client.batch(statements(), 'write');
        }, { onRetry: (e) => log(`reintento de escritura: ${e.message}`) });
        break;
      } catch (e) {
        if (round >= 3 || !/UNIQUE/i.test(String(e.message))) throw e;
        const taken = new Set();
        for (const part of chunk(accepted.map((a) => a.row.dedup_key), 150)) {
          (await db.all(`SELECT dedup_key FROM clues WHERE dedup_key IN (${part.map(() => '?').join(',')})`, part)).forEach((r) => taken.add(r.dedup_key));
        }
        for (const part of chunk(accepted.map((a) => a.row.fingerprint), 150)) {
          (await db.all(`SELECT fingerprint FROM clues WHERE fingerprint IN (${part.map(() => '?').join(',')})`, part)).forEach((r) => taken.add(r.fingerprint));
        }
        const before = accepted.length;
        for (let k = accepted.length - 1; k >= 0; k--) {
          if (taken.has(accepted[k].row.dedup_key) || taken.has(accepted[k].row.fingerprint)) {
            if (accepted[k].row.status === 'published') counts.validated--;
            accepted.splice(k, 1);
          }
        }
        counts.duplicates += before - accepted.length;
        reasons.dup_concurrent = (reasons.dup_concurrent || 0) + (before - accepted.length);
        if (before === accepted.length) throw e;
      }
    }

    // 4) verificación contra la base
    const v = await verifyBatch(db, batchId);
    if (!v.ok) throw new Error(`verificación fallida: esperados ${accepted.length}, en base ${v.found}`);

    // 5) muestra para auditoría humana
    await sampleAudit(db, batchId, accepted.filter((a) => a.row.status === 'published').map((a) => a.id), cfg);

    const after = (await db.get("SELECT COUNT(*) AS n FROM clues WHERE language_code = ? AND difficulty = ? AND status = 'published'", [lang, difficulty])).n;
    const status = after >= cell.target ? 'done' : pos >= answers.length ? 'exhausted' : 'idle';
    await release(db, lang, difficulty, status);
    log(`${lang} D${difficulty} lote ${seq}: ${counts.candidates} candidatos, ${counts.published} publicados, ${counts.pending} pendientes, ${counts.rejected} rechazados, ${counts.duplicates} duplicados (cursor ${cursor}→${pos}/${answers.length})`);
    return { batch_id: batchId, seq, ...counts, cursor_from: cursor, cursor_to: pos, total_published: after, status };
  } catch (e) {
    if (batchId) {
      await db.run("UPDATE generation_batches SET status = 'failed', error = ?, finished_at = ?, duration_ms = ? WHERE id = ? AND status = 'running'",
        [String(e.message).slice(0, 500), now(), Date.now() - started, batchId]).catch(() => {});
    }
    await db.run('INSERT INTO error_log(scope, message, details) VALUES (?,?,?)', ['bank', String(e.message).slice(0, 500), JSON.stringify({ lang, difficulty, batchId })]).catch(() => {});
    await release(db, lang, difficulty, 'error', String(e.message).slice(0, 300)).catch(() => {});
    throw e;
  }
}

// Relee la base: el lote solo queda verificado si sus registros existen.
async function verifyBatch(db, batchId) {
  const b = await db.get('SELECT * FROM generation_batches WHERE id = ?', [batchId]);
  if (!b) return { ok: false, found: 0 };
  const r = await db.get("SELECT COUNT(*) AS n, SUM(status = 'published') AS p FROM clues WHERE batch_id = ?", [batchId]);
  const expected = b.published + b.pending;
  const ok = b.status === 'committed' || b.status === 'running' ? r.n === expected : r.n > 0;
  if (ok && b.status !== 'verified' && b.status !== 'suspended') {
    await db.run("UPDATE generation_batches SET status = 'verified', verified_at = ?, published = ?, pending = ? WHERE id = ?",
      [now(), r.p || 0, r.n - (r.p || 0), batchId]);
  }
  return { ok, found: r.n, expected };
}

async function sampleAudit(db, batchId, publishedIds, cfg) {
  if (!publishedIds.length) return 0;
  const n = Math.min(publishedIds.length, Math.max(cfg.auditMin, Math.ceil(publishedIds.length * cfg.auditRate)));
  const pick = [...publishedIds].sort(() => Math.random() - 0.5).slice(0, n);
  const stmts = [];
  for (const id of pick) {
    stmts.push({ sql: 'INSERT OR IGNORE INTO clue_audits(clue_id, batch_id) VALUES (?,?)', args: [id, batchId] });
    stmts.push({ sql: "UPDATE clues SET audit_status = 'pending' WHERE id = ?", args: [id] });
  }
  await db.client.batch(stmts, 'write');
  return n;
}

// ── varias celdas con concurrencia acotada ──
async function runCells(db, { langs, difficulties = [1, 2, 3, 4, 5], batches = 1, size, concurrency = 2, holder, log = () => {}, deadline } = {}) {
  await ensureTargets(db);
  const enabled = (await db.all('SELECT code FROM languages WHERE enabled = 1')).map((r) => r.code);
  const cells = [];
  for (const l of (langs && langs.length ? langs : enabled)) {
    if (!enabled.includes(l)) continue;
    for (const d of difficulties) cells.push([l, d]);
  }
  const runId = uuid();
  const results = [];
  let next = 0;
  async function worker() {
    while (next < cells.length) {
      const [l, d] = cells[next++];
      for (let k = 0; k < batches; k++) {
        if (deadline && Date.now() > deadline) return;
        try {
          const r = await runBatch(db, { lang: l, difficulty: d, size, runId, holder, log });
          results.push({ lang: l, difficulty: d, ...r });
          if (r.done || r.exhausted || r.skipped || r.status === 'done' || r.status === 'exhausted') break;
        } catch (e) {
          results.push({ lang: l, difficulty: d, error: e.message });
          log(`${l} D${d}: error ${e.message}`);
          break;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, concurrency)) }, worker));
  return { run_id: runId, results };
}

// ── matriz del panel ──
function clueFilter(f = {}) {
  const where = ['1=1']; const args = [];
  if (f.lang) { where.push('c.language_code = ?'); args.push(f.lang); }
  if (f.difficulty) { where.push('c.difficulty = ?'); args.push(Number(f.difficulty)); }
  if (f.origin) { where.push('c.origin = ?'); args.push(f.origin); }
  if (f.author) { where.push("COALESCE(c.author_name, '') LIKE ?"); args.push(`%${f.author}%`); }
  if (f.source) { where.push('c.source_id = ?'); args.push(f.source); }
  if (f.license) { where.push('c.license_id = ?'); args.push(f.license); }
  if (f.status) { where.push('c.status = ?'); args.push(f.status); }
  if (f.mechanism) { where.push('c.mechanism = ?'); args.push(f.mechanism); }
  return { where: where.join(' AND '), args };
}

async function matrix(db, filters = {}) {
  await ensureTargets(db);
  const f = clueFilter(filters);
  const counts = await db.all(`SELECT c.language_code AS lang, c.difficulty AS d, c.origin,
      SUM(c.status = 'published') AS published,
      SUM(c.status IN ('review','draft')) AS pending,
      SUM(c.status = 'disabled') AS disabled,
      SUM(c.validation_status IN ('verified','asserted') AND c.validation_errors = 0) AS validated,
      SUM(c.rights_status IN ('unverified','reference_only')) AS unverified,
      COUNT(*) AS total
    FROM clues c WHERE ${f.where} GROUP BY c.language_code, c.difficulty, c.origin`, f.args);
  const batches = await db.all(`SELECT language_code AS lang, difficulty AS d, SUM(candidates) AS candidates, SUM(rejected) AS rejected,
      SUM(duplicates) AS duplicates, MAX(finished_at) AS last_run, COUNT(*) AS n
    FROM generation_batches GROUP BY language_code, difficulty`);
  const targets = await db.all(`SELECT t.*, l.enabled FROM bank_targets t JOIN languages l ON l.code = t.language_code ORDER BY t.language_code, t.difficulty`);
  const cells = targets.filter((t) => !filters.lang || t.language_code === filters.lang)
    .filter((t) => !filters.difficulty || t.difficulty === Number(filters.difficulty))
    .map((t) => {
      const rows = counts.filter((c) => c.lang === t.language_code && c.d === t.difficulty);
      const sum = (k, pred = () => true) => rows.filter(pred).reduce((a, r) => a + (r[k] || 0), 0);
      const b = batches.find((x) => x.lang === t.language_code && x.d === t.difficulty) || {};
      const published = sum('published');
      return {
        lang: t.language_code, difficulty: t.difficulty, target: t.target, enabled: t.enabled === 1,
        generated: (b.candidates || 0) + sum('total', (r) => r.origin !== 'generated'),
        validated: sum('validated'),
        published,
        published_original: sum('published', (r) => r.origin === 'original' || r.origin === 'generated'),
        published_external: sum('published', (r) => r.origin === 'external'),
        published_community: sum('published', (r) => r.origin === 'community'),
        pending: sum('pending'),
        rejected: (b.rejected || 0) + sum('disabled'),
        duplicates: b.duplicates || 0,
        unverified: sum('unverified'),
        percent: t.target ? Math.floor((published / t.target) * 1000) / 10 : 0,
        missing: Math.max(0, t.target - published),
        last_run: t.last_run_at || b.last_run || null,
        status: t.status, lease_until: t.lease_until, last_error: t.last_error,
        cursor: t.cursor, generator_version: t.generator_version, batches: b.n || 0,
      };
    });
  const totals = cells.reduce((a, c) => {
    for (const k of ['target', 'generated', 'validated', 'published', 'published_original', 'published_external', 'published_community', 'pending', 'rejected', 'duplicates', 'unverified', 'missing']) a[k] = (a[k] || 0) + c[k];
    return a;
  }, {});
  totals.percent = totals.target ? Math.floor((totals.published / totals.target) * 1000) / 10 : 0;
  const audits = await db.get("SELECT SUM(verdict = 'pending') AS pending, SUM(verdict = 'ok') AS ok, SUM(verdict = 'rejected') AS rejected FROM clue_audits");
  return { cells, totals, audits: { pending: audits.pending || 0, ok: audits.ok || 0, rejected: audits.rejected || 0 }, generator: safeVersion() };
}

function safeVersion() {
  try { return generator().VERSION; } catch { return null; }
}

async function batchHistory(db, { lang, difficulty, limit = 30 } = {}) {
  const where = []; const args = [];
  if (lang) { where.push('language_code = ?'); args.push(lang); }
  if (difficulty) { where.push('difficulty = ?'); args.push(Number(difficulty)); }
  const rows = await db.all(`SELECT * FROM generation_batches ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY started_at DESC LIMIT ?`, [...args, Math.min(200, Number(limit) || 30)]);
  return rows.map((r) => ({ ...r, details: parseJson(r.details, {}) }));
}

// ── auditoría ──
async function auditQueue(db, { lang, limit = 20 } = {}) {
  const rows = await db.all(`SELECT a.id AS audit_id, a.batch_id, c.id, c.clue_text, c.answer, c.definition, c.explanation, c.mechanism,
      c.difficulty, c.language_code, c.variant_code, c.evidence
    FROM clue_audits a JOIN clues c ON c.id = a.clue_id
    WHERE a.verdict = 'pending' ${lang ? 'AND c.language_code = ?' : ''} ORDER BY a.created_at LIMIT ?`, lang ? [lang, limit] : [limit]);
  return rows.map((r) => ({ ...r, explanation: parseJson(r.explanation, []), evidence: parseJson(r.evidence, []) }));
}

async function auditVerdict(db, auditId, { verdict, reason }, actor) {
  if (!['ok', 'rejected'].includes(verdict)) throw new HttpError(400, 'invalid_verdict');
  const a = await db.get('SELECT * FROM clue_audits WHERE id = ?', [auditId]);
  if (!a) throw new HttpError(404, 'not_found');
  await db.run('UPDATE clue_audits SET verdict = ?, reason = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?',
    [verdict, reason ? String(reason).slice(0, 500) : null, actor.id, now(), auditId]);
  await db.run('UPDATE clues SET audit_status = ?, updated_at = ? WHERE id = ?', [verdict, now(), a.clue_id]);
  if (verdict === 'rejected') {
    const c = await db.get('SELECT status FROM clues WHERE id = ?', [a.clue_id]);
    await db.run("UPDATE clues SET status = 'disabled', updated_at = ? WHERE id = ?", [now(), a.clue_id]);
    await db.run("INSERT INTO clue_events(clue_id, actor_id, actor_kind, action, from_status, to_status, diff) VALUES (?,?, 'admin', 'audit_reject', ?, 'disabled', ?)",
      [a.clue_id, actor.id, c ? c.status : null, JSON.stringify({ reason: reason || null })]);
  }
  await audit(db, { actorId: actor.id, action: 'bank.audit', targetKind: 'clue', targetId: a.clue_id, details: { verdict, reason: reason || null } });
  // Un lote cuya muestra auditada falla demasiado se retira entero de las partidas.
  let suspended = false;
  if (a.batch_id) {
    const s = await db.get("SELECT SUM(verdict = 'ok') AS ok, SUM(verdict = 'rejected') AS bad FROM clue_audits WHERE batch_id = ?", [a.batch_id]);
    const reviewed = (s.ok || 0) + (s.bad || 0);
    const max = await getSetting(db, 'bank.audit_max_reject_rate');
    if (reviewed >= 3 && (s.bad || 0) / reviewed > max) {
      await suspendBatch(db, a.batch_id, actor, 'auditoría: demasiados rechazos en la muestra');
      suspended = true;
    }
  }
  return { ok: true, suspended };
}

async function suspendBatch(db, batchId, actor, reason) {
  const b = await db.get('SELECT * FROM generation_batches WHERE id = ?', [batchId]);
  if (!b) throw new HttpError(404, 'not_found');
  const r = await db.run("UPDATE clues SET status = 'review', updated_at = ? WHERE batch_id = ? AND status = 'published'", [now(), batchId]);
  await db.run("UPDATE generation_batches SET status = 'suspended', error = ? WHERE id = ?", [reason || 'suspendido por un administrador', batchId]);
  await audit(db, { actorId: actor ? actor.id : null, action: 'bank.suspend_batch', targetKind: 'batch', targetId: batchId, details: { unpublished: r.changes, reason: reason || null } });
  return { unpublished: r.changes };
}

async function setCell(db, lang, difficulty, { target, status }, actor) {
  if (target !== undefined) {
    const t = Number(target);
    if (!Number.isInteger(t) || t < 0 || t > 1000000) throw new HttpError(400, 'invalid_target');
    await db.run('UPDATE bank_targets SET target = ?, updated_at = ? WHERE language_code = ? AND difficulty = ?', [t, now(), lang, difficulty]);
  }
  if (status !== undefined) {
    if (!['paused', 'idle'].includes(status)) throw new HttpError(400, 'invalid_status');
    await db.run('UPDATE bank_targets SET status = ?, lease_until = NULL, updated_at = ? WHERE language_code = ? AND difficulty = ?', [status, now(), lang, difficulty]);
  }
  await audit(db, { actorId: actor.id, action: 'bank.cell', targetKind: 'bank_target', targetId: `${lang}:${difficulty}`, details: { target, status } });
}

module.exports = {
  ensureTargets, runBatch, runCells, verifyBatch, recoverCell, matrix, batchHistory, auditQueue, auditVerdict,
  suspendBatch, setCell, verifyEvidence, clueFilter,
};
