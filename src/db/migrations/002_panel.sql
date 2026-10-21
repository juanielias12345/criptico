-- fk: off
-- Panel de control: rol de analista, estado de cuenta, seguimiento de partidas,
-- tablas de resumen, alertas y solicitudes de datos personales.

-- ───────────── Usuarios: rol «analyst», estado y fechas de actividad ─────────────
-- SQLite no permite cambiar un CHECK: se reconstruye la tabla (procedimiento oficial).
-- Los dos disparadores que leen «users» se quitan y se vuelven a crear iguales.
-- Salvaguarda: si las claves foráneas siguieron activas (el PRAGMA no se aplicó en esta
-- conexión), borrar «users» dispararía borrados en cascada. Esta inserción falla en ese
-- caso y la transacción entera se revierte sin tocar nada.
CREATE TABLE _migration_fk_guard (fk INTEGER NOT NULL CHECK (fk = 0));
INSERT INTO _migration_fk_guard(fk) SELECT foreign_keys FROM pragma_foreign_keys;
DROP TABLE _migration_fk_guard;

DROP TRIGGER IF EXISTS clues_community_requires_human;
DROP TRIGGER IF EXISTS clues_insert_community_requires_human;

CREATE TABLE users_new (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'player'
                CHECK (role IN ('player','analyst','moderator','editor','owner')),
  display_name  TEXT,
  country_code  TEXT,
  play_variant  TEXT,
  ui_language   TEXT,
  timezone      TEXT,
  disabled      INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),   -- 1 = suspendida
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  email_verified_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT,
  last_active_at TEXT,
  deleted_at    TEXT                                                  -- cuenta anonimizada
);
INSERT INTO users_new(id, username, email, password_hash, role, display_name, country_code, play_variant, ui_language,
  disabled, failed_logins, locked_until, created_at, last_login_at, last_active_at)
SELECT id, username, email, password_hash, role, display_name, country_code, play_variant, ui_language,
  disabled, failed_logins, locked_until, created_at, last_login_at, last_login_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX idx_users_created ON users(created_at);
CREATE INDEX idx_users_active ON users(last_active_at);

CREATE TRIGGER clues_community_requires_human
BEFORE UPDATE OF status ON clues
WHEN NEW.status = 'published' AND NEW.origin = 'community' AND NOT EXISTS (
  SELECT 1 FROM submissions s JOIN users u ON u.id = s.approved_by
  WHERE s.id = NEW.submission_id AND u.role IN ('owner','moderator') AND s.status IN ('approved','published'))
BEGIN SELECT RAISE(ABORT, 'publish_blocked: manual_approval_required'); END;

CREATE TRIGGER clues_insert_community_requires_human
BEFORE INSERT ON clues
WHEN NEW.status = 'published' AND NEW.origin = 'community' AND NOT EXISTS (
  SELECT 1 FROM submissions s JOIN users u ON u.id = s.approved_by
  WHERE s.id = NEW.submission_id AND u.role IN ('owner','moderator') AND s.status IN ('approved','published'))
BEGIN SELECT RAISE(ABORT, 'publish_blocked: manual_approval_required'); END;

-- ───────────── Partidas: estado, actividad y tiempos ─────────────
-- status: started (sin acciones), in_progress, solved, revealed, abandoned, expired, error.
ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'started'
  CHECK (status IN ('started','in_progress','solved','revealed','abandoned','expired','error'));
ALTER TABLE games ADD COLUMN end_reason TEXT;        -- solved, revealed, skipped, inactivity, timeout, server_error
ALTER TABLE games ADD COLUMN last_activity_at TEXT;
ALTER TABLE games ADD COLUMN active_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN wrong_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN last_wrong_key TEXT;    -- evita contar dos veces el mismo intento repetido
ALTER TABLE games ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0;

UPDATE games SET
  status = CASE result WHEN 'solved' THEN 'solved' WHEN 'revealed' THEN 'revealed' WHEN 'skipped' THEN 'abandoned'
    WHEN 'timeout' THEN 'expired' ELSE CASE WHEN attempts > 0 OR hints_used > 0 THEN 'in_progress' ELSE 'started' END END,
  end_reason = CASE result WHEN 'skipped' THEN 'skipped' WHEN 'timeout' THEN 'timeout' ELSE result END,
  last_activity_at = COALESCE(finished_at, started_at),
  wrong_attempts = CASE WHEN result = 'solved' THEN MAX(attempts - 1, 0) ELSE attempts END;
