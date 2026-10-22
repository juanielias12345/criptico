-- Banco de crípticos: metas por idioma y dificultad, lotes de generación
-- reanudables, procedencia y derechos completos, deduplicación por juego de
-- palabras, auditoría por muestra y muestreo rápido para las partidas.
-- Solo agrega columnas, tablas, índices y triggers: no reconstruye tablas.

-- ───────────── Campos nuevos de cada críptico ─────────────
ALTER TABLE clues ADD COLUMN mechanisms_secondary TEXT NOT NULL DEFAULT '[]';   -- mecanismos y recursos secundarios
ALTER TABLE clues ADD COLUMN hints TEXT;                                         -- pistas progresivas (JSON); NULL = se derivan
ALTER TABLE clues ADD COLUMN answer_length INTEGER;                              -- letras de la respuesta
ALTER TABLE clues ADD COLUMN dedup_key TEXT;                                     -- respuesta + mecanismo + material
ALTER TABLE clues ADD COLUMN batch_id TEXT;                                      -- lote que lo generó
ALTER TABLE clues ADD COLUMN generator_version TEXT;
ALTER TABLE clues ADD COLUMN evidence TEXT;                                      -- evidencia léxica de cada definición (JSON)
-- Estado de derechos: original (propio), licensed/public_domain/permission (externo
-- habilitado), reference_only (solo enlace, nunca se publica), unverified (cuarentena).
ALTER TABLE clues ADD COLUMN rights_status TEXT NOT NULL DEFAULT 'original'
  CHECK (rights_status IN ('original','licensed','public_domain','permission','reference_only','unverified'));
ALTER TABLE clues ADD COLUMN source_title TEXT;
ALTER TABLE clues ADD COLUMN source_accessed_at TEXT;
ALTER TABLE clues ADD COLUMN audit_status TEXT CHECK (audit_status IS NULL OR audit_status IN ('pending','ok','rejected'));
ALTER TABLE clues ADD COLUMN shuffle INTEGER;                                    -- clave aleatoria fija para sortear rápido

UPDATE clues SET answer_length = length(answer_key);
UPDATE clues SET rights_status = CASE
  WHEN origin = 'external' AND EXISTS (SELECT 1 FROM sources s JOIN licenses l ON l.id = s.license_id
       WHERE s.id = clues.source_id AND s.republish_allowed = 1 AND l.allows_republish = 1) THEN 'licensed'
  WHEN origin = 'external' THEN 'unverified'
  ELSE 'original' END;
UPDATE clues SET shuffle = abs(random()) % 1000000000;

