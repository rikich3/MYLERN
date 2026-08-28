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
    /** Secreto compartido con n8n para los endpoints /internal/*. */
    internalSecret: req('INTERNAL_API_SECRET', 'cambiar-en-produccion-internal'),
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

  bootstrap: {
    email: process.env.BOOTSTRAP_EMAIL ?? '',
    password: process.env.BOOTSTRAP_PASSWORD ?? '',
    telegramChatId: process.env.BOOTSTRAP_TELEGRAM_CHAT_ID ?? '',
  },
} as const;

/** Segundos que dura una Unidad de Espaciado (UE). */
export const SEGUNDOS_POR_UE = 600;
