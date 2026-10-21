-- Perfil personal del jugador: logros, objetivos, biblioteca, perfil público,
-- enlaces para compartir y participación voluntaria en rankings.
-- Solo agrega columnas y tablas: no reconstruye ninguna tabla existente.

-- ───────────── Preferencias del perfil (en la cuenta) ─────────────
ALTER TABLE users ADD COLUMN public_profile INTEGER NOT NULL DEFAULT 0;      -- 1 = perfil público activado
ALTER TABLE users ADD COLUMN public_name TEXT;                              -- nombre público opcional
ALTER TABLE users ADD COLUMN avatar TEXT;                                   -- avatar elegido de un conjunto propio
ALTER TABLE users ADD COLUMN profile_share TEXT NOT NULL DEFAULT '{}';      -- qué estadísticas muestra el perfil público
ALTER TABLE users ADD COLUMN profile_prefs TEXT NOT NULL DEFAULT '{}';      -- recomendaciones, avisos de logros, niveles
ALTER TABLE users ADD COLUMN leaderboard_opt_in INTEGER NOT NULL DEFAULT 0; -- participa en rankings (voluntario)

-- Identificadores de jugador de una cuenta eliminada: sus partidas quedan anónimas para
-- las estadísticas generales, pero ningún navegador puede volver a verlas como propias.
ALTER TABLE players ADD COLUMN retired_at TEXT;

-- ───────────── Logros obtenidos ─────────────
-- owner = 'u:<id de cuenta>' o 'p:<id seudónimo de jugador>' (juego sin cuenta).
-- La clave primaria impide obtener dos veces el mismo logro.
CREATE TABLE achievements_earned (
  owner     TEXT NOT NULL,
  code      TEXT NOT NULL,
  game_id   TEXT REFERENCES games(id) ON DELETE SET NULL,
  earned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (owner, code)
);
CREATE INDEX idx_achievements_time ON achievements_earned(owner, earned_at);

-- ───────────── Objetivos personales (opcionales) ─────────────
CREATE TABLE user_goals (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('solve','games','mechanism','no_hints','median_time','language')),
  target     INTEGER NOT NULL CHECK (target > 0),
  period     TEXT NOT NULL CHECK (period IN ('day','week','month')),
  param      TEXT,                                  -- mecanismo o idioma, según el tipo
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_user_goals ON user_goals(user_id);

-- ───────────── Biblioteca personal: solo referencias a crípticos ─────────────
CREATE TABLE retry_list (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clue_id    TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, clue_id)
);
CREATE TABLE collections (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_collections_user ON collections(user_id);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  clue_id       TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (collection_id, clue_id)
);

-- ───────────── Resultados compartidos ─────────────
-- El enlace solo da acceso a esa tarjeta; qué se muestra lo decide la persona.
CREATE TABLE game_shares (
  token       TEXT PRIMARY KEY,
  game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  show_time   INTEGER NOT NULL DEFAULT 0 CHECK (show_time IN (0,1)),
  show_answer INTEGER NOT NULL DEFAULT 0 CHECK (show_answer IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_game_shares_game ON game_shares(game_id);

-- Consultas del perfil: historial por jugador y estado, y crípticos únicos.
CREATE INDEX idx_games_player_status ON games(player_id, status, finished_at);
CREATE INDEX idx_games_player_clue ON games(player_id, clue_id);
CREATE INDEX idx_games_daily ON games(daily_date, mode);
