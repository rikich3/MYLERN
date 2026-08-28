-- ============================================================================
-- MILERN / MYLERN  --  Esquema relacional transaccional
-- Contenedor 03 "base de datos postgres mylern"
-- Requiere PostgreSQL >= 14 (columnas generadas STORED + WITH RECURSIVE)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE fase_nodo AS ENUM ('fase_1','fase_2','fase_3','fase_4','archivado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE origen_esfuerzo AS ENUM ('nodo','grafo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_despacho AS ENUM ('pendiente','en_proceso','enviado','fallido','descartado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_solucion AS ENUM ('backlog','en_progreso','completado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_evaluacion AS ENUM ('generada','en_progreso','calificada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE resultado_item AS ENUM ('pendiente','acierto','fallo');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- usuarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT NOT NULL UNIQUE,
  password_hash     TEXT   NOT NULL,
  nombre            TEXT   NOT NULL DEFAULT '',
  telegram_chat_id  BIGINT UNIQUE,
  zona_horaria      TEXT   NOT NULL DEFAULT 'UTC',
  activo            BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- fases_config : parametrizacion del ciclo de vida (feature 1.1)
--   min_ue / max_ue  -> rango pseudoaleatorio uniforme del delta de agendacion
--   umbral_conteo    -> esfuerzos necesarios para transicionar a siguiente_fase
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fases_config (
  fase           fase_nodo PRIMARY KEY,
  min_ue         INTEGER NOT NULL CHECK (min_ue > 0),
  max_ue         INTEGER NOT NULL CHECK (max_ue >= min_ue),
  umbral_conteo  INTEGER,
  siguiente_fase fase_nodo
);

INSERT INTO fases_config (fase, min_ue, max_ue, umbral_conteo, siguiente_fase) VALUES
  ('fase_1',  2,  6,  36, 'fase_2'),
  ('fase_2',  9, 15,  84, 'fase_3'),
  ('fase_3', 21, 35, 108, 'fase_4'),
  ('fase_4', 54, 66, NULL, NULL)
ON CONFLICT (fase) DO UPDATE
  SET min_ue = EXCLUDED.min_ue,
      max_ue = EXCLUDED.max_ue,
      umbral_conteo = EXCLUDED.umbral_conteo,
      siguiente_fase = EXCLUDED.siguiente_fase;

-- ---------------------------------------------------------------------------
-- grafos : entidad Grafo de Conocimiento (feature 2)
--   Posee su propio indice_siguiente_esfuerzo y su puntero Round Robin.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grafos (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id                UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre                    TEXT NOT NULL,
  descripcion               TEXT NOT NULL DEFAULT '',
  indice_siguiente_esfuerzo BIGINT NOT NULL DEFAULT 0,
  cursor_rr                 INTEGER NOT NULL DEFAULT 0 CHECK (cursor_rr >= 0),
  activo                    BOOLEAN NOT NULL DEFAULT TRUE,
  archivado_en              TIMESTAMPTZ,
  creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_grafos_agenda
  ON grafos (indice_siguiente_esfuerzo) WHERE activo;

-- ---------------------------------------------------------------------------
-- nodos : unidad de conocimiento. Unifica los campos de scheduling (feature
--   1.2) y los campos de pertenencia a grafo / adjacency list (feature 2.1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodos (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id                UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,

  -- contenido (feature 1.1 / feature 2)
  nodo_esfuerzo             TEXT NOT NULL CHECK (btrim(nodo_esfuerzo) <> ''),
  nodo_crudo                TEXT,
  contenido                 TEXT GENERATED ALWAYS AS
                              (COALESCE(NULLIF(btrim(nodo_crudo), ''), nodo_esfuerzo)) STORED,

  -- scheduling (feature 1.2)
  fase                      fase_nodo NOT NULL DEFAULT 'fase_1',
  conteo_esfuerzo           INTEGER NOT NULL DEFAULT 0 CHECK (conteo_esfuerzo >= 0),
  -- contador por etapa: los umbrales 36 / 84 / 108 son requisitos POR etapa
  -- (ver docs/decisiones.md, DEC-002). conteo_esfuerzo mantiene el acumulado.
  conteo_esfuerzo_fase      INTEGER NOT NULL DEFAULT 0 CHECK (conteo_esfuerzo_fase >= 0),
  indice_siguiente_esfuerzo BIGINT  NOT NULL,
  indice_fecha_limite       BIGINT,
  es_temporal               BOOLEAN GENERATED ALWAYS AS (indice_fecha_limite IS NOT NULL) STORED,

  -- adjacency list (feature 2.1)
  grafo_id                  UUID REFERENCES grafos(id) ON DELETE SET NULL,
  parent_id                 UUID REFERENCES nodos(id)  ON DELETE SET NULL,
  enlace_contenido          TEXT,
  is_leaf                   BOOLEAN NOT NULL DEFAULT TRUE,

  activo                    BOOLEAN NOT NULL DEFAULT TRUE,
  archivado_en              TIMESTAMPTZ,
  creado_en                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- [PRT-INTEGRIDAD.1] par atomico parent_id / enlace_contenido
  CONSTRAINT chk_par_atomico CHECK (
    (parent_id IS NULL     AND enlace_contenido IS NULL) OR
    (parent_id IS NOT NULL AND enlace_contenido IS NOT NULL)
  ),
  -- un nodo nunca es su propio padre  [LOG-ACICLICIDAD paso 1]
  CONSTRAINT chk_no_autopadre CHECK (parent_id IS DISTINCT FROM id),
  -- solo un nodo integrado a un grafo puede tener padre
  CONSTRAINT chk_padre_requiere_grafo CHECK (parent_id IS NULL OR grafo_id IS NOT NULL),
  -- un nodo NO temporal en fase_4 esta necesariamente integrado a un grafo
  CONSTRAINT chk_fase4_estructurado CHECK (
    fase <> 'fase_4' OR indice_fecha_limite IS NOT NULL OR grafo_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS ix_nodos_agenda
  ON nodos (indice_siguiente_esfuerzo, fase) WHERE activo;
CREATE INDEX IF NOT EXISTS ix_nodos_fecha_limite
  ON nodos (indice_fecha_limite) WHERE activo AND indice_fecha_limite IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_nodos_parent
  ON nodos (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_nodos_hojas
  ON nodos (grafo_id, is_leaf) WHERE activo AND grafo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_nodos_usuario
  ON nodos (usuario_id) WHERE activo;

-- ---------------------------------------------------------------------------
-- effort_dispatch_queue : cola transaccional de despacho de esfuerzos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS effort_dispatch_queue (
  id                  BIGSERIAL PRIMARY KEY,
  usuario_id          UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  origen              origen_esfuerzo NOT NULL,
  nodo_id             UUID REFERENCES nodos(id)  ON DELETE CASCADE,
  grafo_id            UUID REFERENCES grafos(id) ON DELETE CASCADE,
  contenido           TEXT NOT NULL,
  indice_global       BIGINT NOT NULL,
  prioridad           INTEGER NOT NULL DEFAULT 100,
  estado              estado_despacho NOT NULL DEFAULT 'pendiente',
  intentos            INTEGER NOT NULL DEFAULT 0,
  ultimo_error        TEXT,
  telegram_message_id BIGINT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  tomado_en           TIMESTAMPTZ,
  enviado_en          TIMESTAMPTZ,
  CONSTRAINT chk_origen_coherente CHECK (
    (origen = 'nodo'  AND nodo_id  IS NOT NULL AND grafo_id IS NULL) OR
    (origen = 'grafo' AND grafo_id IS NOT NULL)
  )
);

-- Idempotencia del tick: un nodo/grafo no puede encolarse dos veces en el
-- mismo indice global aunque el tick se ejecute mas de una vez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cola_nodo_tick
  ON effort_dispatch_queue (nodo_id, indice_global) WHERE origen = 'nodo';
CREATE UNIQUE INDEX IF NOT EXISTS ux_cola_grafo_tick
  ON effort_dispatch_queue (grafo_id, indice_global) WHERE origen = 'grafo';
CREATE INDEX IF NOT EXISTS ix_cola_pendientes
  ON effort_dispatch_queue (prioridad, id) WHERE estado = 'pendiente';

-- ---------------------------------------------------------------------------
-- esfuerzos_log : historico inmutable de esfuerzos confirmados
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS esfuerzos_log (
  id                  BIGSERIAL PRIMARY KEY,
  dispatch_id         BIGINT,
  usuario_id          UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  origen              origen_esfuerzo NOT NULL,
  nodo_id             UUID,
  grafo_id            UUID,
  fase_al_enviar      fase_nodo,
  contenido           TEXT NOT NULL,
  indice_global       BIGINT NOT NULL,
  telegram_message_id BIGINT,
  enviado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_esfuerzos_log_nodo ON esfuerzos_log (nodo_id, enviado_en DESC);

-- ---------------------------------------------------------------------------
-- CASO DE USO 2 : evaluaciones dominicales
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evaluaciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  semana_iso    TEXT NOT NULL,
  indice_global BIGINT NOT NULL,
  estado        estado_evaluacion NOT NULL DEFAULT 'generada',
  total_items   INTEGER NOT NULL DEFAULT 0,
  aciertos      INTEGER NOT NULL DEFAULT 0,
  fallos        INTEGER NOT NULL DEFAULT 0,
  puntaje       NUMERIC(5,2),
  generada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrada_en    TIMESTAMPTZ,
  CONSTRAINT ux_evaluacion_semana UNIQUE (usuario_id, semana_iso)
);

CREATE TABLE IF NOT EXISTS evaluacion_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluacion_id UUID NOT NULL REFERENCES evaluaciones(id) ON DELETE CASCADE,
  nodo_id       UUID REFERENCES nodos(id) ON DELETE SET NULL,
  orden         INTEGER NOT NULL,
  premisa       TEXT NOT NULL,
  contraste     TEXT NOT NULL,
  resultado     resultado_item NOT NULL DEFAULT 'pendiente',
  respondido_en TIMESTAMPTZ,
  CONSTRAINT ux_item_orden UNIQUE (evaluacion_id, orden)
);

CREATE TABLE IF NOT EXISTS retencion_historico (
  id            BIGSERIAL PRIMARY KEY,
  usuario_id    UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  evaluacion_id UUID REFERENCES evaluaciones(id) ON DELETE CASCADE,
  semana_iso    TEXT NOT NULL,
  total_items   INTEGER NOT NULL,
  aciertos      INTEGER NOT NULL,
  fallos        INTEGER NOT NULL,
  puntaje       NUMERIC(5,2) NOT NULL,
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- CASO DE USO 3 : avance del sistema (oportunidades -> soluciones)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS soluciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  descripcion    TEXT NOT NULL DEFAULT '',
  estado         estado_solucion NOT NULL DEFAULT 'backlog',
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oportunidades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  situacion   TEXT NOT NULL,
  observacion TEXT NOT NULL,
  solucion_id UUID REFERENCES soluciones(id) ON DELETE SET NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_oportunidades_solucion ON oportunidades (solucion_id);

-- ---------------------------------------------------------------------------
-- Seguridad y auditoria
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  revocado   BOOLEAN NOT NULL DEFAULT FALSE,
  ultimo_uso TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Log de transacciones: habilita el comando `undo` de la CLI.
CREATE TABLE IF NOT EXISTS transacciones_log (
  id               BIGSERIAL PRIMARY KEY,
  usuario_id       UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  origen           TEXT NOT NULL CHECK (origen IN ('web','cli','n8n','telegram','sistema')),
  operacion        TEXT NOT NULL,
  entidad          TEXT NOT NULL,
  entidad_id       TEXT,
  payload_anterior JSONB,
  payload_nuevo    JSONB,
  deshecha         BOOLEAN NOT NULL DEFAULT FALSE,
  deshecha_en      TIMESTAMPTZ,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_txlog_usuario ON transacciones_log (usuario_id, id DESC);
