-- 22/10/2026: a pedido de Juan Ignacio Elías (CEO) se quita la verificación en dos pasos
-- de las cuentas de CEO porque el código no les funcionaba. Cada uno puede volver a
-- activarla desde Seguridad cuando quiera; la política deja de exigirla.
UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_recovery = NULL, mfa_last_step = NULL
  WHERE role = 'owner';
UPDATE sessions SET mfa_at = NULL WHERE user_id IN (SELECT id FROM users WHERE role = 'owner');
UPDATE settings SET value = 'false' WHERE key = 'security.require_mfa_owner';
INSERT INTO audit_log(action, target_kind, details, actor_kind, actor_label, outcome)
  VALUES ('security.mfa_disabled', 'user', '{"scope":"owners","reason":"pedido del CEO: el código no funcionaba"}', 'system', 'migración 008', 'ok');
