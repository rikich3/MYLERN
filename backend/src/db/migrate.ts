import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, esperarDisponible } from './pool.js';

/**
 * Aplicador de migraciones idempotente. Lee los .sql de `deploy/postgres/init`
 * en orden lexicografico y registra los aplicados en `schema_migrations`.
 * El contenedor de Postgres ya ejecuta esos scripts en su primer arranque; este
 * comando cubre los despliegues sobre una base preexistente.
 */
const DIR = process.env.MIGRATIONS_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

async function main(): Promise<void> {
  await esperarDisponible();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      archivo     TEXT PRIMARY KEY,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const archivos = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const archivo of archivos) {
    const yaAplicada = await pool.query('SELECT 1 FROM schema_migrations WHERE archivo = $1', [archivo]);
    if (yaAplicada.rowCount) {
      console.log(`= ${archivo} (ya aplicada)`);
      continue;
    }
    const sql = await readFile(join(DIR, archivo), 'utf8');
    const cx = await pool.connect();
    try {
      await cx.query('BEGIN');
      await cx.query(sql);
      await cx.query('INSERT INTO schema_migrations (archivo) VALUES ($1)', [archivo]);
      await cx.query('COMMIT');
      console.log(`+ ${archivo}`);
    } catch (e) {
      await cx.query('ROLLBACK');
      throw new Error(`Fallo la migracion ${archivo}: ${(e as Error).message}`);
    } finally {
      cx.release();
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
