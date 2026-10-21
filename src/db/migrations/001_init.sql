-- Esquema inicial de la plataforma.
-- Convenciones: ids TEXT (UUID v4 o slugs), fechas TEXT ISO-8601 UTC,
-- booleanos INTEGER 0/1, JSON en columnas TEXT validadas con json_valid().

PRAGMA foreign_keys = ON;

-- ───────────── Idiomas, variantes y catálogos auxiliares ─────────────

CREATE TABLE languages (
  code        TEXT PRIMARY KEY,                 -- 'es', 'en', 'fr'…
  name_native TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE language_variants (
  code          TEXT PRIMARY KEY,               -- 'es-AR', 'en-GB'…
  language_code TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  name_native   TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  -- rasgos fonéticos usados por el validador de homófonos (JSON array)
  phonetics     TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(phonetics)),
  min_clues     INTEGER NOT NULL DEFAULT 10      -- mínimo propio para no mostrar aviso
);
CREATE INDEX idx_variants_lang ON language_variants(language_code);

CREATE TABLE categories (
  slug     TEXT PRIMARY KEY,
  name_es  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))
);

CREATE TABLE mechanisms (
  slug     TEXT PRIMARY KEY,                    -- anagram, hidden, reversal…
  name_es  TEXT NOT NULL,
  name_en  TEXT NOT NULL,
  help_es  TEXT NOT NULL,
  help_en  TEXT NOT NULL
);

CREATE TABLE licenses (
  id               TEXT PRIMARY KEY,            -- 'cc-by-4.0', 'permiso-escrito'…
  name             TEXT NOT NULL,
  url              TEXT,
  allows_republish INTEGER NOT NULL CHECK (allows_republish IN (0,1)),
  requires_attribution INTEGER NOT NULL DEFAULT 1 CHECK (requires_attribution IN (0,1)),
  notes            TEXT
);

-- ───────────── Usuarios y sesiones ─────────────

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT UNIQUE COLLATE NOCASE,     -- opcional
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'player'
                CHECK (role IN ('player','moderator','editor','owner')),
  display_name  TEXT,
  country_code  TEXT,
  play_variant  TEXT,
  ui_language   TEXT,
  disabled      INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1)),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,                 -- hash SHA-256 del token (el token nunca se guarda)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  ip_hash     TEXT,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Jugadores anónimos (cookie aleatoria). Sin datos personales.
CREATE TABLE players (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  country_code TEXT,
  play_variant TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_players_user ON players(user_id);

-- ───────────── Fuentes externas ─────────────

CREATE TABLE sources (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  url                  TEXT NOT NULL,
  country_code         TEXT,
  language_code        TEXT NOT NULL REFERENCES languages(code),
  variant_code         TEXT REFERENCES language_variants(code),
  content_type         TEXT NOT NULL DEFAULT 'clues'
                       CHECK (content_type IN ('clues','metadata_only')),
  access_method        TEXT NOT NULL
                       CHECK (access_method IN ('json_feed','rss','csv','api','manual_upload')),
  access_authorized    INTEGER NOT NULL DEFAULT 0 CHECK (access_authorized IN (0,1)),
  license_id           TEXT REFERENCES licenses(id),
  reuse_terms          TEXT,
  attribution_required INTEGER NOT NULL DEFAULT 1 CHECK (attribution_required IN (0,1)),
  attribution_text     TEXT,
  republish_allowed    INTEGER NOT NULL DEFAULT 0 CHECK (republish_allowed IN (0,1)),
  frequency_minutes    INTEGER NOT NULL DEFAULT 1440 CHECK (frequency_minutes >= 15),
  status               TEXT NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review','active','paused','disabled','error')),
  admin_approved_by    TEXT REFERENCES users(id),
  admin_approved_at    TEXT,
  auth_env_var         TEXT,                     -- nombre de la variable de entorno con la credencial
  last_checked_at      TEXT,
  last_success_at      TEXT,
  next_run_at          TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  items_imported       INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE import_runs (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  http_status  INTEGER,
  fetched      INTEGER NOT NULL DEFAULT 0,
  published    INTEGER NOT NULL DEFAULT 0,
  queued       INTEGER NOT NULL DEFAULT 0,
  duplicates   INTEGER NOT NULL DEFAULT 0,
  discarded    INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  attempt      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_import_runs_source ON import_runs(source_id, started_at);

-- Cada elemento recibido de una fuente (circuito A, separado de las propuestas).
CREATE TABLE import_items (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  run_id         TEXT REFERENCES import_runs(id) ON DELETE SET NULL,
  external_id    TEXT NOT NULL,
  source_url     TEXT,
  payload        TEXT NOT NULL CHECK (json_valid(payload)),
  status         TEXT NOT NULL CHECK (status IN
                 ('auto_published','review','published','discarded','duplicate','error')),
  checks         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checks)),
  clue_id        TEXT REFERENCES clues(id) ON DELETE SET NULL,
  duplicate_of   TEXT REFERENCES clues(id) ON DELETE SET NULL,
  reviewed_by    TEXT REFERENCES users(id),
  reviewed_at    TEXT,
  imported_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source_id, external_id)               -- evita importar dos veces lo mismo
);
CREATE INDEX idx_import_items_status ON import_items(status);

