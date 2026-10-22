-- Empresa: gobierno de dos CEO con autoridad idéntica, seguridad de cuentas del
-- equipo (MFA, sesiones, invitaciones, recuperación), bandeja de aprobaciones con
-- versiones inmutables, auditoría inalterable y centro de operaciones (tareas,
-- agentes, riesgos, costos, integraciones, matriz legal, documentos y contenido).
-- Ver docs/EMPRESA.md. Solo agrega columnas, tablas, índices y disparadores.

-- ───────────── Cuentas del equipo ─────────────
ALTER TABLE users ADD COLUMN title TEXT;                        -- cargo visible («CEO y Súper Administrador»)
ALTER TABLE users ADD COLUMN mfa_secret TEXT;                   -- secreto TOTP cifrado (AES-256-GCM)
ALTER TABLE users ADD COLUMN mfa_enabled_at TEXT;               -- NULL = sin MFA
ALTER TABLE users ADD COLUMN mfa_recovery TEXT;                 -- hashes de los códigos de recuperación (JSON)
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
ALTER TABLE users ADD COLUMN mfa_last_step INTEGER;              -- último período TOTP usado (un código no sirve dos veces)

ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE sessions ADD COLUMN mfa_at TEXT;                    -- cuándo se verificó el segundo factor

-- Invitaciones y enlaces de recuperación de un solo uso (solo se guarda el hash).
CREATE TABLE staff_tokens (
  id          TEXT PRIMARY KEY,                                 -- hash SHA-256 del token
  kind        TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  role        TEXT CHECK (role IS NULL OR role IN ('owner','editor','moderator','analyst')),
  title       TEXT,
  display_name TEXT,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,      -- reset: cuenta a recuperar
  created_by  TEXT NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  used_by     TEXT REFERENCES users(id),
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_staff_tokens_open ON staff_tokens(kind, used_at, expires_at);

-- Dispositivos conocidos por cuenta del equipo: un acceso desde uno nuevo genera alerta.
CREATE TABLE staff_devices (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,                                    -- hash de IP + navegador
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, fingerprint)
);

-- ───────────── Auditoría inalterable ─────────────
ALTER TABLE audit_log ADD COLUMN actor_kind TEXT;               -- person | agent | system
ALTER TABLE audit_log ADD COLUMN actor_label TEXT;              -- nombre del agente o proceso
ALTER TABLE audit_log ADD COLUMN cost_amount REAL;
ALTER TABLE audit_log ADD COLUMN cost_currency TEXT;
ALTER TABLE audit_log ADD COLUMN outcome TEXT;                  -- ok | error | blocked

-- Nadie (ni la aplicación) puede borrar ni reescribir un registro. La única
-- modificación permitida es quitar el hash de IP al vencer el plazo de retención.
-- Reemplaza la regla de 002 (que permitía borrar por plazo de conservación).
DROP TRIGGER IF EXISTS audit_log_no_update;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log_immutable'); END;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
WHEN NOT (NEW.ip_hash IS NULL AND NEW.id = OLD.id AND NEW.actor_id IS OLD.actor_id AND NEW.action = OLD.action
  AND NEW.target_kind IS OLD.target_kind AND NEW.target_id IS OLD.target_id AND NEW.details IS OLD.details
  AND NEW.created_at = OLD.created_at AND NEW.actor_kind IS OLD.actor_kind AND NEW.actor_label IS OLD.actor_label
  AND NEW.cost_amount IS OLD.cost_amount AND NEW.cost_currency IS OLD.cost_currency AND NEW.outcome IS OLD.outcome)
BEGIN SELECT RAISE(ABORT, 'audit_log_immutable'); END;

