-- Aceptación de términos y edad mínima al crear una cuenta (versión global de los legales, 22/10/2026).
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
