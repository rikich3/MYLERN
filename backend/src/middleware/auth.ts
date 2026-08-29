import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import * as authService from '../services/auth.service.js';
import { env } from '../config/env.js';
import { noAutorizado } from '../utils/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    usuarioId?: string;
  }
}

function comparar(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Autenticacion de usuario. Admite dos portadores:
 *   - `Authorization: Bearer <jwt>`         -> app web
 *   - `Authorization: Bearer mlk_<token>`   -> CLI via API Token (HTTPS)
 */
export async function requiereUsuario(req: FastifyRequest, _res: FastifyReply): Promise<void> {
  const header = req.headers.authorization ?? '';
  const [tipo, valor] = header.split(' ');
  if (tipo !== 'Bearer' || !valor) throw noAutorizado('Falta el encabezado Authorization');

  req.usuarioId = valor.startsWith('mlk_')
    ? await authService.usuarioPorApiToken(valor)
    : authService.verificarJwt(valor);
}

/**
 * Autenticacion maquina-a-maquina para los endpoints consumidos por n8n
 * (`/api/v1/internal/*`).
 *
 * Si `INTERNAL_API_SECRET` esta vacio la comprobacion se desactiva. Es el modo
 * por defecto en un despliegue personal: n8n y el backend hablan por la red
 * interna de Docker y esa superficie no se publica al exterior, asi que el
 * secreto solo anadiria un valor mas que gestionar.
 * Para reactivarlo basta con definir la variable. Ver docs/seguridad_removida.md.
 */
export async function requiereSecretoInterno(req: FastifyRequest, _res: FastifyReply): Promise<void> {
  if (env.auth.internalSecret === '') return;
  const recibido = String(req.headers['x-internal-secret'] ?? '');
  if (recibido === '' || !comparar(recibido, env.auth.internalSecret)) {
    throw noAutorizado('Secreto interno invalido');
  }
}

export function usuarioDe(req: FastifyRequest): string {
  if (!req.usuarioId) throw noAutorizado();
  return req.usuarioId;
}