-- ───────────── Bandeja de aprobaciones ─────────────
CREATE TABLE approval_items (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,                                  -- post, campaign, legal_doc, production_change, budget, contract…
  area          TEXT NOT NULL,                                  -- direction, tech, marketing, legal, community, apps, content, finance
  title         TEXT NOT NULL,
  summary       TEXT,
  content       TEXT NOT NULL CHECK (json_valid(content)),      -- la versión exacta que se aprueba
  version       INTEGER NOT NULL DEFAULT 1,
  content_hash  TEXT NOT NULL,                                  -- SHA-256 del contenido canónico
  policy        TEXT NOT NULL DEFAULT 'one' CHECK (policy IN ('one','both')),
  level         INTEGER NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 4),
  amount        REAL,                                           -- compromiso económico, si lo hay
  currency      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','changes_requested','conflict','withdrawn','executed')),
  requested_by_kind TEXT NOT NULL DEFAULT 'person' CHECK (requested_by_kind IN ('person','agent','system')),
  requested_by  TEXT,                                           -- id de usuario o nombre del agente
  target_kind   TEXT,                                           -- objeto al que se aplica (content_piece, legal_doc…)
  target_id     TEXT,
  decided_at    TEXT,
  executed_at   TEXT,
  execution_evidence TEXT,                                      -- enlace o referencia verificable
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_approvals_status ON approval_items(status, created_at);
CREATE INDEX idx_approvals_target ON approval_items(target_kind, target_id);

-- Cada versión revisada queda guardada tal cual.
CREATE TABLE approval_versions (
  item_id      TEXT NOT NULL REFERENCES approval_items(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  content      TEXT NOT NULL CHECK (json_valid(content)),
  content_hash TEXT NOT NULL,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (item_id, version)
);
CREATE TRIGGER approval_versions_immutable BEFORE UPDATE ON approval_versions
BEGIN SELECT RAISE(ABORT, 'approval_version_immutable'); END;

-- Un voto vale solo para la versión y el hash exactos que se revisaron.
CREATE TABLE approval_votes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      TEXT NOT NULL REFERENCES approval_items(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id),
  decision     TEXT NOT NULL CHECK (decision IN ('approve','reject','changes')),
  comment      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (item_id, version, user_id)
);
CREATE TRIGGER approval_votes_immutable BEFORE UPDATE ON approval_votes
BEGIN SELECT RAISE(ABORT, 'approval_vote_immutable'); END;
CREATE TRIGGER approval_votes_no_delete BEFORE DELETE ON approval_votes
BEGIN SELECT RAISE(ABORT, 'approval_vote_immutable'); END;

-- ───────────── Centro de operaciones ─────────────
-- Agentes: roles lógicos con responsabilidades, herramientas y límites. «runtime»
-- dice cómo se ejecuta de verdad; sin proceso, el estado es «sin proceso activo».
CREATE TABLE agents (
  id           TEXT PRIMARY KEY,                                -- slug estable
  number       INTEGER,
  department   TEXT NOT NULL,
  name         TEXT NOT NULL,
  mission      TEXT NOT NULL,
  responsibilities TEXT NOT NULL CHECK (json_valid(responsibilities)),
  tools        TEXT NOT NULL CHECK (json_valid(tools)),         -- herramientas autorizadas
  limits       TEXT NOT NULL CHECK (json_valid(limits)),
  kpis         TEXT NOT NULL CHECK (json_valid(kpis)),
  autonomy_max INTEGER NOT NULL DEFAULT 1 CHECK (autonomy_max BETWEEN 1 AND 4),
  owner_label  TEXT NOT NULL DEFAULT 'CEO',                     -- responsable operativo humano
  runtime      TEXT NOT NULL DEFAULT 'none',                    -- none | on_demand | workflow:<archivo> | job:<nombre>
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Ejecuciones reales registradas (por un flujo, un trabajo o una sesión de trabajo).
CREATE TABLE agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  task_id     TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL CHECK (status IN ('running','ok','error','cancelled')),
  summary     TEXT,
  evidence    TEXT,                                             -- commit, ejecución, archivo…
  cost_amount REAL,
  cost_currency TEXT,
  error       TEXT
);
CREATE INDEX idx_agent_runs_agent ON agent_runs(agent_id, started_at);

