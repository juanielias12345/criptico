'use strict';

// API de AI Company HQ (oficina virtual de los CEO). Solo los permisos hq.*,
// que tienen los dos CEO por igual (rol owner). Ver docs/HQ.md.

const express = require('express');
const hq = require('../services/hq');
const reports = require('../services/hq-reports');
const { HttpError } = require('../services/util');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const db = (req) => req.app.locals.db;

module.exports = function hqRoutes({ need }) {
  const r = express.Router();
  const read = need('hq.read'); const act = need('hq.act');

  r.get('/hq/state', read, a(async (req, res) => {
    const s = await hq.snapshot(db(req), { config: req.app.locals.config });
    s.unread_reports = await reports.unread(db(req), req.user.id);
    s.me = { username: req.user.username, display_name: req.user.display_name };
    res.json(s);
  }));
  r.get('/hq/events', read, a(async (req, res) => res.json({ items: await hq.listEvents(db(req), { since: req.query.since, before: req.query.before, agentId: req.query.agent, limit: req.query.limit }) })));
  r.get('/hq/agents/:id', read, a(async (req, res) => res.json(await hq.agentSheet(db(req), req.params.id))));
  r.post('/hq/agents/:id/tasks', act, a(async (req, res) => res.status(201).json(await hq.assignTask(db(req), req.params.id, req.body || {}, req.user))));
  r.patch('/hq/tasks/:id/priority', act, a(async (req, res) => res.json(await hq.setPriority(db(req), req.params.id, (req.body || {}).priority, req.user))));
  r.post('/hq/agents/:id/pause', act, a(async (req, res) => res.json(await hq.pause(db(req), req.params.id, req.body || {}, req.user))));
  r.post('/hq/agents/:id/resume', act, a(async (req, res) => res.json(await hq.resume(db(req), req.params.id, req.user))));
  r.post('/hq/agents/:id/retry', act, a(async (req, res) => res.json(await hq.retry(db(req), req.params.id, req.body || {}, req.user, { siteUrl: req.app.locals.config.siteUrl }))));
  r.post('/hq/agents/:id/report', act, a(async (req, res) => res.json(await hq.agentReport(db(req), req.params.id, req.user))));
  r.post('/hq/agents/:id/corrections', act, a(async (req, res) => res.status(201).json(await hq.proposeCorrection(db(req), req.params.id, req.user))));
  r.post('/hq/corrections/:id/applied', act, a(async (req, res) => res.json(await hq.correctionApplied(db(req), req.params.id, req.user))));

  r.get('/hq/rooms/servers', read, a(async (req, res) => res.json(await hq.servers(db(req), { config: req.app.locals.config }))));
  r.get('/hq/rooms/social/:platform', read, a(async (req, res) => res.json(await hq.socialRoom(db(req), req.params.platform))));
  r.get('/hq/rooms/product', read, a(async (req, res) => res.json(await hq.productRoom(db(req)))));
  r.get('/hq/rooms/legal', read, a(async (req, res) => res.json(await hq.legalRoom(db(req)))));
  r.get('/hq/rooms/marketing', read, a(async (req, res) => res.json(await hq.marketingRoom(db(req)))));

  r.get('/hq/reports', read, a(async (req, res) => res.json({ items: await reports.list(db(req), req.user.id), next: await reports.nextRun(db(req)) })));
  r.post('/hq/reports', act, a(async (req, res) => {
    const out = await reports.generate(db(req), { trigger: 'manual', actor: req.user });
    if (out.skipped === 'duplicate' || out.skipped === 'in_progress') throw new HttpError(409, 'report_exists', 'Ya se generó un informe en este minuto.');
    res.status(201).json(out);
  }));
  r.get('/hq/reports/:id', read, a(async (req, res) => res.json(await reports.get(db(req), req.params.id, req.user))));
  r.get('/hq/reports/:id/markdown', read, a(async (req, res) => {
    const rep = await reports.get(db(req), req.params.id, null);
    res.set('Content-Disposition', `attachment; filename="informe-${rep.period_end.slice(0, 10)}.md"`);
    res.type('text/markdown').send(reports.toMarkdown(rep));
  }));
  return r;
};
