/**
 * Configuracion central por variables de entorno.
 * Todo valor sensible se inyecta desde el entorno del contenedor (deploy/.env).
 */
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Variable de entorno requerida ausente: ${name}`);
  }
  return v;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Variable ${name} no es numerica: ${raw}`);
  return n;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'production',
  host: process.env.HOST ?? '0.0.0.0',
  port: num('PORT', 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  db: {
    host: req('PGHOST', 'postgres'),
    port: num('PGPORT', 5432),
    user: req('PGUSER', 'mylern'),
    password: req('PGPASSWORD', 'mylern'),
    database: req('PGDATABASE', 'mylern'),
    max: num('PG_POOL_MAX', 10),
  },

  auth: {
    jwtSecret: req('JWT_SECRET', 'cambiar-en-produccion-jwt'),
    jwtTtl: process.env.JWT_TTL ?? '12h',
    /**
     * Secreto compartido con n8n para los endpoints /internal/*.
     * Vacio = comprobacion desactivada. En un despliegue de un solo usuario,
     * donde n8n y el backend hablan por la red interna de Docker y esa
     * superficie no se publica, no aporta nada. Ver docs/seguridad_removida.md.
     */
    internalSecret: process.env.INTERNAL_API_SECRET ?? '',
  },

  telegram: {
    /** El envio real lo realiza n8n; el backend solo lo usa para respuestas directas. */
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    apiBase: process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  },

  despacho: {
    /** Maximo de mensajes por ventana de 1 UE (procedimiento "recibiendo esfuerzos"). */
    maxPorVentana: num('DESPACHO_MAX_POR_VENTANA', 10),
    /** Espaciado uniforme: 1 mensaje por minuto. */
    espaciadoSegundos: num('DESPACHO_ESPACIADO_SEG', 60),
    maxIntentos: num('DESPACHO_MAX_INTENTOS', 3),
  },

  evaluacion: {
    maxItems: num('EVALUACION_MAX_ITEMS', 20),
  },

  /**
   * [feature 1.3] Horas de silencio: franja en la que no se envian esfuerzos.
   * Las horas son de reloj de pared, por eso hace falta la zona horaria.
   */
  silencio: {
    activo: (process.env.SILENCIO_ACTIVO ?? 'true') !== 'false',
    zonaHoraria: process.env.ZONA_HORARIA ?? 'UTC',
    horaInicio: num('SILENCIO_HORA_INICIO', 22),
    horaFin: num('SILENCIO_HORA_FIN', 7),
    desplazamientoUE: num('SILENCIO_DESPLAZAMIENTO_UE', 54),
  },

  seguridad: {
    /**
     * Limitador de caudal de la API. Apagado por defecto: en un despliegue
     * personal el unico cliente eres tu. Ver docs/seguridad_removida.md.
     */
    rateLimitActivo: (process.env.RATE_LIMIT_ACTIVO ?? 'false') === 'true',
    rateLimitMax: num('RATE_LIMIT_MAX', 300),
  },

  bootstrap: {
    email: process.env.BOOTSTRAP_EMAIL ?? '',
    password: process.env.BOOTSTRAP_PASSWORD ?? '',
    telegramChatId: process.env.BOOTSTRAP_TELEGRAM_CHAT_ID ?? '',
  },
} as const;

/** Segundos que dura una Unidad de Espaciado (UE). */
export const SEGUNDOS_POR_UE = 600;

/**
 * Valida la configuracion de horas de silencio al arrancar. Una zona horaria
 * mal escrita o una ventana imposible harian que los esfuerzos salieran a
 * deshora sin ningun error visible, asi que se falla temprano y con claridad.
 */
export function validarConfigSilencio(): void {
  const s = env.silencio;
  if (!s.activo) return;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: s.zonaHoraria }).format(new Date());
  } catch {
    throw new Error(
      `ZONA_HORARIA invalida: "${s.zonaHoraria}". Usa un identificador IANA, por ejemplo America/Lima.`,
    );
  }

  for (const [nombre, valor] of [['SILENCIO_HORA_INICIO', s.horaInicio], ['SILENCIO_HORA_FIN', s.horaFin]] as const) {
    if (!Number.isInteger(valor) || valor < 0 || valor > 23) {
      throw new Error(`${nombre} debe ser un entero entre 0 y 23; se recibio ${valor}`);
    }
  }
  if (s.horaInicio === s.horaFin) {
    throw new Error(
      'SILENCIO_HORA_INICIO y SILENCIO_HORA_FIN no pueden ser iguales: ' +
      'la ventana seria de 24 h y ningun esfuerzo llegaria a enviarse nunca.',
    );
  }
  if (s.desplazamientoUE <= 0) {
    throw new Error(`SILENCIO_DESPLAZAMIENTO_UE debe ser mayor que 0; se recibio ${s.desplazamientoUE}`);
  }
}
