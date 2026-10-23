-- Agente de biblioteca: el dueño fijó la meta en 34.000 aprobados por variante
-- (23/10/2026, el techo real del léxico) y eligió producir sin tope diario.
-- Cambia los ajustes ya guardados, que la siembra no pisa.
INSERT INTO settings(key, value) VALUES ('agent.library_target_per_variant', '34000')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
INSERT INTO settings(key, value) VALUES ('agent.daily_target_per_variant', '0')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
