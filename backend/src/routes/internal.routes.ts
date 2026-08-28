import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as scheduler from '../services/scheduler.service.js';
import * as despacho from '../services/despacho.service.js';
import * as telegram from '../services/telegram.service.js';
import * as evaluaciones from '../services/evaluaciones.service.js';
import { requiereSecretoInterno } from '../middleware/auth.js';

/**
 * Superficie consumida por el contenedor 02 "workflow n8n mylern".
 * n8n aporta la integracion (webhook de Telegram, triggers cronometrados y
 * llamadas a la API de Telegram); toda la logica de dominio vive aqui.
 */
export async function rutasInternas(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requiereSecretoInterno);

  /** [procedimiento 1, paso 1] Webhook de Telegram. */
  app.post('/api/v1/internal/telegram/update', async (req) =>
    telegram.procesarUpdate(req.body as telegram.UpdateTelegram));

  /**
   * [LOG-GEN-NODO] + [LOG-GEN-GRAFO] + [procedimiento "recibiendo esfuerzos",
   * paso 1] Tick de 1 UE: se ejecuta cada 10 minutos.
   */
  app.post('/api/v1/internal/scheduler/tick', async () => scheduler.ejecutarTick());

  /**
   * [procedimiento "recibiendo esfuerzos", paso 2] El worker de n8n invoca este
   * endpoint cada minuto; el backend aplica el limite de 10 mensajes por UE y
   * el espaciado de 1 mensaje por minuto.
   */
  app.post('/api/v1/internal/despacho/siguiente', async () => despacho.reclamarSiguiente());

  /** Confirmacion de recepcion de la API de Telegram. */
  app.post('/api/v1/internal/despacho/:id/confirmar', async (req) => {
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(req.params);
    const { telegram_message_id } = z.object({
      telegram_message_id: z.coerce.number().int().nullable().optional(),
    }).parse(req.body ?? {});
    return despacho.confirmarEnvio(id, telegram_message_id ?? null);
  });

  app.post('/api/v1/internal/despacho/:id/fallo', async (req) => {
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(req.params);
    const { error } = z.object({ error: z.string().max(4000).default('error desconocido') }).parse(req.body ?? {});
    return despacho.registrarFallo(id, error);
  });

  app.get('/api/v1/internal/despacho/estado', async () => despacho.estado());

  /** [caso de uso 2, paso 1] Domingo 00:00 UTC. */
  app.post('/api/v1/internal/evaluaciones/generar-semanal', async () =>
    evaluaciones.generarSemanalGlobal());
}
