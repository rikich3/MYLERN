/**
 * Cliente HTTPS contra el backend centralizado, autenticado por API Token
 * (procedimiento "manejando el conocimiento usando la terminal", paso 2).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export interface Config {
  base_url: string;
  token: string;
}

/**
 * Autenticacion con correo y contrasena. Evita el paso aparte de emitir un API
 * Token para un despliegue de un solo usuario; los API Token siguen siendo
 * preferibles para automatizar desde otra maquina.
 */
export async function iniciarSesion(base_url: string, email: string, password: string): Promise<void> {
  const res = await fetch(`${base_url.replace(/\/$/, '')}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`no se pudo iniciar sesion (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const { token } = (await res.json()) as { token: string };
  await guardarConfig({ base_url, token });
}

const RUTA_CONFIG = process.env.MYLERN_CONFIG ?? join(homedir(), '.config', 'mylern', 'config.json');

export async function cargarConfig(): Promise<Config> {
  const base_url = process.env.MYLERN_URL;
  const token = process.env.MYLERN_TOKEN;
  if (base_url && token) return { base_url, token };

  try {
    const crudo = await readFile(RUTA_CONFIG, 'utf8');
    const cfg = JSON.parse(crudo) as Config;
    return { base_url: base_url ?? cfg.base_url, token: token ?? cfg.token };
  } catch {
    throw new Error(
      `No hay configuracion. Ejecuta:  mylern-cli config <https://host> <mlk_token>\n` +
      `(o define MYLERN_URL y MYLERN_TOKEN)`,
    );
  }
}

export async function guardarConfig(cfg: Config): Promise<string> {
  await mkdir(dirname(RUTA_CONFIG), { recursive: true, mode: 0o700 });
  await writeFile(RUTA_CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return RUTA_CONFIG;
}

export async function api<T = unknown>(
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
): Promise<T> {
  const cfg = await cargarConfig();
  const res = await fetch(`${cfg.base_url.replace(/\/$/, '')}${ruta}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

  const texto = await res.text();
  const datos = texto === '' ? null : (() => { try { return JSON.parse(texto); } catch { return texto; } })();

  if (!res.ok) {
    const d = datos as { error?: string; mensaje?: string } | string | null;
    const msg = typeof d === 'object' && d !== null
      ? `[${d.error ?? res.status}] ${d.mensaje ?? texto}`
      : `HTTP ${res.status}: ${texto}`;
    throw new Error(msg);
  }
  return datos as T;
}
