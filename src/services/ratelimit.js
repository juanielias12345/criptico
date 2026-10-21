'use strict';

// Limitador de frecuencia guardado en la base, para que funcione igual con
// varias instancias serverless. Ventanas fijas por minuto, hora o día.

const WINDOWS = { minute: 60, hour: 3600, day: 86400 };

async function hit(db, bucket, limit, window = 'hour') {
  const secs = WINDOWS[window];
  const win = `${window}:${Math.floor(Date.now() / 1000 / secs)}`;
  await db.run(`INSERT INTO rate_limits(bucket, win, count) VALUES (?,?,1)
    ON CONFLICT(bucket, win) DO UPDATE SET count = count + 1`, [bucket, win]);
  const row = await db.get('SELECT count FROM rate_limits WHERE bucket = ? AND win = ?', [bucket, win]);
  return { allowed: row.count <= limit, count: row.count, limit };
}

async function cleanupRateLimits(db) {
  const cutoffDay = Math.floor(Date.now() / 1000 / 86400) - 2;
  const rows = await db.all('SELECT DISTINCT win FROM rate_limits');
  for (const { win } of rows) {
    const [kind, n] = win.split(':');
    const ageDays = (Date.now() / 1000 - Number(n) * WINDOWS[kind]) / 86400;
    if (ageDays > 2 || (kind === 'day' && Number(n) < cutoffDay)) await db.run('DELETE FROM rate_limits WHERE win = ?', [win]);
  }
}

module.exports = { hit, cleanupRateLimits };
