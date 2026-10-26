'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, client } = require('./helpers');
const A = require('../src/services/arena');
const ADS = require('../src/services/ads');

let env;
test.before(async () => { env = await makeEnv({ spanishOnly: true }); });
test.after(async () => { await env.close(); });

async function player(name) {
  const c = client(env.base);
  const r = await c.post('/api/auth/register', { username: name, password: 'Contraseña-segura-123', accept: true });
  assert.equal(r.status, 201, r.text);
  return { c, user: r.json.user };
}
const answerOf = async (gameId) => (await env.db.get('SELECT c.answer FROM games g JOIN clues c ON c.id = g.clue_id WHERE g.id = ?', [gameId])).answer;
const todayRound = (t) => Math.floor((Date.now() - Date.parse(t.starts_on + 'T00:00:00Z')) / 86400000);

test('puntaje: base por resolver, descuentos por pista y error, bonus por velocidad', () => {
  assert.deepEqual(A.scoreOf({ result: 'solved', attempts: 1, hints: 0, ms: 8000 }), { points: 200, base: 100, speed: 100 });
  assert.equal(A.scoreOf({ result: 'solved', attempts: 3, hints: 1, ms: 200000 }).points, 60, '100 − 20 − 2×10, sin bonus después de 3 min');
  assert.equal(A.scoreOf({ result: 'solved', attempts: 9, hints: 4, ms: 60000 }).base, 20, 'nunca menos de 20 si resolvió');
  assert.equal(A.scoreOf({ result: 'solved', attempts: 1, hints: 0, ms: 1000 }).speed, 0, 'menos de 3 s no suma velocidad');
  assert.equal(A.scoreOf({ result: 'revealed', attempts: 1, hints: 0, ms: 5000 }).points, 0);
});

