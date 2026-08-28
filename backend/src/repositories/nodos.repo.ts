import { consulta, uno, type Ejecutor } from '../db/pool.js';
import type { Fase, Nodo, NodoHoja } from '../domain/tipos.js';

const COLS = `id, usuario_id, nodo_esfuerzo, nodo_crudo, contenido, fase,
  conteo_esfuerzo, conteo_esfuerzo_fase, indice_siguiente_esfuerzo,
  indice_fecha_limite, es_temporal, grafo_id, parent_id, enlace_contenido,
  is_leaf, activo, creado_en, actualizado_en`;

export interface NuevoNodo {
  usuario_id: string;
  nodo_esfuerzo: string;
  nodo_crudo: string | null;
  indice_fecha_limite: number | null;
  indice_siguiente_esfuerzo: number;
  grafo_id?: string | null;
  parent_id?: string | null;
  enlace_contenido?: string | null;
}

export async function crear(ej: Ejecutor, n: NuevoNodo): Promise<Nodo> {
  const row = await uno<Nodo>(
    ej,
    `INSERT INTO nodos (usuario_id, nodo_esfuerzo, nodo_crudo, indice_fecha_limite,
                        indice_siguiente_esfuerzo, grafo_id, parent_id, enlace_contenido,
                        fase, conteo_esfuerzo, conteo_esfuerzo_fase, activo, is_leaf)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'fase_1',0,0,TRUE,TRUE)
     RETURNING ${COLS}`,
    [n.usuario_id, n.nodo_esfuerzo, n.nodo_crudo, n.indice_fecha_limite,
     n.indice_siguiente_esfuerzo, n.grafo_id ?? null, n.parent_id ?? null,
     n.enlace_contenido ?? null],
  );
  return row!;
}

export async function obtener(ej: Ejecutor, id: string, usuarioId?: string): Promise<Nodo | null> {
  return uno<Nodo>(
    ej,
    `SELECT ${COLS} FROM nodos WHERE id = $1 AND ($2::uuid IS NULL OR usuario_id = $2)`,
    [id, usuarioId ?? null],
  );
}

export async function obtenerParaActualizar(ej: Ejecutor, id: string): Promise<Nodo | null> {
  return uno<Nodo>(ej, `SELECT ${COLS} FROM nodos WHERE id = $1 FOR UPDATE`, [id]);
}

export interface FiltroNodos {
  usuario_id: string;
  fase?: Fase;
  grafo_id?: string | null;
  activo?: boolean;
  busqueda?: string;
  limite?: number;
  desplazamiento?: number;
}

export async function listar(ej: Ejecutor, f: FiltroNodos): Promise<Nodo[]> {
  return consulta<Nodo>(
    ej,
    `SELECT ${COLS} FROM nodos
      WHERE usuario_id = $1
        AND ($2::fase_nodo IS NULL OR fase = $2)
        AND ($3::boolean   IS NULL OR activo = $3)
        AND ($4::text      IS NULL OR nodo_esfuerzo ILIKE '%'||$4||'%' OR contenido ILIKE '%'||$4||'%')
        AND ($5::uuid      IS NULL OR grafo_id = $5)
      ORDER BY creado_en DESC
      LIMIT $6 OFFSET $7`,
    [f.usuario_id, f.fase ?? null, f.activo ?? null, f.busqueda ?? null,
     f.grafo_id ?? null, f.limite ?? 100, f.desplazamiento ?? 0],
  );
}

/**
 * [LOG-GEN-NODO] "Se marcan como inactivos/archivados los nodos con
 * `indice_fecha_limite < indice_global`."
 */
export async function archivarVencidos(ej: Ejecutor, indiceGlobal: number): Promise<string[]> {
  const rows = await consulta<{ id: string }>(
    ej,
    `UPDATE nodos
        SET activo = FALSE, fase = 'archivado', archivado_en = now()
      WHERE activo AND indice_fecha_limite IS NOT NULL AND indice_fecha_limite < $1
      RETURNING id`,
    [indiceGlobal],
  );
  return rows.map((r) => r.id);
}

