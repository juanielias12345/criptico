-- Agentes de crecimiento (22/10/2026): un agente de métricas por red, un gerente de redes
-- que informa a la dirección de marketing y publicidad, y un agente de estrategia comercial.

-- Métricas diarias de cada cuenta. Solo cifras importadas de una fuente nombrada
-- (Metricool, archivo CSV o carga manual); nunca estimadas.
CREATE TABLE social_metrics_daily (
  network     TEXT NOT NULL CHECK (network IN ('instagram','facebook','tiktok','youtube')),
  day         TEXT NOT NULL,                                     -- AAAA-MM-DD
  metric      TEXT NOT NULL,
  value       REAL NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('metricool','csv','manual')),
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  imported_by TEXT,
  PRIMARY KEY (network, day, metric)
);

-- Cada importación queda registrada (quién, de dónde, cuántas filas).
CREATE TABLE social_metric_imports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  network     TEXT,
  source      TEXT NOT NULL,
  rows        INTEGER NOT NULL,
  first_day   TEXT,
  last_day    TEXT,
  actor       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Informes de los agentes (por red, del gerente y comercial). No se modifican.
CREATE TABLE growth_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     TEXT NOT NULL REFERENCES agents(id),
  kind         TEXT NOT NULL CHECK (kind IN ('network','manager','commercial')),
  network      TEXT,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  addressed_to TEXT,                                             -- agente que lo recibe
  content      TEXT NOT NULL CHECK (json_valid(content)),
  run_id       INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_growth_reports ON growth_reports(kind, network, created_at);
CREATE TRIGGER growth_reports_immutable_u BEFORE UPDATE ON growth_reports BEGIN SELECT RAISE(ABORT, 'report_immutable'); END;
CREATE TRIGGER growth_reports_immutable_d BEFORE DELETE ON growth_reports BEGIN SELECT RAISE(ABORT, 'report_immutable'); END;

-- Propuestas de cambio de estrategia, publicaciones o negocio. La última palabra es de un CEO:
-- sin aprobación vigente no se ejecutan.
CREATE TABLE growth_proposals (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  kind        TEXT NOT NULL CHECK (kind IN ('social','commercial')),
  network     TEXT,
  rule        TEXT NOT NULL,                                     -- regla o línea de negocio que la originó
  title       TEXT NOT NULL,
  rationale   TEXT NOT NULL,
  evidence    TEXT NOT NULL CHECK (json_valid(evidence)),
  plan        TEXT NOT NULL CHECK (json_valid(plan)),            -- pasos que se ejecutan al aprobarse
  metric      TEXT,                                              -- qué se mide después
  baseline    REAL,
  status      TEXT NOT NULL DEFAULT 'proposed'
              CHECK (status IN ('proposed','approved','rejected','executing','measured','withdrawn')),
  approval_id TEXT REFERENCES approval_items(id),
  tasks       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tasks)),
  result      TEXT CHECK (result IS NULL OR json_valid(result)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at  TEXT,
  measure_after TEXT,
  measured_at TEXT
);
CREATE INDEX idx_growth_proposals ON growth_proposals(kind, status, agent_id);

-- Solo se ejecuta lo aprobado por un CEO en la versión vigente.
CREATE TRIGGER growth_proposals_need_approval BEFORE UPDATE OF status ON growth_proposals
WHEN NEW.status IN ('approved','executing') AND NOT EXISTS (
  SELECT 1 FROM approval_items a WHERE a.id = NEW.approval_id AND a.status IN ('approved','executed'))
BEGIN SELECT RAISE(ABORT, 'approval_required'); END;
