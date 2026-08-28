import { consulta, uno, type Ejecutor } from '../db/pool.js';

export type OrigenTx = 'web' | 'cli' | 'n8n' | 'telegram' | 'sistema';

export interface RegistroTx {
  id: string;
  usuario_id: string;
  origen: OrigenTx;
  operacion: string;
  entidad: string;
  entidad_id: string | null;
  payload_anterior: unknown;
  payload_nuevo: unknown;
  deshecha: boolean;
  creado_en: string;
}

/**
 * Log de transacciones que habilita el comando `undo` de la CLI
 * (procedimiento "manejando el conocimiento usando la terminal").
 */
export async function registrar(
  ej: Ejecutor,
  r: {
    usuario_id: string;
    origen: OrigenTx;
    operacion: string;
    entidad: string;
    entidad_id: string | null;
    payload_anterior: unknown;
    payload_nuevo: unknown;
  },
): Promise<string> {
  const row = await uno<{ id: string }>(
    ej,
    `INSERT INTO transacciones_log
       (usuario_id, origen, operacion, entidad, entidad_id, payload_anterior, payload_nuevo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,
    [r.usuario_id, r.origen, r.operacion, r.entidad, r.entidad_id,
     r.payload_anterior === undefined ? null : JSON.stringify(r.payload_anterior),
     r.payload_nuevo === undefined ? null : JSON.stringify(r.payload_nuevo)],
  );
  return row!.id;
}

export async function ultimaReversible(ej: Ejecutor, usuarioId: string): Promise<RegistroTx | null> {
  return uno<RegistroTx>(
    ej,
    `SELECT id::text, usuario_id, origen, operacion, entidad, entidad_id,
            payload_anterior, payload_nuevo, deshecha, creado_en
       FROM transacciones_log
      WHERE usuario_id = $1 AND NOT deshecha AND operacion <> 'undo'
      ORDER BY id DESC LIMIT 1
      FOR UPDATE`,
    [usuarioId],
  );
}

export async function marcarDeshecha(ej: Ejecutor, id: string): Promise<void> {
  await ej.query(
    'UPDATE transacciones_log SET deshecha = TRUE, deshecha_en = now() WHERE id = $1',
    [id],
  );
}

export async function historial(ej: Ejecutor, usuarioId: string, limite = 50): Promise<RegistroTx[]> {
  return consulta<RegistroTx>(
    ej,
    `SELECT id::text, usuario_id, origen, operacion, entidad, entidad_id,
            payload_anterior, payload_nuevo, deshecha, creado_en
       FROM transacciones_log WHERE usuario_id = $1 ORDER BY id DESC LIMIT $2`,
    [usuarioId, limite],
  );
}