CREATE TABLE ops_tasks (
  id          TEXT PRIMARY KEY,                                 -- T-0001
  title       TEXT NOT NULL,
  objective   TEXT,
  area        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('critical','important','ux','growth','tech_debt','legal','integration','human_decision')),
  agent_id    TEXT REFERENCES agents(id),
  owner_user_id TEXT REFERENCES users(id),
  input       TEXT,
  expected    TEXT,
  depends_on  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(depends_on)),
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','in_progress','blocked','in_review','approved','done','cancelled')),
  blocked_reason TEXT,
  due_at      TEXT,
  cost_estimate REAL,
  cost_actual REAL,
  risk        TEXT CHECK (risk IS NULL OR risk IN ('low','medium','high','critical')),
  permissions TEXT,
  approval_level INTEGER NOT NULL DEFAULT 1 CHECK (approval_level BETWEEN 1 AND 4),
  approval_id TEXT REFERENCES approval_items(id),
  evidence    TEXT,                                             -- obligatoria para «done»
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  done_at     TEXT
);
CREATE INDEX idx_tasks_status ON ops_tasks(status, category);

-- Una tarea no se completa sin evidencia verificable.
CREATE TRIGGER ops_tasks_done_needs_evidence BEFORE UPDATE OF status ON ops_tasks
WHEN NEW.status = 'done' AND (NEW.evidence IS NULL OR trim(NEW.evidence) = '')
BEGIN SELECT RAISE(ABORT, 'evidence_required'); END;
CREATE TRIGGER ops_tasks_insert_done_needs_evidence BEFORE INSERT ON ops_tasks
WHEN NEW.status = 'done' AND (NEW.evidence IS NULL OR trim(NEW.evidence) = '')
BEGIN SELECT RAISE(ABORT, 'evidence_required'); END;

CREATE TABLE risks (
  id          TEXT PRIMARY KEY,                                 -- R-001
  area        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  severity    TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  likelihood  TEXT NOT NULL CHECK (likelihood IN ('low','medium','high')),
  jurisdiction TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigating','accepted','closed')),
  mitigation  TEXT,
  needs_lawyer INTEGER NOT NULL DEFAULT 0 CHECK (needs_lawyer IN (0,1)),
  owner_label TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Costos: estimados y reales por separado, nunca mezclados.
CREATE TABLE costs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  area        TEXT NOT NULL,
  vendor      TEXT NOT NULL,
  description TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('estimate','actual','budget')),
  amount      REAL NOT NULL CHECK (amount >= 0),
  currency    TEXT NOT NULL DEFAULT 'USD',
  period      TEXT,                                             -- 2026-10, mensual, único…
  evidence    TEXT,                                             -- factura o fuente del estimado
  approval_id TEXT REFERENCES approval_items(id),
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Integraciones: solo «verified» con evidencia de la comprobación.
CREATE TABLE integrations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('verified','configured_unverified','missing','not_needed')),
  provides    TEXT,
  permissions TEXT,
  data        TEXT,
  cost        TEXT,
  actions     TEXT,
  limitations TEXT,
  ceo_action  TEXT,                                             -- qué debe configurar o autorizar un CEO
  evidence    TEXT,
  checked_at  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ───────────── Legal ─────────────
