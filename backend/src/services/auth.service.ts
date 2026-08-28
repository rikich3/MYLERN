import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool, enTransaccion } from '../db/pool.js';
import * as usuariosRepo from '../repositories/usuarios.repo.js';
import * as tokensRepo from '../repositories/tokens.repo.js';
import { env } from '../config/env.js';
import { noAutorizado, conflicto } from '../utils/errors.js';

export interface Sesion {
  token: string;
  usuario: { id: string; email: string; nombre: string; telegram_chat_id: string | null };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function registrar(email: string, password: string, nombre = ''): Promise<Sesion> {
  const existente = await usuariosRepo.porEmail(pool, email);
  if (existente) throw conflicto('EMAIL_EN_USO', 'Ya existe una cuenta con ese correo.');
  const u = await usuariosRepo.crear(pool, {
    email, password_hash: await bcrypt.hash(password, 12), nombre,
  });
  return { token: firmar(u.id), usuario: proyectar(u) };
}

export async function iniciarSesion(email: string, password: string): Promise<Sesion> {
  const u = await usuariosRepo.porEmail(pool, email);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) throw noAutorizado();
  return { token: firmar(u.id), usuario: proyectar(u) };
}

function firmar(usuarioId: string): string {
  return jwt.sign({ sub: usuarioId }, env.auth.jwtSecret, {
    expiresIn: env.auth.jwtTtl as jwt.SignOptions['expiresIn'],
  });
}

function proyectar(u: usuariosRepo.Usuario) {
  return { id: u.id, email: u.email, nombre: u.nombre, telegram_chat_id: u.telegram_chat_id };
}

export function verificarJwt(token: string): string {
  try {
    const payload = jwt.verify(token, env.auth.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') throw new Error('sub ausente');
    return payload.sub;
  } catch {
    throw noAutorizado('Token invalido o expirado');
  }
}

/**
 * API Token para la CLI (procedimiento "manejando el conocimiento usando la
 * terminal"). Solo se muestra una vez; la base guarda unicamente el hash.
 */
export async function emitirApiToken(usuarioId: string, nombre: string) {
  const secreto = `mlk_${randomBytes(24).toString('base64url')}`;
  const registro = await tokensRepo.crear(pool, {
    usuario_id: usuarioId, nombre, token_hash: hashToken(secreto),
  });
  return { ...registro, token: secreto };
}

export async function usuarioPorApiToken(token: string): Promise<string> {
  const r = await tokensRepo.porHash(pool, hashToken(token));
  if (!r) throw noAutorizado('API token invalido o revocado');
  return r.usuario_id;
}

export const listarApiTokens = (usuarioId: string) => tokensRepo.listar(pool, usuarioId);
export const revocarApiToken = (usuarioId: string, id: string) => tokensRepo.revocar(pool, id, usuarioId);

export const vincularTelegram = (usuarioId: string, chatId: string) =>
  enTransaccion((cx) => usuariosRepo.vincularTelegram(cx, usuarioId, chatId));

export const perfil = async (usuarioId: string) => {
  const u = await usuariosRepo.porId(pool, usuarioId);
  return u ? proyectar(u) : null;
};
