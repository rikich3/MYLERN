/**
 * Pruebas de integracion contra una base PostgreSQL real.
 * Recorren el ciclo completo: registro por Telegram -> tick -> despacho ->
 * confirmacion -> transicion de fase -> ingreso al grafo -> evaluacion.
 *
 * Se omiten si no hay base disponible (PGHOST/PGPORT).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, enTransaccion } from '../src/db/pool.js';
import * as nodosService from '../src/services/nodos.service.js';
import * as grafosService from '../src/services/grafos.service.js';
import * as scheduler from '../src/services/scheduler.service.js';
import * as despacho from '../src/services/despacho.service.js';
import * as evaluaciones from '../src/services/evaluaciones.service.js';
import * as telegram from '../src/services/telegram.service.js';
import * as undoService from '../src/services/undo.service.js';
import * as nodosRepo from '../src/repositories/nodos.repo.js';
import * as grafosRepo from '../src/repositories/grafos.repo.js';
import { indiceGlobal } from '../src/utils/tiempo.js';

/**
 * Comprueba que un reagendamiento cayo dentro del rango de la etapa.
 * Se toma el indice global ANTES y DESPUES de la operacion porque el tick de 1
 * UE puede cruzarse durante la prueba: sin esa ventana la asercion es una
 * carrera contra el reloj.
 */
function enRango(indiceAgendado: number, igAntes: number, igDespues: number, min: number, max: number): boolean {
  return indiceAgendado >= igAntes + min && indiceAgendado <= igDespues + max;
}

const EMAIL = `it-${Date.now()}@test.local`;
const CHAT = String(900000000 + (Date.now() % 1000000));
let usuarioId = '';

before(async () => {
  const r = await pool.query(
    `INSERT INTO usuarios (email, password_hash, telegram_chat_id)
     VALUES ($1,'x',$2::bigint) RETURNING id`,
    [EMAIL, CHAT],
  );
  usuarioId = r.rows[0].id;
});

after(async () => {
  await pool.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
  await pool.end();
});

test('registro de nodo por Telegram con los tres segmentos', async () => {
  const igAntes = indiceGlobal();
  const r = await telegram.procesarUpdate({
    message: { chat: { id: CHAT }, text: 'Teorema de Bayes | Invierte la condicional | 2030-01-15' },
  });
  assert.equal(r.ok, true);
  const nodo = await nodosRepo.obtener(pool, r.nodo_id!);
  assert.equal(nodo!.fase, 'fase_1');
  assert.equal(nodo!.conteo_esfuerzo, 0);
  assert.equal(nodo!.es_temporal, true);          // tiene fecha limite
  assert.equal(nodo!.nodo_crudo, 'Invierte la condicional');
  // indice_siguiente_esfuerzo = indice_global + random(2, 6)
  assert.ok(
    enRango(nodo!.indice_siguiente_esfuerzo, igAntes, indiceGlobal(), 2, 6),
    `agendamiento inicial fuera del rango de fase_1: ${nodo!.indice_siguiente_esfuerzo}`,
  );
});

test('un mensaje mal formado responde explicacion y no crea nodo', async () => {
  const antes = await nodosRepo.listar(pool, { usuario_id: usuarioId, activo: true });
  const r = await telegram.procesarUpdate({
    message: { chat: { id: CHAT }, text: 'a | b | c | d' },
  });
  assert.equal(r.ok, false);
  assert.match(r.texto, /FORMATO_INVALIDO/);
  const despues = await nodosRepo.listar(pool, { usuario_id: usuarioId, activo: true });
  assert.equal(despues.length, antes.length);
});

test('tick -> despacho -> confirmacion incrementa el contador y reagenda', async () => {
  const nodo = await nodosService.registrar(
    usuarioId, { nodo_esfuerzo: 'ciclo completo', nodo_crudo: 'reverso', fecha_limite: null }, 'web',
  );
  // Se fuerza la elegibilidad: indice_siguiente_esfuerzo <= indice_global.
  await pool.query('UPDATE nodos SET indice_siguiente_esfuerzo = $2 WHERE id = $1',
    [nodo.id, indiceGlobal() - 1]);

  const tick = await scheduler.ejecutarTick();
  assert.ok(tick.nodos_encolados >= 1, 'el tick debio encolar el nodo');

  // El caudal (10 por UE / 1 por minuto) puede diferir la entrega: se lee el
  // item directamente de la cola para probar la confirmacion de forma aislada.
  const fila = await pool.query(
    `SELECT id::text FROM effort_dispatch_queue
      WHERE nodo_id = $1 AND estado IN ('pendiente','en_proceso') ORDER BY id DESC LIMIT 1`,
    [nodo.id],
  );
  assert.equal(fila.rowCount, 1);

  const igAntes = indiceGlobal();
  const res = await despacho.confirmarEnvio(fila.rows[0].id, 12345);
  assert.equal(res.conteo_esfuerzo, 1);
  assert.equal(res.fase_nueva, 'fase_1');

  const actualizado = await nodosRepo.obtener(pool, nodo.id);
  assert.ok(
    enRango(actualizado!.indice_siguiente_esfuerzo, igAntes, indiceGlobal(), 2, 6),
    `reagendamiento fuera del rango de fase_1: ${actualizado!.indice_siguiente_esfuerzo}`,
  );

  const log = await pool.query('SELECT count(*)::int n FROM esfuerzos_log WHERE nodo_id = $1', [nodo.id]);
  assert.equal(log.rows[0].n, 1);
});

