-- Solo español (decisión de los CEO, 22/10/2026). Los crípticos en otros idiomas
-- no se borran: quedan guardados y se pueden reactivar desde el panel (Idiomas).
UPDATE languages SET enabled = 0 WHERE code <> 'es';