/**
 * [LOG-GEN-NODO] Nodos candidatos para generacion:
 *   activo = verdadero
 *   fase IN ('fase_1','fase_2','fase_3') O (fase = 'fase_4' Y es_temporal)
 *   indice_siguiente_esfuerzo <= indice_global
 *
 * Se excluyen los nodos que ya tienen un esfuerzo vivo en la cola: su
 * `indice_siguiente_esfuerzo` solo se reagenda al confirmarse el envio, de modo
 * que sin este filtro un tick posterior los volveria a encolar.
 */
export async function candidatos(ej: Ejecutor, indiceGlobal: number, limite = 500): Promise<Nodo[]> {
  return consulta<Nodo>(
    ej,
    `SELECT ${COLS} FROM nodos n
      WHERE n.activo
        AND ( n.fase IN ('fase_1','fase_2','fase_3')
              OR (n.fase = 'fase_4' AND n.es_temporal) )
        AND n.indice_siguiente_esfuerzo <= $1
        AND NOT EXISTS (
              SELECT 1 FROM effort_dispatch_queue q
               WHERE q.nodo_id = n.id AND q.estado IN ('pendiente','en_proceso'))
      ORDER BY n.indice_siguiente_esfuerzo ASC, n.creado_en ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [indiceGlobal, limite],
  );
}

export interface ActualizacionAgenda {
  fase: Fase;
  conteo_esfuerzo: number;
  conteo_esfuerzo_fase: number;
  indice_siguiente_esfuerzo: number;
  grafo_id?: string | null;
}

export async function aplicarAgenda(ej: Ejecutor, id: string, a: ActualizacionAgenda): Promise<Nodo> {
  const row = await uno<Nodo>(
    ej,
    `UPDATE nodos
        SET fase = $2,
            conteo_esfuerzo = $3,
            conteo_esfuerzo_fase = $4,
            indice_siguiente_esfuerzo = $5,
            grafo_id = COALESCE($6::uuid, grafo_id)
      WHERE id = $1
      RETURNING ${COLS}`,
    [id, a.fase, a.conteo_esfuerzo, a.conteo_esfuerzo_fase,
     a.indice_siguiente_esfuerzo, a.grafo_id ?? null],
  );
  return row!;
}

/**
 * [feature 2.1] `nodos_hojas` del grafo: nodos activos sin descendientes,
 * independientemente de si tienen padre o son raices/aislados. El flag
 * `is_leaf` indexado permite resolverlo sin recorrer la jerarquia.
 */
export async function hojasDeGrafo(ej: Ejecutor, grafoId: string): Promise<NodoHoja[]> {
  return consulta<NodoHoja>(
    ej,
    `SELECT n.id, n.parent_id, n.enlace_contenido, n.contenido,
            p.contenido AS contenido_padre
       FROM nodos n
       LEFT JOIN nodos p ON p.id = n.parent_id AND p.activo
      WHERE n.grafo_id = $1 AND n.activo AND n.is_leaf
      ORDER BY n.creado_en ASC, n.id ASC`,
    [grafoId],
  );
}

/** Nodos de un grafo, como adjacency list navegable por la app web. */
export async function nodosDeGrafo(ej: Ejecutor, grafoId: string): Promise<Array<Nodo & { children_count: number }>> {
  return consulta<Nodo & { children_count: number }>(
    ej,
    `SELECT ${COLS.split(',').map((c) => 'n.' + c.trim()).join(', ')},
            (SELECT count(*)::int FROM nodos h WHERE h.parent_id = n.id AND h.activo) AS children_count
       FROM nodos n
      WHERE n.grafo_id = $1 AND n.activo
      ORDER BY n.creado_en ASC`,
    [grafoId],
  );
}

/**
 * [LOG-ACICLICIDAD] Recorrido ascendente por ancestros mediante WITH RECURSIVE,
 * desde el `parent_id` propuesto hacia la raiz.
 */
export async function rutaAncestros(ej: Ejecutor, desdeId: string): Promise<Array<{ id: string; parent_id: string | null; contenido: string; enlace_contenido: string | null }>> {
  return consulta(
    ej,
    `WITH RECURSIVE ancestros AS (
        SELECT n.id, n.parent_id, n.contenido, n.enlace_contenido, 1 AS nivel
          FROM nodos n WHERE n.id = $1
      UNION ALL
        SELECT p.id, p.parent_id, p.contenido, p.enlace_contenido, a.nivel + 1
          FROM nodos p JOIN ancestros a ON p.id = a.parent_id
         WHERE a.nivel < 10000
     )
     SELECT id, parent_id, contenido, enlace_contenido FROM ancestros ORDER BY nivel ASC`,
    [desdeId],
  );
}

export async function contarHijosActivos(ej: Ejecutor, padreId: string): Promise<number> {
  const r = await uno<{ n: number }>(
    ej,
    'SELECT count(*)::int AS n FROM nodos WHERE parent_id = $1 AND activo',
    [padreId],
  );
  return r?.n ?? 0;
}

/**
 * [PSC-DEL-NODO] `desvincular_hijos_directos`: asigna parent_id = null y
 * enlace_contenido = null a los hijos directos, preservandolos en el grafo como
 * nodos raices/aislados [PRT-INTEGRIDAD.3].
 */
export async function desvincularHijosDirectos(ej: Ejecutor, padreId: string): Promise<string[]> {
  const rows = await consulta<{ id: string }>(
    ej,
    `UPDATE nodos SET parent_id = NULL, enlace_contenido = NULL
      WHERE parent_id = $1 AND activo
      RETURNING id`,
    [padreId],
  );
  return rows.map((r) => r.id);
}

export async function marcarIsLeaf(ej: Ejecutor, id: string, isLeaf: boolean): Promise<void> {
  await ej.query('UPDATE nodos SET is_leaf = $2 WHERE id = $1', [id, isLeaf]);
}

/** Baja logica: el nodo permanece archivado en la base de datos. */
export async function marcarBajaLogica(ej: Ejecutor, id: string): Promise<Nodo | null> {
  return uno<Nodo>(
    ej,
    `UPDATE nodos
        SET activo = FALSE, fase = 'archivado', archivado_en = now(),
            parent_id = NULL, enlace_contenido = NULL
      WHERE id = $1 AND activo
      RETURNING ${COLS}`,
    [id],
  );
}

export async function reparentear(
  ej: Ejecutor,
  id: string,
  parentId: string | null,
  enlaceContenido: string | null,
): Promise<Nodo> {
  const row = await uno<Nodo>(
    ej,
    `UPDATE nodos SET parent_id = $2, enlace_contenido = $3 WHERE id = $1 RETURNING ${COLS}`,
    [id, parentId, enlaceContenido],
  );
  return row!;
}

export async function actualizarContenido(
  ej: Ejecutor,
  id: string,
  campos: { nodo_esfuerzo?: string; nodo_crudo?: string | null; grafo_id?: string | null },
): Promise<Nodo | null> {
  return uno<Nodo>(
    ej,
    `UPDATE nodos
        SET nodo_esfuerzo = COALESCE($2, nodo_esfuerzo),
            nodo_crudo    = COALESCE($3, nodo_crudo),
            grafo_id      = COALESCE($4::uuid, grafo_id)
      WHERE id = $1 AND activo
      RETURNING ${COLS}`,
    [id, campos.nodo_esfuerzo ?? null, campos.nodo_crudo ?? null, campos.grafo_id ?? null],
  );
}

/** [caso de uso 2] Muestra aleatoria de nodos en fase_3 o fase_4. */
export async function muestraParaEvaluacion(ej: Ejecutor, usuarioId: string, limite: number): Promise<Nodo[]> {
  return consulta<Nodo>(
    ej,
    `SELECT ${COLS} FROM nodos
      WHERE usuario_id = $1 AND activo AND fase IN ('fase_3','fase_4')
      ORDER BY random()
      LIMIT $2`,
    [usuarioId, limite],
  );
}

export async function resumenPorFase(ej: Ejecutor, usuarioId: string): Promise<Array<{ fase: Fase; total: number }>> {
  return consulta<{ fase: Fase; total: number }>(
    ej,
    `SELECT fase, count(*)::int AS total FROM nodos
      WHERE usuario_id = $1 AND activo GROUP BY fase ORDER BY fase`,
    [usuarioId],
  );
}
