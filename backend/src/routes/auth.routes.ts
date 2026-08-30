import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as authService from '../services/auth.service.js';
import { requiereUsuario, usuarioDe } from '../middleware/auth.js';

const credenciales = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres'),
  nombre: z.string().max(120).optional(),
});

export async function rutasAuth(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/registro', async (req) => {
    const { email, password, nombre } = credenciales.parse(req.body);
    return authService.registrar(email, password, nombre ?? '');
  });

  app.post('/api/v1/auth/login', async (req) => {
    const { email, password } = credenciales.pick({ email: true, password: true }).parse(req.body);
    return authService.iniciarSesion(email, password);
  });

  app.get('/api/v1/auth/perfil', { preHandler: requiereUsuario }, async (req) => ({
    perfil: await authService.perfil(usuarioDe(req)),
  }));

  app.post('/api/v1/auth/tokens', { preHandler: requiereUsuario }, async (req) => {
    const { nombre } = z.object({ nombre: z.string().min(1).max(80) }).parse(req.body);
    return authService.emitirApiToken(usuarioDe(req), nombre);
  });

  app.get('/api/v1/auth/tokens', { preHandler: requiereUsuario }, async (req) =>
    authService.listarApiTokens(usuarioDe(req)));

  app.delete('/api/v1/auth/tokens/:id', { preHandler: requiereUsuario }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { revocado: await authService.revocarApiToken(usuarioDe(req), id) };
  });
}
