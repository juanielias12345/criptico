-- Origen de las visitas, de los jugadores nuevos y de las cuentas (22/10/2026).
-- Por jugador o cuenta: solo el canal, el dominio que trajo la visita, la campaña y la primera página.
ALTER TABLE players ADD COLUMN origin_source TEXT;
ALTER TABLE players ADD COLUMN origin_medium TEXT;
ALTER TABLE players ADD COLUMN origin_campaign TEXT;
ALTER TABLE players ADD COLUMN origin_referrer TEXT;
ALTER TABLE players ADD COLUMN origin_landing TEXT;
ALTER TABLE users ADD COLUMN origin_source TEXT;
ALTER TABLE users ADD COLUMN origin_medium TEXT;
ALTER TABLE users ADD COLUMN origin_campaign TEXT;
ALTER TABLE users ADD COLUMN origin_referrer TEXT;
ALTER TABLE users ADD COLUMN origin_landing TEXT;

-- Visitas de entrada por origen: conteos agregados, sin identificadores.
CREATE TABLE traffic_sources_daily (
  day       TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('entry','new_visitor')),
  source    TEXT NOT NULL DEFAULT '',
  medium    TEXT NOT NULL DEFAULT '',
  campaign  TEXT NOT NULL DEFAULT '',
  n         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, source, medium, campaign)
);
