'use strict';

const crypto = require('crypto');

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

function parseJson(text, fallback) {
  if (text === null || text === undefined) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Hash de IP con sal: sirve para limitar abusos sin guardar la IP.
function ipHash(ip, salt) {
  return sha256(`${salt || ''}:${ip || ''}`).slice(0, 32);
}

module.exports = { uuid, now, sha256, randomToken, parseJson, HttpError, ipHash };
