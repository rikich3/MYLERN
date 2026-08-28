const BASE = import.meta.env.VITE_API_BASE ?? '';
const CLAVE_TOKEN = 'milern.token';

export const sesion = {
  token: (): string | null => localStorage.getItem(CLAVE_TOKEN),
  guardar: (t: string) => localStorage.setItem(CLAVE_TOKEN, t),
  cerrar: () => localStorage.removeItem(CLAVE_TOKEN),
};

export class ErrorApi extends Error {
  constructor(readonly codigo: string, mensaje: string, readonly status: number) {
    super(mensaje);
  }
}

export async function api<T = unknown>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const token = sesion.token();
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

  if (res.status === 401) {
    sesion.cerrar();
    throw new ErrorApi('NO_AUTORIZADO', 'Sesion expirada, vuelve a ingresar.', 401);
  }

  const texto = await res.text();
  const datos = texto === '' ? null : JSON.parse(texto);
  if (!res.ok) {
    const d = datos as { error?: string; mensaje?: string };
    throw new ErrorApi(d?.error ?? 'ERROR', d?.mensaje ?? `HTTP ${res.status}`, res.status);
  }
  return datos as T;
}

// --- Tipos compartidos con el backend ---------------------------------------
export type Fase = 'fase_1' | 'fase_2' | 'fase_3' | 'fase_4' | 'archivado';

export interface Nodo {
  id: string;
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
  children_count?: number;
}

export interface Grafo {
  id: string;
  nombre: string;
  descripcion: string;
  indice_siguiente_esfuerzo: number;
  cursor_rr: number;
  total_nodos?: number;
  total_hojas?: number;
}

export interface Evaluacion {
  id: string;
  semana_iso: string;
  estado: 'generada' | 'en_progreso' | 'calificada';
  total_items: number;
  aciertos: number;
  fallos: number;
  puntaje: number | null;
  generada_en: string;
}

export interface ItemEvaluacion {
  id: string;
  orden: number;
  premisa: string;
  contraste: string;
  resultado: 'pendiente' | 'acierto' | 'fallo';
  nodo_id: string | null;
}

export interface Oportunidad {
  id: string;
  situacion: string;
  observacion: string;
  solucion_id: string | null;
  creado_en: string;
}

export interface Solucion {
  id: string;
  titulo: string;
  descripcion: string;
  estado: 'backlog' | 'en_progreso' | 'completado';
  total_observaciones: number;
}
