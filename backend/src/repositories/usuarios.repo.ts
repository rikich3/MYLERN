import { consulta, uno, type Ejecutor } from '../db/pool.js';

export interface Usuario {
  id: string;
  email: string;
  password_hash: string;
  nombre: string;
  telegram_chat_id: string | null;
  zona_horaria: string;
  activo: boolean;
}

const COLS = 'id, email, password_hash, nombre, telegram_chat_id::text, zona_horaria, activo';

export async function porEmail(ej: Ejecutor, email: string): Promise<Usuario | null> {
  return uno<Usuario>(ej, `SELECT ${COLS} FROM usuarios WHERE email = $1 AND activo`, [email]);
}

export async function porId(ej: Ejecutor, id: string): Promise<Usuario | null> {
  return uno<Usuario>(ej, `SELECT ${COLS} FROM usuarios WHERE id = $1`, [id]);
}

export async function porChatTelegram(ej: Ejecutor, chatId: string): Promise<Usuario | null> {
  return uno<Usuario>(
    ej,
    `SELECT ${COLS} FROM usuarios WHERE telegram_chat_id = $1::bigint AND activo`,
    [chatId],
  );
}

export async function crear(
  ej: Ejecutor,
  u: { email: string; password_hash: string; nombre?: string; telegram_chat_id?: string | null },
): Promise<Usuario> {
  const row = await uno<Usuario>(
    ej,
    `INSERT INTO usuarios (email, password_hash, nombre, telegram_chat_id)
     VALUES ($1,$2,$3,$4::bigint) RETURNING ${COLS}`,
    [u.email, u.password_hash, u.nombre ?? '', u.telegram_chat_id ?? null],
  );
  return row!;
}

export async function vincularTelegram(ej: Ejecutor, id: string, chatId: string): Promise<void> {
  await ej.query('UPDATE usuarios SET telegram_chat_id = $2::bigint WHERE id = $1', [id, chatId]);
}

export async function activos(ej: Ejecutor): Promise<Usuario[]> {
  return consulta<Usuario>(ej, `SELECT ${COLS} FROM usuarios WHERE activo ORDER BY creado_en`);
}
