'use strict';

const path = require('path');
const express = require('express');
const { sessionFromToken } = require('./services/auth');
const { logError } = require('./services/audit');
const { HttpError, ipHash } = require('./services/util');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function securityHeaders(config) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
      "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ].join('; '));
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals.db = db;
  app.locals.config = config;

  app.use(securityHeaders(config));
  app.use(express.json({ limit: '200kb' }));

  // Identidad: sesión (opcional) y jugador anónimo.
  app.use(async (req, res, next) => {
    try {
      req.cookies = parseCookies(req.headers.cookie);
      req.ipHash = ipHash(req.ip, config.ipHashSalt);
      req.session = await sessionFromToken(db, req.cookies.sid);
      req.user = req.session ? req.session.user : null;
      req.playerId = req.cookies.pid || null;
      next();
    } catch (e) { next(e); }
  });

  // Protección CSRF para peticiones que modifican datos:
  //  - deben ser JSON (un formulario de otro sitio no puede enviarlo sin preflight CORS),
  //  - si traen Origin, debe ser este mismo sitio,
  //  - con sesión iniciada, además deben traer el token CSRF de la sesión.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/cron/')) return next();
    if (!req.is('application/json')) return next(new HttpError(415, 'json_required'));
    const origin = req.headers.origin;
    if (origin) {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      try { if (new URL(origin).host !== host) return next(new HttpError(403, 'bad_origin')); } catch { return next(new HttpError(403, 'bad_origin')); }
    }
    if (req.session && req.headers['x-csrf-token'] !== req.session.csrf && !['/auth/login', '/auth/register'].includes(req.path)) {
      return next(new HttpError(403, 'csrf_failed', 'La sesión expiró. Recargá la página.'));
    }
    next();
  });

  app.use('/api/admin', require('./routes/admin')());
  app.use('/api', require('./routes/api')());
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.production ? '7d' : 0, index: false }));
  app.use(require('./routes/pages')());

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use(async (err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    console.error(err);
    await logError(db, 'http', err, { path: req.path, method: req.method });
    if (req.path.startsWith('/api')) return res.status(500).json({ error: 'server_error' });
    res.status(500).send('Error interno');
  });
  return app;
}

module.exports = { createApp, parseCookies };
