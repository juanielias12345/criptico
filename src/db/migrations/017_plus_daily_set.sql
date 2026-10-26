-- Crípticos Plus del día: una tanda de varios por día e idioma (antes era uno solo).
CREATE TABLE plus_daily_set (
  date          TEXT NOT NULL,
  language_code TEXT NOT NULL,
  slot          INTEGER NOT NULL,
  clue_id       TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  PRIMARY KEY (date, language_code, slot)
);
CREATE INDEX plus_daily_set_clue ON plus_daily_set(language_code, clue_id);
