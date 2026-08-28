import { consulta, uno, type Ejecutor } from '../db/pool.js';
import type { EstadoEvaluacion } from './tipos-eval.js';

export interface Evaluacion {
  id: string;
  usuario_id: string;
  semana_iso: string;
  indice_global: number;
  estado: EstadoEvaluacion;
  total_items: number;
  aciertos: number;
  fallos: number;
  puntaje: number | null;
  generada_en: string;
  cerrada_en: string | null;
}

export interface ItemEvaluacion {
  id: string;
  evaluacion_id: string;
  nodo_id: string | null;
  orden: number;
  premisa: string;
  contraste: string;
  resultado: 'pendiente' | 'acierto' | 'fallo';
  respondido_en: string | null;
}

const COLS = `id, usuario_id, semana_iso, indice_global, estado, total_items,
              aciertos, fallos, puntaje, generada_en, cerrada_en`;

export async function crear(
  ej: Ejecutor,
  e: { usuario_id: string; semana_iso: string; indice_global: number },
): Promise<Evaluacion | null> {
  return uno<Evaluacion>(
    ej,
    `INSERT INTO evaluaciones (usuario_id, semana_iso, indice_global)
     VALUES ($1,$2,$3)
     ON CONFLICT (usuario_id, semana_iso) DO NOTHING
     RETURNING ${COLS}`,
    [e.usuario_id, e.semana_iso, e.indice_global],
  );
}

export async function porSemana(ej: Ejecutor, usuarioId: string, semana: string): Promise<Evaluacion | null> {
  return uno<Evaluacion>(
    ej,
    `SELECT ${COLS} FROM evaluaciones WHERE usuario_id = $1 AND semana_iso = $2`,
    [usuarioId, semana],
  );
}

export async function obtener(ej: Ejecutor, id: string, usuarioId: string): Promise<Evaluacion | null> {
  return uno<Evaluacion>(
    ej,
    `SELECT ${COLS} FROM evaluaciones WHERE id = $1 AND usuario_id = $2`,
    [id, usuarioId],
  );
}

export async function listar(ej: Ejecutor, usuarioId: string, limite = 30): Promise<Evaluacion[]> {
  return consulta<Evaluacion>(
    ej,
    `SELECT ${COLS} FROM evaluaciones WHERE usuario_id = $1 ORDER BY generada_en DESC LIMIT $2`,
    [usuarioId, limite],
  );
}

export async function insertarItems(
  ej: Ejecutor,
  evaluacionId: string,
  items: Array<{ nodo_id: string | null; orden: number; premisa: string; contraste: string }>,
): Promise<void> {
  if (items.length === 0) return;
  const params: unknown[] = [];
  const filas = items.map((it, i) => {
    const base = i * 5;
    params.push(evaluacionId, it.nodo_id, it.orden, it.premisa, it.contraste);
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
  });
  await ej.query(
    `INSERT INTO evaluacion_items (evaluacion_id, nodo_id, orden, premisa, contraste)
     VALUES ${filas.join(',')}`,
    params,
  );
  await ej.query('UPDATE evaluaciones SET total_items = $2 WHERE id = $1', [evaluacionId, items.length]);
}

export async function items(ej: Ejecutor, evaluacionId: string): Promise<ItemEvaluacion[]> {
  return consulta<ItemEvaluacion>(
    ej,
    `SELECT id, evaluacion_id, nodo_id, orden, premisa, contraste, resultado, respondido_en
       FROM evaluacion_items WHERE evaluacion_id = $1 ORDER BY orden ASC`,
    [evaluacionId],
  );
}

export async function calificarItem(
  ej: Ejecutor,
  itemId: string,
  resultado: 'acierto' | 'fallo',
): Promise<ItemEvaluacion | null> {
  return uno<ItemEvaluacion>(
    ej,
    `UPDATE evaluacion_items SET resultado = $2, respondido_en = now()
      WHERE id = $1 RETURNING id, evaluacion_id, nodo_id, orden, premisa, contraste, resultado, respondido_en`,
    [itemId, resultado],
  );
}

/** Recalcula agregados y cierra la evaluacion cuando no quedan pendientes. */
export async function recalcular(ej: Ejecutor, evaluacionId: string): Promise<Evaluacion> {
  const row = await uno<Evaluacion>(
    ej,
    `WITH agg AS (
        SELECT count(*) FILTER (WHERE resultado = 'acierto')::int AS aciertos,
               count(*) FILTER (WHERE resultado = 'fallo')::int   AS fallos,
               count(*) FILTER (WHERE resultado = 'pendiente')::int AS pendientes,
               count(*)::int AS total
          FROM evaluacion_items WHERE evaluacion_id = $1
     )
     UPDATE evaluaciones e
        SET aciertos = agg.aciertos,
            fallos   = agg.fallos,
            puntaje  = CASE WHEN agg.total = 0 THEN NULL
                            ELSE ROUND(agg.aciertos::numeric * 100 / agg.total, 2) END,
            estado   = CASE WHEN agg.pendientes = 0 AND agg.total > 0 THEN 'calificada'::estado_evaluacion
                            WHEN agg.aciertos + agg.fallos > 0 THEN 'en_progreso'::estado_evaluacion
                            ELSE 'generada'::estado_evaluacion END,
            cerrada_en = CASE WHEN agg.pendientes = 0 AND agg.total > 0 THEN now() ELSE NULL END
       FROM agg
      WHERE e.id = $1
      RETURNING ${COLS.split(',').map((c) => 'e.' + c.trim()).join(', ')}`,
    [evaluacionId],
  );
  return row!;
}

export async function registrarRetencion(ej: Ejecutor, e: Evaluacion): Promise<void> {
  await ej.query(
    `INSERT INTO retencion_historico
       (usuario_id, evaluacion_id, semana_iso, total_items, aciertos, fallos, puntaje)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e.usuario_id, e.id, e.semana_iso, e.total_items, e.aciertos, e.fallos, e.puntaje ?? 0],
  );
}

export async function historicoRetencion(ej: Ejecutor, usuarioId: string, limite = 52) {
  return consulta(
    ej,
    `SELECT semana_iso, total_items, aciertos, fallos, puntaje, registrado_en
       FROM retencion_historico WHERE usuario_id = $1
      ORDER BY registrado_en DESC LIMIT $2`,
    [usuarioId, limite],
  );
}