test('torneo semanal: inscripción obligatoria, una ronda por día, puntos y ranking', async () => {
  const anon = client(env.base);
  const list = await anon.get('/api/tournaments');
  assert.equal(list.status, 200);
  const t = list.json.current;
  assert.ok(t && t.days === 7, 'el torneo de la semana se arma solo');
  assert.equal(t.starts_on, A.mondayOf());
  assert.equal((await anon.post(`/api/tournaments/${t.id}/register`, {})).status, 401, 'sin cuenta no se inscribe');

  const ana = await player('ana_torneo');
  const round = todayRound(t);
  assert.equal((await ana.c.post(`/api/tournaments/${t.id}/rounds/${round}/start`, {})).status, 403, 'sin inscripción no se juega');
  const reg = await ana.c.post(`/api/tournaments/${t.id}/register`, {});
  assert.equal(reg.status, 200);
  assert.equal(reg.json.registered, true);
  assert.equal(reg.json.rounds[round].state, 'open');
  if (round < 6) assert.equal((await ana.c.post(`/api/tournaments/${t.id}/rounds/${round + 1}/start`, {})).json.error, 'round_locked', 'la ronda de mañana no se abre antes');

  const start = await ana.c.post(`/api/tournaments/${t.id}/rounds/${round}/start`, {});
  assert.equal(start.status, 200, start.text);
  assert.ok(start.json.clue && !('answer' in start.json.clue), 'el críptico va sin la respuesta');
  const again = await ana.c.post(`/api/tournaments/${t.id}/rounds/${round}/start`, {});
  assert.equal(again.json.game_id, start.json.game_id, 'volver a entrar retoma la misma partida');
  assert.equal(again.json.resumed, true);
  await env.db.run('UPDATE games SET started_at = ? WHERE id = ?', [new Date(Date.now() - 20000).toISOString(), start.json.game_id]);
  const g = await ana.c.post(`/api/game/${start.json.game_id}/guess`, { answer: await answerOf(start.json.game_id) });
  assert.equal(g.json.correct, true);

  const view = await ana.c.get(`/api/tournaments/${t.slug}`);
  const pts = view.json.rounds[round].points;
  assert.ok(pts > 100 && pts < 200, 'resolvió en ~20 s: base completa y casi todo el bonus');
  assert.deepEqual({ rank: view.json.standings.me.rank, points: view.json.standings.me.points, solved: view.json.standings.me.solved }, { rank: 1, points: pts, solved: 1 });

  const beto = await player('beto_torneo');
  await beto.c.post(`/api/tournaments/${t.slug}/register`, {});
  const b = await beto.c.post(`/api/tournaments/${t.id}/rounds/${round}/start`, {});
  await beto.c.post(`/api/game/${b.json.game_id}/reveal`, {});
  assert.equal((await beto.c.post(`/api/game/${b.json.game_id}/restart`, {})).json.error, 'arena_round', 'una ronda no se reinicia');
  const vb = await beto.c.get(`/api/tournaments/${t.slug}`);
  assert.equal(vb.json.standings.me.rank, 2, 'revelar vale 0: queda segundo');
  assert.deepEqual(vb.json.standings.items.map((x) => x.name), ['ana_torneo', 'beto_torneo']);
  assert.equal((await beto.c.post(`/api/tournaments/${t.id}/rounds/${round}/start`, {})).json.finished, true, 'una ronda cerrada no se vuelve a jugar');

  const page = await anon.get(`/es/torneos/${t.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /ana_torneo/, 'la página pública muestra el ranking');
  assert.equal((await anon.get('/es/desafios')).status, 200);
  const pend = await ana.c.get('/api/arena/pending');
  assert.equal(pend.json.tournament.registered, true);
});

test('duelos: el rival acepta, los dos juegan los mismos crípticos y gana quien suma más', async () => {
  const ceci = await player('ceci_duelo');
  const dani = await player('dani_duelo');
  assert.equal((await ceci.c.post('/api/duels', { opponent: 'nadie_existe' })).status, 404);
  assert.equal((await ceci.c.post('/api/duels', { opponent: 'ceci_duelo' })).json.error, 'self');
  const cr = await ceci.c.post('/api/duels', { opponent: 'dani_duelo', rounds: 3 });
  assert.equal(cr.status, 200, cr.text);
  const id = cr.json.id;
  assert.equal((await dani.c.post(`/api/duels/${id}/rounds/0/start`, {})).json.error, 'duel_closed', 'sin aceptar no juega');
  assert.equal((await ceci.c.post(`/api/duels/${id}/rounds/1/start`, {})).json.error, 'round_locked', 'las rondas van en orden');

  const clues = [];
  for (let i = 0; i < 3; i++) {
    const s = await ceci.c.post(`/api/duels/${id}/rounds/${i}/start`, {});
    assert.equal(s.status, 200, s.text);
    clues.push(s.json.clue.id);
    await ceci.c.post(`/api/game/${s.json.game_id}/reveal`, {});
  }
  const acc = await dani.c.post(`/api/duels/${cr.json.token}/accept`, {});
  assert.equal(acc.json.status, 'active');
  assert.equal(acc.json.challenger.points, null, 'mientras sigue, no se ven los puntos del rival');
  for (let i = 0; i < 3; i++) {
    const s = await dani.c.post(`/api/duels/${id}/rounds/${i}/start`, {});
    assert.equal(s.json.clue.id, clues[i], 'mismo críptico para los dos');
    await dani.c.post(`/api/game/${s.json.game_id}/guess`, { answer: await answerOf(s.json.game_id) });
  }
  const fin = await ceci.c.get(`/api/duels/${id}`);
  assert.equal(fin.json.status, 'finished');
  assert.equal(fin.json.winner, 'opponent');
  assert.equal(fin.json.challenger.points, 0);
  assert.ok(fin.json.opponent.points >= 300);
  assert.deepEqual((await dani.c.get('/api/duels')).json.record, { won: 1, lost: 0, tied: 0 });
  const re = await ceci.c.post(`/api/duels/${id}/rematch`, {});
  assert.equal(re.status, 200);
  assert.equal((await dani.c.get(`/api/duels/${re.json.id}`)).json.status, 'pending', 'la revancha le llega al mismo rival');
});

test('duelo abierto: lo toma quien abre el enlace; vencido sin rival no tiene ganador', async () => {
  const eli = await player('eli_abierto');
  const fede = await player('fede_abierto');
  const gabi = await player('gabi_abierto');
  const cr = await eli.c.post('/api/duels', {});
  assert.equal((await client(env.base).get(`/api/duels/${cr.json.token}`)).json.status, 'open', 'el enlace se puede ver sin cuenta');
  assert.equal((await client(env.base).get(`/es/desafios/duelo/${cr.json.token}`)).status, 200);
  assert.equal((await eli.c.post(`/api/duels/${cr.json.token}/accept`, {})).json.error, 'own_duel');
  assert.equal((await fede.c.post(`/api/duels/${cr.json.token}/accept`, {})).json.status, 'active');
  assert.equal((await gabi.c.post(`/api/duels/${cr.json.token}/accept`, {})).json.error, 'taken', 'lo toma una sola persona');

  const old = await eli.c.post('/api/duels', {});
  await env.db.run('UPDATE duels SET expires_at = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), old.json.id]);
  const v = await eli.c.get(`/api/duels/${old.json.id}`);
  assert.equal(v.json.status, 'expired');
  assert.equal(v.json.winner, null);
});

test('amigos: solicitud, aceptación, conectados y borrado de cuenta', async () => {
  const hugo = await player('hugo_amigo');
  const ines = await player('ines_amiga');
  assert.equal((await hugo.c.get('/api/friends')).status, 200);
  assert.equal((await client(env.base).get('/api/friends')).status, 401);
  assert.equal((await hugo.c.post('/api/friends', { username: 'ines_amiga' })).json.status, 'pending');
  const inbox = await ines.c.get('/api/friends');
  assert.deepEqual(inbox.json.incoming.map((x) => x.username), ['hugo_amigo']);
  assert.equal((await hugo.c.post('/api/friends/ines_amiga/accept', {})).json.error, 'own_request', 'no se acepta la propia solicitud');
  await ines.c.post('/api/friends/hugo_amigo/accept', {});
  await env.db.run('UPDATE users SET last_active_at = ? WHERE username = ?', [new Date().toISOString(), 'ines_amiga']);
  const list = await hugo.c.get('/api/friends');
  assert.deepEqual(list.json.friends, [{ username: 'ines_amiga', name: 'ines_amiga', online: true }]);

  const people = require('../src/services/people');
  await people.anonymizeUser(env.db, ines.user.id);
  assert.deepEqual((await hugo.c.get('/api/friends')).json.friends, [], 'la cuenta eliminada sale de los amigos');
});

test('anuncios: solo con ID de editor y la política publicada; con nonce en la página', async () => {
  const c = client(env.base);
  ADS.clearCache();
  let home = await c.get('/es');
  assert.doesNotMatch(home.text, /adsbygoogle|ads\.js|google-adsense-account/, 'sin configurar no hay nada de anuncios');
  assert.equal((await c.get('/ads.txt')).status, 404);

  env.config.adsenseClient = 'ca-pub-1234567890123456';
  env.config.adsenseSlot = '9876543210';
  try {
    ADS.clearCache();
    home = await c.get('/es');
    assert.match(home.text, /google-adsense-account" content="ca-pub-1234567890123456/, 'la etiqueta de verificación de AdSense va siempre');
    assert.doesNotMatch(home.text, /\/js\/ads\.js/, 'sin la política publicada no se cargan anuncios');
    const txt = await c.get('/ads.txt');
    assert.equal(txt.text, 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');

    await require('../src/services/settings').setSetting(env.db, 'ads.enabled', true);
    ADS.clearCache();
    home = await c.get('/es');
    const csp = home.headers.get('content-security-policy');
    const nonce = /'nonce-([^']+)'/.exec(csp)[1];
    assert.ok(nonce.length >= 16);
    assert.match(home.text, new RegExp(`/js/ads\\.js\\?v=[\\w]+" defer nonce="${nonce.replace(/[+/=]/g, '\\$&')}"`), 'el script de anuncios lleva el nonce');
    assert.match(home.text, /<ins class="adsbygoogle" data-ad-client="ca-pub-1234567890123456" data-ad-slot="9876543210"/);
    const acc = await c.get('/es/cuenta');
    assert.doesNotMatch(acc.text, /\/js\/ads\.js/, 'la cuenta no lleva anuncios');
    assert.doesNotMatch(acc.headers.get('content-security-policy'), /nonce/);
  } finally {
    env.config.adsenseClient = ''; env.config.adsenseSlot = '';
    await require('../src/services/settings').setSetting(env.db, 'ads.enabled', false);
    ADS.clearCache();
  }
});

test('las cuentas del equipo también juegan duelos y torneos', async () => {
  const boss = await player('jefa_arena');
  await env.db.run("UPDATE users SET role = 'owner' WHERE id = ?", [boss.user.id]);
  const t = (await boss.c.get('/api/tournaments')).json.current;
  const reg = await boss.c.post(`/api/tournaments/${t.id}/register`, {});
  assert.equal(reg.status, 200, reg.text);
  const start = await boss.c.post(`/api/tournaments/${t.id}/rounds/${todayRound(t)}/start`, {});
  assert.equal(start.status, 200, start.text);
  assert.ok(start.json.clue, 'recibe el críptico de la ronda');
  const duel = await boss.c.post('/api/duels', { rounds: 3 });
  assert.equal(duel.status, 200, duel.text);
  assert.equal((await boss.c.get('/api/arena/pending')).status, 200);
});
