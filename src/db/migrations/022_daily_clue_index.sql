-- La página de cada críptico busca si fue «críptico del día» para titularla con la fecha.
-- Con este índice esa búsqueda lee solo las filas de ese críptico.
CREATE INDEX IF NOT EXISTS idx_daily_clue ON daily_challenges(clue_id, date);
