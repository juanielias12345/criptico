-- AI Company HQ: oficina virtual de los CEO (ver docs/HQ.md).
-- Registro de eventos de ejecución de los agentes, pausa de asignaciones,
-- informes ejecutivos cada 48 horas con su historial de entrega y
-- correcciones propuestas a partir de la evaluación de desempeño.
-- Solo agrega columnas, tablas, índices y disparadores.

-- Agentes: cargo, responsable de supervisión, dependencias y código relacionado.
ALTER TABLE agents ADD COLUMN role_title TEXT;                  -- cargo visible en la ficha
ALTER TABLE agents ADD COLUMN supervisor TEXT NOT NULL DEFAULT 'Los dos CEO';
ALTER TABLE agents ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(depends_on)); -- otros agentes o integraciones
ALTER TABLE agents ADD COLUMN code_paths TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(code_paths)); -- archivos del repositorio
ALTER TABLE agents ADD COLUMN paused_at TEXT;                   -- pausa de nuevas asignaciones
ALTER TABLE agents ADD COLUMN paused_by TEXT REFERENCES users(id);
ALTER TABLE agents ADD COLUMN pause_reason TEXT;

-- Ejecuciones: etapa explícita (sin porcentajes inventados) y último latido.
ALTER TABLE agent_runs ADD COLUMN stage TEXT;                   -- research | implementation | testing | review | …
ALTER TABLE agent_runs ADD COLUMN heartbeat_at TEXT;            -- última señal verificada de una ejecución en curso
ALTER TABLE agent_runs ADD COLUMN source TEXT;                  -- job | workflow | commit | ceo | cli

-- Tareas: prioridad y reintentos.
ALTER TABLE ops_tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5); -- 1 = máxima
ALTER TABLE ops_tasks ADD COLUMN retry_of TEXT;

-- Registro de eventos de ejecución. Es la prueba de actividad: la oficina solo
-- muestra trabajo cuando hay un evento o una ejecución registrada. Inalterable.
CREATE TABLE agent_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  run_id      INTEGER REFERENCES agent_runs(id),
  task_id     TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('started','stage','progress','file','test','result','error','approval_request',
                                             'blocked','finished','cost','report','paused','resumed','assigned','retry','note')),
  stage       TEXT,
  message     TEXT NOT NULL,
  progress    REAL CHECK (progress IS NULL OR (progress >= 0 AND progress <= 1)),  -- solo si se midió de verdad
  progress_basis TEXT,                                          -- qué se midió (por ejemplo «12 de 40 lotes»)
  data        TEXT CHECK (data IS NULL OR json_valid(data)),
  cost_amount REAL,
  cost_currency TEXT,
  source      TEXT NOT NULL DEFAULT 'system',                   -- job | workflow | commit | ceo | cli | system
  actor_id    TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (progress IS NULL OR progress_basis IS NOT NULL)
);
CREATE INDEX idx_agent_events_agent ON agent_events(agent_id, id);
CREATE INDEX idx_agent_events_created ON agent_events(created_at);
CREATE TRIGGER agent_events_no_update BEFORE UPDATE ON agent_events
BEGIN SELECT RAISE(ABORT, 'agent_events_immutable'); END;
CREATE TRIGGER agent_events_no_delete BEFORE DELETE ON agent_events
BEGIN SELECT RAISE(ABORT, 'agent_events_immutable'); END;

-- Informes ejecutivos. period_key impide duplicados: un informe programado por turno.
CREATE TABLE exec_reports (
  id           TEXT PRIMARY KEY,
  period_key   TEXT NOT NULL UNIQUE,                            -- scheduled:<turno> | manual:<minuto>
  trigger      TEXT NOT NULL CHECK (trigger IN ('scheduled','manual')),
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  timezone     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating','ready','failed')),
  attempts     INTEGER NOT NULL DEFAULT 1,
  content      TEXT CHECK (content IS NULL OR json_valid(content)),
  sources      TEXT CHECK (sources IS NULL OR json_valid(sources)),     -- tablas y consultas usadas
  error        TEXT,
  requested_by TEXT REFERENCES users(id),
  started_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  generated_at TEXT,
  delivery     TEXT CHECK (delivery IS NULL OR json_valid(delivery)),   -- canal → estado
  delivered_at TEXT
);
CREATE INDEX idx_exec_reports_end ON exec_reports(period_end);

-- Un informe listo no cambia: es la evidencia de lo que se informó.
CREATE TRIGGER exec_reports_ready_immutable BEFORE UPDATE OF content, sources, period_start, period_end ON exec_reports
WHEN OLD.status = 'ready'
BEGIN SELECT RAISE(ABORT, 'report_immutable'); END;

-- Correcciones propuestas cuando un agente muestra un patrón de malos resultados.
CREATE TABLE agent_corrections (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  pattern     TEXT NOT NULL,                                    -- qué se detectó
  evidence    TEXT NOT NULL CHECK (json_valid(evidence)),       -- ejecuciones y tareas que lo prueban
  cause       TEXT NOT NULL,                                    -- causa investigada (clasificada)
  proposal    TEXT NOT NULL,
  baseline    TEXT NOT NULL CHECK (json_valid(baseline)),       -- indicadores antes de corregir
  status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','applied','effective','ineffective')),
  approval_id TEXT REFERENCES approval_items(id),
  task_id     TEXT,
  applied_at  TEXT,
  measured_at TEXT,
  result      TEXT CHECK (result IS NULL OR json_valid(result)),
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_corrections_agent ON agent_corrections(agent_id, created_at);
