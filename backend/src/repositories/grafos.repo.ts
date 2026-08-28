import { consulta, uno, type Ejecutor } from '../db/pool.js';
import type { Grafo } from '../domain/tipos.js';

const COLS = `id, usuario_id, nombre, descripcion, indice_siguiente_esfuerzo,
              cursor_rr, activo, creado_en, actualizado_en`;

export async function crear(
  ej: Ejecutor,
  g: { usuario_id: string; nombre: string; descripcion?: string; indice_siguiente_esfuerzo: number },
): Promise<Grafo> {
  const row = await uno<Grafo>(
    ej,
    `INSERT INTO grafos (usuario_id, nombre, descripcion, indice_siguiente_esfuerzo)
     VALUES ($1,$2,$3,$4) RETURNING ${COLS}`,
    [g.usuario_id, g.nombre, g.descripcion ?? '', g.indice_siguiente_esfuerzo],
  );
  return row!;
}

export async function obtener(ej: Ejecutor, id: string, usuarioId?: string): Promise<Grafo | null> {
  return uno<Grafo>(
    ej,
    `SELECT ${COLS} FROM grafos WHERE id = $1 AND ($2::uuid IS NULL OR usuario_id = $2)`,
    [id, usuarioId ?? null],
  );
}

export async function listar(ej: Ejecutor, usuarioId: string): Promise<Array<Grafo & { total_nodos: number; total_hojas: number }>> {
  return consulta(
    ej,
    `SELECT g.id, g.usuario_id, g.nombre, g.descripcion, g.indice_siguiente_esfuerzo,
            g.cursor_rr, g.activo, g.creado_en, g.actualizado_en,
            (SELECT count(*)::int FROM nodos n WHERE n.grafo_id = g.id AND n.activo) AS total_nodos,
            (SELECT count(*)::int FROM nodos n WHERE n.grafo_id = g.id AND n.activo AND n.is_leaf) AS total_hojas
       FROM grafos g
      WHERE g.usuario_id = $1 AND g.activo
      ORDER BY g.creado_en ASC`,
    [usuarioId],
  );
}

export async function actualizar(
  ej: Ejecutor,
  id: string,
  campos: { nombre?: string; descripcion?: string },
): Promise<Grafo | null> {
  return uno<Grafo>(
    ej,
    `UPDATE grafos SET nombre = COALESCE($2, nombre), descripcion = COALESCE($3, descripcion)
      WHERE id = $1 AND activo RETURNING ${COLS}`,
    [id, campos.nombre ?? null, campos.descripcion ?? null],
  );
}

export async function archivar(ej: Ejecutor, id: string): Promise<void> {
  await ej.query('UPDATE grafos SET activo = FALSE, archivado_en = now() WHERE id = $1', [id]);
}

/**
 * [LOG-GEN-GRAFO] "Se identifican los grafos donde
 * `indice_siguiente_esfuerzo <= indice_global`."
 * Se excluyen los grafos con un esfuerzo aun vivo en la cola.
 */
export async function elegibles(ej: Ejecutor, indiceGlobal: number, limite = 200): Promise<Grafo[]> {
  return consulta<Grafo>(
    ej,
    `SELECT ${COLS} FROM grafos g
      WHERE g.activo AND g.indice_siguiente_esfuerzo <= $1
        AND NOT EXISTS (
              SELECT 1 FROM effort_dispatch_queue q
               WHERE q.grafo_id = g.id AND q.estado IN ('pendiente','en_proceso'))
      ORDER BY g.indice_siguiente_esfuerzo ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [indiceGlobal, limite],
  );
}

/**
 * [LOG-GEN-GRAFO] "Se actualiza el cursor Round Robin del grafo y se agenda su
 * nuevo `indice_siguiente_esfuerzo` sumando un valor pseudoaleatorio entre 54 y
 * 66 UE."
 */
export async function avanzarRoundRobin(
  ej: Ejecutor,
  id: string,
  nuevoCursor: number,
  nuevoIndice: number,
): Promise<void> {
  await ej.query(
    'UPDATE grafos SET cursor_rr = $2, indice_siguiente_esfuerzo = $3 WHERE id = $1',
    [id, nuevoCursor, nuevoIndice],
  );
}

/** Grafo por defecto del usuario: destino de los nodos que alcanzan fase_4. */
export async function reservaDeConocimiento(
  ej: Ejecutor,
  usuarioId: string,
  indiceGlobal: number,
): Promise<Grafo> {
  const existente = await uno<Grafo>(
    ej,
    `SELECT ${COLS} FROM grafos WHERE usuario_id = $1 AND activo ORDER BY creado_en ASC LIMIT 1`,
    [usuarioId],
  );
  if (existente) return existente;
  return crear(ej, {
    usuario_id: usuarioId,
    nombre: 'Reserva de Conocimiento',
    descripcion: 'Grafo por defecto que recibe los nodos que alcanzan la cuarta etapa.',
    indice_siguiente_esfuerzo: indiceGlobal,
  });
}
