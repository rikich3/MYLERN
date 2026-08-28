import { consulta, uno, type Ejecutor } from '../db/pool.js';
import type { EstadoSolucion } from '../domain/tipos.js';

export interface Oportunidad {
  id: string;
  usuario_id: string;
  situacion: string;
  observacion: string;
  solucion_id: string | null;
  activo: boolean;
  creado_en: string;
}

export interface Solucion {
  id: string;
  usuario_id: string;
  titulo: string;
  descripcion: string;
  estado: EstadoSolucion;
  creado_en: string;
  actualizado_en: string;
}

export async function crearOportunidad(
  ej: Ejecutor,
  o: { usuario_id: string; situacion: string; observacion: string; solucion_id?: string | null },
): Promise<Oportunidad> {
  const row = await uno<Oportunidad>(
    ej,
    `INSERT INTO oportunidades (usuario_id, situacion, observacion, solucion_id)
     VALUES ($1,$2,$3,$4)
     RETURNING id, usuario_id, situacion, observacion, solucion_id, activo, creado_en`,
    [o.usuario_id, o.situacion, o.observacion, o.solucion_id ?? null],
  );
  return row!;
}

export async function listarOportunidades(
  ej: Ejecutor,
  usuarioId: string,
  solucionId?: string | null,
): Promise<Oportunidad[]> {
  return consulta<Oportunidad>(
    ej,
    `SELECT id, usuario_id, situacion, observacion, solucion_id, activo, creado_en
       FROM oportunidades
      WHERE usuario_id = $1 AND activo
        AND ($2::uuid IS NULL OR solucion_id = $2)
      ORDER BY creado_en DESC`,
    [usuarioId, solucionId ?? null],
  );
}

/** Vincula multiples observaciones bajo una propuesta formal de solucion. */
export async function vincularOportunidades(
  ej: Ejecutor,
  usuarioId: string,
  solucionId: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await ej.query(
    `UPDATE oportunidades SET solucion_id = $2
      WHERE usuario_id = $1 AND id = ANY($3::uuid[])`,
    [usuarioId, solucionId, ids as string[]],
  );
  return r.rowCount ?? 0;
}

export async function desvincularOportunidad(ej: Ejecutor, usuarioId: string, id: string): Promise<void> {
  await ej.query(
    'UPDATE oportunidades SET solucion_id = NULL WHERE usuario_id = $1 AND id = $2',
    [usuarioId, id],
  );
}

export async function crearSolucion(
  ej: Ejecutor,
  s: { usuario_id: string; titulo: string; descripcion?: string },
): Promise<Solucion> {
  const row = await uno<Solucion>(
    ej,
    `INSERT INTO soluciones (usuario_id, titulo, descripcion) VALUES ($1,$2,$3)
     RETURNING id, usuario_id, titulo, descripcion, estado, creado_en, actualizado_en`,
    [s.usuario_id, s.titulo, s.descripcion ?? ''],
  );
  return row!;
}

export async function listarSoluciones(ej: Ejecutor, usuarioId: string) {
  return consulta(
    ej,
    `SELECT s.id, s.usuario_id, s.titulo, s.descripcion, s.estado, s.creado_en, s.actualizado_en,
            (SELECT count(*)::int FROM oportunidades o WHERE o.solucion_id = s.id AND o.activo) AS total_observaciones
       FROM soluciones s WHERE s.usuario_id = $1
      ORDER BY CASE s.estado WHEN 'en_progreso' THEN 0 WHEN 'backlog' THEN 1 ELSE 2 END, s.creado_en DESC`,
    [usuarioId],
  );
}

/** Ciclo de vida: Backlog -> En Progreso -> Completado. */
export async function cambiarEstadoSolucion(
  ej: Ejecutor,
  usuarioId: string,
  id: string,
  estado: EstadoSolucion,
): Promise<Solucion | null> {
  return uno<Solucion>(
    ej,
    `UPDATE soluciones SET estado = $3 WHERE id = $2 AND usuario_id = $1
     RETURNING id, usuario_id, titulo, descripcion, estado, creado_en, actualizado_en`,
    [usuarioId, id, estado],
  );
}
