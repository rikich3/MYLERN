import { ErrorDominio } from '../utils/errors.js';

/** Fila minima para el recorrido ascendente por ancestros. */
export interface FilaAncestro {
  id: string;
  parent_id: string | null;
}

/**
 * [LOG-ACICLICIDAD] Validacion de no-ciclos.
 *   1. Si `parent_id == nodo.id`, rechazar de inmediato.
 *   2. Recorrer ascendentemente los ancestros del `parent_id` propuesto; si el
 *      `nodo.id` aparece en la ruta, abortar por deteccion de ciclo.
 *
 * `rutaAncestros` es el resultado del `WITH RECURSIVE` ejecutado en Postgres,
 * ordenado desde el padre propuesto hacia la raiz.
 */
export function validarAciclicidad(
  nodoId: string,
  parentIdPropuesto: string | null,
  rutaAncestros: readonly FilaAncestro[],
): void {
  if (parentIdPropuesto === null) return;

  if (parentIdPropuesto === nodoId) {
    throw new ErrorDominio(
      'CICLO_AUTOREFERENCIA',
      'Un nodo no puede ser su propio padre',
      422,
    );
  }

  if (rutaAncestros.some((a) => a.id === nodoId)) {
    throw new ErrorDominio(
      'CICLO_DETECTADO',
      `El nodo ${nodoId} ya es ancestro de ${parentIdPropuesto}: el reparenteo generaria un ciclo`,
      422,
    );
  }
}
