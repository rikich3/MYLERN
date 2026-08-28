import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as grafosService from '../services/grafos.service.js';
import { requiereUsuario, usuarioDe } from '../middleware/auth.js';

const uuid = z.object({ id: z.string().uuid() });

export async function rutasGrafos(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requiereUsuario);

  app.get('/api/v1/grafos', async (req) => ({ grafos: await grafosService.listarGrafos(usuarioDe(req)) }));

  app.post('/api/v1/grafos', async (req, res) => {
    const datos = z.object({
      nombre: z.string().min(1).max(160),
      descripcion: z.string().max(2000).optional(),
    }).parse(req.body);
    return res.code(201).send(await grafosService.crearGrafo(usuarioDe(req), datos, 'web'));
  });

  app.get('/api/v1/grafos/:id', async (req) => {
    const { id } = uuid.parse(req.params);
    return grafosService.detalleGrafo(usuarioDe(req), id);
  });

  /** [PSC-INS-NODO] insertar_nodo(grafo_id, contenido, parent_id?, enlace_contenido?) */
  app.post('/api/v1/grafos/:id/nodos', async (req, res) => {
    const { id } = uuid.parse(req.params);
    const datos = z.object({
      contenido: z.string().min(1).max(20000),
      nodo_esfuerzo: z.string().max(4000).optional(),
      parent_id: z.string().uuid().nullable().optional(),
      enlace_contenido: z.string().max(2000).nullable().optional(),
    }).parse(req.body);
    return res.code(201).send(await grafosService.insertarNodo(usuarioDe(req), id, datos, 'web'));
  });

  /** [LOG-ACICLICIDAD] reparenteo validado transaccionalmente. */
  app.patch('/api/v1/nodos/:id/padre', async (req) => {
    const { id } = uuid.parse(req.params);
    const datos = z.object({
      parent_id: z.string().uuid().nullable(),
      enlace_contenido: z.string().max(2000).nullable(),
    }).parse(req.body);
    return grafosService.reparentear(usuarioDe(req), id, datos.parent_id, datos.enlace_contenido, 'web');
  });

  /** [PSC-DEL-NODO] eliminar_nodo(nodo_id) con desvinculacion huerfana segura. */
  app.delete('/api/v1/nodos/:id', async (req) => {
    const { id } = uuid.parse(req.params);
    return grafosService.eliminarNodo(usuarioDe(req), id, 'web');
  });

  app.post('/api/v1/nodos/:id/integrar', async (req) => {
    const { id } = uuid.parse(req.params);
    const { grafo_id } = z.object({ grafo_id: z.string().uuid() }).parse(req.body);
    return grafosService.integrarNodoAGrafo(usuarioDe(req), id, grafo_id, 'web');
  });
}
