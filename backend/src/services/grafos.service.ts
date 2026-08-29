import { enTransaccion, pool } from '../db/pool.js';
import * as nodosRepo from '../repositories/nodos.repo.js';
import * as grafosRepo from '../repositories/grafos.repo.js';
import * as auditoria from '../repositories/auditoria.repo.js';
import type { OrigenTx } from '../repositories/auditoria.repo.js';
import { validarAciclicidad } from '../domain/aciclicidad.js';
import { RANGO_GRAFO } from '../domain/fases.js';
import { agendarSiguiente } from '../domain/silencio.js';
import { indiceGlobal } from '../utils/tiempo.js';
import { ErrorDominio, invalido, noEncontrado } from '../utils/errors.js';
import type { Grafo, Nodo } from '../domain/tipos.js';

export async function crearGrafo(
  usuarioId: string,
  datos: { nombre: string; descripcion?: string },
  origen: OrigenTx = 'web',
): Promise<Grafo> {
  return enTransaccion(async (cx) => {
    const g = await grafosRepo.crear(cx, {
      usuario_id: usuarioId,
      nombre: datos.nombre,
      descripcion: datos.descripcion,
      // Se agenda desde el arranque dentro del rango propio del grafo.
      indice_siguiente_esfuerzo: agendarSiguiente(indiceGlobal(), RANGO_GRAFO.min, RANGO_GRAFO.max),
    });
    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'crear', entidad: 'grafo',
      entidad_id: g.id, payload_anterior: null, payload_nuevo: g,
    });
    return g;
  });
}

export const listarGrafos = (usuarioId: string) => grafosRepo.listar(pool, usuarioId);

export async function detalleGrafo(usuarioId: string, grafoId: string) {
  const grafo = await grafosRepo.obtener(pool, grafoId, usuarioId);
  if (!grafo) throw noEncontrado('Grafo');
  const nodos = await nodosRepo.nodosDeGrafo(pool, grafoId);
  const hojas = await nodosRepo.hojasDeGrafo(pool, grafoId);
  return { grafo, nodos, hojas };
}

/**
 * [PSC-INS-NODO] Transcripcion del pseudocodigo `insertar_nodo`:
 *
 *   si parent_id != null: validar_existencia_y_grafo(parent_id, grafo_id)
 *   nodo = crear_registro_nodo(..., is_leaf = verdadero)
 *   si parent_id != null: actualizar_nodo(parent_id, is_leaf = falso)
 *   retornar nodo
 *
 * El par (`parent_id`, `enlace_contenido`) es atomico [PRT-INTEGRIDAD.1]: la
 * validacion se hace aqui y la garantiza el Check Constraint de la base.
 */
export async function insertarNodo(
  usuarioId: string,
  grafoId: string,
  datos: { contenido: string; nodo_esfuerzo?: string; parent_id?: string | null; enlace_contenido?: string | null },
  origen: OrigenTx = 'web',
): Promise<Nodo> {
  const parentId = datos.parent_id ?? null;
  const enlace = datos.enlace_contenido ?? null;

  if ((parentId === null) !== (enlace === null)) {
    throw invalido(
      'PAR_NO_ATOMICO',
      '`parent_id` y `enlace_contenido` constituyen un par atomico: ambos presentes o ambos nulos.',
    );
  }

  return enTransaccion(async (cx) => {
    const grafo = await grafosRepo.obtener(cx, grafoId, usuarioId);
    if (!grafo) throw noEncontrado('Grafo');

    if (parentId !== null) {
      // validar_existencia_y_grafo(parent_id, grafo_id)
      const padre = await nodosRepo.obtener(cx, parentId, usuarioId);
      if (!padre || !padre.activo) throw noEncontrado('Nodo padre');
      if (padre.grafo_id !== grafoId) {
        throw invalido('GRAFO_DISCORDANTE', 'El nodo padre pertenece a otro grafo.');
      }
    }

    // crear_registro_nodo(grafo_id, contenido, parent_id, enlace_contenido, is_leaf=verdadero)
    const nodo = await nodosRepo.crear(cx, {
      usuario_id: usuarioId,
      nodo_esfuerzo: datos.nodo_esfuerzo?.trim() || datos.contenido,
      nodo_crudo: datos.contenido,
      indice_fecha_limite: null,
      // Un nodo nacido dentro del grafo se integra directamente al ciclo del grafo.
      indice_siguiente_esfuerzo: agendarSiguiente(indiceGlobal(), RANGO_GRAFO.min, RANGO_GRAFO.max),
      grafo_id: grafoId,
      parent_id: parentId,
      enlace_contenido: enlace,
    });

    // actualizar_nodo(parent_id, is_leaf=falso) -- el trigger tg_nodos_is_leaf lo
    // aplica tambien a nivel de base; aqui se explicita el paso del pseudocodigo.
    if (parentId !== null) await nodosRepo.marcarIsLeaf(cx, parentId, false);

    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'insertar_nodo_grafo', entidad: 'nodo',
      entidad_id: nodo.id, payload_anterior: null, payload_nuevo: nodo,
    });
    return nodo;
  });
}

/**
 * Reparenteo con validacion de aciclicidad transaccional [LOG-ACICLICIDAD] y
 * [PRT-INTEGRIDAD.2].
 */