CREATE INDEX idx_games_status ON games(status, last_activity_at);
CREATE INDEX idx_games_finished ON games(finished_at);

-- Eventos de cada partida: permiten reconstruir qué ocurrió. No guardan el texto escrito.
CREATE TABLE game_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('start','resume','guess_wrong','guess_repeat','guess_correct','hint','reveal',
               'skip','timeout','abandon','error','restart')),
  data       TEXT CHECK (data IS NULL OR json_valid(data)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_game_events ON game_events(game_id, id);
INSERT INTO game_events(game_id, kind, created_at) SELECT id, 'start', started_at FROM games;
INSERT INTO game_events(game_id, kind, created_at)
  SELECT id, CASE result WHEN 'solved' THEN 'guess_correct' WHEN 'revealed' THEN 'reveal' WHEN 'skipped' THEN 'skip' ELSE 'timeout' END, finished_at
  FROM games WHERE finished_at IS NOT NULL;

-- ───────────── Tablas de resumen ─────────────
-- Un registro por jugador (identificador seudónimo) y día con actividad.
CREATE TABLE player_days (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  games     INTEGER NOT NULL DEFAULT 0,
  solved    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day)
);
CREATE INDEX idx_player_days_day ON player_days(day);
INSERT INTO player_days(player_id, day, games, solved)
  SELECT player_id, substr(started_at, 1, 10), COUNT(*), SUM(CASE WHEN result = 'solved' THEN 1 ELSE 0 END)
  FROM games GROUP BY player_id, substr(started_at, 1, 10);

-- Partidas agregadas por día de inicio y dimensiones. Se recalcula por días.
CREATE TABLE stats_daily (
  day           TEXT NOT NULL,
  language_code TEXT NOT NULL DEFAULT '',
  country_code  TEXT NOT NULL DEFAULT '',
  play_variant  TEXT NOT NULL DEFAULT '',
  mode          TEXT NOT NULL DEFAULT '',
  started       INTEGER NOT NULL DEFAULT 0,
  completed     INTEGER NOT NULL DEFAULT 0,
  solved        INTEGER NOT NULL DEFAULT 0,
  revealed      INTEGER NOT NULL DEFAULT 0,
  abandoned     INTEGER NOT NULL DEFAULT 0,
  expired       INTEGER NOT NULL DEFAULT 0,
  errored       INTEGER NOT NULL DEFAULT 0,
  wrong         INTEGER NOT NULL DEFAULT 0,
  hints         INTEGER NOT NULL DEFAULT 0,
  active_ms     INTEGER NOT NULL DEFAULT 0,
  solve_ms_sum  INTEGER NOT NULL DEFAULT 0,
  players       INTEGER NOT NULL DEFAULT 0,
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (day, language_code, country_code, play_variant, mode)
);

-- Visitas agregadas, sin identificadores: solo contadores por día.
CREATE TABLE traffic_daily (
  day        TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('pageview','new_visitor')),
  ui_lang    TEXT NOT NULL DEFAULT '',
  country    TEXT NOT NULL DEFAULT '',
  n          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, ui_lang, country)
);

-- ───────────── Alertas ─────────────
CREATE TABLE alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key    TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title         TEXT NOT NULL,
  details       TEXT CHECK (details IS NULL OR json_valid(details)),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  occurrences   INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  resolved_at   TEXT,
  resolved_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_alerts_status ON alerts(status, severity, last_seen_at);

-- ───────────── Solicitudes sobre datos personales ─────────────
CREATE TABLE data_requests (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('access','rectification','deletion')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','rejected')),
  message         TEXT,
  resolution_note TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at     TEXT,
  resolved_by     TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_data_requests ON data_requests(status, created_at);

-- La auditoría no se modifica ni se borra salvo por la limpieza programada (plazo de conservación).
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log_is_append_only'); END;
