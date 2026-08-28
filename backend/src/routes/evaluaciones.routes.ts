import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as evaluaciones from '../services/evaluaciones.service.js';
import { requiereUsuario, usuarioDe } from '../middleware/auth.js';

export async function rutasEvaluaciones(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requiereUsuario);

  app.get('/api/v1/evaluaciones', async (req) =>
    ({ evaluaciones: await evaluaciones.listar(usuarioDe(req)) }));

  app.get('/api/v1/evaluaciones/retencion', async (req) =>
    ({ historico: await evaluaciones.historicoRetencion(usuarioDe(req)) }));

  app.get('/api/v1/evaluaciones/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return evaluaciones.detalle(usuarioDe(req), id);
  });

  /** Descarga del formato offline (panel integrado de descarga y calificacion). */
  app.get('/api/v1/evaluaciones/:id/descargar', async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const texto = await evaluaciones.exportarTexto(usuarioDe(req), id);
    return res
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="evaluacion-${id}.txt"`)
      .send(texto);
  });

  /** Generacion manual (la automatica la dispara n8n cada domingo 00:00 UTC). */
  app.post('/api/v1/evaluaciones/generar', async (req) =>
    evaluaciones.generarSemanal(usuarioDe(req)));

  app.post('/api/v1/evaluaciones/:id/items/:itemId', async (req) => {
    const { id, itemId } = z.object({
      id: z.string().uuid(),
      itemId: z.string().uuid(),
    }).parse(req.params);
    const { resultado } = z.object({ resultado: z.enum(['acierto', 'fallo']) }).parse(req.body);
    return evaluaciones.calificar(usuarioDe(req), id, itemId, resultado);
  });
}
