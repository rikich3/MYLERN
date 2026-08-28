import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { indiceGlobal } from '../utils/tiempo.js';

export async function rutasSalud(app: FastifyInstance): Promise<void> {
  app.get('/salud', async () => ({ estado: 'ok', indice_global: indiceGlobal() }));

  app.get('/salud/listo', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      return { estado: 'listo', indice_global: indiceGlobal() };
    } catch (e) {
      return res.code(503).send({ estado: 'no_listo', error: (e as Error).message });
    }
  });
}
