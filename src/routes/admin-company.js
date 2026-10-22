'use strict';

// API de la empresa: seguridad de la cuenta propia, equipo e invitaciones,
// bandeja de aprobaciones y centro de operaciones. Cada ruta exige su permiso
// en el servidor; las decisiones de aprobación son solo de los CEO (rol owner).

const express = require('express');
const security = require('../services/security');
const gov = require('../services/governance');
const company = require('../services/company');
const { HttpError } = require('../services/util');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const db = (req) => req.app.locals.db;
const actor = (req) => req.user;

module.exports = function companyRoutes({ need }) {
  const r = express.Router();
  const staff = (req, res, next) => (req.user && req.user.role !== 'player' ? next() : next(new HttpError(401, 'login_required')));

  // ── Mi seguridad (cualquier cuenta del equipo) ──
  r.get('/security/me', staff, a(async (req, res) => {
    const u = await db(req).get('SELECT mfa_enabled_at, mfa_recovery, password_changed_at, title, display_name FROM users WHERE id = ?', [req.user.id]);
    res.json({ mfa_enabled: !!u.mfa_enabled_at, mfa_enabled_at: u.mfa_enabled_at, recovery_left: u.mfa_recovery ? JSON.parse(u.mfa_recovery).length : 0,
      password_changed_at: u.password_changed_at, title: u.title, display_name: u.display_name, require_mfa: await security.require2fa(db(req)),
      sessions: await security.listSessions(db(req), req.user.id, req.session.sessionId),
      devices: await db(req).all('SELECT first_seen_at, last_seen_at FROM staff_devices WHERE user_id = ? ORDER BY last_seen_at DESC', [req.user.id]) });
  }));
  r.post('/security/mfa/setup', staff, a(async (req, res) => res.json(await security.mfaSetup(db(req), req.app.locals.config, req.user.id, req.app.locals.config.siteName))));
  r.post('/security/mfa/enable', staff, a(async (req, res) => res.json(await security.mfaEnable(db(req), req.app.locals.config, req.user, (req.body || {}).code,
    { sessionId: req.session.sessionId, ipHash: req.ipHash }))));
  r.post('/security/mfa/disable', staff, a(async (req, res) => res.json(await security.mfaDisable(db(req), req.app.locals.config, req.user, req.body || {}, { ipHash: req.ipHash }))));
  r.post('/security/sessions/revoke', staff, a(async (req, res) => {
    const b = req.body || {};
    res.json(await security.revokeSessions(db(req), req.user, { sessionPrefix: b.session, allButCurrent: b.others === true, currentId: req.session.sessionId, ipHash: req.ipHash }));
  }));
  r.patch('/security/profile', staff, a(async (req, res) => {
    const b = req.body || {};
    await db(req).run('UPDATE users SET display_name = COALESCE(?, display_name), title = COALESCE(?, title) WHERE id = ?',
      [b.display_name ? String(b.display_name).slice(0, 80) : null, b.title ? String(b.title).slice(0, 80) : null, req.user.id]);
    res.json({ ok: true });
  }));

  // ── Equipo: invitaciones y recuperación ──
  r.get('/team/tokens', need('users.manage'), a(async (req, res) => res.json({ items: await security.listTokens(db(req)) })));
  r.post('/team/invites', need('users.manage'), a(async (req, res) => {
    const b = req.body || {};
    const out = await security.createInvite(db(req), req.user, { role: b.role, title: b.title, display_name: b.display_name }, req.ipHash);
    res.status(201).json({ ...out, path: '/admin#invite?token=' + out.token });
  }));
  r.post('/team/users/:id/reset', need('users.manage'), a(async (req, res) => {
    const out = await security.createReset(db(req), req.user, req.params.id, req.ipHash);
    res.status(201).json({ ...out, path: '/admin#reset?token=' + out.token });
  }));
  r.post('/team/users/:id/sessions/revoke', need('users.manage'), a(async (req, res) => {
    res.json(await security.revokeSessions(db(req), req.user, { userId: req.params.id, ipHash: req.ipHash }));
  }));
  r.post('/team/tokens/:id/revoke', need('users.manage'), a(async (req, res) => res.json(await security.revokeToken(db(req), req.user, req.params.id, req.ipHash))));

  // ── Aprobaciones ──
  r.get('/approvals', need('company.read'), a(async (req, res) => {
    res.json({ items: await gov.list(db(req), { status: req.query.status, area: req.query.area, limit: Number(req.query.limit) || 50 }),
      conflicts: await db(req).all("SELECT * FROM ceo_conflicts WHERE status = 'open' ORDER BY created_at"), owners: await gov.ownersCount(db(req)), kinds: gov.KINDS,
      dual: (await require('../services/settings').getSetting(db(req), 'governance.dual_approval')) === true });
  }));
  r.get('/approvals/:id', need('company.read'), a(async (req, res) => res.json(await gov.get(db(req), req.params.id))));
  r.post('/approvals', need('approvals.request'), a(async (req, res) => {
    const b = req.body || {};
    res.status(201).json(await gov.createRequest(db(req), { kind: b.kind, title: b.title, summary: b.summary, content: b.content, amount: b.amount, currency: b.currency }, actor(req)));
  }));
  r.put('/approvals/:id', need('approvals.request'), a(async (req, res) => {
    const b = req.body || {};
    res.json(await gov.revise(db(req), req.params.id, { content: b.content, title: b.title, summary: b.summary, amount: b.amount }, actor(req)));
  }));
  r.post('/approvals/:id/vote', need('approvals.decide'), a(async (req, res) => res.json(await gov.vote(db(req), req.params.id, req.body || {}, actor(req)))));
  r.post('/approvals/:id/withdraw', need('approvals.request'), a(async (req, res) => res.json(await gov.withdraw(db(req), req.params.id, actor(req)))));
  r.post('/approvals/:id/executed', need('approvals.decide'), a(async (req, res) => {
    await gov.markExecuted(db(req), req.params.id, (req.body || {}).evidence, actor(req));
    res.json(await gov.get(db(req), req.params.id));
  }));
  r.post('/conflicts/:id/resolve', need('approvals.decide'), a(async (req, res) => res.json(await gov.resolveConflict(db(req), Number(req.params.id), (req.body || {}).resolution, actor(req)))));

  // ── Centro de operaciones ──
  r.get('/company/overview', need('company.read'), a(async (req, res) => res.json(await company.overview(db(req), { config: req.app.locals.config }))));
  r.get('/company/agents', need('company.read'), a(async (req, res) => res.json({ items: await company.agents(db(req)) })));
  r.get('/company/agents/:id/runs', need('company.read'), a(async (req, res) => {
    res.json({ items: await db(req).all('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 50', [req.params.id]) });
  }));
  r.get('/company/tasks', need('company.read'), a(async (req, res) => res.json({ items: await company.listTasks(db(req), req.query) })));
  r.post('/company/tasks', need('company.write'), a(async (req, res) => res.status(201).json(await company.saveTask(db(req), null, req.body || {}, actor(req)))));
  r.patch('/company/tasks/:id', need('company.write'), a(async (req, res) => res.json(await company.saveTask(db(req), req.params.id, req.body || {}, actor(req)))));
  r.post('/company/tasks/:id/request-approval', need('approvals.request'), a(async (req, res) => res.status(201).json(await company.requestTaskApproval(db(req), req.params.id, req.body || {}, actor(req)))));
  r.get('/company/risks', need('company.read'), a(async (req, res) => res.json({ items: await db(req).all('SELECT * FROM risks ORDER BY id') })));
  r.post('/company/risks', need('company.write'), a(async (req, res) => res.status(201).json(await company.saveRisk(db(req), null, req.body || {}, actor(req)))));
  r.patch('/company/risks/:id', need('company.write'), a(async (req, res) => res.json(await company.saveRisk(db(req), req.params.id, req.body || {}, actor(req)))));
  r.get('/company/costs', need('company.read'), a(async (req, res) => res.json({ items: await db(req).all('SELECT * FROM costs ORDER BY created_at DESC LIMIT 200') })));
  r.post('/company/costs', need('company.write'), a(async (req, res) => res.status(201).json(await company.addCost(db(req), req.body || {}, actor(req)))));
  r.patch('/company/integrations/:id', need('company.write'), a(async (req, res) => res.json(await company.saveIntegration(db(req), req.params.id, req.body || {}, actor(req)))));

  // Legal
  r.get('/legal/documents', need('company.read'), a(async (req, res) => res.json({ items: await company.legalDocs(db(req)) })));
  r.get('/legal/documents/:doc/:version/:lang', need('company.read'), a(async (req, res) => res.json(await company.legalVersion(db(req), req.params.doc, req.params.version, req.params.lang))));
  r.post('/legal/documents/:doc/drafts', need('legal.write'), a(async (req, res) => res.status(201).json(await company.newLegalDraft(db(req), req.params.doc, req.body || {}, actor(req)))));
  r.post('/legal/documents/:doc/:version/:lang/submit', need('legal.write'), a(async (req, res) => res.status(201).json(await company.submitLegal(db(req), req.params.doc, req.params.version, req.params.lang, actor(req)))));
  r.post('/legal/documents/:doc/:version/:lang/published', need('approvals.decide'), a(async (req, res) => res.json(await company.markLegalPublished(db(req), req.params.doc, req.params.version, req.params.lang, (req.body || {}).evidence, actor(req)))));
  r.post('/legal/global/approve', need('approvals.decide'), a(async (req, res) => res.json(await company.approveGlobalLegal(db(req), actor(req), req.app.locals.config.siteUrl))));
  r.put('/legal/jurisdictions/:code', need('legal.write'), a(async (req, res) => res.json(await company.saveJurisdiction(db(req), String(req.params.code).toUpperCase(), req.body || {}, actor(req)))));

  // Contenido
  // Archivos reales de las piezas (diseños) guardados en data/marketing: solo para el equipo.
  r.get(/^\/content-assets\/(marketing\/[a-z0-9-]+\/[a-z0-9-]+\.png)$/, need('company.read'), (req, res, next) => {
    const path = require('path');
    const file = path.join(__dirname, '..', '..', 'data', req.params[0]);
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(file, (err) => { if (err) next(new HttpError(404, 'not_found')); });
  });
  // Calendario de redes: carpetas por día, aprobación en bloque y programación.
  const social = require('../services/social');
  r.get('/social/calendar', need('company.read'), a(async (req, res) => res.json(await social.calendar(db(req)))));
  r.get('/social/days/:n', need('company.read'), a(async (req, res) => res.json(await social.day(db(req), req.params.n))));
  r.post('/social/approve', need('approvals.decide'), a(async (req, res) => res.json(await social.approveMany(db(req), (req.body || {}).items, actor(req)))));
  r.post('/social/pieces/:id/changes', need('approvals.decide'), a(async (req, res) => res.json(await social.requestChanges(db(req), req.params.id, (req.body || {}).comment, actor(req)))));
  r.post('/social/pieces/:id/schedule', need('approvals.decide'), a(async (req, res) => {
    const p = await db(req).get('SELECT * FROM content_pieces WHERE id = ?', [req.params.id]);
    if (!p) throw new HttpError(404, 'not_found');
    res.json(await social.scheduleOne(db(req), p));
  }));
  r.get('/content', need('company.read'), a(async (req, res) => res.json({ items: await company.listPieces(db(req), { status: req.query.status }) })));
  r.get('/content/:id', need('company.read'), a(async (req, res) => res.json(await company.getPiece(db(req), req.params.id))));
  r.post('/content', need('content.write'), a(async (req, res) => res.status(201).json(await company.savePiece(db(req), null, req.body || {}, actor(req)))));
  r.patch('/content/:id', need('content.write'), a(async (req, res) => res.json(await company.savePiece(db(req), req.params.id, req.body || {}, actor(req)))));
  r.post('/content/:id/status', need('content.write'), a(async (req, res) => {
    const b = req.body || {};
    // Programar y marcar como publicada son decisiones de un CEO.
    if (['scheduled', 'published'].includes(b.status) && !require('../services/auth').can(req.user, 'approvals.decide')) throw new HttpError(403, 'forbidden');
    res.json(await company.setPieceStatus(db(req), req.params.id, b, actor(req)));
  }));

  return r;
};