test('el tick archiva los nodos temporales vencidos', async () => {
  const nodo = await nodosService.registrar(
    usuarioId, { nodo_esfuerzo: 'vencido', nodo_crudo: null, fecha_limite: null }, 'web',
  );
  await pool.query('UPDATE nodos SET indice_fecha_limite = $2 WHERE id = $1',
    [nodo.id, indiceGlobal() - 5]);
  await scheduler.ejecutarTick();
  const archivado = await nodosRepo.obtener(pool, nodo.id);
  assert.equal(archivado!.activo, false);
  assert.equal(archivado!.fase, 'archivado');
});

test('un nodo no temporal que alcanza fase_4 ingresa a un grafo de conocimiento', async () => {
  const nodo = await nodosService.registrar(
    usuarioId, { nodo_esfuerzo: 'maduro', nodo_crudo: 'contenido maduro', fecha_limite: null }, 'web',
  );
  // Ultimo esfuerzo de fase_3: la siguiente confirmacion dispara la transicion.
  await pool.query(
    `UPDATE nodos SET fase='fase_3', conteo_esfuerzo=227, conteo_esfuerzo_fase=107,
            indice_siguiente_esfuerzo=$2 WHERE id=$1`,
    [nodo.id, indiceGlobal() - 1],
  );
  await scheduler.ejecutarTick();
  const fila = await pool.query(
    `SELECT id::text FROM effort_dispatch_queue WHERE nodo_id=$1 ORDER BY id DESC LIMIT 1`, [nodo.id]);
  const res = await despacho.confirmarEnvio(fila.rows[0].id, 1);

  assert.equal(res.fase_nueva, 'fase_4');
  assert.ok(res.ingreso_a_grafo, 'debio asignarse un grafo de conocimiento');

  const final = await nodosRepo.obtener(pool, nodo.id);
  assert.equal(final!.fase, 'fase_4');
  assert.equal(final!.grafo_id, res.ingreso_a_grafo);
  // A partir de aqui deja de ser candidato: el grafo gobierna sus esfuerzos.
  const elegibles = await nodosRepo.candidatos(pool, indiceGlobal() + 100000);
  assert.ok(!elegibles.some((n) => n.id === nodo.id));
});

test('el grafo genera esfuerzos por Round Robin sobre sus hojas', async () => {
  const grafo = await grafosService.crearGrafo(usuarioId, { nombre: 'Analisis' }, 'web');
  const raiz = await grafosService.insertarNodo(usuarioId, grafo.id, { contenido: 'La derivada' }, 'web');
  await grafosService.insertarNodo(usuarioId, grafo.id, {
    contenido: 'la regla de la cadena', parent_id: raiz.id, enlace_contenido: 'se calcula con',
  }, 'web');
  await grafosService.insertarNodo(usuarioId, grafo.id, {
    contenido: 'la linealidad', parent_id: raiz.id, enlace_contenido: 'cumple',
  }, 'web');

  // La raiz dejo de ser hoja al recibir hijos.
  const hojas = await nodosRepo.hojasDeGrafo(pool, grafo.id);
  assert.equal(hojas.length, 2);
  assert.ok(!hojas.some((h) => h.id === raiz.id));

  await pool.query('UPDATE grafos SET indice_siguiente_esfuerzo = $2 WHERE id = $1',
    [grafo.id, indiceGlobal() - 1]);
  const igAntes = indiceGlobal();
  const tick = await scheduler.ejecutarTick();
  assert.ok(tick.grafos_encolados >= 1);

  const item = await pool.query(
    'SELECT contenido FROM effort_dispatch_queue WHERE grafo_id = $1 ORDER BY id DESC LIMIT 1', [grafo.id]);
  // padre.contenido + " " + enlace_contenido + " " + contenido
  assert.match(item.rows[0].contenido, /^La derivada (se calcula con|cumple) /);

  // El cursor avanzo y la agenda se movio 54-66 UE hacia adelante.
  const g = await grafosRepo.obtener(pool, grafo.id, usuarioId);
  assert.equal(g!.cursor_rr, 1);
  assert.ok(
    enRango(g!.indice_siguiente_esfuerzo, igAntes, indiceGlobal(), 54, 66),
    `reagendamiento del grafo fuera de rango: ${g!.indice_siguiente_esfuerzo}`,
  );
});

