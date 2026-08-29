import { enTransaccion } from '../db/pool.js';
import * as nodosRepo from '../repositories/nodos.repo.js';
import * as grafosRepo from '../repositories/grafos.repo.js';
import * as colaRepo from '../repositories/cola.repo.js';
import { generarEsfuerzo } from '../domain/esfuerzos.js';
import { RANGO_GRAFO } from '../domain/fases.js';
import { agendarSiguiente, enHorasDeSilencio } from '../domain/silencio.js';
import { indiceGlobal } from '../utils/tiempo.js';

export interface ResultadoTick {
  indice_global: number;
  nodos_archivados: number;
  nodos_encolados: number;
  grafos_encolados: number;
  grafos_sin_hojas: number;
  /** [feature 1.3] Verdadero cuando el tick cayo dentro de las horas de silencio. */
  en_silencio: boolean;
}

/**
 * [LOG-GEN-NODO] + [LOG-GEN-GRAFO]
 * Tick de 1 UE (cada 10 minutos). Ejecuta, en una sola transaccion:
 *
 *   1. Archivado de los nodos con `indice_fecha_limite < indice_global`.
 *   2. Seleccion de nodos candidatos y encolado en la tabla transaccional de
 *      despacho de esfuerzos.
 *   3. Seleccion de grafos con `indice_siguiente_esfuerzo <= indice_global`,
 *      generacion del contenido por Round Robin, encolado, avance del cursor y
 *      reagendamiento con un delta pseudoaleatorio entre 54 y 66 UE.
 *
 * Nota de diseno: el `indice_siguiente_esfuerzo` de un NODO se recalcula al
 * confirmarse el envio (no aqui), tal como indica la especificacion. El de un
 * GRAFO se recalcula en este punto, tambien segun la especificacion.
 *
 * [LOG-SILENCIO paso 1] Si el indice cae en el rango 10pm - 7am no se genera
 * ningun esfuerzo. El archivado de nodos vencidos si se ejecuta: archivar no es
 * enviar, y aplazarlo nueve horas solo dejaria datos rancios (DEC-017).
 */
export async function ejecutarTick(): Promise<ResultadoTick> {
  const ig = indiceGlobal();

  return enTransaccion(async (cx) => {
    // 1. Nodos temporales vencidos -> baja logica / archivado.
    const archivados = await nodosRepo.archivarVencidos(cx, ig);

    if (enHorasDeSilencio(ig)) {
      return {
        indice_global: ig,
        nodos_archivados: archivados.length,
        nodos_encolados: 0,
        grafos_encolados: 0,
        grafos_sin_hojas: 0,
        en_silencio: true,
      };
    }

    // 2. Nodos candidatos -> cola de despacho.
    const candidatos = await nodosRepo.candidatos(cx, ig);
    let nodosEncolados = 0;
    for (const nodo of candidatos) {
      const item = await colaRepo.encolar(cx, {
        usuario_id: nodo.usuario_id,
        origen: 'nodo',
        nodo_id: nodo.id,
        grafo_id: null,
        // El contenido del esfuerzo de un nodo es siempre el `nodo_esfuerzo`:
        // el frente de la flashcard, que oculta su parte clave.
        contenido: nodo.nodo_esfuerzo,
        indice_global: ig,
        // Los nodos en etapas tempranas se despachan primero.
        prioridad: prioridadDeFase(nodo.fase),
      });
      if (item) nodosEncolados++;
    }

    // 3. Grafos elegibles -> cola de despacho (Round Robin sobre nodos_hojas).
    const grafos = await grafosRepo.elegibles(cx, ig);
    let grafosEncolados = 0;
    let grafosSinHojas = 0;
    for (const grafo of grafos) {
      const hojas = await nodosRepo.hojasDeGrafo(cx, grafo.id);
      const esfuerzo = generarEsfuerzo(grafo.cursor_rr, hojas);

      if (esfuerzo === null) {
        // Grafo sin hojas: no hay esfuerzo que generar, pero igual se reagenda
        // para no reevaluarlo en cada tick.
        grafosSinHojas++;
        await grafosRepo.avanzarRoundRobin(
          cx, grafo.id, grafo.cursor_rr,
          agendarSiguiente(ig, RANGO_GRAFO.min, RANGO_GRAFO.max),
        );
        continue;
      }

      const item = await colaRepo.encolar(cx, {
        usuario_id: grafo.usuario_id,
        origen: 'grafo',
        nodo_id: esfuerzo.nodo_id,
        grafo_id: grafo.id,
        contenido: esfuerzo.contenido,
        indice_global: ig,
        prioridad: 400,
      });
      if (item) grafosEncolados++;

      await grafosRepo.avanzarRoundRobin(
        cx, grafo.id,
        grafo.cursor_rr + 1,
        agendarSiguiente(ig, RANGO_GRAFO.min, RANGO_GRAFO.max),
      );
    }

    return {
      indice_global: ig,
      nodos_archivados: archivados.length,
      nodos_encolados: nodosEncolados,
      grafos_encolados: grafosEncolados,
      grafos_sin_hojas: grafosSinHojas,
      en_silencio: false,
    };
  });
}

/** Los nodos jovenes tienen intervalos cortos: pierden mas si se posterga. */
function prioridadDeFase(fase: string): number {
  switch (fase) {
    case 'fase_1': return 100;
    case 'fase_2': return 200;
    case 'fase_3': return 300;
    default: return 400;
  }
}
