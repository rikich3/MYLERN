export type Fase = 'fase_1' | 'fase_2' | 'fase_3' | 'fase_4' | 'archivado';
export type OrigenEsfuerzo = 'nodo' | 'grafo';
export type EstadoDespacho = 'pendiente' | 'en_proceso' | 'enviado' | 'fallido' | 'descartado';
export type EstadoSolucion = 'backlog' | 'en_progreso' | 'completado';
export type ResultadoItem = 'pendiente' | 'acierto' | 'fallo';

export interface Nodo {
  id: string;
  usuario_id: string;
  nodo_esfuerzo: string;
  nodo_crudo: string | null;
  contenido: string;
  fase: Fase;
  conteo_esfuerzo: number;
  conteo_esfuerzo_fase: number;
  indice_siguiente_esfuerzo: number;
  indice_fecha_limite: number | null;
  es_temporal: boolean;
  grafo_id: string | null;
  parent_id: string | null;
  enlace_contenido: string | null;
  is_leaf: boolean;
  activo: boolean;
  creado_en: string;
  actualizado_en: string;
}

export interface Grafo {
  id: string;
  usuario_id: string;
  nombre: string;
  descripcion: string;
  indice_siguiente_esfuerzo: number;
  cursor_rr: number;
  activo: boolean;
}

/** Proyeccion minima de un nodo hoja, tal como la consume `generar_esfuerzo`. */
export interface NodoHoja {
  id: string;
  parent_id: string | null;
  enlace_contenido: string | null;
  contenido: string;
  /** Contenido del padre, precargado por la adjacency list. */
  contenido_padre: string | null;
}

export interface ItemCola {
  id: string;
  usuario_id: string;
  origen: OrigenEsfuerzo;
  nodo_id: string | null;
  grafo_id: string | null;
  contenido: string;
  indice_global: number;
  estado: EstadoDespacho;
  intentos: number;
}
