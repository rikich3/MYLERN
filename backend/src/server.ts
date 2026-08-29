import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { ErrorDominio } from './utils/errors.js';
import { rutasAuth } from './routes/auth.routes.js';
import { rutasNodos } from './routes/nodos.routes.js';
import { rutasGrafos } from './routes/grafos.routes.js';
import { rutasEvaluaciones } from './routes/evaluaciones.routes.js';
import { rutasMejoras } from './routes/mejoras.routes.js';
import { rutasInternas } from './routes/internal.routes.js';
import { rutasSalud } from './routes/salud.routes.js';

export async function construirServidor(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.logLevel },
    trustProxy: true,          // detras del reverse proxy TLS (contenedor 05)
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (process.env.CORS_ORIGEN ?? '*').split(',').map((s) => s.trim()),
    credentials: true,
  });
  // Limitador de caudal: apagado por defecto. En un despliegue personal el
  // unico cliente es el propio usuario, asi que solo anadiria una via de fallo.
  // Se enciende con RATE_LIMIT_ACTIVO=true. Ver docs/seguridad_removida.md.
  if (env.seguridad.rateLimitActivo) {
    await app.register(rateLimit, {
      max: env.seguridad.rateLimitMax,
      timeWindow: '1 minute',
      // n8n habla por la red interna y tiene su propio caudal controlado.
      allowList: (req) => req.url.startsWith('/api/v1/internal/'),
    });
  }

  // Varios endpoints internos se invocan sin cuerpo. Sin este parser, un POST
  // con content-type inesperado y cuerpo vacio se rechaza con 415.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, cuerpo, hecho) => {
    const bruto = cuerpo as Buffer;
    if (bruto.length === 0) return hecho(null, undefined);
    try {
      hecho(null, JSON.parse(bruto.toString('utf8')));
    } catch {
      hecho(null, undefined);
    }
  });

  app.setErrorHandler((error, req, res) => {
    if (error instanceof ErrorDominio) {
      return res.code(error.status).send({
        error: error.codigo, mensaje: error.message, detalle: error.detalle,
      });
    }
    if (error instanceof ZodError) {
      return res.code(422).send({
        error: 'VALIDACION', mensaje: 'Payload invalido', detalle: error.issues,
      });
    }
    // Violaciones de constraint de Postgres (par atomico, ciclos, unicidad).
    const pgCode = (error as { code?: string }).code;
    if (pgCode === '23514' || pgCode === '23505' || pgCode === '23503') {
      req.log.warn({ err: error }, 'violacion de integridad');
      return res.code(409).send({
        error: 'INTEGRIDAD', mensaje: (error as Error).message, detalle: { pg_code: pgCode },
      });
    }
    // Errores propios de Fastify (415, 413, 400 de parseo...) ya traen su
    // statusCode: devolverlos como 500 ocultaria la causa real al cliente.
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      req.log.warn({ err: error }, 'peticion rechazada');
      return res.code(status).send({
        error: (error as { code?: string }).code ?? 'PETICION_INVALIDA',
        mensaje: (error as Error).message,
      });
    }

    req.log.error({ err: error }, 'error no controlado');
    return res.code(500).send({ error: 'INTERNO', mensaje: 'Error interno del servidor' });
  });

  await app.register(rutasSalud);
  await app.register(rutasAuth);
  await app.register(rutasNodos);
  await app.register(rutasGrafos);
  await app.register(rutasEvaluaciones);
  await app.register(rutasMejoras);
  await app.register(rutasInternas);

  return app;
}
