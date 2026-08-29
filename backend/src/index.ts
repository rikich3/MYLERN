import { construirServidor } from './server.js';
import { env, validarConfigSilencio } from './config/env.js';
import { describirVentana } from './domain/silencio.js';
import { esperarDisponible, pool } from './db/pool.js';
import { ejecutarBootstrap } from './bootstrap.js';

async function main(): Promise<void> {
  // Antes de abrir el puerto: una zona horaria mal escrita mandaria los
  // esfuerzos a deshora sin error visible.
  validarConfigSilencio();

  const app = await construirServidor();
  app.log.info(describirVentana());

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
