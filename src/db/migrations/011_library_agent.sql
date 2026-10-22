-- Agente Autónomo de Biblioteca: ciclos diarios por variante del español,
-- lotes reanudables, registro auditable de cada candidato y control
-- administrativo (pausar, reanudar, detener). Ver docs/AGENTE.md.
-- Solo agrega tablas, índices y triggers: no toca lo existente.

-- Estado global del agente y bloqueo de ejecución (un solo proceso a la vez).
CREATE TABLE agent_control (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  state             TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','stopped')),
  reason            TEXT,
  updated_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TEXT,
  lease_holder      TEXT,                 -- proceso que tiene el bloqueo
  lease_until       TEXT,
  last_run_at       TEXT,
  last_run_status   TEXT,
  last_run_evidence TEXT,                 -- enlace a la ejecución de GitHub Actions
  last_run_summary  TEXT
);
INSERT INTO agent_control(id) VALUES (1);

-- Una fila por variante real (language_variants). El agente nunca crea variantes.
CREATE TABLE agent_variants (
  variant_code     TEXT PRIMARY KEY REFERENCES language_variants(code),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','maintenance')),
  paused_reason    TEXT,
  probation        INTEGER NOT NULL DEFAULT 0,      -- 1 = el próximo lote es una prueba controlada
  cursor           INTEGER NOT NULL DEFAULT 0,      -- posición en la lista de respuestas
  library_target   INTEGER,                         -- NULL = la meta general; solo la cambian los administradores
  pilot_done       INTEGER NOT NULL DEFAULT 0,      -- ya corrió el piloto de bajo volumen
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Un ciclo por día de la zona horaria del proyecto.
CREATE TABLE agent_cycles (
  id               TEXT PRIMARY KEY,
  cycle_date       TEXT NOT NULL UNIQUE,              -- AAAA-MM-DD en la zona horaria configurada
  timezone         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','blocked','stopped','completed','partial','failed')),
  blocked_reason   TEXT,
  runs             INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL NOT NULL DEFAULT 0,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  report           TEXT CHECK (report IS NULL OR json_valid(report)),
  started_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_activity_at TEXT,
  finished_at      TEXT
);

CREATE TABLE agent_batches (
  id               TEXT PRIMARY KEY,
  cycle_id         TEXT NOT NULL REFERENCES agent_cycles(id),
  variant_code     TEXT NOT NULL,
  seq              INTEGER NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal','pilot','probation')),
  holder           TEXT,
  generator_version TEXT NOT NULL,
  generator_model  TEXT,
  reviewer_model   TEXT,
  status           TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','committed','verified','failed','abandoned','suspended')),
  requested        INTEGER NOT NULL DEFAULT 0,
  candidates       INTEGER NOT NULL DEFAULT 0,
  approved         INTEGER NOT NULL DEFAULT 0,
  needs_review     INTEGER NOT NULL DEFAULT 0,
  rejected         INTEGER NOT NULL DEFAULT 0,
  duplicates       INTEGER NOT NULL DEFAULT 0,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL NOT NULL DEFAULT 0,          -- se suma después de cada llamada, aunque el lote falle
  cursor_start     INTEGER,
  cursor_end       INTEGER,
  details          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  error            TEXT,
  started_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at      TEXT,
  duration_ms      INTEGER,
  UNIQUE (cycle_id, variant_code, seq)
);
CREATE INDEX idx_agent_batches_cycle ON agent_batches(cycle_id, variant_code, status);
CREATE INDEX idx_agent_batches_status ON agent_batches(status);

-- Registro auditable de cada candidato: aprobado, pendiente de revisión o rechazado,
-- con el resultado de cada control. Los rechazados no llegan a la tabla clues.
CREATE TABLE agent_candidates (
  id               TEXT PRIMARY KEY,
  batch_id         TEXT NOT NULL REFERENCES agent_batches(id),
  cycle_id         TEXT NOT NULL,
  variant_code     TEXT NOT NULL,
  clue_id          TEXT REFERENCES clues(id) ON DELETE SET NULL,
  status           TEXT NOT NULL CHECK (status IN ('approved','needs_review','rejected')),
  mechanism        TEXT,
  difficulty       INTEGER,
  clue_text        TEXT,
  answer           TEXT,
  checks           TEXT NOT NULL CHECK (json_valid(checks)),   -- controles A–F con su resultado
  reasons          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons)),
  generator_version TEXT NOT NULL,
  generator_model  TEXT,
  reviewer_model   TEXT,
  cost_usd         REAL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  invalidated_at   TEXT,
  invalidated_reason TEXT
);
CREATE INDEX idx_agent_cand_cycle ON agent_candidates(cycle_id, variant_code, status, mechanism);
CREATE INDEX idx_agent_cand_clue ON agent_candidates(clue_id);
CREATE INDEX idx_agent_cand_batch ON agent_candidates(batch_id);
CREATE INDEX idx_clues_variant_status ON clues(variant_code, status);

-- Si un críptico aprobado por el agente se modifica, su aprobación se invalida:
-- sale de las partidas y vuelve a revisión (el panel lo revalida al guardar).
CREATE TRIGGER agent_approval_invalidated_on_edit
AFTER UPDATE OF clue_text, answer, definition, wordplay, variant_code ON clues
WHEN (OLD.clue_text IS NOT NEW.clue_text OR OLD.answer IS NOT NEW.answer OR OLD.definition IS NOT NEW.definition
      OR OLD.wordplay IS NOT NEW.wordplay OR OLD.variant_code IS NOT NEW.variant_code)
  AND EXISTS (SELECT 1 FROM agent_candidates WHERE clue_id = NEW.id AND status = 'approved' AND invalidated_at IS NULL)
BEGIN
  UPDATE agent_candidates SET status = 'needs_review', invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    invalidated_reason = 'modificado después de la aprobación automática'
    WHERE clue_id = NEW.id AND status = 'approved' AND invalidated_at IS NULL;
  INSERT INTO clue_events(clue_id, actor_kind, action, from_status, to_status, diff)
    VALUES (NEW.id, 'system', 'agent_approval_invalidated', NEW.status, CASE WHEN NEW.status = 'published' THEN 'review' ELSE NEW.status END,
      '{"reason":"edited"}');
  UPDATE clues SET status = 'review' WHERE id = NEW.id AND status = 'published';
END;
