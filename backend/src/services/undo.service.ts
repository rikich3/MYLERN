import { enTransaccion } from '../db/pool.js';
import * as auditoria from '../repositories/auditoria.repo.js';
import * as nodosRepo from '../repositories/nodos.repo.js';
import { pool } from '../db/pool.js';
import { ErrorDominio, noEncontrado } from '../utils/errors.js';

/**
 * Comando `undo` de la CLI, soportado a nivel log de transacciones
 * (procedimiento "manejando el conocimiento usando la terminal", paso 2).
 * Revierte la ultima operacion reversible del usuario.
 */
export async function deshacerUltima(usuarioId: string) {
  return enTransaccion(async (cx) => {
    const tx = await auditoria.ultimaReversible(cx, usuarioId);
    if (!tx) throw noEncontrado('Transaccion reversible');

    const anterior = tx.payload_anterior as Record<string, unknown> | null;
    let detalle: string;

    switch (`${tx.entidad}:${tx.operacion}`) {
      case 'nodo:crear':
      case 'nodo:insertar_nodo_grafo': {
        await nodosRepo.marcarBajaLogica(cx, tx.entidad_id!);
        detalle = `Nodo ${tx.entidad_id} dado de baja logica.`;
        break;
      }
      case 'nodo:crear_lote': {
        const ids = (tx.payload_nuevo as string[]) ?? [];
        for (const id of ids) await nodosRepo.marcarBajaLogica(cx, id);
        detalle = `${ids.length} nodos del lote dados de baja logica.`;
        break;
      }
      case 'nodo:reparentear': {
        await nodosRepo.reparentear(
          cx, tx.entidad_id!,
          (anterior?.parent_id as string | null) ?? null,
          (anterior?.enlace_contenido as string | null) ?? null,
        );
        detalle = `Reparenteo de ${tx.entidad_id} revertido.`;
        break;
      }
      case 'nodo:actualizar': {
        await nodosRepo.actualizarContenido(cx, tx.entidad_id!, {
          nodo_esfuerzo: anterior?.nodo_esfuerzo as string | undefined,
          nodo_crudo: (anterior?.nodo_crudo as string | null) ?? null,
        });
        detalle = `Contenido de ${tx.entidad_id} restaurado.`;
        break;
      }
      case 'nodo:eliminar': {
        await cx.query(
          `UPDATE nodos SET activo = TRUE, archivado_en = NULL, fase = $2,
                            parent_id = $3, enlace_contenido = $4
             WHERE id = $1`,
          [tx.entidad_id, anterior?.fase ?? 'fase_1',
           anterior?.parent_id ?? null, anterior?.enlace_contenido ?? null],
        );
        detalle = `Nodo ${tx.entidad_id} restaurado.`;
        break;
      }
      case 'nodo:integrar_a_grafo': {
        await cx.query('UPDATE nodos SET grafo_id = $2 WHERE id = $1',
          [tx.entidad_id, anterior?.grafo_id ?? null]);
        detalle = `Integracion a grafo de ${tx.entidad_id} revertida.`;
        break;
      }
      case 'grafo:crear': {
        await cx.query('UPDATE grafos SET activo = FALSE, archivado_en = now() WHERE id = $1', [tx.entidad_id]);
        detalle = `Grafo ${tx.entidad_id} archivado.`;
        break;
      }
      default:
        throw new ErrorDominio(
          'UNDO_NO_SOPORTADO',
          `La operacion "${tx.operacion}" sobre "${tx.entidad}" no es reversible automaticamente.`,
          422,
        );
    }

    await auditoria.marcarDeshecha(cx, tx.id);
    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen: tx.origen, operacion: 'undo', entidad: tx.entidad,
      entidad_id: tx.entidad_id, payload_anterior: tx.payload_nuevo, payload_nuevo: tx.payload_anterior,
    });

    return { revertida: { id: tx.id, operacion: tx.operacion, entidad: tx.entidad }, detalle };
  });
}

export const historial = (usuarioId: string, limite?: number) =>
  auditoria.historial(pool, usuarioId, limite);
