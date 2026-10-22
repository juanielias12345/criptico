'use strict';

const { DEFAULT_SETTINGS } = require('../db/reference');
const { parseJson, now } = require('./util');

async function getSetting(db, key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? parseJson(row.value, DEFAULT_SETTINGS[key]) : DEFAULT_SETTINGS[key];
}

async function getAllSettings(db) {
  const rows = await db.all('SELECT key, value FROM settings ORDER BY key');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = parseJson(r.value, DEFAULT_SETTINGS[r.key]);
  return out;
}

// Solo se aceptan claves conocidas y del mismo tipo que el valor por defecto.
function validateSetting(key, value) {
  if (!(key in DEFAULT_SETTINGS)) return 'unknown_setting';
  const def = DEFAULT_SETTINGS[key];
  if (Array.isArray(def) !== Array.isArray(value)) return 'invalid_type';
  if (typeof def !== typeof value) return 'invalid_type';
  if (typeof def === 'number' && (!Number.isFinite(value) || value < 0 || value > 100000)) return 'invalid_range';
  if (key === 'agent.mechanism_weights') {
    const known = new Set(require('../lib/agent/mechanisms').production());
    for (const [m, w] of Object.entries(value || {})) if (!known.has(m) || typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 100) return 'invalid_weights';
  }
  if (key === 'agent.mechanisms' && !value.every((m) => require('../lib/agent/mechanisms').production().includes(m))) return 'invalid_mechanism';
  if (key === 'agent.concurrency' && (!Number.isInteger(value) || value < 1 || value > 8)) return 'invalid_range';
  if (key === 'hq.report_timezone') { try { new Intl.DateTimeFormat('es', { timeZone: value }); } catch { return 'invalid_timezone'; } }
  return null;
}

async function setSetting(db, key, value, actorId) {
  await db.run(
    `INSERT INTO settings(key, value, updated_at, updated_by) VALUES (?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [key, JSON.stringify(value), now(), actorId || null]);
}

module.exports = { getSetting, getAllSettings, setSetting, validateSetting };
