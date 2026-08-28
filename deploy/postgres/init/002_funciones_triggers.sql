-- ============================================================================
-- MILERN / MYLERN -- Funciones, triggers e invariantes del grafo
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tiempo global discreto: 1 UE = 600 s  (feature 1.2)
--   indice_global = floor(unix_timestamp_seconds / 600)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_indice_global(p_ts TIMESTAMPTZ DEFAULT now())
RETURNS BIGINT LANGUAGE sql IMMUTABLE AS $$
  SELECT FLOOR(EXTRACT(EPOCH FROM p_ts) / 600)::BIGINT;
$$;

-- Delta pseudoaleatorio uniforme dentro del rango [min_ue, max_ue]
CREATE OR REPLACE FUNCTION fn_delta_ue(p_min INT, p_max INT)
RETURNS INT LANGUAGE sql VOLATILE AS $$
  SELECT p_min + FLOOR(random() * (p_max - p_min + 1))::INT;
$$;

-- ---------------------------------------------------------------------------
-- actualizado_en automatico
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_touch_actualizado_en()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_nodos_touch ON nodos;
CREATE TRIGGER tg_nodos_touch BEFORE UPDATE ON nodos
  FOR EACH ROW EXECUTE FUNCTION fn_touch_actualizado_en();

DROP TRIGGER IF EXISTS tg_grafos_touch ON grafos;
CREATE TRIGGER tg_grafos_touch BEFORE UPDATE ON grafos
  FOR EACH ROW EXECUTE FUNCTION fn_touch_actualizado_en();

DROP TRIGGER IF EXISTS tg_soluciones_touch ON soluciones;
CREATE TRIGGER tg_soluciones_touch BEFORE UPDATE ON soluciones
  FOR EACH ROW EXECUTE FUNCTION fn_touch_actualizado_en();

DROP TRIGGER IF EXISTS tg_usuarios_touch ON usuarios;
CREATE TRIGGER tg_usuarios_touch BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION fn_touch_actualizado_en();

-- ---------------------------------------------------------------------------
-- [LOG-ACICLICIDAD] Validacion de no-ciclos, transaccional y previa a cada
-- confirmacion de reparenteo. Segunda barrera: la primera vive en el servicio
-- de aplicacion; esta garantiza la invariante ante escrituras directas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validar_aciclicidad()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_grafo_padre UUID;
  v_ciclo       BOOLEAN;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Rechazo inmediato de auto-referencia.
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'CICLO_AUTOREFERENCIA: el nodo % no puede ser su propio padre', NEW.id
      USING ERRCODE = '23514';
  END IF;

  -- 2. El padre debe existir y pertenecer al mismo grafo.
  SELECT grafo_id INTO v_grafo_padre FROM nodos WHERE id = NEW.parent_id AND activo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PADRE_INEXISTENTE: el nodo padre % no existe o esta archivado', NEW.parent_id
      USING ERRCODE = '23503';
  END IF;
  IF v_grafo_padre IS DISTINCT FROM NEW.grafo_id THEN
    RAISE EXCEPTION 'GRAFO_DISCORDANTE: el padre % pertenece a otro grafo', NEW.parent_id
      USING ERRCODE = '23514';
  END IF;

  -- 3. Recorrido ascendente por ancestros del parent_id propuesto.
  WITH RECURSIVE ancestros AS (
      SELECT n.id, n.parent_id, 1 AS nivel
        FROM nodos n WHERE n.id = NEW.parent_id
    UNION ALL
      SELECT p.id, p.parent_id, a.nivel + 1
        FROM nodos p JOIN ancestros a ON p.id = a.parent_id
       WHERE a.nivel < 10000
  )
  SELECT EXISTS (SELECT 1 FROM ancestros WHERE id = NEW.id) INTO v_ciclo;

  IF v_ciclo THEN
    RAISE EXCEPTION 'CICLO_DETECTADO: % ya es ancestro de %', NEW.id, NEW.parent_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_nodos_aciclicidad ON nodos;
