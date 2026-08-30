import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarEsfuerzo } from '../src/domain/esfuerzos.js';
import { evaluarTransicion, FASES, generaEsfuerzosPropios } from '../src/domain/fases.js';
import { validarAciclicidad } from '../src/domain/aciclicidad.js';
import { ESTRUCTURA_NODO, parsearNodo, detectarComando, normalizarFecha } from '../src/domain/parser.js';
import { indiceGlobal, deltaUE, fechaLimiteAIndice, semanaISO } from '../src/utils/tiempo.js';
import { ErrorDominio } from '../src/utils/errors.js';
import type { NodoHoja } from '../src/domain/tipos.js';

const hoja = (p: Partial<NodoHoja>): NodoHoja => ({
  id: 'n', parent_id: null, enlace_contenido: null, contenido: 'c', contenido_padre: null, ...p,
});

// --- [PSC-GEN-ESF] generar_esfuerzo -----------------------------------------
test('generar_esfuerzo retorna null si no hay nodos hoja', () => {
  assert.equal(generarEsfuerzo(0, []), null);
});

test('generar_esfuerzo concatena padre + enlace + contenido cuando hay padre', () => {
  const hojas = [hoja({
    id: 'h1', parent_id: 'p1', enlace_contenido: 'se calcula con',
    contenido: 'la regla de la cadena', contenido_padre: 'La derivada de una composicion',
  })];
  assert.equal(
    generarEsfuerzo(0, hojas)!.contenido,
    'La derivada de una composicion se calcula con la regla de la cadena',
  );
});

test('generar_esfuerzo usa solo el contenido cuando el nodo es raiz o aislado', () => {
  assert.equal(generarEsfuerzo(0, [hoja({ contenido: 'axioma' })])!.contenido, 'axioma');
});

test('generar_esfuerzo aplica index % len (Round Robin)', () => {
  const hojas = [hoja({ id: 'a', contenido: 'A' }), hoja({ id: 'b', contenido: 'B' }), hoja({ id: 'c', contenido: 'C' })];
  assert.equal(generarEsfuerzo(0, hojas)!.contenido, 'A');
  assert.equal(generarEsfuerzo(4, hojas)!.contenido, 'B');
  assert.equal(generarEsfuerzo(11, hojas)!.contenido, 'C');
});

// --- [feature 1.1] ciclo de vida --------------------------------------------
test('los promedios declarados en el ASI se reproducen con los umbrales por etapa', () => {
  const promedio = (min: number, max: number) => (min + max) / 2;
  assert.equal(FASES.fase_1.umbral! * promedio(2, 6) * 10, 24 * 60);          // 24 horas
  assert.equal(FASES.fase_2.umbral! * promedio(9, 15) * 10, 7 * 24 * 60);     // 1 semana
  assert.equal(FASES.fase_3.umbral! * promedio(21, 35) * 10, 21 * 24 * 60);   // 3 semanas
});

test('la transicion ocurre exactamente al alcanzar el umbral de la etapa', () => {
  const base = { fase: 'fase_1' as const, conteo_esfuerzo: 34, conteo_esfuerzo_fase: 34, es_temporal: false };
  assert.equal(evaluarTransicion(base).fase, 'fase_1');
  const t = evaluarTransicion({ ...base, conteo_esfuerzo: 35, conteo_esfuerzo_fase: 35 });
  assert.equal(t.fase, 'fase_2');
  assert.equal(t.conteo_esfuerzo, 36);
  assert.equal(t.conteo_esfuerzo_fase, 0);
});

test('un nodo NO temporal que alcanza fase_4 se transfiere al grafo', () => {
  const t = evaluarTransicion({ fase: 'fase_3', conteo_esfuerzo: 227, conteo_esfuerzo_fase: 107, es_temporal: false });
  assert.equal(t.fase, 'fase_4');
  assert.equal(t.ingresa_a_grafo, true);
});

test('un nodo temporal que alcanza fase_4 NO entra al grafo de conocimiento', () => {
  const t = evaluarTransicion({ fase: 'fase_3', conteo_esfuerzo: 227, conteo_esfuerzo_fase: 107, es_temporal: true });
  assert.equal(t.fase, 'fase_4');
  assert.equal(t.ingresa_a_grafo, false);
  // ...y sigue generando esfuerzos propios cada 54-66 UE hasta la fecha limite.
  assert.equal(generaEsfuerzosPropios('fase_4', true), true);
  assert.equal(generaEsfuerzosPropios('fase_4', false), false);
});

// --- [LOG-ACICLICIDAD] -------------------------------------------------------
test('rechaza de inmediato parent_id == nodo.id', () => {
  assert.throws(() => validarAciclicidad('a', 'a', []), (e: ErrorDominio) => e.codigo === 'CICLO_AUTOREFERENCIA');
});

test('detecta ciclo cuando el nodo aparece en la ruta de ancestros', () => {
  const ruta = [{ id: 'b', parent_id: 'a' }, { id: 'a', parent_id: null }];
  assert.throws(() => validarAciclicidad('a', 'b', ruta), (e: ErrorDominio) => e.codigo === 'CICLO_DETECTADO');
});

