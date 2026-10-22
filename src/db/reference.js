'use strict';

// Datos de referencia que la plataforma necesita para funcionar (no son contenido
// de demostración): idiomas, variantes, categorías, mecanismos, licencias,
// configuración por defecto y tareas programadas. Se insertan sin pisar
// cambios que el administrador haya hecho después.

const LANGUAGES = [
  ['es', 'Español', 1, 1], ['en', 'English', 0, 2],   // inglés desactivado el 22/10/2026: solo español
  ['fr', 'Français', 0, 3], ['pt', 'Português', 0, 4], ['it', 'Italiano', 0, 5], ['de', 'Deutsch', 0, 6],
];

// Una variante por cada país de habla hispana (22/10/2026: todos al mismo nivel).
// Rasgos fonéticos para validar homófonos: en América, seseo + yeísmo; en España y
// Guinea Ecuatorial, solo yeísmo (distinguen la Z de la S).
const LATAM = ['seseo', 'yeismo'];
const VARIANTS = [
  ['es-AR', 'es', 'Español de Argentina', LATAM],
  ['es-BO', 'es', 'Español de Bolivia', LATAM],
  ['es-CL', 'es', 'Español de Chile', LATAM],
  ['es-CO', 'es', 'Español de Colombia', LATAM],
  ['es-CR', 'es', 'Español de Costa Rica', LATAM],
  ['es-CU', 'es', 'Español de Cuba', LATAM],
  ['es-EC', 'es', 'Español de Ecuador', LATAM],
  ['es-SV', 'es', 'Español de El Salvador', LATAM],
  ['es-ES', 'es', 'Español de España', ['yeismo']],
  ['es-US', 'es', 'Español de Estados Unidos', LATAM],
  ['es-GQ', 'es', 'Español de Guinea Ecuatorial', ['yeismo']],
  ['es-GT', 'es', 'Español de Guatemala', LATAM],
  ['es-HN', 'es', 'Español de Honduras', LATAM],
  ['es-MX', 'es', 'Español de México', LATAM],
  ['es-NI', 'es', 'Español de Nicaragua', LATAM],
  ['es-PA', 'es', 'Español de Panamá', LATAM],
  ['es-PY', 'es', 'Español de Paraguay', LATAM],
  ['es-PE', 'es', 'Español de Perú', LATAM],
  ['es-PR', 'es', 'Español de Puerto Rico', LATAM],
  ['es-DO', 'es', 'Español de República Dominicana', LATAM],
  ['es-UY', 'es', 'Español de Uruguay', LATAM],
  ['es-VE', 'es', 'Español de Venezuela', LATAM],
  ['en-GB', 'en', 'British English', []],
  ['en-US', 'en', 'American English', []],
  ['fr-FR', 'fr', 'Français de France', []],
  ['pt-BR', 'pt', 'Português do Brasil', []],
  ['pt-PT', 'pt', 'Português europeu', []],
  ['it-IT', 'it', 'Italiano', []],
  ['de-DE', 'de', 'Deutsch', []],
];

const CATEGORIES = [
  ['general', 'General', 'General'], ['sentimientos', 'Sentimientos', 'Feelings'], ['geografia', 'Geografía', 'Geography'],
  ['animales', 'Animales', 'Animals'], ['cultura', 'Cultura', 'Culture'], ['personas', 'Personas', 'People'],
  ['sociedad', 'Sociedad', 'Society'], ['naturaleza', 'Naturaleza', 'Nature'], ['objetos', 'Objetos', 'Objects'],
  ['comida', 'Comida', 'Food'], ['lenguaje', 'Lenguaje', 'Language'], ['ciencia', 'Ciencia', 'Science'],
  ['deportes', 'Deportes', 'Sport'], ['juegos', 'Juegos', 'Games'],
];

// Alias en inglés para importar contenidos con categorías en ese idioma.
const CATEGORY_ALIASES = {
  feelings: 'sentimientos', geography: 'geografia', animals: 'animales', culture: 'cultura', people: 'personas',
  society: 'sociedad', nature: 'naturaleza', objects: 'objetos', food: 'comida', language: 'lenguaje',
  science: 'ciencia', sport: 'deportes', sports: 'deportes', games: 'juegos',
};

