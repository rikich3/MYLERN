import { enTransaccion, pool } from '../db/pool.js';
import * as colaRepo from '../repositories/cola.repo.js';
import * as nodosRepo from '../repositories/nodos.repo.js';
import * as grafosRepo from '../repositories/grafos.repo.js';
import { configDeFase, evaluarTransicion } from '../domain/fases.js';
import { agendarSiguiente, enHorasDeSilencio } from '../domain/silencio.js';
import { indiceGlobal } from '../utils/tiempo.js';
import { env, SEGUNDOS_POR_UE } from '../config/env.js';
import { noEncontrado } from '../utils/errors.js';

export interface ItemDespacho {
  id: string;
  chat_id: string | null;
  contenido: string;
  origen: 'nodo' | 'grafo';
  nodo_id: string | null;
  grafo_id: string | null;
  intentos: number;
}

export interface RespuestaDespacho {
  item: ItemDespacho | null;
  motivo?: 'cola_vacia' | 'limite_ventana' | 'espaciado' | 'horas_silencio';
  enviados_en_ventana: number;
}

/**
 * [procedimiento "recibiendo esfuerzos", paso 2]
 * "Un worker procesa los items de la cola enviando un maximo de 10 mensajes
 *  espaciados uniformemente a razon de 1 mensaje por minuto".
 *
 * El worker de n8n llama a este endpoint cada minuto. Aqui se aplican las dos
 * restricciones de caudal antes de entregar un item:
 *   - maximo 10 mensajes por ventana de 1 UE (600 s);
 *   - separacion minima de 60 s entre mensajes consecutivos.
 *
 * [feature 1.3] Ademas se respetan las horas de silencio. El tick ya evita
 * generar esfuerzos en esa franja, pero la cola puede arrastrar items encolados
 * justo antes de las 22:00; sin esta comprobacion se enviarian ya de noche y se
 * incumpliria el requisito "no se va a enviar esfuerzos desde las 10pm hasta
 * las 7am" (DEC-017).
 */
export async function reclamarSiguiente(): Promise<RespuestaDespacho> {
  return enTransaccion(async (cx) => {
    if (enHorasDeSilencio(indiceGlobal())) {
      return { item: null, motivo: 'horas_silencio', enviados_en_ventana: 0 };
    }

    const enVentana = await colaRepo.enviadosRecientes(cx, SEGUNDOS_POR_UE);
    if (enVentana >= env.despacho.maxPorVentana) {
      return { item: null, motivo: 'limite_ventana', enviados_en_ventana: enVentana };
    }

    const desdeUltimo = await colaRepo.segundosDesdeUltimoEnvio(cx);
    if (desdeUltimo !== null && desdeUltimo < env.despacho.espaciadoSegundos) {
      return { item: null, motivo: 'espaciado', enviados_en_ventana: enVentana };
    }

    const item = await colaRepo.tomarSiguiente(cx);
    if (!item) return { item: null, motivo: 'cola_vacia', enviados_en_ventana: enVentana };

    return {
      item: {
        id: item.id,
        chat_id: item.telegram_chat_id,
        contenido: item.contenido,
        origen: item.origen,
        nodo_id: item.nodo_id,
        grafo_id: item.grafo_id,
        intentos: item.intentos,
      },
      enviados_en_ventana: enVentana,
    };
  });
}

export interface ResultadoConfirmacion {
  dispatch_id: string;
  nodo_id: string | null;
  fase_anterior?: string;
  fase_nueva?: string;
  conteo_esfuerzo?: number;
  indice_siguiente_esfuerzo?: number;
  ingreso_a_grafo?: string | null;
}

/**
 * [LOG-GEN-NODO] "Cuando se registra y confirma el envio de un esfuerzo:
 *   - Se incrementa `conteo_esfuerzo`.
 *   - Se evalua la transicion de fase segun los umbrales (36, 84, 108).
 *   - Si un nodo no temporal alcanza la cuarta fase, se transiciona a `fase_4`
 *     y se transfiere su generacion de esfuerzos al grafo de conocimiento.
 *   - De acuerdo a la fase resultante, se calcula el nuevo
 *     `indice_siguiente_esfuerzo` sumando un delta pseudoaleatorio uniforme
 *     dentro del rango de la etapa."
 *
 * Los esfuerzos de origen `grafo` no alteran el estado del nodo hoja: su
 * agenda ya fue avanzada por la entidad Grafo durante el tick.
 */
