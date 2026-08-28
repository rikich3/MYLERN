import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as nodosService from '../services/nodos.service.js';
import * as undoService from '../services/undo.service.js';
import { requiereUsuario, usuarioDe } from '../middleware/auth.js';
import { parsearNodo } from '../domain/parser.js';

const entrada = z.object({
  nodo_esfuerzo: z.string().min(1).max(4000),
  nodo_crudo: z.string().max(20000).nullable().optional(),
  fecha_limite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function rutasNodos(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requiereUsuario);

  app.get('/api/v1/nodos', async (req) => {
    const q = z.object({
      fase: z.enum(['fase_1', 'fase_2', 'fase_3', 'fase_4', 'archivado']).optional(),
      grafo_id: z.string().uuid().optional(),
      activo: z.coerce.boolean().optional(),
      busqueda: z.string().max(200).optional(),
      limite: z.coerce.number().int().min(1).max(500).optional(),
      desplazamiento: z.coerce.number().int().min(0).optional(),
    }).parse(req.query);
    return { nodos: await nodosService.listar(usuarioDe(req), q) };
  });

  app.get('/api/v1/nodos/estadisticas', async (req) => nodosService.estadisticas(usuarioDe(req)));

  app.get('/api/v1/nodos/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return nodosService.obtener(usuarioDe(req), id);
  });

  app.post('/api/v1/nodos', async (req, res) => {
    const datos = entrada.parse(req.body);
    const nodo = await nodosService.registrar(
      usuarioDe(req),
      { nodo_esfuerzo: datos.nodo_esfuerzo, nodo_crudo: datos.nodo_crudo ?? null, fecha_limite: datos.fecha_limite ?? null },
      'web',
    );
    return res.code(201).send(nodo);
  });

  /** Insercion masiva de alta velocidad usada por la CLI. */
  app.post('/api/v1/nodos/lote', async (req, res) => {
    const { lineas, nodos } = z.object({
      lineas: z.array(z.string().min(1)).max(500).optional(),
      nodos: z.array(entrada).max(500).optional(),
    }).parse(req.body);

    const entradas = [
      ...(lineas ?? []).map(parsearNodo),
      ...(nodos ?? []).map((n) => ({
        nodo_esfuerzo: n.nodo_esfuerzo,
        nodo_crudo: n.nodo_crudo ?? null,
        fecha_limite: n.fecha_limite ?? null,
      })),
    ];
    const creados = await nodosService.registrarLote(usuarioDe(req), entradas, 'cli');
    return res.code(201).send({ creados: creados.length, nodos: creados });
  });

  app.patch('/api/v1/nodos/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const campos = z.object({
      nodo_esfuerzo: z.string().min(1).max(4000).optional(),
      nodo_crudo: z.string().max(20000).nullable().optional(),
      grafo_id: z.string().uuid().nullable().optional(),
    }).parse(req.body);
    return nodosService.actualizar(usuarioDe(req), id, campos, 'web');
  });

  app.get('/api/v1/transacciones', async (req) => {
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
    return { transacciones: await undoService.historial(usuarioDe(req), limite) };
  });

  /** `undo` soportado a nivel log de transacciones. */
  app.post('/api/v1/transacciones/undo', async (req) => undoService.deshacerUltima(usuarioDe(req)));
}