export async function reparentear(
  usuarioId: string,
  nodoId: string,
  parentId: string | null,
  enlaceContenido: string | null,
  origen: OrigenTx = 'web',
): Promise<Nodo> {
  if ((parentId === null) !== (enlaceContenido === null)) {
    throw invalido(
      'PAR_NO_ATOMICO',
      '`parent_id` y `enlace_contenido` constituyen un par atomico: ambos presentes o ambos nulos.',
    );
  }

  return enTransaccion(async (cx) => {
    const nodo = await nodosRepo.obtener(cx, nodoId, usuarioId);
    if (!nodo || !nodo.activo) throw noEncontrado('Nodo');

    if (parentId !== null) {
      const padre = await nodosRepo.obtener(cx, parentId, usuarioId);
      if (!padre || !padre.activo) throw noEncontrado('Nodo padre');
      if (padre.grafo_id !== nodo.grafo_id) {
        throw invalido('GRAFO_DISCORDANTE', 'El nodo padre pertenece a otro grafo.');
      }
      // Recorrido ascendente por ancestros del parent_id propuesto.
      const ruta = await nodosRepo.rutaAncestros(cx, parentId);
      validarAciclicidad(nodoId, parentId, ruta);
    }

    const actualizado = await nodosRepo.reparentear(cx, nodoId, parentId, enlaceContenido);
    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'reparentear', entidad: 'nodo',
      entidad_id: nodoId,
      payload_anterior: { parent_id: nodo.parent_id, enlace_contenido: nodo.enlace_contenido },
      payload_nuevo: { parent_id: parentId, enlace_contenido: enlaceContenido },
    });
    return actualizado;
  });
}

/**
 * [PSC-DEL-NODO] Transcripcion del pseudocodigo `eliminar_nodo`:
 *
 *   nodo = obtener_nodo(nodo_id)
 *   desvincular_hijos_directos(padre_id = nodo_id)
 *   si nodo.parent_id != null:
 *     si contar_hijos_activos(nodo.parent_id) == 1:
 *       actualizar_nodo(nodo.parent_id, is_leaf=verdadero)
 *   marcar_baja_logica(nodo_id)
 *
 * [PRT-INTEGRIDAD.3] La desvinculacion huerfana segura preserva los
 * descendientes en el grafo como nodos raices/aislados.
 */
export async function eliminarNodo(
  usuarioId: string,
  nodoId: string,
  origen: OrigenTx = 'web',
): Promise<{ nodo: Nodo; hijos_desvinculados: string[] }> {
  return enTransaccion(async (cx) => {
    const nodo = await nodosRepo.obtener(cx, nodoId, usuarioId);
    if (!nodo || !nodo.activo) throw noEncontrado('Nodo');

    const hijos = await nodosRepo.desvincularHijosDirectos(cx, nodoId);

    if (nodo.parent_id !== null) {
      // El nodo aun cuenta como hijo activo: si es el unico, el padre vuelve a ser hoja.
      if (await nodosRepo.contarHijosActivos(cx, nodo.parent_id) === 1) {
        await nodosRepo.marcarIsLeaf(cx, nodo.parent_id, true);
      }
    }

    const archivado = await nodosRepo.marcarBajaLogica(cx, nodoId);
    if (!archivado) throw new ErrorDominio('BAJA_FALLIDA', 'No se pudo archivar el nodo', 409);

    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'eliminar', entidad: 'nodo',
      entidad_id: nodoId, payload_anterior: nodo,
      payload_nuevo: { activo: false, hijos_desvinculados: hijos },
    });
    return { nodo: archivado, hijos_desvinculados: hijos };
  });
}

/** Integra un nodo suelto (fase_4 o anterior) a un grafo de conocimiento. */
export async function integrarNodoAGrafo(
  usuarioId: string,
  nodoId: string,
  grafoId: string,
  origen: OrigenTx = 'web',
): Promise<Nodo> {
  return enTransaccion(async (cx) => {
    const grafo = await grafosRepo.obtener(cx, grafoId, usuarioId);
    if (!grafo) throw noEncontrado('Grafo');
    const previo = await nodosRepo.obtener(cx, nodoId, usuarioId);
    if (!previo || !previo.activo) throw noEncontrado('Nodo');
    const actualizado = await nodosRepo.actualizarContenido(cx, nodoId, { grafo_id: grafoId });
    await auditoria.registrar(cx, {
      usuario_id: usuarioId, origen, operacion: 'integrar_a_grafo', entidad: 'nodo',
      entidad_id: nodoId, payload_anterior: { grafo_id: previo.grafo_id },
      payload_nuevo: { grafo_id: grafoId },
    });
    return actualizado!;
  });
}

/** Cadena ancestral usada para construir el contraste de las evaluaciones. */
export async function cadenaAncestral(nodoId: string): Promise<string> {
  const ruta = await nodosRepo.rutaAncestros(pool, nodoId);
  if (ruta.length <= 1) return '';
  return ruta
    .slice(1)
    .map((a, i) => `${ruta[i]!.enlace_contenido ?? '->'} ${a.contenido}`)
    .join(' | ');
}
