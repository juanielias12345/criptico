-- Duelos, torneos y amigos (26/10/2026). Ver docs/ARENA.md.
-- Las partidas de duelos y torneos son partidas normales (tabla games, modos 'duel' y
-- 'tournament'): el servidor mide el tiempo y cuenta intentos y pistas como siempre.
-- Los puntos y totales se guardan ya sumados para que los rankings lean pocas filas.

-- Amistades: una fila por par, con a_id < b_id.
CREATE TABLE friendships (
  a_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  b_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  accepted_at  TEXT,
  PRIMARY KEY (a_id, b_id),
  CHECK (a_id < b_id)
);
CREATE INDEX idx_friendships_b ON friendships(b_id);

-- Duelos 1 contra 1: los dos juegan los mismos crípticos, cada uno cuando puede.
-- Sin rival (opponent_id NULL) es un desafío abierto: lo toma quien abre el enlace.
CREATE TABLE duels (
  id                TEXT PRIMARY KEY,
  token             TEXT NOT NULL UNIQUE,
  challenger_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  rounds            INTEGER NOT NULL CHECK (rounds BETWEEN 1 AND 10),
  difficulty        INTEGER CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  clue_ids          TEXT NOT NULL CHECK (json_valid(clue_ids)),
  status            TEXT NOT NULL CHECK (status IN ('open','pending','active','finished','declined','expired','cancelled')),
  challenger_points INTEGER NOT NULL DEFAULT 0,
  opponent_points   INTEGER NOT NULL DEFAULT 0,
  challenger_done   INTEGER NOT NULL DEFAULT 0,
  opponent_done     INTEGER NOT NULL DEFAULT 0,
  challenger_ms     INTEGER NOT NULL DEFAULT 0,
  opponent_ms       INTEGER NOT NULL DEFAULT 0,
  winner_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  rematch_of        TEXT REFERENCES duels(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  accepted_at       TEXT,
  expires_at        TEXT NOT NULL,
  finished_at       TEXT
);
CREATE INDEX idx_duels_challenger ON duels(challenger_id, created_at);
CREATE INDEX idx_duels_opponent ON duels(opponent_id, created_at);

-- Torneos con inscripción: una ronda (un críptico) por día.
CREATE TABLE tournaments (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'weekly' CHECK (kind IN ('weekly','special')),
  language_code TEXT NOT NULL REFERENCES languages(code),
  starts_on     TEXT NOT NULL,                  -- AAAA-MM-DD (UTC), primer día de juego
  days          INTEGER NOT NULL CHECK (days BETWEEN 1 AND 31),
  clue_ids      TEXT NOT NULL CHECK (json_valid(clue_ids)),
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tournaments_start ON tournaments(language_code, starts_on);

CREATE TABLE tournament_entries (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  points        INTEGER NOT NULL DEFAULT 0,
  solved        INTEGER NOT NULL DEFAULT 0,
  time_ms       INTEGER NOT NULL DEFAULT 0,      -- suma del tiempo de los crípticos resueltos (desempate)
  rounds_played INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX idx_tournament_rank ON tournament_entries(tournament_id, points DESC, time_ms ASC);
CREATE INDEX idx_tournament_entries_user ON tournament_entries(user_id);

-- Cada ronda jugada de un duelo o torneo apunta a su partida.
CREATE TABLE arena_games (
  game_id    TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('duel','tournament')),
  ref_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round      INTEGER NOT NULL,
  points     INTEGER,                            -- NULL mientras la partida sigue abierta
  result     TEXT,
  ms         INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (kind, ref_id, user_id, round)
);
CREATE INDEX idx_arena_ref ON arena_games(kind, ref_id);