test('acepta un reparenteo sin ciclo', () => {
  assert.doesNotThrow(() => validarAciclicidad('x', 'b', [{ id: 'b', parent_id: 'a' }, { id: 'a', parent_id: null }]));
});

test('parent_id nulo desconecta sin validar', () => {
  assert.doesNotThrow(() => validarAciclicidad('x', null, []));
});

// --- [procedimiento 1] parser ------------------------------------------------
test('parsea los tres segmentos del mensaje', () => {
  const r = parsearNodo('Teorema de Bayes | P(A dado B) es proporcional a P(B dado A) | 2026-12-31');
  assert.equal(r.nodo_esfuerzo, 'Teorema de Bayes');
  assert.equal(r.nodo_crudo, 'P(A dado B) es proporcional a P(B dado A)');
  assert.equal(r.fecha_limite, '2026-12-31');
});

test('el separador puede escaparse como \\| dentro del contenido', () => {
  const r = parsearNodo('Teorema de Bayes | P(A\\|B) = P(B\\|A)P(A)/P(B) | 2026-12-31');
  assert.equal(r.nodo_crudo, 'P(A|B) = P(B|A)P(A)/P(B)');
  assert.equal(r.fecha_limite, '2026-12-31');
});

test('la fecha limite es opcional; el nodo_crudo no', () => {
  const r = parsearNodo('Teorema de Bayes | Formula que invierte la condicional');
  assert.equal(r.nodo_crudo, 'Formula que invierte la condicional');
  assert.equal(r.fecha_limite, null);
});

test('rechaza un mensaje suelto sin el segmento de nodo_crudo', () => {
  assert.throws(() => parsearNodo('hola'), (e: ErrorDominio) => e.codigo === 'FORMATO_INVALIDO');
});

test('toda discordancia de estructura responde con el mismo texto explicativo', () => {
  assert.equal(
    ESTRUCTURA_NODO,
    'Nodo no se registro. El nodo debe tener esta estructura:\n' +
      '[nodo_esfuerzo] | [nodo_crudo] <opcional> | [fecha ISO 8601] </opcional>\n' +
      'Ejemplo: "ISO para la calidad de software _ | ISO 25010 | 2026-12-12"',
  );
  for (const malo of ['hola', '', 'frente | ', ' | back', 'a | b | 2026-01-01 | extra']) {
    assert.throws(
      () => parsearNodo(malo),
      (e: ErrorDominio) => e.message.startsWith(ESTRUCTURA_NODO),
      `no explico la estructura ante: ${JSON.stringify(malo)}`,
    );
  }
});

test('rechaza un nodo_crudo vacio', () => {
  assert.throws(() => parsearNodo('frente | '), (e: ErrorDominio) => e.codigo === 'CRUDO_VACIO');
});

test('rechaza mas de tres segmentos', () => {
  assert.throws(() => parsearNodo('a | b | 2026-01-01 | extra'), (e: ErrorDominio) => e.codigo === 'FORMATO_INVALIDO');
});

test('rechaza un nodo_esfuerzo vacio', () => {
  assert.throws(() => parsearNodo(' | back'), (e: ErrorDominio) => e.codigo === 'ESFUERZO_VACIO');
});

test('rechaza fechas inexistentes', () => {
  assert.throws(() => normalizarFecha('2026-02-30'), (e: ErrorDominio) => e.codigo === 'FECHA_INVALIDA');
  assert.equal(normalizarFecha('31/12/2026'), '2026-12-31');
});

test('registrar un nodo es la operacion por defecto (texto sin comando)', () => {
  assert.equal(detectarComando('Teorema de Bayes | ...'), null);
  assert.equal(detectarComando('/stats')!.comando, '/stats');
  assert.throws(() => detectarComando('/inexistente'), (e: ErrorDominio) => e.codigo === 'COMANDO_DESCONOCIDO');
});

// --- [feature 1.2] tiempo global ---------------------------------------------
test('indice_global = floor(unix_timestamp_seconds / 600)', () => {
  assert.equal(indiceGlobal(new Date(0)), 0);
  assert.equal(indiceGlobal(new Date(599_000)), 0);
  assert.equal(indiceGlobal(new Date(600_000)), 1);
  assert.equal(indiceGlobal(new Date('2026-01-01T00:00:00Z')), Math.floor(Date.UTC(2026, 0, 1) / 600_000));
});

test('deltaUE queda dentro del rango cerrado de la etapa', () => {
  for (let i = 0; i < 500; i++) {
    const d = deltaUE(FASES.fase_3.min, FASES.fase_3.max);
    assert.ok(d >= 21 && d <= 35, `delta fuera de rango: ${d}`);
  }
});

test('la fecha limite se ancla al final del dia UTC', () => {
  assert.equal(fechaLimiteAIndice('1970-01-01'), 143); // 86399 / 600 = 143
});

test('semanaISO produce la clave natural de la evaluacion', () => {
  assert.equal(semanaISO(new Date('2026-01-04T00:00:00Z')), '2026-W01');
});
