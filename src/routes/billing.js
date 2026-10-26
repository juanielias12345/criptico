'use strict';

// Plan Plus: estado, enlace de pago y beneficios con datos (comparación con la comunidad). El webhook del procesador está en app.js
// (necesita el cuerpo crudo para verificar la firma).

const express = require('express');
const P = require('../services/plus');
const { HttpError } = require('../services/util');
const { hit } = require('../services/ratelimit');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = function billingApi() {
  const r = express.Router();
  r.get('/billing/plus', a(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await P.status(req.app.locals.db, req.app.locals.config, req.user));
  }));
  r.post('/billing/plus/checkout', a(async (req, res) => {
    if (req.user && !(await hit(req.app.locals.db, `checkout:${req.user.id}`, 20, 'day')).allowed) throw new HttpError(429, 'rate_limited', 'Probá de nuevo más tarde.');
    res.json(await P.checkout(req.app.locals.db, req.app.locals.config, req.user, (req.body || {}).plan === 'yearly' ? 'yearly' : 'monthly'));
  }));
  // Comparación con la comunidad (solo Plus).
  r.get('/plus/comparison', a(async (req, res) => {
    if (!req.user) throw new HttpError(401, 'login_required');
    if (!P.isPlus(req.user)) throw new HttpError(403, 'plus_required', 'La comparación con la comunidad es exclusiva de Plus.');
    res.set('Cache-Control', 'no-store');
    res.json(await P.comparison(req.app.locals.db, req.user, 'es'));
  }));
  return r;
};
