import type { Nodo } from './api';

export interface NodoPosicionado extends Nodo {
  x: number;
  y: number;
  profundidad: number;
}

export interface Arista {
  desde: NodoPosicionado;
  hacia: NodoPosicionado;
  etiqueta: string;
}

export const ANCHO_NODO = 190;
export const ALTO_NODO = 62;
const SEPARACION_X = 60;
const SEPARACION_Y = 130;

/**
 * Layout jerarquico por niveles sobre la adjacency list.
 * Se recorre cada arbol en profundidad asignando una banda horizontal por hoja;
 * los nodos internos se centran sobre sus hijos. Los nodos aislados (sin padre
 * y sin hijos) se ubican como raices independientes, tal como los define la
 * especificacion de `nodos_hojas`.
 */
export function calcularLayout(nodos: readonly Nodo[]): { nodos: NodoPosicionado[]; aristas: Arista[] } {
  const porId = new Map(nodos.map((n) => [n.id, n]));
  const hijos = new Map<string | null, Nodo[]>();
  for (const n of nodos) {
    // Un parent_id que apunte fuera del conjunto se trata como raiz.
    const padre = n.parent_id !== null && porId.has(n.parent_id) ? n.parent_id : null;
    const lista = hijos.get(padre) ?? [];
    lista.push(n);
    hijos.set(padre, lista);
  }

  const posicionados = new Map<string, NodoPosicionado>();
  let cursorHoja = 0;

  const visitados = new Set<string>();
  function ubicar(nodo: Nodo, profundidad: number): number {
    if (visitados.has(nodo.id)) return cursorHoja * (ANCHO_NODO + SEPARACION_X);
    visitados.add(nodo.id);

    const misHijos = hijos.get(nodo.id) ?? [];
    let x: number;

    if (misHijos.length === 0) {
      x = cursorHoja * (ANCHO_NODO + SEPARACION_X);
      cursorHoja++;
    } else {
      const xs = misHijos.map((h) => ubicar(h, profundidad + 1));
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }

    posicionados.set(nodo.id, { ...nodo, x, y: profundidad * SEPARACION_Y, profundidad });
    return x;
  }

  for (const raiz of hijos.get(null) ?? []) ubicar(raiz, 0);
  // Cualquier nodo no alcanzado (ciclo residual o dato inconsistente) se ubica igual.
  for (const n of nodos) if (!visitados.has(n.id)) ubicar(n, 0);

  const lista = [...posicionados.values()];
  const aristas: Arista[] = [];
  for (const n of lista) {
    if (n.parent_id === null) continue;
    const padre = posicionados.get(n.parent_id);
    if (padre) aristas.push({ desde: padre, hacia: n, etiqueta: n.enlace_contenido ?? '' });
  }
  return { nodos: lista, aristas };
}

export function limites(nodos: readonly NodoPosicionado[]) {
  if (nodos.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 400 };
  return {
    minX: Math.min(...nodos.map((n) => n.x)) - 60,
    minY: Math.min(...nodos.map((n) => n.y)) - 60,
    maxX: Math.max(...nodos.map((n) => n.x)) + ANCHO_NODO + 60,
    maxY: Math.max(...nodos.map((n) => n.y)) + ALTO_NODO + 60,
  };
}
