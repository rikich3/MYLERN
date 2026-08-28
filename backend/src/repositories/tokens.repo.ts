import { consulta, uno, type Ejecutor } from '../db/pool.js';

export interface ApiToken {
  id: string;
  usuario_id: string;
  nombre: string;
  revocado: boolean;
  creado_en: string;
  ultimo_uso: string | null;
}

export async function crear(
  ej: Ejecutor,
  t: { usuario_id: string; nombre: string; token_hash: string },
): Promise<ApiToken> {
  const row = await uno<ApiToken>(
    ej,
    `INSERT INTO api_tokens (usuario_id, nombre, token_hash) VALUES ($1,$2,$3)
     RETURNING id, usuario_id, nombre, revocado, creado_en, ultimo_uso`,
    [t.usuario_id, t.nombre, t.token_hash],
  );
  return row!;
}

export async function porHash(ej: Ejecutor, hash: string): Promise<{ usuario_id: string } | null> {
  const row = await uno<{ usuario_id: string }>(
    ej,
    'SELECT usuario_id FROM api_tokens WHERE token_hash = $1 AND NOT revocado',
    [hash],
  );
  if (row) {
    await ej.query('UPDATE api_tokens SET ultimo_uso = now() WHERE token_hash = $1', [hash]);
  }
  return row;
}

export async function listar(ej: Ejecutor, usuarioId: string): Promise<ApiToken[]> {
  return consulta<ApiToken>(
    ej,
    `SELECT id, usuario_id, nombre, revocado, creado_en, ultimo_uso
       FROM api_tokens WHERE usuario_id = $1 ORDER BY creado_en DESC`,
    [usuarioId],
  );
}

export async function revocar(ej: Ejecutor, id: string, usuarioId: string): Promise<boolean> {
  const r = await ej.query(
    'UPDATE api_tokens SET revocado = TRUE WHERE id = $1 AND usuario_id = $2',
    [id, usuarioId],
  );
  return (r.rowCount ?? 0) > 0;
}
