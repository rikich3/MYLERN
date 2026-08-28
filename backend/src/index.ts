import { construirServidor } from './server.js';
import { env } from './config/env.js';
import { esperarDisponible, pool } from './db/pool.js';
import { ejecutarBootstrap } from './bootstrap.js';

async function main(): Promise<void> {
  const app = await construirServidor();

  app.log.info('esperando disponibilidad de PostgreSQL...');
  await esperarDisponible();
  await ejecutarBootstrap((m) => app.log.info(m));

  await app.listen({ host: env.host, port: env.port });
  app.log.info(`MILERN backend escuchando en ${env.host}:${env.port}`);

  for (const senal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(senal, () => {
      app.log.info(`${senal} recibida, cerrando...`);
      void app.close().then(() => pool.end()).then(() => process.exit(0));
    });
  }
}

main().catch((e) => {
  console.error('fallo al iniciar el backend:', e);
  process.exit(1);
});
