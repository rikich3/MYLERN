import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as mejoras from '../services/mejoras.service.js';
import { requiereUsuario, usuarioDe } from '../middleware/auth.js';

export async function rutasMejoras(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requiereUsuario);

  app.get('/api/v1/oportunidades', async (req) => {
    const { solucion_id } = z.object({ solucion_id: z.string().uuid().optional() }).parse(req.query);
    return { oportunidades: await mejoras.listarOportunidades(usuarioDe(req), solucion_id ?? null) };
  });

  app.post('/api/v1/oportunidades', async (req, res) => {
    const datos = z.object({
      situacion: z.string().min(1).max(4000),
      observacion: z.string().min(1).max(8000),
    }).parse(req.body);
    return res.code(201).send(await mejoras.registrarOportunidad(usuarioDe(req), datos, 'web'));
  });

  app.get('/api/v1/soluciones', async (req) =>
    ({ soluciones: await mejoras.listarSoluciones(usuarioDe(req)) }));

  app.post('/api/v1/soluciones', async (req, res) => {
    const datos = z.object({
      titulo: z.string().min(1).max(200),
      descripcion: z.string().max(8000).optional(),
      oportunidades: z.array(z.string().uuid()).max(200).optional(),
    }).parse(req.body);
    return res.code(201).send(await mejoras.crearSolucion(usuarioDe(req), datos, 'web'));
  });

  app.post('/api/v1/soluciones/:id/vincular', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { oportunidades } = z.object({
      oportunidades: z.array(z.string().uuid()).min(1).max(200),
    }).parse(req.body);
    return mejoras.vincular(usuarioDe(req), id, oportunidades);
  });

  app.patch('/api/v1/soluciones/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { estado } = z.object({ estado: z.string() }).parse(req.body);
    return mejoras.cambiarEstado(usuarioDe(req), id, estado);
  });
}