CREATE TRIGGER tg_nodos_aciclicidad
  BEFORE INSERT OR UPDATE OF parent_id ON nodos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_aciclicidad();

-- ---------------------------------------------------------------------------
-- [feature 2.1] Mantenimiento del flag is_leaf mediante triggers de insercion
-- y eliminacion de relaciones, para alimentar `nodos_hojas` en O(1).
--   is_leaf(n) := NO EXISTE hijo activo cuyo parent_id = n.id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_recalcular_is_leaf(p_nodo_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_nodo_id IS NULL THEN RETURN; END IF;
  UPDATE nodos n
     SET is_leaf = NOT EXISTS (
           SELECT 1 FROM nodos h WHERE h.parent_id = p_nodo_id AND h.activo
         )
   WHERE n.id = p_nodo_id
     AND n.is_leaf IS DISTINCT FROM NOT EXISTS (
           SELECT 1 FROM nodos h WHERE h.parent_id = p_nodo_id AND h.activo
         );
END $$;

CREATE OR REPLACE FUNCTION fn_sync_is_leaf()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM fn_recalcular_is_leaf(NEW.parent_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM fn_recalcular_is_leaf(OLD.parent_id);
  ELSE
    IF OLD.parent_id IS DISTINCT FROM NEW.parent_id THEN
      PERFORM fn_recalcular_is_leaf(OLD.parent_id);
      PERFORM fn_recalcular_is_leaf(NEW.parent_id);
    END IF;
    IF OLD.activo IS DISTINCT FROM NEW.activo THEN
      PERFORM fn_recalcular_is_leaf(NEW.parent_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- Se restringe a las columnas que definen la relacion para evitar recursion:
-- fn_recalcular_is_leaf solo escribe is_leaf, columna no vigilada aqui.
DROP TRIGGER IF EXISTS tg_nodos_is_leaf ON nodos;
CREATE TRIGGER tg_nodos_is_leaf
  AFTER INSERT OR DELETE OR UPDATE OF parent_id, activo ON nodos
  FOR EACH ROW EXECUTE FUNCTION fn_sync_is_leaf();

-- ---------------------------------------------------------------------------
-- Vistas de apoyo
-- ---------------------------------------------------------------------------

-- `nodos_hojas`: nodos activos del grafo sin descendientes, tengan o no padre.
CREATE OR REPLACE VIEW v_nodos_hojas AS
SELECT n.id,
       n.grafo_id,
       n.parent_id,
       n.enlace_contenido,
       n.contenido,
       p.contenido AS contenido_padre,
       ROW_NUMBER() OVER (PARTITION BY n.grafo_id ORDER BY n.creado_en, n.id) - 1 AS posicion
  FROM nodos n
  LEFT JOIN nodos p ON p.id = n.parent_id AND p.activo
 WHERE n.activo AND n.grafo_id IS NOT NULL AND n.is_leaf;

-- Nodos elegibles para generacion de esfuerzos  [LOG-GEN-NODO]
CREATE OR REPLACE VIEW v_nodos_elegibles AS
SELECT n.*
  FROM nodos n
 WHERE n.activo
   AND ( n.fase IN ('fase_1','fase_2','fase_3')
         OR (n.fase = 'fase_4' AND n.es_temporal) )
   AND n.indice_siguiente_esfuerzo <= fn_indice_global();

-- Grafo materializado como lista de adyacencia navegable
CREATE OR REPLACE VIEW v_grafo_adyacencia AS
SELECT g.id AS grafo_id, g.nombre AS grafo_nombre,
       n.id, n.parent_id, n.enlace_contenido, n.contenido, n.is_leaf,
       (SELECT count(*) FROM nodos h WHERE h.parent_id = n.id AND h.activo) AS children_count
  FROM grafos g JOIN nodos n ON n.grafo_id = g.id AND n.activo
 WHERE g.activo;
