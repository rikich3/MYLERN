import { enTransaccion, pool, type Ejecutor } from '../db/pool.js';
import * as nodosRepo from '../repositories/nodos.repo.js';
import * as auditoria from '../repositories/auditoria.repo.js';
import { FASES } from '../domain/fases.js';
import { deltaUE, fechaLimiteAIndice, indiceGlobal } from '../utils/tiempo.js';
import { noEncontrado } from '../utils/errors.js';
import type { Nodo } from '../domain/tipos.js';
import type { OrigenTx } from '../repositories/auditoria.repo.js';

export interface EntradaNodo {
  nodo_esfuerzo: string;
  nodo_crudo: string | null;
  fecha_limite: string | null;
}

/**
 * [procedimiento 1 "registrando un nodo", paso 2 "guardando nodo"]
 * Inserta el nuevo nodo inicializando `fase = 'fase_1'`, `conteo_esfuerzo = 0`,
 * `activo = verdadero` y `indice_siguiente_esfuerzo = indice_global + random(2, 6)`.
 */
export async function registrar(
  usuarioId: string,
  entrada: EntradaNodo,
  origen: OrigenTx = 'telegram',
): Promise<Nodo> {
  return enTransaccion(async (cx) => {
    const ig = indiceGlobal();
    const nodo = await nodosRepo.crear(cx, {
      usuario_id: usuarioId,
      nodo_esfuerzo: entrada.nodo_esfuerzo,
      nodo_crudo: entrada.nodo_crudo,
      indice_fecha_limite: entrada.fecha_limite === null ? null : fechaLimiteAIndice(entrada.fecha_limite),
      indice_siguiente_esfuerzo: ig + deltaUE(FASES.fase_1.min, FASES.fase_1.max),
    });
    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'crear', entidad: 'nodo',
      entidad_id: nodo.id, payload_anterior: null, payload_nuevo: nodo,
    });
    return nodo;
  });
}

export async function registrarLote(
  usuarioId: string,
  entradas: readonly EntradaNodo[],
  origen: OrigenTx = 'cli',
): Promise<Nodo[]> {
  return enTransaccion(async (cx) => {
    const ig = indiceGlobal();
    const creados: Nodo[] = [];
    for (const e of entradas) {
      creados.push(await nodosRepo.crear(cx, {
        usuario_id: usuarioId,
        nodo_esfuerzo: e.nodo_esfuerzo,
        nodo_crudo: e.nodo_crudo,
        indice_fecha_limite: e.fecha_limite === null ? null : fechaLimiteAIndice(e.fecha_limite),
        indice_siguiente_esfuerzo: ig + deltaUE(FASES.fase_1.min, FASES.fase_1.max),
      }));
    }
    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'crear_lote', entidad: 'nodo',
      entidad_id: null, payload_anterior: null, payload_nuevo: creados.map((n) => n.id),
    });
    return creados;
  });
}

export async function listar(usuarioId: string, filtro: Omit<nodosRepo.FiltroNodos, 'usuario_id'>) {
  return nodosRepo.listar(pool, { ...filtro, usuario_id: usuarioId });
}

export async function obtener(usuarioId: string, id: string): Promise<Nodo> {
  const n = await nodosRepo.obtener(pool, id, usuarioId);
  if (!n) throw noEncontrado('Nodo');
  return n;
}

export async function actualizar(
  usuarioId: string,
  id: string,
  campos: { nodo_esfuerzo?: string; nodo_crudo?: string | null; grafo_id?: string | null },
  origen: OrigenTx = 'web',
): Promise<Nodo> {
  return enTransaccion(async (cx) => {
    const previo = await nodosRepo.obtener(cx, id, usuarioId);
    if (!previo) throw noEncontrado('Nodo');
    const actualizado = await nodosRepo.actualizarContenido(cx, id, campos);
    if (!actualizado) throw noEncontrado('Nodo');
    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'actualizar', entidad: 'nodo',
      entidad_id: id, payload_anterior: previo, payload_nuevo: actualizado,
    });
    return actualizado;
  });
}

/** Estadisticas de avance para el bot y la app web. */
export async function estadisticas(usuarioId: string, ej: Ejecutor = pool) {
  const porFase = await nodosRepo.resumenPorFase(ej, usuarioId);
  const total = porFase.reduce((a, f) => a + f.total, 0);
  return { total, por_fase: porFase, indice_global: indiceGlobal() };
}
