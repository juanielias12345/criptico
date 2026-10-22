'use strict';

// API del banco de crípticos: matriz idioma × dificultad, historial de lotes,
// auditoría por muestra y acciones sobre celdas y lotes. Cada ruta exige su
// permiso en el servidor.

const express = require('express');
const bank = require('../services/bank');
const { HttpError } = require('../services/util');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const LANG = /^[a-z]{2}$/;

function cellParams(req) {
  const lang = String(req.params.lang || '');
  const d = Number(req.params.difficulty);
  if (!LANG.test(lang) || !Number.isInteger(d) || d < 1 || d > 5) throw new HttpError(400, 'invalid_cell');
  return { lang, d };
}

module.exports = function bankRoutes({ need, log }) {
  const r = express.Router();

  r.get('/bank/matrix', need('bank.read'), a(async (req, res) => {
    const q = req.query;
    res.json(await bank.matrix(req.app.locals.db, { lang: q.lang, difficulty: q.difficulty, origin: q.origin, author: q.author,
      source: q.source, license: q.license, status: q.status, mechanism: q.mechanism }));
  }));

  r.get('/bank/batches', need('bank.read'), a(async (req, res) => {
    res.json({ items: await bank.batchHistory(req.app.locals.db, { lang: req.query.lang, difficulty: req.query.difficulty, limit: req.query.limit }) });
  }));

  // Un lote corto desde el panel. Los lotes grandes corren en la tarea programada
  // («Banco de crípticos» en GitHub Actions), porque una función del servidor
  // tiene poco tiempo de ejecución.
  r.post('/bank/cells/:lang/:difficulty/run', need('bank.run'), a(async (req, res) => {
    const { lang, d } = cellParams(req);
    const size = Math.max(1, Math.min(80, Number((req.body || {}).size) || 40));
    const out = await bank.runBatch(req.app.locals.db, { lang, difficulty: d, size, holder: 'panel:' + req.user.id });
    await log(req, 'bank.run', 'bank_target', `${lang}:${d}`, { size, result: out.skipped || out.status || null, published: out.published || 0 });
    res.json(out);
  }));

  r.patch('/bank/cells/:lang/:difficulty', need('bank.run'), a(async (req, res) => {
    const { lang, d } = cellParams(req);
    await bank.setCell(req.app.locals.db, lang, d, req.body || {}, req.user);
    res.json({ ok: true });
  }));

  r.post('/bank/batches/:id/suspend', need('bank.run'), a(async (req, res) => {
    res.json(await bank.suspendBatch(req.app.locals.db, req.params.id, req.user, (req.body || {}).reason));
  }));

  r.post('/bank/batches/:id/verify', need('bank.read'), a(async (req, res) => {
    res.json(await bank.verifyBatch(req.app.locals.db, req.params.id));
  }));

  r.get('/bank/audits', need('bank.audit'), a(async (req, res) => {
    res.json({ items: await bank.auditQueue(req.app.locals.db, { lang: req.query.lang, limit: Math.min(100, Number(req.query.limit) || 20) }) });
  }));

  r.post('/bank/audits/:id', need('bank.audit'), a(async (req, res) => {
    res.json(await bank.auditVerdict(req.app.locals.db, Number(req.params.id), req.body || {}, req.user));
  }));

  return r;
};
