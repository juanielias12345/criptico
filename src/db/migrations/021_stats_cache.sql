-- Conteos del catálogo compartidos entre instancias de Vercel. La memoria de cada instancia
-- (services/catalog-stats.js) se pierde cada vez que Vercel arranca una nueva, y cada arranque
-- volvía a contar el catálogo entero (~27.000 filas leídas, unas 3.400 veces por día).
-- Leer el valor guardado aquí cuesta una fila.
CREATE TABLE IF NOT EXISTS stats_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