CREATE UNIQUE INDEX idx_clues_dedup ON clues(dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX idx_clues_shuffle ON clues(status, language_code, difficulty, shuffle);
CREATE INDEX idx_clues_batch ON clues(batch_id);
CREATE INDEX idx_clues_matrix ON clues(language_code, difficulty, status, origin);

-- Nada en cuarentena o solo de referencia puede publicarse.
CREATE TRIGGER clues_publish_requires_rights_status
BEFORE UPDATE OF status ON clues
WHEN NEW.status = 'published' AND NEW.rights_status IN ('reference_only','unverified')
BEGIN SELECT RAISE(ABORT, 'publish_blocked: rights'); END;

CREATE TRIGGER clues_insert_publish_requires_rights_status
BEFORE INSERT ON clues
WHEN NEW.status = 'published' AND NEW.rights_status IN ('reference_only','unverified')
BEGIN SELECT RAISE(ABORT, 'publish_blocked: rights'); END;

-- ───────────── Derechos de las fuentes externas ─────────────
ALTER TABLE sources ADD COLUMN author_name TEXT;                 -- 'desconocido' si no se sabe; nunca inventado
ALTER TABLE sources ADD COLUMN title TEXT;
ALTER TABLE sources ADD COLUMN rights_holder TEXT;
ALTER TABLE sources ADD COLUMN permission_evidence TEXT;         -- enlace o descripción del permiso guardado
ALTER TABLE sources ADD COLUMN adaptation_terms TEXT;
ALTER TABLE sources ADD COLUMN commercial_use TEXT NOT NULL DEFAULT 'unknown'
  CHECK (commercial_use IN ('allowed','forbidden','unknown'));
ALTER TABLE sources ADD COLUMN legal_review TEXT NOT NULL DEFAULT 'pending'
  CHECK (legal_review IN ('pending','approved','rejected'));
ALTER TABLE sources ADD COLUMN permission_expires_at TEXT;
ALTER TABLE sources ADD COLUMN accessed_at TEXT;

-- Las fuentes ya aprobadas por un administrador conservan su estado.
UPDATE sources SET legal_review = 'approved' WHERE admin_approved_by IS NOT NULL;

-- Una fuente con revisión legal rechazada o con el permiso vencido no publica.
CREATE TRIGGER clues_external_permission_valid
BEFORE UPDATE OF status ON clues
WHEN NEW.status = 'published' AND NEW.origin = 'external' AND EXISTS (
  SELECT 1 FROM sources s WHERE s.id = NEW.source_id AND (s.legal_review = 'rejected'
    OR (s.permission_expires_at IS NOT NULL AND s.permission_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now'))))
BEGIN SELECT RAISE(ABORT, 'publish_blocked: rights'); END;

CREATE TRIGGER clues_insert_external_permission_valid
BEFORE INSERT ON clues
WHEN NEW.status = 'published' AND NEW.origin = 'external' AND EXISTS (
  SELECT 1 FROM sources s WHERE s.id = NEW.source_id AND (s.legal_review = 'rejected'
    OR (s.permission_expires_at IS NOT NULL AND s.permission_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now'))))
BEGIN SELECT RAISE(ABORT, 'publish_blocked: rights'); END;

-- ───────────── Metas y estado por idioma × dificultad ─────────────
CREATE TABLE bank_targets (
  language_code TEXT NOT NULL REFERENCES languages(code),
  difficulty    INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  target        INTEGER NOT NULL DEFAULT 10000 CHECK (target >= 0),
  generator_version TEXT,
  cursor        INTEGER NOT NULL DEFAULT 0,          -- posición en la lista de respuestas del generador
  status        TEXT NOT NULL DEFAULT 'idle'
                CHECK (status IN ('idle','running','paused','exhausted','done','error')),
  lease_until   TEXT,                                -- evita dos procesos sobre la misma celda
  last_run_at   TEXT,
  last_error    TEXT,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (language_code, difficulty)
);

-- ───────────── Lotes ─────────────
CREATE TABLE generation_batches (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  language_code TEXT NOT NULL,
  difficulty    INTEGER NOT NULL,
  seq           INTEGER NOT NULL,                    -- número de lote dentro de la celda
  generator_version TEXT NOT NULL,
  cursor_start  INTEGER NOT NULL,
  cursor_end    INTEGER,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','committed','verified','failed','abandoned','suspended')),
  attempts      INTEGER NOT NULL DEFAULT 1,
  requested     INTEGER NOT NULL DEFAULT 0,
  candidates    INTEGER NOT NULL DEFAULT 0,          -- generados
  validated     INTEGER NOT NULL DEFAULT 0,          -- sin errores ni dudas
  published     INTEGER NOT NULL DEFAULT 0,
  pending       INTEGER NOT NULL DEFAULT 0,          -- guardados para revisión humana
  rejected      INTEGER NOT NULL DEFAULT 0,          -- descartados por errores
  duplicates    INTEGER NOT NULL DEFAULT 0,          -- descartados por duplicados
  details       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  error         TEXT,
  duration_ms   INTEGER,
  rows_written  INTEGER,
  started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at   TEXT,
  verified_at   TEXT,
  UNIQUE (language_code, difficulty, generator_version, seq)
);
CREATE INDEX idx_batches_cell ON generation_batches(language_code, difficulty, started_at);
CREATE INDEX idx_batches_status ON generation_batches(status);

-- ───────────── Auditoría humana por muestra ─────────────
CREATE TABLE clue_audits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clue_id     TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  batch_id    TEXT,
  verdict     TEXT NOT NULL DEFAULT 'pending' CHECK (verdict IN ('pending','ok','rejected')),
  reason      TEXT,
  reviewer_id TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  UNIQUE (clue_id)
);
CREATE INDEX idx_audits_batch ON clue_audits(batch_id, verdict);
CREATE INDEX idx_audits_pending ON clue_audits(verdict, created_at);

-- Sorteo sin filtro de dificultad (partida infinita con todas las dificultades).
CREATE INDEX idx_clues_shuffle_lang ON clues(status, language_code, shuffle);
