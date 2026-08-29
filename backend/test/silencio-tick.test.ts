/**
 * [feature 1.3] Compuertas de silencio contra base real.
 *
 * La configuracion se lee del entorno al cargar el modulo, asi que este archivo
 * la fija ANTES de importar nada y usa importaciones dinamicas. La ventana se
 * calcula a partir de la hora actual, de modo que la prueba es determinista a
 * cualquier hora del dia.
 *
 * IMPORTANTE: los ficheros que tocan la base deben ejecutarse EN SERIE
 * (`npm run test:db`, que pasa --test-concurrency=1). `node --test` lanza los
 * ficheros en procesos paralelos, y `ejecutarTick()` opera sobre TODOS los
 * usuarios: en paralelo, el tick de un fichero encola nodos del usuario del
 * otro y las aserciones de aislamiento fallan de forma intermitente.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ZONA = 'UTC';
const horaActual = Number(
  new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hour: 'numeric', hour12: false })
    .formatToParts(new Date()).find((p) => p.type === 'hour')?.value ?? '0',
) % 24;

// Ventana de 3 horas centrada en el instante presente: empieza una hora antes
// y acaba dos despues. Una ventana de una sola hora se rompia si la suite
// cruzaba el cambio de hora a mitad de ejecucion.
process.env.ZONA_HORARIA = ZONA;
process.env.SILENCIO_ACTIVO = 'true';
process.env.SILENCIO_HORA_INICIO = String((horaActual + 23) % 24);
process.env.SILENCIO_HORA_FIN = String((horaActual + 2) % 24);
process.env.JWT_SECRET ??= 'pruebas';

const { pool } = await import('../src/db/pool.js');
const scheduler = await import('../src/services/scheduler.service.js');
const despacho = await import('../src/services/despacho.service.js');
const nodosService = await import('../src/services/nodos.service.js');
const grafosService = await import('../src/services/grafos.service.js');
const { enHorasDeSilencio, describirVentana } = await import('../src/domain/silencio.js');
const { indiceGlobal } = await import('../src/utils/tiempo.js');

let usuarioId = '';

before(async () => {
  const r = await pool.query(
    `INSERT INTO usuarios (email, password_hash) VALUES ($1,'x') RETURNING id`,
    [`silencio-${Date.now()}@test.local`],
  );
  usuarioId = r.rows[0].id;
});

after(async () => {
  await pool.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
  await pool.end();
});

test('la ventana forzada cubre el instante presente', () => {
  assert.equal(enHorasDeSilencio(indiceGlobal()), true, describirVentana());
});

test('el tick no encola nodos ni grafos durante las horas de silencio', async () => {
  const nodo = await nodosService.registrar(
    usuarioId, { nodo_esfuerzo: 'nodo en silencio', nodo_crudo: null, fecha_limite: null }, 'web',
  );
  const grafo = await grafosService.crearGrafo(usuarioId, { nombre: 'Grafo en silencio' }, 'web');
  await grafosService.insertarNodo(usuarioId, grafo.id, { contenido: 'hoja' }, 'web');

  // Ambos vencidos: sin silencio, el tick los encolaria.
  await pool.query('UPDATE nodos  SET indice_siguiente_esfuerzo = $2 WHERE id = $1', [nodo.id, indiceGlobal() - 1]);
  await pool.query('UPDATE grafos SET indice_siguiente_esfuerzo = $2 WHERE id = $1', [grafo.id, indiceGlobal() - 1]);

  const r = await scheduler.ejecutarTick();

  assert.equal(r.en_silencio, true);
  assert.equal(r.nodos_encolados, 0);
  assert.equal(r.grafos_encolados, 0);

  const cola = await pool.query(
    'SELECT count(*)::int n FROM effort_dispatch_queue WHERE usuario_id = $1', [usuarioId]);
  assert.equal(cola.rows[0].n, 0, 'no debio encolarse ningun esfuerzo');
});

test('el tick sigue archivando los nodos vencidos aunque haya silencio', async () => {
  const nodo = await nodosService.registrar(
    usuarioId, { nodo_esfuerzo: 'vencido en silencio', nodo_crudo: null, fecha_limite: null }, 'web',
  );
  await pool.query('UPDATE nodos SET indice_fecha_limite = $2 WHERE id = $1', [nodo.id, indiceGlobal() - 5]);

  const r = await scheduler.ejecutarTick();
  assert.equal(r.en_silencio, true);
  assert.ok(r.nodos_archivados >= 1, 'archivar no es enviar: debe seguir ocurriendo');

  const fila = await pool.query('SELECT activo, fase FROM nodos WHERE id = $1', [nodo.id]);
  assert.equal(fila.rows[0].activo, false);
  assert.equal(fila.rows[0].fase, 'archivado');
});

test('el worker no entrega esfuerzos encolados antes del silencio', async () => {
  // Item metido a mano en la cola, como si se hubiera encolado a las 21:59.
  await pool.query(
    `INSERT INTO effort_dispatch_queue (usuario_id, origen, nodo_id, contenido, indice_global)
     SELECT $1, 'nodo', id, 'pendiente de antes', $2 FROM nodos WHERE usuario_id = $1 AND activo LIMIT 1`,
    [usuarioId, indiceGlobal()],
  );
  const pendientes = await pool.query(
    "SELECT count(*)::int n FROM effort_dispatch_queue WHERE usuario_id=$1 AND estado='pendiente'", [usuarioId]);
  assert.ok(pendientes.rows[0].n >= 1, 'la prueba necesita al menos un item en cola');

  const r = await despacho.reclamarSiguiente();
  assert.equal(r.item, null);
  assert.equal(r.motivo, 'horas_silencio');
});

test('el agendamiento aparta los nuevos indices de la ventana', async () => {
  for (let i = 0; i < 30; i++) {
    const n = await nodosService.registrar(
      usuarioId, { nodo_esfuerzo: `apartado ${i}`, nodo_crudo: null, fecha_limite: null }, 'web',
    );
    assert.equal(
      enHorasDeSilencio(n.indice_siguiente_esfuerzo), false,
      `nodo agendado dentro de la ventana: ${n.indice_siguiente_esfuerzo}`,
    );
  }
});
