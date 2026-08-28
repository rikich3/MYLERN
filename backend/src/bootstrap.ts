import bcrypt from 'bcryptjs';
import { pool } from './db/pool.js';
import * as usuariosRepo from './repositories/usuarios.repo.js';
import { env } from './config/env.js';

/**
 * Crea la cuenta inicial cuando BOOTSTRAP_EMAIL / BOOTSTRAP_PASSWORD estan
 * definidos y la base aun no la tiene. Idempotente: no pisa datos existentes.
 */
export async function ejecutarBootstrap(log: (m: string) => void): Promise<void> {
  const { email, password, telegramChatId } = env.bootstrap;
  if (email === '' || password === '') return;

  const existente = await usuariosRepo.porEmail(pool, email);
  if (existente) {
    if (telegramChatId !== '' && existente.telegram_chat_id === null) {
      await usuariosRepo.vincularTelegram(pool, existente.id, telegramChatId);
      log(`bootstrap: chat de Telegram vinculado a ${email}`);
    }
    return;
  }

  const u = await usuariosRepo.crear(pool, {
    email,
    password_hash: await bcrypt.hash(password, 12),
    nombre: 'Operador MILERN',
    telegram_chat_id: telegramChatId === '' ? null : telegramChatId,
  });
  log(`bootstrap: usuario inicial creado ${email} (id=${u.id})`);
}
