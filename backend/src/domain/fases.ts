import type { Fase } from './tipos.js';

/**
 * [feature 1.1] Ciclo de vida del nodo en 4 etapas.
 *
 *  etapa | intervalo (UE) | esfuerzos para avanzar | promedio declarado
 *  ------+----------------+------------------------+-------------------
 *   1    |  2 -  6        | 36                     | ~24 horas   (36 x 4 UE  =  144 UE)
 *   2    |  9 - 15        | 84                     | ~1 semana   (84 x 12 UE = 1008 UE)
 *   3    | 21 - 35        | 108                    | ~3 semanas  (108 x 28 UE = 3024 UE)
 *   4    | 54 - 66        | -                      | 9 a 11 horas
 *
 * Los promedios declarados en el ASI se reproducen exactamente cuando los
 * umbrales 36/84/108 se interpretan POR etapa (ver docs/decisiones.md DEC-002).
 */
export interface ConfigFase {
  min: number;
  max: number;
  /** Esfuerzos requeridos dentro de la etapa para transicionar. */
  umbral: number | null;
  siguiente: Fase | null;
}

export const FASES: Record<Exclude<Fase, 'archivado'>, ConfigFase> = {
  fase_1: { min: 2, max: 6, umbral: 36, siguiente: 'fase_2' },
  fase_2: { min: 9, max: 15, umbral: 84, siguiente: 'fase_3' },
  fase_3: { min: 21, max: 35, umbral: 108, siguiente: 'fase_4' },
  fase_4: { min: 54, max: 66, umbral: null, siguiente: null },
};

/** Rango de agendacion propio de un Grafo de Conocimiento (54 - 66 UE). */
export const RANGO_GRAFO = { min: 54, max: 66 } as const;

export function configDeFase(fase: Fase): ConfigFase {
  if (fase === 'archivado') throw new Error('Un nodo archivado no genera esfuerzos');
  return FASES[fase];
}

export interface TransicionFase {
  fase: Fase;
  conteo_esfuerzo: number;
  conteo_esfuerzo_fase: number;
  transiciono: boolean;
  /** Verdadero cuando el nodo debe integrarse al grafo de conocimiento. */
  ingresa_a_grafo: boolean;
}

/**
 * [LOG-GEN-NODO] Evalua la transicion de fase tras confirmar un envio.
 *   - incrementa `conteo_esfuerzo`
 *   - evalua el umbral de la etapa actual
 *   - un nodo NO temporal que alcanza la cuarta fase se transfiere al grafo
 */
export function evaluarTransicion(nodo: {
  fase: Fase;
  conteo_esfuerzo: number;
  conteo_esfuerzo_fase: number;
  es_temporal: boolean;
}): TransicionFase {
  const conteo = nodo.conteo_esfuerzo + 1;
  const conteoFase = nodo.conteo_esfuerzo_fase + 1;
  const cfg = configDeFase(nodo.fase);

  if (cfg.umbral !== null && cfg.siguiente !== null && conteoFase >= cfg.umbral) {
    return {
      fase: cfg.siguiente,
      conteo_esfuerzo: conteo,
      conteo_esfuerzo_fase: 0,
      transiciono: true,
      ingresa_a_grafo: cfg.siguiente === 'fase_4' && !nodo.es_temporal,
    };
  }

  return {
    fase: nodo.fase,
    conteo_esfuerzo: conteo,
    conteo_esfuerzo_fase: conteoFase,
    transiciono: false,
    ingresa_a_grafo: false,
  };
}

/**
 * Determina si un nodo, dada su fase, sigue generando esfuerzos por si mismo.
 * En fase_4 solo los nodos temporales conservan generacion propia; los
 * estructurados delegan en el Grafo de Conocimiento.
 */
export function generaEsfuerzosPropios(fase: Fase, esTemporal: boolean): boolean {
  if (fase === 'archivado') return false;
  if (fase === 'fase_4') return esTemporal;
  return true;
}