export async function confirmarEnvio(
  dispatchId: string,
  telegramMessageId: number | null,
): Promise<ResultadoConfirmacion> {
  return enTransaccion(async (cx) => {
    const item = await colaRepo.obtenerItem(cx, dispatchId);
    if (!item) throw noEncontrado('Item de despacho');

    await colaRepo.marcarEnviado(cx, dispatchId, telegramMessageId);

    const resultado: ResultadoConfirmacion = { dispatch_id: dispatchId, nodo_id: item.nodo_id };
    let faseAlEnviar: string | null = null;

    if (item.origen === 'nodo' && item.nodo_id !== null) {
      const nodo = await nodosRepo.obtenerParaActualizar(cx, item.nodo_id);
      if (nodo) {
        faseAlEnviar = nodo.fase;
        const transicion = evaluarTransicion({
          fase: nodo.fase,
          conteo_esfuerzo: nodo.conteo_esfuerzo,
          conteo_esfuerzo_fase: nodo.conteo_esfuerzo_fase,
          es_temporal: nodo.es_temporal,
        });

        // Un nodo NO temporal que alcanza fase_4 se integra al grafo de
        // conocimiento asociado; si no tiene uno, entra a la Reserva de
        // Conocimiento del usuario (grafo por defecto).
        let grafoDestino: string | null = null;
        if (transicion.ingresa_a_grafo) {
          grafoDestino = nodo.grafo_id
            ?? (await grafosRepo.reservaDeConocimiento(cx, nodo.usuario_id, indiceGlobal())).id;
        }

        const cfg = configDeFase(transicion.fase);
        // [LOG-SILENCIO paso 2] el nuevo indice se aparta de las horas de silencio.
        const nuevoIndice = agendarSiguiente(indiceGlobal(), cfg.min, cfg.max);

        await nodosRepo.aplicarAgenda(cx, nodo.id, {
          fase: transicion.fase,
          conteo_esfuerzo: transicion.conteo_esfuerzo,
          conteo_esfuerzo_fase: transicion.conteo_esfuerzo_fase,
          indice_siguiente_esfuerzo: nuevoIndice,
          grafo_id: grafoDestino,
        });

        resultado.fase_anterior = nodo.fase;
        resultado.fase_nueva = transicion.fase;
        resultado.conteo_esfuerzo = transicion.conteo_esfuerzo;
        resultado.indice_siguiente_esfuerzo = nuevoIndice;
        resultado.ingreso_a_grafo = grafoDestino;
      }
    }

    await colaRepo.registrarEnLog(cx, {
      dispatch_id: dispatchId,
      usuario_id: item.usuario_id,
      origen: item.origen,
      nodo_id: item.nodo_id,
      grafo_id: item.grafo_id,
      fase_al_enviar: (faseAlEnviar as never) ?? null,
      contenido: item.contenido,
      indice_global: item.indice_global,
      telegram_message_id: telegramMessageId,
    });

    return resultado;
  });
}

/** Registra un fallo de envio; el item vuelve a `pendiente` hasta agotar reintentos. */
export async function registrarFallo(dispatchId: string, error: string) {
  return enTransaccion(async (cx) => {
    const estado = await colaRepo.marcarFallido(cx, dispatchId, error, env.despacho.maxIntentos);
    return { dispatch_id: dispatchId, estado };
  });
}

export async function estado() {
  const [cola, enVentana, desdeUltimo] = await Promise.all([
    colaRepo.estadoCola(pool),
    colaRepo.enviadosRecientes(pool, SEGUNDOS_POR_UE),
    colaRepo.segundosDesdeUltimoEnvio(pool),
  ]);
  return {
    indice_global: indiceGlobal(),
    cola,
    enviados_en_ventana: enVentana,
    segundos_desde_ultimo_envio: desdeUltimo,
    max_por_ventana: env.despacho.maxPorVentana,
    espaciado_segundos: env.despacho.espaciadoSegundos,
  };
}