const MECHANISMS = [
  ['anagram', 'Anagrama', 'Anagram', 'Las letras de una palabra se reordenan para formar otra.', 'The letters of a word are rearranged into another.'],
  ['hidden', 'Palabra oculta', 'Hidden word', 'La respuesta está escondida, letra por letra, dentro de la propia pista.', 'The answer is hidden letter by letter inside the clue.'],
  ['reversal', 'Inversión', 'Reversal', 'Una palabra se lee al revés.', 'A word is read backwards.'],
  ['container', 'Inserción', 'Container', 'Un fragmento se mete dentro de otro.', 'One piece goes inside another.'],
  ['deletion', 'Eliminación', 'Deletion', 'Se quitan letras de una palabra.', 'Letters are removed from a word.'],
  ['charade', 'Charada', 'Charade', 'La respuesta se arma uniendo fragmentos.', 'The answer is built by joining pieces.'],
  ['homophone', 'Homófono', 'Homophone', 'La respuesta suena igual que otra palabra.', 'The answer sounds like another word.'],
  ['double_definition', 'Doble definición', 'Double definition', 'Dos definiciones distintas de la misma palabra.', 'Two different definitions of the same word.'],
  ['initials', 'Iniciales', 'Initial letters', 'Se toman las primeras letras de varias palabras.', 'The first letters of several words are taken.'],
  ['cryptic_definition', 'Definición críptica', 'Cryptic definition', 'Toda la pista es una definición con doble sentido.', 'The whole clue is a definition with a twist.'],
  ['combination', 'Combinación', 'Combination', 'Se combinan dos o más mecanismos.', 'Two or more devices are combined.'],
];

const LICENSES = [
  ['cc0-1.0', 'CC0 1.0 (dominio público)', 'https://creativecommons.org/publicdomain/zero/1.0/', 1, 0, null],
  ['public-domain', 'Dominio público', null, 1, 0, 'Verificar el estado de dominio público en el país de origen.'],
  ['cc-by-4.0', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 1, 1, null],
  ['cc-by-sa-4.0', 'CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 1, 1, 'Las obras derivadas deben compartirse con la misma licencia.'],
  ['written-permission', 'Permiso escrito del titular', null, 1, 1, 'Guardar copia del permiso y su alcance.'],
  ['all-rights-reserved', 'Todos los derechos reservados', null, 0, 1, 'No se puede republicar: solo metadatos y enlaces.'],
  ['unknown', 'Desconocida', null, 0, 1, 'Sin licencia clara: nunca se publica.'],
];

const DEFAULT_SETTINGS = {
  'game.max_hints': 4,
  'game.timed_seconds': 180,
  'game.recent_window': 200,
  'modes.enabled': ['quick', 'infinite', 'daily', 'archive', 'beginner', 'intermediate', 'expert', 'guided', 'timed', 'themed', 'practice', 'streak', 'shared'],
  'difficulty.labels': { 1: 'Muy fácil', 2: 'Fácil', 3: 'Intermedio', 4: 'Difícil', 5: 'Experto' },
  'antispam.submissions_per_day': 5,
  'antispam.reports_per_hour': 10,
  'antispam.min_form_seconds': 5,
  'publishing.external_autopublish': true,
  // Afirmaciones semánticas (sinónimos, dobles definiciones) no comprobables por máquina:
  // si es false, los externos que las tengan van a la cola de revisión en lugar de publicarse solos.
  'publishing.external_allow_asserted': false,
  'publishing.generated_autopublish': false,
  'publishing.semantic_duplicate_threshold': 0.6,
  // Gobierno (ver docs/EMPRESA.md). Se cambian con un pedido en la bandeja de aprobaciones.
  // Decisión de los CEO (22/10/2026): con la aprobación de uno alcanza para todo. En true vuelve la doble aprobación.
  'governance.dual_approval': false,
  'governance.dual_approval_amount_usd': 100,   // con governance.dual_approval en true, gastos por encima de esto exigen a los dos CEO
  'security.require_mfa_owner': false,          // si es true, un CEO sin MFA solo puede configurarlo
  // Banco de crípticos (ver docs/BANCO.md)
  'bank.target_per_cell': 10000,
  'bank.batch_size': 400,
  'bank.autopublish_strict': true,      // decisión del dueño: publica solo lo que pasa la validación estricta
  'bank.audit_rate': 0.02,
  'bank.audit_min': 3,
  'bank.audit_max_reject_rate': 0.2,
  'bank.max_clues_per_answer': 6,
  'bank.max_per_answer_mechanism': 2,
  // Agente Autónomo de Biblioteca (ver docs/AGENTE.md). El agente lee estas reglas pero nunca las escribe.
  'agent.daily_target_per_variant': 3000,
  'agent.library_target_per_variant': 100000,
  // Pedido del dueño (22/10/2026): la cuota diaria se reparte en partes iguales entre estos mecanismos.
  'agent.mechanisms': ['anagram', 'hidden', 'reversal', 'container', 'deletion', 'charade', 'homophone', 'double_definition', 'initials', 'combination'],
  'agent.timezone': 'America/Argentina/Buenos_Aires',
  'agent.daily_budget_usd': 0,             // 0 = sin presupuesto: el agente queda bloqueado y no llama a la IA
  'agent.variant_budget_usd': 0,           // 0 = el presupuesto diario se reparte en partes iguales entre variantes
  'agent.batch_size': 100,
  'agent.pilot_batch_size': 20,
  'agent.chunk_size': 12,                  // candidatos por llamada al generador
  'agent.generator_model': 'claude-opus-5-5',
  'agent.reviewer_model': 'claude-sonnet-5-5',   // distinto del generador: evaluación final independiente
  'agent.generator_effort': 'medium',
  'agent.reviewer_effort': 'medium',
  // Precios por millón de tokens [entrada, salida] según la tabla publicada por Anthropic (consultada el 22/10/2026).
  // Si cambian, se corrigen acá; un modelo sin precio detiene el agente porque no se puede controlar el gasto.
  'agent.prices_usd_per_mtok': { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-fable-5-1': [10, 50], 'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25] },
  'agent.max_reject_rate': 0.6,            // un lote peor que esto pasa a prueba controlada; dos seguidos pausan la variante
  'agent.max_duplicate_rate': 0.5,
  'agent.min_approval_rate': 0.05,
  'agent.max_cost_per_approved_usd': 0.5,  // costo anormal: pausa la variante y alerta
  'agent.max_consecutive_failures': 3,
  'agent.max_template_share': 0.02,        // tope diario de pistas con la misma estructura, sobre la meta de la variante
  'agent.audit_rate': 0.02,
  'retention.games_days': 400,
  'retention.audit_days': 730,
  'retention.game_events_days': 180,
  'retention.traffic_days': 730,
  // Guardar el origen de cada jugador o cuenta nueva: se enciende al publicarse la política de privacidad que lo explica.
  'privacy.store_origin': false,
  // Seguimiento de partidas (ver docs/PANEL.md)
  'analytics.abandon_minutes': 30,
  'analytics.active_gap_seconds': 120,
  // Umbrales de alertas
  'alerts.min_sample': 20,
  'alerts.errors_per_hour': 20,
  'alerts.source_failures': 3,
  'alerts.solve_rate_drop_points': 15,
  'alerts.abandon_rate_rise_points': 15,
  'alerts.clue_min_plays': 10,
  'alerts.clue_solve_rate_min': 10,
  'alerts.clue_wrong_answer_reports': 2,
  'alerts.pending_submissions_max': 25,
  'alerts.pending_submission_days': 7,
  'alerts.failed_admin_logins_per_hour': 10,
};

