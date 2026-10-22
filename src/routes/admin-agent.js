'use strict';

// API del Agente Autónomo de Biblioteca: estado, informes, registros auditables
// y controles (pausar, reanudar, detener, retirar). Las reglas del agente (metas,
// pesos por mecanismo, presupuesto, modelos) se guardan como ajustes con el permiso
// settings.write (PUT /admin/settings/agent.*), también desde esta sección del panel:
// el agente no puede modificar sus propias reglas ni sus permisos.

const express = require('express');
const agent = require('../services/library-agent');
const { HttpError } = require('../services/util');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VARIANT = /^[a-z]{2}-[A-Z]{2}$/;

module.exports = function agentRoutes({ need }) {
  const r = express.Router();

  r.get('/agent', need('bank.read'), a(async (req, res) => { res.json(await agent.overview(req.app.locals.db)); }));

  r.get('/agent/cycles/:date', need('bank.read'), a(async (req, res) => {
    if (!DATE.test(req.params.date)) throw new HttpError(400, 'invalid_date');
    res.json(await agent.cycleReport(req.app.locals.db, req.params.date));
  }));

  r.get('/agent/candidates', need('bank.read'), a(async (req, res) => {
    const q = req.query;
    if (q.cycle && !DATE.test(q.cycle)) throw new HttpError(400, 'invalid_date');
    if (q.from && !DATE.test(q.from)) throw new HttpError(400, 'invalid_date');
    if (q.to && !DATE.test(q.to)) throw new HttpError(400, 'invalid_date');
    if (q.variant && !VARIANT.test(q.variant)) throw new HttpError(400, 'invalid_variant');
    if (q.status && !agent.STATES.includes(q.status)) throw new HttpError(400, 'invalid_status');
    if (q.mechanism && !/^[a-z_]{3,30}$/.test(q.mechanism)) throw new HttpError(400, 'invalid_mechanism');
    if (q.difficulty && !/^[1-5]$/.test(q.difficulty)) throw new HttpError(400, 'invalid_difficulty');
    res.json({ items: await agent.candidates(req.app.locals.db, { cycle: q.cycle, variant: q.variant, mechanism: q.mechanism, difficulty: q.difficulty,
      status: q.status, from: q.from, to: q.to, limit: q.limit }) });
  }));

  // Retirar contenido cuestionado (derechos, posible copia, error): sale del juego y queda en cuarentena.
  r.post('/agent/candidates/:id/quarantine', need('agent.control'), a(async (req, res) => {
    res.json(await agent.quarantine(req.app.locals.db, String(req.params.id), req.user, (req.body || {}).reason));
  }));

  r.post('/agent/control', need('agent.control'), a(async (req, res) => {
    const { state, reason } = req.body || {};
    await agent.setControl(req.app.locals.db, state, req.user, reason);
    res.json({ ok: true });
  }));

  r.patch('/agent/variants/:code', need('agent.control'), a(async (req, res) => {
    if (!VARIANT.test(req.params.code)) throw new HttpError(400, 'invalid_variant');
    const b = req.body || {};
    await agent.setVariant(req.app.locals.db, req.params.code, { status: b.status, library_target: b.library_target }, req.user);
    res.json({ ok: true });
  }));

  return r;
};
