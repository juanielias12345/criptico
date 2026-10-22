'use strict';

// Datos de referencia que la plataforma necesita para funcionar (no son contenido
// de demostración): idiomas, variantes, categorías, mecanismos, licencias,
// configuración por defecto y tareas programadas. Se insertan sin pisar
// cambios que el administrador haya hecho después.

const LANGUAGES = [
  ['es', 'Español', 1, 1], ['en', 'English', 1, 2],
  ['fr', 'Français', 0, 3], ['pt', 'Português', 0, 4], ['it', 'Italiano', 0, 5], ['de', 'Deutsch', 0, 6],
];

const VARIANTS = [
  ['es-AR', 'es', 'Español rioplatense', ['seseo', 'yeismo']],
  ['es-ES', 'es', 'Español de España', ['yeismo']],
  ['es-MX', 'es', 'Español de México', ['seseo', 'yeismo']],
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
  // Gobierno (ver docs/EMPRESA.md). Se cambian solo con la aprobación de los dos CEO.
  'governance.dual_approval_amount_usd': 100,   // gastos o compromisos por encima de esto exigen a los dos CEO
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
  'retention.games_days': 400,
  'retention.audit_days': 730,
  'retention.game_events_days': 180,
  'retention.traffic_days': 730,
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
  ['analytics_rollup', 60], ['alerts_scan', 60],
];

async function seedReference(db) {
  for (const [code, name, enabled, order] of LANGUAGES) {
    await db.run('INSERT OR IGNORE INTO languages(code, name_native, enabled, sort_order) VALUES (?,?,?,?)', [code, name, enabled, order]);
  }
  for (const [code, lang, name, phon] of VARIANTS) {
    await db.run('INSERT OR IGNORE INTO language_variants(code, language_code, name_native, phonetics) VALUES (?,?,?,?)', [code, lang, name, JSON.stringify(phon)]);
  }
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
