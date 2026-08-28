import { ErrorDominio } from '../utils/errors.js';

/**
 * [procedimiento 1 "registrando un nodo", paso 2]
 * Estructura del mensaje de registro:
 *   [nodo_esfuerzo] | [nodo_crudo] <opcional> | [fecha_limite] </opcional>
 */
export interface NodoParseado {
  nodo_esfuerzo: string;
  nodo_crudo: string | null;
  fecha_limite: string | null; // ISO YYYY-MM-DD
}

export interface ComandoControl {
  comando: string;
  argumento: string;
}

const COMANDOS = new Set([
  '/start', '/ayuda', '/help', '/nodo', '/listar', '/grafos',
  '/stats', '/baja', '/mejora', '/evaluacion', '/vincular',
]);

/**
 * [procedimiento 1, paso 1] "Si el mensaje no contiene comandos de control, se
 * enruta al parser de creacion de nodos". Registrar un nodo es la operacion por
 * defecto del bot.
 */
export function detectarComando(texto: string): ComandoControl | null {
  const limpio = texto.trim();
  if (!limpio.startsWith('/')) return null;
  const [crudo, ...resto] = limpio.split(/\s+/);
  // Telegram admite la forma /comando@nombre_del_bot
  const comando = (crudo ?? '').split('@')[0]!.toLowerCase();
  if (!COMANDOS.has(comando)) {
    throw new ErrorDominio(
      'COMANDO_DESCONOCIDO',
      `Comando no reconocido: ${comando}. Envia /ayuda para ver los comandos disponibles.`,
      422,
    );
  }
  return { comando, argumento: resto.join(' ').trim() };
}

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const RE_LATAM = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Normaliza `YYYY-MM-DD` o `DD/MM/YYYY` a ISO, validando que la fecha exista. */
export function normalizarFecha(entrada: string): string {
  const t = entrada.trim();
  let iso: string | null = null;

  if (RE_ISO.test(t)) {
    iso = t;
  } else {
    const m = RE_LATAM.exec(t);
    if (m) iso = `${m[3]}-${m[2]}-${m[1]}`;
  }

  if (iso === null) {
    throw new ErrorDominio(
      'FECHA_INVALIDA',
      `Formato de fecha limite invalido: "${entrada}". Usa YYYY-MM-DD o DD/MM/YYYY.`,
      422,
    );
  }

  const d = new Date(`${iso}T00:00:00.000Z`);
  const [y, mo, da] = iso.split('-').map(Number) as [number, number, number];
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== y || d.getUTCMonth() + 1 !== mo || d.getUTCDate() !== da
  ) {
    throw new ErrorDominio('FECHA_INVALIDA', `La fecha "${entrada}" no existe en el calendario.`, 422);
  }
  return iso;
}

/**
 * El separador `|` puede aparecer dentro del contenido legitimo (por ejemplo
 * `P(A|B)`). Se admite escaparlo como `\\|`; el escape se protege antes de
 * segmentar y se restituye despues, de modo que la regla de "como maximo 3
 * segmentos" del ASI se sigue validando con exactitud.
 */
const CENTINELA_PIPE = '\u0000PIPE\u0000';

function segmentar(cuerpo: string): string[] {
  return cuerpo
    .replace(/\\\|/g, CENTINELA_PIPE)
    .split('|')
    .map((p) => p.replace(new RegExp(CENTINELA_PIPE, 'g'), '|').trim());
}

/**
 * Extrae los tokens del payload y valida la integridad del formato.
 * Ante discordancia sintactica se lanza ErrorDominio: el flujo de Telegram
 * responde con el mensaje explicativo y finaliza.
 */
export function parsearNodo(texto: string): NodoParseado {
  const cuerpo = texto.replace(/^\/nodo(@\S+)?\s*/i, '').trim();

  if (cuerpo === '') {
    throw new ErrorDominio(
      'MENSAJE_VACIO',
      'El mensaje esta vacio. Formato esperado: [nodo_esfuerzo] | [nodo_crudo] | [fecha_limite]',
      422,
    );
  }

  const partes = segmentar(cuerpo);
  if (partes.length > 3) {
    throw new ErrorDominio(
      'FORMATO_INVALIDO',
      `Se recibieron ${partes.length} segmentos; el formato admite como maximo 3: ` +
        '[nodo_esfuerzo] | [nodo_crudo] | [fecha_limite]. ' +
        'Si el texto contiene el caracter "|", escapalo como \\| .',
      422,
    );
  }

  const nodoEsfuerzo = partes[0] ?? '';
  if (nodoEsfuerzo === '') {
    throw new ErrorDominio(
      'ESFUERZO_VACIO',
      'El primer segmento ([nodo_esfuerzo]) es obligatorio y no puede estar vacio.',
      422,
    );
  }

  const segundo = partes.length >= 2 ? (partes[1] ?? '') : '';
  const tercero = partes.length === 3 ? (partes[2] ?? '') : '';

  if (partes.length === 3 && tercero === '') {
    throw new ErrorDominio(
      'FECHA_VACIA',
      'Se declaro un tercer segmento pero la fecha limite esta vacia.',
      422,
    );
  }

  return {
    nodo_esfuerzo: nodoEsfuerzo,
    nodo_crudo: segundo === '' ? null : segundo,
    fecha_limite: tercero === '' ? null : normalizarFecha(tercero),
  };
}

/** Formulario estructurado del caso de uso 3: `[situacion] | [observacion]`. */
export function parsearMejora(texto: string): { situacion: string; observacion: string } {
  const partes = segmentar(texto);
  if (partes.length !== 2 || partes[0] === '' || partes[1] === '') {
    throw new ErrorDominio(
      'FORMATO_INVALIDO',
      'Formato esperado: /mejora [situacion] | [observacion]',
      422,
    );
  }
  return { situacion: partes[0]!, observacion: partes[1]! };
}
