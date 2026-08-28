import type { NodoHoja } from './tipos.js';

export interface Esfuerzo {
  contenido: string;
  nodo_id: string;
}

/**
 * [PSC-GEN-ESF] Transcripcion directa del pseudocodigo del ASI:
 *
 *   func generar_esfuerzo(index, const &nodos_hojas):
 *     nodos_hojas_length = nodos_hojas.len()
 *     si nodos_hojas_length == 0: retornar null
 *     index = index % nodos_hojas_length
 *     nodo = nodos_hojas[index]
 *     si nodo.parent_id != null Y nodo.enlace_contenido != null:
 *       esfuerzo.contenido = nodo.padre.contenido + " " + nodo.enlace_contenido + " " + nodo.contenido
 *     si_no:
 *       esfuerzo.contenido = nodo.contenido
 *     retornar esfuerzo
 *
 * `nodos_hojas` es el conjunto de nodos activos del grafo sin descendientes
 * (`children_count == 0`), tengan o no padre asignado.
 */
export function generarEsfuerzo(index: number, nodosHojas: readonly NodoHoja[]): Esfuerzo | null {
  const nodosHojasLength = nodosHojas.length;
  if (nodosHojasLength === 0) return null;

  // El cursor Round Robin es monotonamente creciente: se normaliza al rango.
  const idx = ((index % nodosHojasLength) + nodosHojasLength) % nodosHojasLength;
  const nodo = nodosHojas[idx]!;

  let contenido: string;
  if (nodo.parent_id !== null && nodo.enlace_contenido !== null) {
    contenido = `${nodo.contenido_padre ?? ''} ${nodo.enlace_contenido} ${nodo.contenido}`.trim();
  } else {
    contenido = nodo.contenido;
  }

  return { contenido, nodo_id: nodo.id };
}
