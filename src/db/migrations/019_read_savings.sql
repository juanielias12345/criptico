-- Explorar ordena por fecha de publicación: con este índice lee solo la página pedida
-- en lugar de todo el catálogo del idioma (Turso cobra cada fila leída).
CREATE INDEX IF NOT EXISTS idx_clues_published ON clues(status, language_code, published_at DESC, id);
