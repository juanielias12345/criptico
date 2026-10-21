'use strict';

// Autenticación del lado del servidor.
// - Contraseñas con scrypt y sal aleatoria (sin dependencias externas).
// - Sesiones opacas: la cookie lleva un token aleatorio; la base guarda solo su hash.
// - Protección CSRF con un token por sesión que el cliente envía en un encabezado.
// - Bloqueo temporal tras intentos fallidos.

const crypto = require('crypto');
const { uuid, now, sha256, randomToken, HttpError } = require('./util');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;
const ADMIN_SESSION_HOURS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [alg, n, r, p, saltB64, hashB64] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(expected, got);
}

// Hash ficticio para igualar tiempos cuando el usuario no existe.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

function passwordProblems(password, username) {
  const p = String(password || '');
  const problems = [];
  if (p.length < 10) problems.push('min_length_10');
  if (p.length > 200) problems.push('max_length_200');
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) problems.push('contains_username');
  if (/^(.)\1+$/.test(p) || ['contraseña123', 'password123', '1234567890', 'qwertyuiop'].includes(p.toLowerCase())) problems.push('too_common');
  return problems;
}

async function createUser(db, { username, password, email, role = 'player', displayName }) {
  const u = String(username || '').trim();
  if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(u)) throw new HttpError(400, 'invalid_username', 'El usuario debe tener entre 3 y 30 letras, números, puntos o guiones.');
  const problems = passwordProblems(password, u);
  if (problems.length) throw new HttpError(400, 'weak_password', 'La contraseña es débil.', { problems });
  const mail = email ? String(email).trim().toLowerCase() : null;
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new HttpError(400, 'invalid_email');
  if (!['player', ...STAFF_ROLES].includes(role)) throw new HttpError(400, 'invalid_role');
  if (await db.get('SELECT 1 FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)', [u, mail])) {
    throw new HttpError(409, 'user_exists', 'Ese usuario o correo ya está registrado.');
  }
  const id = uuid();
  await db.run('INSERT INTO users(id, username, email, password_hash, role, display_name) VALUES (?,?,?,?,?,?)',
    [id, u, mail, hashPassword(password), role, displayName || null]);
  return { id, username: u, role };
}

async function login(db, { username, password, ipHash, userAgent, adminOnly }) {
  const user = await db.get('SELECT * FROM users WHERE username = ? OR email = ?', [String(username || ''), String(username || '').toLowerCase()]);
  if (!user) { verifyPassword(password, DUMMY_HASH); throw new HttpError(401, 'invalid_credentials', 'Usuario o contraseña incorrectos.'); }
  if (user.disabled) throw new HttpError(403, 'account_disabled');
  if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
    throw new HttpError(429, 'account_locked', 'Demasiados intentos. Probá de nuevo en unos minutos.');
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    await db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [lock ? 0 : failed, lock, user.id]);
    throw new HttpError(401, 'invalid_credentials', 'Usuario o contraseña incorrectos.');
  }
  if (adminOnly && user.role === 'player') throw new HttpError(403, 'not_admin', 'Esta cuenta no tiene acceso al panel.');
  await db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [now(), user.id]);
  const token = randomToken(32);
  const csrf = randomToken(24);
  const hours = user.role === 'player' ? SESSION_DAYS * 24 : ADMIN_SESSION_HOURS;
  const expires = new Date(Date.now() + hours * 3600000).toISOString();
  await db.run('INSERT INTO sessions(id, user_id, csrf_token, expires_at, ip_hash, user_agent) VALUES (?,?,?,?,?,?)',
    [sha256(token), user.id, csrf, expires, ipHash || null, String(userAgent || '').slice(0, 200)]);
  return { token, csrf, expires, user: publicUser(user) };
}

async function sessionFromToken(db, token) {
  if (!token) return null;
  const row = await db.get(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`, [sha256(token)]);
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now() || row.disabled) {
    await db.run('DELETE FROM sessions WHERE id = ?', [row.session_id]);
    return null;
  }
  return { sessionId: row.session_id, csrf: row.csrf_token, user: publicUser(row) };
}

async function logout(db, token) {
  if (token) await db.run('DELETE FROM sessions WHERE id = ?', [sha256(token)]);
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, display_name: u.display_name, email: u.email || null,
    country_code: u.country_code || null, play_variant: u.play_variant || null };
}

// Permisos por rol. El panel solo muestra lo que el rol permite, pero la
// comprobación real ocurre en cada ruta del servidor.
const PERMISSIONS = {
  // Superadministrador: todo, incluidos datos personales, configuración y permisos.
  owner: ['dashboard', 'catalog.read', 'catalog.write', 'catalog.delete', 'sources.read', 'sources.write', 'imports.review',
    'submissions.read', 'submissions.moderate', 'reports.manage', 'languages.write', 'settings.write', 'users.manage', 'audit.read', 'jobs.run',
    'analytics.read', 'players.read', 'players.pii', 'players.manage', 'privacy.manage', 'games.read', 'alerts.read', 'alerts.manage',
    'export.data', 'export.pii'],
  // Administrador de contenido: catálogo, fuentes e importaciones, y el rendimiento de los crípticos.
  editor: ['dashboard', 'catalog.read', 'catalog.write', 'sources.read', 'sources.write', 'imports.review', 'reports.manage', 'jobs.run',
    'analytics.read', 'alerts.read', 'export.data'],
  // Moderador: propuestas de usuarios y reportes; sin datos personales ni estadísticas de usuarios.
  moderator: ['dashboard', 'catalog.read', 'submissions.read', 'submissions.moderate', 'reports.manage'],
  // Analista: estadísticas agregadas, partidas y fichas de usuario sin correo electrónico.
  analyst: ['dashboard', 'catalog.read', 'analytics.read', 'players.read', 'games.read', 'alerts.read', 'export.data'],
  player: [],
};

const ROLE_LABELS = { owner: 'Superadministrador', editor: 'Administrador de contenido', moderator: 'Moderador', analyst: 'Analista de estadísticas', player: 'Jugador' };
const STAFF_ROLES = ['owner', 'editor', 'moderator', 'analyst'];

const can = (user, perm) => !!user && (PERMISSIONS[user.role] || []).includes(perm);

module.exports = { ROLE_LABELS, STAFF_ROLES, hashPassword, verifyPassword, createUser, login, logout, sessionFromToken, passwordProblems, PERMISSIONS, can, publicUser };
