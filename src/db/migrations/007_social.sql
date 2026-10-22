-- Calendario de redes (campaña de lanzamiento de 60 días, ver docs/REDES.md).
-- Cada pieza es una publicación en una red, con día, horario y motivo del horario.
-- Al aprobarse se programa en Metricool; el identificador que devuelve queda como evidencia.
ALTER TABLE content_pieces ADD COLUMN day INTEGER;
ALTER TABLE content_pieces ADD COLUMN slot TEXT;
ALTER TABLE content_pieces ADD COLUMN schedule_note TEXT;
ALTER TABLE content_pieces ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_pieces ADD COLUMN external_id TEXT;
ALTER TABLE content_pieces ADD COLUMN external_error TEXT;
ALTER TABLE content_pieces ADD COLUMN schedule_attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_content_campaign_day ON content_pieces(campaign, day, scheduled_at);