-- ───────────── Propuestas de usuarios (circuito B) ─────────────

CREATE TABLE submissions (
  id              TEXT PRIMARY KEY,
  tracking_token  TEXT NOT NULL UNIQUE,         -- hash del código de seguimiento
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  public_name     TEXT,
  clue_text       TEXT NOT NULL,
  answer          TEXT NOT NULL,
  enumeration     TEXT,
  explanation     TEXT NOT NULL,
  mechanism       TEXT REFERENCES mechanisms(slug),
  definition      TEXT,
  wordplay        TEXT CHECK (wordplay IS NULL OR json_valid(wordplay)),
  language_code   TEXT NOT NULL REFERENCES languages(code),
  variant_code    TEXT REFERENCES language_variants(code),
  category        TEXT REFERENCES categories(slug),
  difficulty      INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  reference       TEXT,
  rights_confirmed INTEGER NOT NULL CHECK (rights_confirmed = 1),
  terms_accepted   INTEGER NOT NULL CHECK (terms_accepted = 1),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_review','needs_changes','approved','published','rejected')),
  checks          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checks)),
  moderator_note  TEXT,
  approved_by     TEXT REFERENCES users(id),    -- solo se completa con aprobación humana
  approved_at     TEXT,
  clue_id         TEXT REFERENCES clues(id) ON DELETE SET NULL,
  ip_hash         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_submissions_status ON submissions(status, created_at);
CREATE INDEX idx_submissions_user ON submissions(user_id);

CREATE TABLE submission_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  actor_id      TEXT REFERENCES users(id),
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_submission_events ON submission_events(submission_id);

-- ───────────── Crípticos ─────────────

CREATE TABLE clues (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  clue_text        TEXT NOT NULL,
  answer           TEXT NOT NULL,               -- forma canónica (con tildes)
  answer_key       TEXT NOT NULL,               -- forma normalizada para comparar
  alt_answers      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alt_answers)),
  enumeration      TEXT NOT NULL,               -- '4', '3,4', '5-3'
  definition       TEXT,
  wordplay         TEXT CHECK (wordplay IS NULL OR json_valid(wordplay)),
  explanation      TEXT NOT NULL CHECK (json_valid(explanation)), -- array de pasos
  note             TEXT,
  language_code    TEXT NOT NULL REFERENCES languages(code),
  variant_code     TEXT REFERENCES language_variants(code), -- NULL = válido en todas las variantes
  category         TEXT REFERENCES categories(slug),
  difficulty       INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  mechanism        TEXT NOT NULL REFERENCES mechanisms(slug),
  origin           TEXT NOT NULL CHECK (origin IN ('original','generated','external','community')),
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','review','published','disabled')),
  author_name      TEXT,
  source_id        TEXT REFERENCES sources(id) ON DELETE RESTRICT,
  source_url       TEXT,
  license_id       TEXT REFERENCES licenses(id),
  attribution      TEXT,
  submission_id    TEXT REFERENCES submissions(id) ON DELETE RESTRICT,
  import_item_id   TEXT,
  validation_status TEXT NOT NULL DEFAULT 'unchecked'
                   CHECK (validation_status IN ('unchecked','verified','asserted','failed')),
  validation_errors INTEGER NOT NULL DEFAULT 0,
  validation       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(validation)),
  fingerprint      TEXT NOT NULL,               -- duplicado exacto
  proper_noun      INTEGER NOT NULL DEFAULT 0 CHECK (proper_noun IN (0,1)),
  daily_eligible   INTEGER NOT NULL DEFAULT 1 CHECK (daily_eligible IN (0,1)),
  published_at     TEXT,
  imported_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- coherencia de procedencia
  CHECK (origin <> 'external'  OR source_id IS NOT NULL),
  CHECK (origin <> 'community' OR submission_id IS NOT NULL)
);
CREATE INDEX idx_clues_pool ON clues(status, language_code, variant_code, difficulty);
CREATE INDEX idx_clues_category ON clues(category);
CREATE INDEX idx_clues_answer ON clues(language_code, answer_key);
CREATE UNIQUE INDEX idx_clues_fingerprint ON clues(fingerprint);

