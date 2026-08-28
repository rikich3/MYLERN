import { pool, enTransaccion } from '../db/pool.js';
import * as mejorasRepo from '../repositories/mejoras.repo.js';
import * as auditoria from '../repositories/auditoria.repo.js';
import type { OrigenTx } from '../repositories/auditoria.repo.js';
import type { EstadoSolucion } from '../domain/tipos.js';
import { invalido, noEncontrado } from '../utils/errors.js';

const ESTADOS: readonly EstadoSolucion[] = ['backlog', 'en_progreso', 'completado'];

/**
 * [caso de uso 3, paso 1] "El usuario registra incidencias o fricciones de
 * aprendizaje mediante el formulario estructurado: `[situacion]` y `[observacion]`."
 */
export async function registrarOportunidad(
  usuarioId: string,
  datos: { situacion: string; observacion: string },
  origen: OrigenTx = 'web',
) {
  return enTransaccion(async (cx) => {
    const o = await mejorasRepo.crearOportunidad(cx, { usuario_id: usuarioId, ...datos });
    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'crear', entidad: 'oportunidad',
      entidad_id: o.id, payload_anterior: null, payload_nuevo: o,
    });
    return o;
  });
}

export const listarOportunidades = (usuarioId: string, solucionId?: string | null) =>
  mejorasRepo.listarOportunidades(pool, usuarioId, solucionId);

export const listarSoluciones = (usuarioId: string) => mejorasRepo.listarSoluciones(pool, usuarioId);

export async function crearSolucion(
  usuarioId: string,
  datos: { titulo: string; descripcion?: string; oportunidades?: string[] },
  origen: OrigenTx = 'web',
) {
  return enTransaccion(async (cx) => {
    const s = await mejorasRepo.crearSolucion(cx, { usuario_id: usuarioId, ...datos });
    // [caso de uso 3, paso 2] Vinculacion de multiples observaciones bajo una
    // propuesta formal de solucion.
    const vinculadas = await mejorasRepo.vincularOportunidades(
      cx, usuarioId, s.id, datos.oportunidades ?? [],
    );
    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'crear', entidad: 'solucion',
      entidad_id: s.id, payload_anterior: null, payload_nuevo: { ...s, vinculadas },
    });
    return { ...s, observaciones_vinculadas: vinculadas };
  });
}

export async function vincular(usuarioId: string, solucionId: string, oportunidades: string[]) {
  const n = await mejorasRepo.vincularOportunidades(pool, usuarioId, solucionId, oportunidades);
  if (n === 0) throw noEncontrado('Oportunidades a vincular');
  return { vinculadas: n };
}

/** [caso de uso 3, paso 3] Ciclo de vida Backlog -> En Progreso -> Completado. */
export async function cambiarEstado(usuarioId: string, id: string, estado: string) {
  if (!ESTADOS.includes(estado as EstadoSolucion)) {
    throw invalido('ESTADO_INVALIDO', `Estado invalido. Valores admitidos: ${ESTADOS.join(', ')}`);
  }
  const s = await mejorasRepo.cambiarEstadoSolucion(pool, usuarioId, id, estado as EstadoSolucion);
  if (!s) throw noEncontrado('Solucion');
  return s;
}
