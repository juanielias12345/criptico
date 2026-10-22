-- fk: off
-- Agente de biblioteca, segunda etapa (producción masiva por mecanismo, ver docs/AGENTE.md):
--   · estados completos del candidato: generated → validating → approved | needs_review |
--     rejected | quarantined | failed (antes solo approved, needs_review, rejected);
--   · lotes con cuarentena, fallidos y reintentos; variantes con léxico agotado.
-- SQLite no permite cambiar un CHECK: agent_candidates se reconstruye copiando todo.

ALTER TABLE agent_variants ADD COLUMN exhausted_at TEXT;   -- el léxico no dio más respuestas disponibles
ALTER TABLE agent_batches ADD COLUMN quarantined INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_batches ADD COLUMN failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_batches ADD COLUMN retries INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS agent_approval_invalidated_on_edit;

CREATE TABLE agent_candidates_new (
  id               TEXT PRIMARY KEY,
  batch_id         TEXT NOT NULL REFERENCES agent_batches(id),
  cycle_id         TEXT NOT NULL,
  variant_code     TEXT NOT NULL,
  clue_id          TEXT REFERENCES clues(id) ON DELETE SET NULL,
  status           TEXT NOT NULL CHECK (status IN ('generated','validating','approved','needs_review','rejected','quarantined','failed')),
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
INSERT INTO agent_candidates_new(id, batch_id, cycle_id, variant_code, clue_id, status, mechanism, difficulty, clue_text, answer, checks, reasons,
  generator_version, generator_model, reviewer_model, cost_usd, created_at, invalidated_at, invalidated_reason)
SELECT id, batch_id, cycle_id, variant_code, clue_id, status, mechanism, difficulty, clue_text, answer, checks, reasons,
  generator_version, generator_model, reviewer_model, cost_usd, created_at, invalidated_at, invalidated_reason FROM agent_candidates;
DROP TABLE agent_candidates;
ALTER TABLE agent_candidates_new RENAME TO agent_candidates;
CREATE INDEX idx_agent_cand_cycle ON agent_candidates(cycle_id, variant_code, status, mechanism);
CREATE INDEX idx_agent_cand_clue ON agent_candidates(clue_id);
CREATE INDEX idx_agent_cand_batch ON agent_candidates(batch_id);
CREATE INDEX idx_agent_cand_created ON agent_candidates(created_at);

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
