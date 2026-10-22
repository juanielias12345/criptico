'use strict';

// Seguridad de las cuentas del equipo: segundo factor (TOTP, RFC 6238) con
// códigos de recuperación, invitaciones y enlaces de recuperación de un solo uso,
// sesiones visibles y revocables, y alerta de acceso desde un dispositivo nuevo.
// Sin dependencias externas.

const crypto = require('crypto');
const { uuid, now, sha256, randomToken, parseJson, HttpError } = require('./util');
const { audit } = require('./audit');
const auth = require('./auth');
const alerts = require('./alerts');

// ── Cifrado del secreto TOTP ──
// Clave: MFA_ENCRYPTION_KEY si existe; si no, derivada de IP_HASH_SALT (obligatoria
// en producción). Cambiar cualquiera de las dos invalida los MFA ya configurados.
function key(config) {
  const base = (config && (config.mfaKey || config.ipHashSalt)) || 'dev-only-key';
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(base), Buffer.from('play-cripticos'), Buffer.from('mfa-totp'), 32));
}
function encrypt(config, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(config), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}
function decrypt(config, blob) {
  const [v, iv, tag, enc] = String(blob || '').split('.');
  if (v !== 'v1') throw new Error('mfa_secret_format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(config), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}

// ── TOTP ──
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(s).replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, t = Date.now(), step = 30) {
  const counter = Math.floor(t / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, '0');
}
// Acepta el período actual y uno a cada lado (relojes desfasados).
function totpStep(secret, code, t = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const k = [-1, 0, 1].find((d) => crypto.timingSafeEqual(Buffer.from(totp(secret, t + d * 30000)), Buffer.from(c)));
  return k === undefined ? null : Math.floor(t / 30000) + k;
}
const totpValid = (secret, code, t) => totpStep(secret, code, t) !== null;
// Un código ya usado no vuelve a servir (RFC 6238 §5.2): se guarda el último período aceptado.
async function consumeTotp(db, userId, secret, code) {
  const step = totpStep(secret, code);
  if (step === null) return false;
  const r = await db.run('UPDATE users SET mfa_last_step = ? WHERE id = ? AND (mfa_last_step IS NULL OR mfa_last_step < ?)', [step, userId, step]);
  return r.changes === 1;
}

const recoveryHash = (code) => sha256('recovery:' + String(code).replace(/[\s-]/g, '').toUpperCase());
function newRecoveryCodes() {
  return Array.from({ length: 8 }, () => {
    const raw = base32Encode(crypto.randomBytes(5)).slice(0, 8);
    return raw.slice(0, 4) + '-' + raw.slice(4);
  });
}

// Comprueba el segundo factor de una cuenta (código TOTP o de recuperación de un solo uso).
async function checkSecondFactor(db, config, user, code) {
  if (!user.mfa_enabled_at) return { ok: true, method: null };
  const c = String(code || '').trim();
  if (!c) return { ok: false };
  let secret;
  try { secret = decrypt(config, user.mfa_secret); } catch { return { ok: false, broken: true }; }
  if (await consumeTotp(db, user.id, secret, c)) return { ok: true, method: 'totp' };
  const list = parseJson(user.mfa_recovery, []);
  const h = recoveryHash(c);
  if (list.includes(h)) {
    // Un código de recuperación se usa una sola vez.
    const r = await db.run('UPDATE users SET mfa_recovery = ? WHERE id = ? AND mfa_recovery = ?', [JSON.stringify(list.filter((x) => x !== h)), user.id, user.mfa_recovery]);
    if (r.changes === 1) return { ok: true, method: 'recovery', remaining: list.length - 1 };
  }
  return { ok: false };
}

// Paso 1 de la activación: se genera el secreto y se guarda sin activar.
async function mfaSetup(db, config, userId, siteName) {
  const u = await db.get('SELECT id, username, mfa_enabled_at FROM users WHERE id = ?', [userId]);
  if (u.mfa_enabled_at) throw new HttpError(409, 'mfa_already_enabled');
  const secret = base32Encode(crypto.randomBytes(20));
  await db.run('UPDATE users SET mfa_secret = ? WHERE id = ?', [encrypt(config, secret), userId]);
  const issuer = siteName || 'Play Crípticos';
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(u.username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

// Paso 2: con un código correcto se activa y se entregan los códigos de recuperación (una sola vez).
async function mfaEnable(db, config, user, code, ctx) {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
  if (u.mfa_enabled_at) throw new HttpError(409, 'mfa_already_enabled');
  if (!u.mfa_secret) throw new HttpError(400, 'mfa_setup_required');
  if (!(await consumeTotp(db, u.id, decrypt(config, u.mfa_secret), code))) throw new HttpError(400, 'invalid_code', 'El código no es correcto.');
  const codes = newRecoveryCodes();
  await db.run('UPDATE users SET mfa_enabled_at = ?, mfa_recovery = ? WHERE id = ?', [now(), JSON.stringify(codes.map(recoveryHash)), u.id]);
  if (ctx && ctx.sessionId) await db.run('UPDATE sessions SET mfa_at = ? WHERE id = ?', [now(), ctx.sessionId]);
  await audit(db, { actorId: u.id, action: 'security.mfa_enabled', targetKind: 'user', targetId: u.id, ipHash: ctx && ctx.ipHash });
  return { recovery_codes: codes };
}

// Desactivar exige la contraseña y un código vigente.
async function mfaDisable(db, config, user, { password, code }, ctx) {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
  if (!u.mfa_enabled_at) throw new HttpError(409, 'mfa_not_enabled');
  if (!auth.verifyPassword(password, u.password_hash)) throw new HttpError(401, 'invalid_credentials', 'La contraseña no es correcta.');
  if (!(await checkSecondFactor(db, config, u, code)).ok) throw new HttpError(400, 'invalid_code', 'El código no es correcto.');
  if (u.role === 'owner' && await require2fa(db)) throw new HttpError(409, 'mfa_required_by_policy', 'La política exige MFA para los superadministradores.');
  await db.run('UPDATE users SET mfa_enabled_at = NULL, mfa_secret = NULL, mfa_recovery = NULL WHERE id = ?', [u.id]);
  await audit(db, { actorId: u.id, action: 'security.mfa_disabled', targetKind: 'user', targetId: u.id, ipHash: ctx && ctx.ipHash });
  return { ok: true };
}

async function require2fa(db) {
  const r = await db.get("SELECT value FROM settings WHERE key = 'security.require_mfa_owner'");
  return r ? JSON.parse(r.value) === true : false;
}

// ── Dispositivo nuevo: alerta y registro ──
async function noteDevice(db, user, { ipHash, userAgent }) {
  if (user.role === 'player') return { isNew: false };
  const fp = sha256(`${ipHash || ''}|${String(userAgent || '').slice(0, 200)}`).slice(0, 32);
  const known = await db.get('SELECT 1 FROM staff_devices WHERE user_id = ? AND fingerprint = ?', [user.id, fp]);
  const t = now();
  if (known) { await db.run('UPDATE staff_devices SET last_seen_at = ? WHERE user_id = ? AND fingerprint = ?', [t, user.id, fp]); return { isNew: false }; }
  const first = !(await db.get('SELECT 1 FROM staff_devices WHERE user_id = ?', [user.id]));
  await db.run('INSERT INTO staff_devices(user_id, fingerprint, first_seen_at, last_seen_at) VALUES (?,?,?,?)', [user.id, fp, t, t]);
  if (!first) {
    await alerts.raise(db, { key: `new_device:${user.id}:${fp}`, kind: 'security', severity: user.role === 'owner' ? 'warning' : 'info',
      title: `Acceso de ${user.username} desde un dispositivo o red nuevos`,
      details: { user_id: user.id, username: user.username, user_agent: String(userAgent || '').slice(0, 120), at: t } });
  }
  return { isNew: !first };
}

// ── Sesiones ──
async function listSessions(db, userId, currentId) {
  const rows = await db.all('SELECT id, created_at, expires_at, last_seen_at, user_agent, mfa_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC', [userId, now()]);
  return rows.map((r) => ({ id: r.id.slice(0, 16), current: r.id === currentId, created_at: r.created_at, expires_at: r.expires_at,
    last_seen_at: r.last_seen_at, user_agent: r.user_agent, mfa: !!r.mfa_at }));
}

async function revokeSessions(db, actor, { userId, sessionPrefix, allButCurrent, currentId, ipHash }) {
  const target = userId || actor.id;
  if (target !== actor.id && !auth.can(actor, 'users.manage')) throw new HttpError(403, 'forbidden');
  let r;
  if (sessionPrefix) {
    if (!/^[0-9a-f]{16}$/.test(sessionPrefix)) throw new HttpError(400, 'invalid_session');
    r = await db.run("DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ?", [target, sessionPrefix]);
  } else if (allButCurrent) {
    r = await db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [target, currentId || '']);
  } else {
    r = await db.run('DELETE FROM sessions WHERE user_id = ?', [target]);
  }
  await audit(db, { actorId: actor.id, action: 'security.sessions_revoked', targetKind: 'user', targetId: target, details: { count: r.changes, one: !!sessionPrefix }, ipHash });
  return { revoked: r.changes };
}

// ── Invitaciones y recuperación ──
const INVITE_HOURS = 72;
const RESET_HOURS = 24;

async function createInvite(db, actor, { role, title, display_name }, ipHash) {
  if (!auth.STAFF_ROLES.includes(role)) throw new HttpError(400, 'invalid_role');
  const token = randomToken(32);
  const expires = new Date(Date.now() + INVITE_HOURS * 3600000).toISOString();
  await db.run('INSERT INTO staff_tokens(id, kind, role, title, display_name, created_by, expires_at) VALUES (?,?,?,?,?,?,?)',
    [sha256(token), 'invite', role, title ? String(title).slice(0, 80) : null, display_name ? String(display_name).slice(0, 80) : null, actor.id, expires]);
  await audit(db, { actorId: actor.id, action: 'team.invite_created', targetKind: 'invite', targetId: sha256(token).slice(0, 16), details: { role, title: title || null, display_name: display_name || null }, ipHash });
  return { token, expires_at: expires };
}

async function createReset(db, actor, userId, ipHash) {
  const u = await db.get('SELECT id, role, username FROM users WHERE id = ?', [userId]);
  if (!u || u.role === 'player') throw new HttpError(404, 'not_found');
  if (u.id === actor.id) throw new HttpError(400, 'own_account', 'Otra persona del equipo con permiso debe generar tu enlace de recuperación.');
  const token = randomToken(32);
  const expires = new Date(Date.now() + RESET_HOURS * 3600000).toISOString();
  await db.run("UPDATE staff_tokens SET revoked_at = ? WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL AND revoked_at IS NULL", [now(), u.id]);
  await db.run('INSERT INTO staff_tokens(id, kind, user_id, created_by, expires_at) VALUES (?,?,?,?,?)', [sha256(token), 'reset', u.id, actor.id, expires]);
  await audit(db, { actorId: actor.id, action: 'team.reset_created', targetKind: 'user', targetId: u.id, ipHash });
  return { token, expires_at: expires };
}

async function tokenInfo(db, token) {
  const t = await db.get('SELECT * FROM staff_tokens WHERE id = ?', [sha256(String(token || ''))]);
  if (!t || t.used_at || t.revoked_at || Date.parse(t.expires_at) < Date.now()) throw new HttpError(404, 'invalid_token', 'El enlace no es válido o venció.');
  return t;
}

async function acceptInvite(db, { token, username, password, display_name, email }, ipHash) {
  const t = await tokenInfo(db, token);
  if (t.kind !== 'invite') throw new HttpError(404, 'invalid_token');
  const user = await auth.createUser(db, { username, password, email, role: t.role, displayName: display_name || t.display_name });
  const claim = await db.run('UPDATE staff_tokens SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL', [now(), user.id, t.id]);
  if (claim.changes !== 1) { await db.run('DELETE FROM users WHERE id = ?', [user.id]); throw new HttpError(409, 'invalid_token'); }
  if (t.title) await db.run('UPDATE users SET title = ? WHERE id = ?', [t.title, user.id]);
  await audit(db, { actorId: user.id, action: 'team.invite_accepted', targetKind: 'user', targetId: user.id, details: { role: t.role, invited_by: t.created_by }, ipHash });
  return { user_id: user.id, role: t.role };
}

// Recuperar: nueva contraseña; se cierran todas las sesiones y se quita el MFA
// (la persona lo vuelve a configurar al entrar).
async function useReset(db, { token, password }, ipHash) {
  const t = await tokenInfo(db, token);
  if (t.kind !== 'reset') throw new HttpError(404, 'invalid_token');
  const u = await db.get('SELECT id, username FROM users WHERE id = ?', [t.user_id]);
  const problems = auth.passwordProblems(password, u.username);
  if (problems.length) throw new HttpError(400, 'weak_password', 'La contraseña es débil.', { problems });
  const claim = await db.run('UPDATE staff_tokens SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL', [now(), u.id, t.id]);
  if (claim.changes !== 1) throw new HttpError(409, 'invalid_token');
  await db.run('UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL, mfa_enabled_at = NULL, mfa_secret = NULL, mfa_recovery = NULL WHERE id = ?',
    [auth.hashPassword(password), now(), u.id]);
  await db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
  await audit(db, { actorId: u.id, action: 'team.reset_used', targetKind: 'user', targetId: u.id, details: { created_by: t.created_by }, ipHash });
  return { ok: true, username: u.username };
}

async function listTokens(db) {
  return db.all(`SELECT substr(t.id, 1, 16) AS id, t.kind, t.role, t.title, t.display_name, t.expires_at, t.used_at, t.revoked_at, t.created_at,
      c.username AS created_by, u.username AS used_by, r.username AS for_user
    FROM staff_tokens t JOIN users c ON c.id = t.created_by LEFT JOIN users u ON u.id = t.used_by LEFT JOIN users r ON r.id = t.user_id
    ORDER BY t.created_at DESC LIMIT 50`);
}

async function revokeToken(db, actor, prefix, ipHash) {
  if (!/^[0-9a-f]{16}$/.test(String(prefix))) throw new HttpError(400, 'invalid_token');
  const r = await db.run('UPDATE staff_tokens SET revoked_at = ? WHERE substr(id, 1, 16) = ? AND used_at IS NULL AND revoked_at IS NULL', [now(), prefix]);
  if (!r.changes) throw new HttpError(404, 'not_found');
  await audit(db, { actorId: actor.id, action: 'team.token_revoked', targetKind: 'invite', targetId: prefix, ipHash });
  return { ok: true };
}

module.exports = {
  totp, totpValid, base32Encode, base32Decode, encrypt, decrypt, newRecoveryCodes, checkSecondFactor, mfaSetup, mfaEnable, mfaDisable,
  require2fa, noteDevice, listSessions, revokeSessions, createInvite, createReset, acceptInvite, useReset, tokenInfo, listTokens, revokeToken, uuid,
};
