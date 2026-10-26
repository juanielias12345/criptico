-- Plan Plus (26/10/2026). Ver docs/PLUS.md.
-- users.plus_until: hasta cuándo la cuenta es Plus (lo actualizan la vuelta
-- desde PayPal y el webhook de PayPal). Se guarda en la fila del usuario para no sumar lecturas por página.
ALTER TABLE users ADD COLUMN plus_until TEXT;

-- Una fila por suscripción de PayPal.
CREATE TABLE subscriptions (
  id           TEXT PRIMARY KEY,                       -- proveedor:id externo
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider     TEXT NOT NULL,
  plan         TEXT NOT NULL DEFAULT 'monthly' CHECK (plan IN ('monthly','yearly')),
  status       TEXT NOT NULL,
  renews_at    TEXT,
  ends_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);

-- Avisos del procesador ya procesados (los reintentos no se aplican dos veces).
CREATE TABLE payment_events (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Críptico Plus del día: uno difícil por día e idioma, solo para cuentas Plus.
-- Sus partidas usan el modo 'plus_daily' y no cuentan para la racha del diario común.
CREATE TABLE plus_daily_challenges (
  date          TEXT NOT NULL,
  language_code TEXT NOT NULL,
  clue_id       TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  PRIMARY KEY (date, language_code)
);

-- Comparación con la comunidad (Plus): referencias agregadas, recalculadas como mucho una
-- vez por día cuando alguien las pide. Una fila por idioma y dificultad.
CREATE TABLE community_benchmarks (
  language_code TEXT NOT NULL,
  difficulty    INTEGER NOT NULL,
  games         INTEGER NOT NULL,
  solve_rate    REAL,
  median_ms     INTEGER,
  avg_hints     REAL,
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (language_code, difficulty)
);