const JOBS = [
  ['import_sources', 15], ['daily_challenge', 60], ['generate_clues', 1440], ['cleanup', 1440], ['recover_stuck', 10],
  ['analytics_rollup', 60], ['alerts_scan', 60], ['social_schedule', 60], ['indexnow', 1440],
];

async function seedReference(db) {
  for (const [code, name, enabled, order] of LANGUAGES) {
    await db.run('INSERT OR IGNORE INTO languages(code, name_native, enabled, sort_order) VALUES (?,?,?,?)', [code, name, enabled, order]);
  }
  for (const [code, lang, name, phon] of VARIANTS) {
    await db.run('INSERT OR IGNORE INTO language_variants(code, language_code, name_native, phonetics) VALUES (?,?,?,?)', [code, lang, name, JSON.stringify(phon)]);
  }
  // Antes «Español rioplatense»: ahora cada país tiene su nombre (solo si nadie lo cambió).
  await db.run("UPDATE language_variants SET name_native = 'Español de Argentina' WHERE code = 'es-AR' AND name_native = 'Español rioplatense'");
  for (const [slug, es, en] of CATEGORIES) {
    await db.run('INSERT OR IGNORE INTO categories(slug, name_es, name_en) VALUES (?,?,?)', [slug, es, en]);
  }
  for (const m of MECHANISMS) {
    await db.run('INSERT OR IGNORE INTO mechanisms(slug, name_es, name_en, help_es, help_en) VALUES (?,?,?,?,?)', m);
  }
  for (const l of LICENSES) {
    await db.run('INSERT OR IGNORE INTO licenses(id, name, url, allows_republish, requires_attribution, notes) VALUES (?,?,?,?,?,?)', l);
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await db.run('INSERT OR IGNORE INTO settings(key, value) VALUES (?,?)', [k, JSON.stringify(v)]);
  }
  const now = new Date().toISOString();
  for (const [name, every] of JOBS) {
    await db.run('INSERT OR IGNORE INTO jobs(name, interval_minutes, next_run_at) VALUES (?,?,?)', [name, every, now]);
  }
  // Centro de operaciones: agentes, backlog, riesgos e integraciones de la auditoría inicial.
  await require('../services/company').seedCompany(db);
}

module.exports = { seedReference, DEFAULT_SETTINGS, CATEGORY_ALIASES, VARIANTS };