-- Reglas de publicación aplicadas en la propia base, no solo en la interfaz.
-- 1) Nada con errores críticos de validación puede publicarse.
CREATE TRIGGER clues_publish_requires_valid
BEFORE UPDATE OF status ON clues
WHEN NEW.status = 'published' AND (NEW.validation_errors > 0 OR NEW.validation_status IN ('unchecked','failed'))
BEGIN SELECT RAISE(ABORT, 'publish_blocked: validation'); END;

CREATE TRIGGER clues_insert_publish_requires_valid
BEFORE INSERT ON clues
WHEN NEW.status = 'published' AND (NEW.validation_errors > 0 OR NEW.validation_status IN ('unchecked','failed'))
BEGIN SELECT RAISE(ABORT, 'publish_blocked: validation'); END;

-- 2) Una propuesta de usuario solo se publica con aprobación humana registrada.
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

-- 3) Un críptico externo solo se publica si su fuente permite republicar y fue aprobada.
CREATE TRIGGER clues_external_requires_rights
BEFORE UPDATE OF status ON clues
WHEN NEW.status = 'published' AND NEW.origin = 'external' AND NOT EXISTS (
  SELECT 1 FROM sources s JOIN licenses l ON l.id = s.license_id
  WHERE s.id = NEW.source_id AND s.republish_allowed = 1 AND l.allows_republish = 1
    AND s.admin_approved_by IS NOT NULL AND s.content_type = 'clues')
BEGIN SELECT RAISE(ABORT, 'publish_blocked: rights'); END;

CREATE TRIGGER clues_insert_external_requires_rights
BEFORE INSERT ON clues
WHEN NEW.status = 'published' AND NEW.origin = 'external' AND NOT EXISTS (
  SELECT 1 FROM sources s JOIN licenses l ON l.id = s.license_id
  WHERE s.id = NEW.source_id AND s.republish_allowed = 1 AND l.allows_republish = 1
    AND s.admin_approved_by IS NOT NULL AND s.content_type = 'clues')
BEGIN SELECT RAISE(ABORT, 'publish_blocked: rights'); END;

CREATE TABLE clue_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clue_id    TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES users(id),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('admin','system','importer','generator','seed')),
  action     TEXT NOT NULL,
  from_status TEXT,
  to_status  TEXT,
  diff       TEXT CHECK (diff IS NULL OR json_valid(diff)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_clue_events ON clue_events(clue_id);

-- Posibles duplicados semánticos detectados (los exactos se bloquean por fingerprint).
CREATE TABLE duplicate_flags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('clue','submission','import_item')),
  subject_id  TEXT NOT NULL,
  clue_id     TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  similarity  REAL NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('exact','semantic')),
  resolved    INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_dupes_subject ON duplicate_flags(subject_kind, subject_id);

CREATE TABLE clue_reports (
  id         TEXT PRIMARY KEY,
  clue_id    TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  player_id  TEXT,
  reason     TEXT NOT NULL CHECK (reason IN ('wrong_answer','bad_explanation','typo','offensive','rights','other')),
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ───────────── Partidas ─────────────

CREATE TABLE games (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  clue_id       TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL,
  play_variant  TEXT,
  country_code  TEXT,
  daily_date    TEXT,
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at   TEXT,
  result        TEXT CHECK (result IN ('solved','revealed','skipped','timeout')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  hints_used    INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER
);
CREATE INDEX idx_games_player ON games(player_id, started_at);
CREATE INDEX idx_games_clue ON games(clue_id);
CREATE INDEX idx_games_started ON games(started_at);

CREATE TABLE favorites (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clue_id    TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, clue_id)
);

CREATE TABLE daily_challenges (
  date          TEXT NOT NULL,
  language_code TEXT NOT NULL REFERENCES languages(code),
  clue_id       TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  PRIMARY KEY (date, language_code)
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);

-- ───────────── Administración y operación ─────────────

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    TEXT REFERENCES users(id),
  action      TEXT NOT NULL,
  target_kind TEXT,
  target_id   TEXT,
  details     TEXT CHECK (details IS NULL OR json_valid(details)),
  ip_hash     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE TABLE jobs (
  name          TEXT PRIMARY KEY,
  interval_minutes INTEGER NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  next_run_at   TEXT NOT NULL,
  lease_until   TEXT,                           -- bloqueo para evitar ejecuciones dobles
  last_status   TEXT,
  last_error    TEXT,
  last_run_at   TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name    TEXT NOT NULL REFERENCES jobs(name) ON DELETE CASCADE,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL CHECK (status IN ('running','success','failed','abandoned')),
  output      TEXT
);
CREATE INDEX idx_job_runs ON job_runs(job_name, started_at);

CREATE TABLE error_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT NOT NULL,
  message    TEXT NOT NULL,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE rate_limits (
  bucket     TEXT NOT NULL,
  win        TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, win)
);