test('eliminar un nodo preserva a sus hijos como raices y devuelve el padre a hoja', async () => {
  const grafo = await grafosService.crearGrafo(usuarioId, { nombre: 'Bajas' }, 'web');
  const abuelo = await grafosService.insertarNodo(usuarioId, grafo.id, { contenido: 'abuelo' }, 'web');
  const padre = await grafosService.insertarNodo(usuarioId, grafo.id, {
    contenido: 'padre', parent_id: abuelo.id, enlace_contenido: 'contiene',
  }, 'web');
  const hijo = await grafosService.insertarNodo(usuarioId, grafo.id, {
    contenido: 'hijo', parent_id: padre.id, enlace_contenido: 'incluye',
  }, 'web');

  const r = await grafosService.eliminarNodo(usuarioId, padre.id, 'web');
  assert.deepEqual(r.hijos_desvinculados, [hijo.id]);

  const hijoFinal = await nodosRepo.obtener(pool, hijo.id);
  assert.equal(hijoFinal!.parent_id, null);
  assert.equal(hijoFinal!.enlace_contenido, null);
  assert.equal(hijoFinal!.activo, true);          // preservado en el grafo

  const abueloFinal = await nodosRepo.obtener(pool, abuelo.id);
  assert.equal(abueloFinal!.is_leaf, true);       // era su unico hijo activo

  const padreFinal = await nodosRepo.obtener(pool, padre.id);
  assert.equal(padreFinal!.activo, false);        // baja logica, no borrado
});

test('el reparenteo que generaria un ciclo es rechazado', async () => {
  const grafo = await grafosService.crearGrafo(usuarioId, { nombre: 'Ciclos' }, 'web');
  const a = await grafosService.insertarNodo(usuarioId, grafo.id, { contenido: 'A' }, 'web');
  const b = await grafosService.insertarNodo(usuarioId, grafo.id, {
    contenido: 'B', parent_id: a.id, enlace_contenido: 'baja a',
  }, 'web');
  await assert.rejects(
    () => grafosService.reparentear(usuarioId, a.id, b.id, 'sube a', 'web'),
    (e: Error & { codigo?: string }) => e.codigo === 'CICLO_DETECTADO',
  );
});

test('el par (parent_id, enlace_contenido) se exige atomico', async () => {
  const grafo = await grafosService.crearGrafo(usuarioId, { nombre: 'Atomico' }, 'web');
  const a = await grafosService.insertarNodo(usuarioId, grafo.id, { contenido: 'A' }, 'web');
  await assert.rejects(
    () => grafosService.insertarNodo(usuarioId, grafo.id, { contenido: 'B', parent_id: a.id }, 'web'),
    (e: Error & { codigo?: string }) => e.codigo === 'PAR_NO_ATOMICO',
  );
});

test('la evaluacion dominical toma nodos de fase_3 y fase_4 y el fallo reagenda', async () => {
  const nodo = await nodosService.registrar(
    usuarioId, { nodo_esfuerzo: 'premisa evaluable', nodo_crudo: 'contraste', fecha_limite: null }, 'web',
  );
  await pool.query("UPDATE nodos SET fase='fase_3' WHERE id=$1", [nodo.id]);

  const semana = `TEST-${Date.now()}`;
  const { evaluacion } = await evaluaciones.generarSemanal(usuarioId, semana);
  assert.ok(evaluacion.total_items > 0 && evaluacion.total_items <= 20);

  const { items } = await evaluaciones.detalle(usuarioId, evaluacion.id);
  const item = items.find((i) => i.nodo_id === nodo.id);
  assert.ok(item, 'el nodo en fase_3 debio aparecer en la evaluacion');
  assert.equal(item!.premisa, 'premisa evaluable');

  const r = await evaluaciones.calificar(usuarioId, evaluacion.id, item!.id, 'fallo');
  assert.equal(r.ajuste!.fase_nueva, 'fase_2');   // retrocede una etapa
  assert.equal(r.evaluacion.fallos, 1);
});

test('undo revierte la ultima operacion registrada en el log', async () => {
  const nodo = await nodosService.registrar(
    usuarioId, { nodo_esfuerzo: 'a deshacer', nodo_crudo: null, fecha_limite: null }, 'cli',
  );
  const r = await undoService.deshacerUltima(usuarioId);
  assert.match(r.detalle, /baja logica/);
  const final = await nodosRepo.obtener(pool, nodo.id);
  assert.equal(final!.activo, false);
});

test('el caudal de despacho respeta el limite de 1 mensaje por minuto', async () => {
  // Ya hubo confirmaciones en esta corrida: el espaciado debe bloquear la entrega.
  await enTransaccion(async (cx) => {
    await cx.query(
      `INSERT INTO esfuerzos_log (usuario_id, origen, contenido, indice_global)
       VALUES ($1,'nodo','marcador',$2)`,
      [usuarioId, indiceGlobal()],
    );
  });
  const r = await despacho.reclamarSiguiente();
  assert.equal(r.item, null);
  assert.equal(r.motivo, 'espaciado');
});
