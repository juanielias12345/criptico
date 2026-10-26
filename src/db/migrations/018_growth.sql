-- Activación y retención (docs/CRECIMIENTO-PRODUCTO.md).
-- Contadores diarios de la interfaz (invitaciones mostradas, aceptadas, cerradas…), sin ningún identificador.
CREATE TABLE ui_events_daily (
  day  TEXT NOT NULL,
  kind TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
-- Desde qué invitación se creó la cuenta (por ejemplo, «post_solve»). NULL = desde la página de cuenta.
ALTER TABLE users ADD COLUMN signup_via TEXT;