CREATE TABLE legal_jurisdictions (
  code        TEXT PRIMARY KEY,                                 -- ISO 3166 o región (EU)
  name        TEXT NOT NULL,
  target_market INTEGER NOT NULL DEFAULT 0 CHECK (target_market IN (0,1)),
  priority    INTEGER,
  requirements TEXT,                                            -- solo con fuente oficial
  official_sources TEXT,
  verified_at TEXT,
  reviewed_at TEXT,
  next_review_at TEXT,
  owner_label TEXT,
  status      TEXT NOT NULL DEFAULT 'not_researched'
              CHECK (status IN ('not_researched','researching','draft_findings','needs_lawyer','compliant','gaps')),
  affected_docs TEXT,
  risk        TEXT,
  pending_action TEXT,
  needs_lawyer INTEGER NOT NULL DEFAULT 0 CHECK (needs_lawyer IN (0,1)),
  notes       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE legal_documents (
  id          TEXT PRIMARY KEY,                                 -- terms, privacy, cookies…
  name        TEXT NOT NULL,
  required    INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  public_route TEXT,                                            -- dónde se publica, si se publica
  notes       TEXT
);

CREATE TABLE legal_document_versions (
  doc_id      TEXT NOT NULL REFERENCES legal_documents(id),
  version     INTEGER NOT NULL,
  language    TEXT NOT NULL DEFAULT 'es',
  body        TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','in_review','lawyer_review','approved','published','superseded')),
  source_note TEXT,                                             -- de dónde sale (p. ej. texto publicado en el sitio)
  approval_id TEXT REFERENCES approval_items(id),
  effective_at TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (doc_id, version, language)
);
-- Un documento no pasa a aprobado o publicado sin una aprobación de CEO vigente.
CREATE TRIGGER legal_versions_need_approval BEFORE UPDATE OF status ON legal_document_versions
WHEN NEW.status IN ('approved','published') AND NOT EXISTS (
  SELECT 1 FROM approval_items a WHERE a.id = NEW.approval_id AND a.status IN ('approved','executed') AND a.content_hash = NEW.content_hash)
BEGIN SELECT RAISE(ABORT, 'approval_required'); END;
-- Solo el registro inicial de los textos que ya están publicados en el sitio
-- («baseline») puede entrar como publicado; todo lo nuevo entra como borrador.
CREATE TRIGGER legal_versions_insert_need_approval BEFORE INSERT ON legal_document_versions
WHEN NEW.status IN ('approved','published') AND NEW.source_note IS NOT 'baseline'
BEGIN SELECT RAISE(ABORT, 'approval_required'); END;
-- El texto de una versión no cambia: los cambios crean otra versión.
CREATE TRIGGER legal_versions_body_immutable BEFORE UPDATE OF body, content_hash ON legal_document_versions
BEGIN SELECT RAISE(ABORT, 'legal_version_immutable'); END;

-- ───────────── Marketing: piezas de contenido ─────────────
CREATE TABLE content_pieces (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  campaign    TEXT,
  objective   TEXT,
  audience    TEXT,
  country     TEXT,
  language    TEXT,
  platform    TEXT NOT NULL,
  format      TEXT NOT NULL,                                    -- reel, carrusel, historia, artículo, pdf, newsletter…
  idea        TEXT,
  script      TEXT,
  body        TEXT,
  cta         TEXT,
  hashtags    TEXT,
  link        TEXT,
  alt_text    TEXT,
  assets      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assets)),   -- archivos reales (ruta o URL)
  rights      TEXT,                                             -- derechos y licencias de los recursos
  metric      TEXT,
  scheduled_at TEXT,
  status      TEXT NOT NULL DEFAULT 'idea'
              CHECK (status IN ('idea','research','production','editing','rights_review','pending_approval','approved',
                                'scheduled','published','paused','rejected','changes_requested','publish_error')),
  version     INTEGER NOT NULL DEFAULT 1,
  approval_id TEXT REFERENCES approval_items(id),
  approved_hash TEXT,
  published_url TEXT,                                           -- evidencia de publicación
  published_at TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_content_status ON content_pieces(status, scheduled_at);

-- Nada se programa ni se publica sin una aprobación vigente de esa versión,
-- y «publicada» exige el enlace a la publicación real.
CREATE TRIGGER content_requires_approval BEFORE UPDATE OF status ON content_pieces
WHEN NEW.status IN ('approved','scheduled','published') AND (NEW.approved_hash IS NULL OR NOT EXISTS (
  SELECT 1 FROM approval_items a WHERE a.id = NEW.approval_id AND a.status IN ('approved','executed') AND a.content_hash = NEW.approved_hash))
BEGIN SELECT RAISE(ABORT, 'approval_required'); END;
CREATE TRIGGER content_insert_requires_approval BEFORE INSERT ON content_pieces
WHEN NEW.status IN ('approved','scheduled','published')
BEGIN SELECT RAISE(ABORT, 'approval_required'); END;
CREATE TRIGGER content_published_needs_evidence BEFORE UPDATE OF status ON content_pieces
WHEN NEW.status = 'published' AND (NEW.published_url IS NULL OR NEW.published_url NOT LIKE 'https://%')
BEGIN SELECT RAISE(ABORT, 'evidence_required'); END;

-- ───────────── Instrucciones contradictorias ─────────────
-- Si los CEO dan órdenes opuestas sobre lo mismo, la tarea queda en pausa hasta resolverlo.
CREATE TABLE ceo_conflicts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_kind TEXT NOT NULL,
  subject_id  TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution  TEXT,
  resolved_by TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
