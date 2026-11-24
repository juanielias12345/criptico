-- La página de cada críptico muestra otros seis del mismo mecanismo. Sin este índice la
-- consulta leía todo el catálogo del idioma (unas 15.000 filas) en cada visita, y los
-- buscadores visitan las 15.000 páginas: era el mayor consumo de lecturas de Turso.
CREATE INDEX IF NOT EXISTS idx_clues_mech ON clues(status, language_code, mechanism, id);
