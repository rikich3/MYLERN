import { consulta, uno, type Ejecutor } from '../db/pool.js';
import type { EstadoDespacho, ItemCola, OrigenEsfuerzo, Fase } from '../domain/tipos.js';

export interface NuevoItem {
  usuario_id: string;
  origen: OrigenEsfuerzo;
  nodo_id: string | null;
  grafo_id: string | null;
  contenido: string;
  indice_global: number;
  prioridad?: number;
}

/**
 * Encola una solicitud de esfuerzo. El indice unico (origen, id, indice_global)
 * vuelve idempotente al tick: una segunda ejecucion en la misma UE no duplica.
 */
export async function encolar(ej: Ejecutor, i: NuevoItem): Promise<ItemCola | null> {
  const conflicto = i.origen === 'nodo'
    ? '(nodo_id, indice_global) WHERE origen = \'nodo\''
    : '(grafo_id, indice_global) WHERE origen = \'grafo\'';
  return uno<ItemCola>(
    ej,
    `INSERT INTO effort_dispatch_queue
       (usuario_id, origen, nodo_id, grafo_id, contenido, indice_global, prioridad)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT ${conflicto} DO NOTHING
     RETURNING id::text, usuario_id, origen, nodo_id, grafo_id, contenido,
               indice_global, estado, intentos`,
    [i.usuario_id, i.origen, i.nodo_id, i.grafo_id, i.contenido, i.indice_global, i.prioridad ?? 100],
  );
}

/**
 * [procedimiento "recibiendo esfuerzos", paso 2] Toma un item de la cola para
 * su envio. `FOR UPDATE SKIP LOCKED` permite multiples workers sin colisiones.
 */
export async function tomarSiguiente(ej: Ejecutor): Promise<(ItemCola & { telegram_chat_id: string | null }) | null> {
  return uno(
    ej,
    `WITH candidato AS (
       SELECT q.id FROM effort_dispatch_queue q
        WHERE q.estado = 'pendiente'
        ORDER BY q.prioridad ASC, q.id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE effort_dispatch_queue q
        SET estado = 'en_proceso', intentos = q.intentos + 1, tomado_en = now()
       FROM candidato c, usuarios u
      WHERE q.id = c.id AND u.id = q.usuario_id
      RETURNING q.id::text, q.usuario_id, q.origen, q.nodo_id, q.grafo_id, q.contenido,
                q.indice_global, q.estado, q.intentos, u.telegram_chat_id::text`,
  );
}

/** Numero de mensajes efectivamente enviados en los ultimos `segundos`. */
export async function enviadosRecientes(ej: Ejecutor, segundos: number): Promise<number> {
  const r = await uno<{ n: number }>(
    ej,
    `SELECT count(*)::int AS n FROM esfuerzos_log
      WHERE enviado_en > now() - make_interval(secs => $1)`,
    [segundos],
  );
  return r?.n ?? 0;
}

/** Segundos transcurridos desde el ultimo envio confirmado (null si no hay). */
export async function segundosDesdeUltimoEnvio(ej: Ejecutor): Promise<number | null> {
  const r = await uno<{ s: number | null }>(
    ej,
    'SELECT EXTRACT(EPOCH FROM (now() - max(enviado_en)))::int AS s FROM esfuerzos_log',
  );
  return r?.s ?? null;
}

export async function marcarEnviado(
  ej: Ejecutor,
  id: string,
  telegramMessageId: number | null,
): Promise<void> {
  await ej.query(
    `UPDATE effort_dispatch_queue
        SET estado = 'enviado', enviado_en = now(), telegram_message_id = $2
      WHERE id = $1`,
    [id, telegramMessageId],
  );
}

export async function marcarFallido(
  ej: Ejecutor,
  id: string,
  error: string,
  maxIntentos: number,
): Promise<EstadoDespacho> {
  const r = await uno<{ estado: EstadoDespacho }>(
    ej,
    `UPDATE effort_dispatch_queue
        SET estado = CASE WHEN intentos >= $3 THEN 'fallido'::estado_despacho
                          ELSE 'pendiente'::estado_despacho END,
            ultimo_error = $2
      WHERE id = $1
      RETURNING estado`,
    [id, error.slice(0, 2000), maxIntentos],
  );
  return r?.estado ?? 'fallido';
}

export async function registrarEnLog(
  ej: Ejecutor,
  d: {
    dispatch_id: string;
    usuario_id: string;
    origen: OrigenEsfuerzo;
    nodo_id: string | null;
    grafo_id: string | null;
    fase_al_enviar: Fase | null;
    contenido: string;
    indice_global: number;
    telegram_message_id: number | null;
  },
): Promise<void> {
  await ej.query(
    `INSERT INTO esfuerzos_log
       (dispatch_id, usuario_id, origen, nodo_id, grafo_id, fase_al_enviar,
        contenido, indice_global, telegram_message_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [d.dispatch_id, d.usuario_id, d.origen, d.nodo_id, d.grafo_id, d.fase_al_enviar,
     d.contenido, d.indice_global, d.telegram_message_id],
  );
}

export async function obtenerItem(ej: Ejecutor, id: string): Promise<ItemCola | null> {
  return uno<ItemCola>(
    ej,
    `SELECT id::text, usuario_id, origen, nodo_id, grafo_id, contenido,
            indice_global, estado, intentos
       FROM effort_dispatch_queue WHERE id = $1 FOR UPDATE`,
    [id],
  );
}

export async function estadoCola(ej: Ejecutor): Promise<Array<{ estado: EstadoDespacho; total: number }>> {
  return consulta<{ estado: EstadoDespacho; total: number }>(
    ej,
    'SELECT estado, count(*)::int AS total FROM effort_dispatch_queue GROUP BY estado',
  );
}

/** Purga los items ya procesados anteriores a la retencion indicada. */
export async function purgar(ej: Ejecutor, dias = 30): Promise<number> {
  const r = await ej.query(
    `DELETE FROM effort_dispatch_queue
      WHERE estado IN ('enviado','descartado') AND creado_en < now() - make_interval(days => $1)`,
    [dias],
  );
  return r.rowCount ?? 0;
}
