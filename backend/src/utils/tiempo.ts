import { SEGUNDOS_POR_UE } from '../config/env.js';

/**
 * [feature 1.2] Tiempo global discreto.
 *   indice_global = floor(unix_timestamp_seconds / 600)
 */
export function indiceGlobal(fecha: Date = new Date()): number {
  return Math.floor(fecha.getTime() / 1000 / SEGUNDOS_POR_UE);
}

/** Convierte un indice global a su instante inicial. */
export function indiceAFecha(indice: number): Date {
  return new Date(indice * SEGUNDOS_POR_UE * 1000);
}

/**
 * Delta pseudoaleatorio uniforme en el rango cerrado [min, max] expresado en UE.
 * Usado para agendar `indice_siguiente_esfuerzo` dentro del rango de la etapa.
 */
export function deltaUE(min: number, max: number): number {
  if (max < min) throw new Error(`Rango UE invalido: [${min}, ${max}]`);
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * [feature 1.3] Hora local (0-23) que corresponde a un indice global en la zona
 * horaria indicada. Las horas de silencio son un concepto de reloj de pared:
 * el indice global es UTC, asi que hay que traducirlo.
 */
export function horaLocal(indice: number, zonaHoraria: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaHoraria,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(indiceAFecha(indice));

  const bruta = partes.find((p) => p.type === 'hour')?.value ?? '0';
  const hora = Number(bruta);
  // Algunas versiones de ICU devuelven "24" para la medianoche.
  return hora === 24 ? 0 : hora;
}

/** Lanza si la zona horaria no la reconoce el runtime. */
export function validarZonaHoraria(zonaHoraria: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zonaHoraria }).format(new Date());
  } catch {
    throw new Error(
      `Zona horaria invalida: "${zonaHoraria}". Usa un identificador IANA, por ejemplo America/Lima.`,
    );
  }
}

/** Semana ISO (formato `YYYY-Www`) usada como clave natural de la evaluacion. */
export function semanaISO(fecha: Date = new Date()): string {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const inicioAnio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

/** Convierte una fecha limite (YYYY-MM-DD, fin de dia UTC) a indice global. */
export function fechaLimiteAIndice(iso: string): number {
  return indiceGlobal(new Date(`${iso}T23:59:59.000Z`));
}
