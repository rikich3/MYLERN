import { pool } from '../db/pool.js';
import * as usuarios from '../repositories/usuarios.repo.js';
import { procesarTexto } from './telegram.service.js';

/** Destinatario de la version de WhatsApp de esta instancia de un usuario. */
export const NUMERO_WHATSAPP = '51991436832';

export async function procesarUpdate(update: { number: string; text: string }) {
  // Antes de consultar usuarios o ejecutar comandos: prefijo literal y separado.
  if (update.number !== NUMERO_WHATSAPP || !/^@milern(?:\s|$)/.test(update.text)) {
    return { ignored: true };
  }
  const contenido = update.text.slice('@milern'.length).trim() || '/ayuda';
  const respuesta = await procesarTexto(update.number, contenido, async () => {
    const cuentas = await usuarios.activos(pool);
    return cuentas.length === 1 ? cuentas[0]! : null;
  }, 'n8n');
  return { ...respuesta, number: update.number, ignored: false };
}
