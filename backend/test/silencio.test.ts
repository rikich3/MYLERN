/**
 * [feature 1.3] Horas de silencio. Pruebas puras: la configuracion se inyecta,
 * de modo que no dependen de las variables de entorno del proceso.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enHorasDeSilencio, desplazarFueraDeSilencio, agendarSiguiente,
  duracionVentanaHoras, describirVentana, type ConfigSilencio,
} from '../src/domain/silencio.js';
import { horaLocal, indiceGlobal } from '../src/utils/tiempo.js';
import { FASES, RANGO_GRAFO } from '../src/domain/fases.js';

/** Configuracion del requisito: 10pm - 7am, desplazamiento de 54 UE. */
const LIMA: ConfigSilencio = {
  activo: true, zonaHoraria: 'America/Lima',
  horaInicio: 22, horaFin: 7, desplazamientoUE: 54,
};
const UTC: ConfigSilencio = { ...LIMA, zonaHoraria: 'UTC' };

/** Indice global de una hora concreta en UTC. */
const idx = (iso: string) => indiceGlobal(new Date(iso));

// --- ventana ----------------------------------------------------------------
test('la ventana 22->7 dura 9 horas, exactamente las 54 UE del desplazamiento', () => {
  assert.equal(duracionVentanaHoras(LIMA), 9);
  assert.equal(LIMA.desplazamientoUE * 10, 9 * 60);   // 54 UE = 540 min = 9 h
});

// --- [LOG-SILENCIO paso 1] deteccion ----------------------------------------
test('detecta el rango 10pm - 7am cruzando la medianoche', () => {
  const dentro = ['22:00', '22:30', '23:59', '00:00', '03:00', '06:59'];
  const fuera  = ['07:00', '07:01', '12:00', '20:00', '21:59'];
  for (const h of dentro) {
    assert.equal(enHorasDeSilencio(idx(`2026-03-10T${h}:00Z`), UTC), true, `${h} deberia ser silencio`);
  }
  for (const h of fuera) {
    assert.equal(enHorasDeSilencio(idx(`2026-03-10T${h}:00Z`), UTC), false, `${h} NO deberia ser silencio`);
  }
});

test('las fronteras no se solapan: 22:00 entra, 07:00 sale', () => {
  assert.equal(enHorasDeSilencio(idx('2026-03-10T21:59:00Z'), UTC), false);
  assert.equal(enHorasDeSilencio(idx('2026-03-10T22:00:00Z'), UTC), true);
  assert.equal(enHorasDeSilencio(idx('2026-03-10T06:59:00Z'), UTC), true);
  assert.equal(enHorasDeSilencio(idx('2026-03-10T07:00:00Z'), UTC), false);
});

test('la ventana es hora local, no UTC', () => {
  // Lima es UTC-5: las 11:00 UTC son las 06:00 en Lima.
  // En Lima es silencio (antes de las 7); en UTC es plena manana.
  const i = idx('2026-03-11T11:00:00Z');
  assert.equal(horaLocal(i, 'America/Lima'), 6);
  assert.equal(horaLocal(i, 'UTC'), 11);
  assert.equal(enHorasDeSilencio(i, LIMA), true);
  assert.equal(enHorasDeSilencio(i, UTC), false);
});

test('una franja diurna en Lima no es silencio aunque en UTC lo pareceria', () => {
  // 01:00 UTC = 20:00 en Lima -> fuera de la ventana local.
  const i = idx('2026-03-11T01:00:00Z');
  assert.equal(horaLocal(i, 'America/Lima'), 20);
  assert.equal(enHorasDeSilencio(i, LIMA), false);
  assert.equal(enHorasDeSilencio(i, UTC), true);
});

test('con el silencio desactivado nunca hay ventana', () => {
  const off: ConfigSilencio = { ...UTC, activo: false };
  for (const h of ['22:00', '00:00', '03:00', '06:59']) {
    assert.equal(enHorasDeSilencio(idx(`2026-03-10T${h}:00Z`), off), false);
  }
});

// --- [LOG-SILENCIO paso 2] desplazamiento -----------------------------------
test('suma 54 UE cuando el indice caeria dentro del rango', () => {
  const dentro = idx('2026-03-10T23:00:00Z');
  const movido = desplazarFueraDeSilencio(dentro, UTC);
  assert.equal(movido - dentro, 54, 'debe sumar exactamente 54 UE');
  assert.equal(horaLocal(movido, 'UTC'), 8);          // 23:00 + 9 h = 08:00
  assert.equal(enHorasDeSilencio(movido, UTC), false);
});

test('no toca el indice si ya cae fuera del rango', () => {
  const fuera = idx('2026-03-10T15:00:00Z');
  assert.equal(desplazarFueraDeSilencio(fuera, UTC), fuera);
});

test('una sola suma de 54 UE basta desde cualquier punto de la ventana', () => {
  // Recorre la ventana entera minuto a UE y comprueba que un solo salto escapa.
  const inicio = idx('2026-03-10T22:00:00Z');
  for (let i = 0; i < 54; i++) {
    const dentro = inicio + i;
    assert.equal(enHorasDeSilencio(dentro, UTC), true, `UE ${i} deberia ser silencio`);
    const movido = desplazarFueraDeSilencio(dentro, UTC);
    assert.equal(movido - dentro, 54, `desde UE ${i} deberia bastar una suma`);
    assert.equal(enHorasDeSilencio(movido, UTC), false, `UE ${i} sigue en silencio tras mover`);
  }
});

test('con una ventana mas ancha que el desplazamiento, se aplica repetidamente', () => {
  // 20:00 -> 08:00 son 12 h, mas que las 9 h del salto: hacen falta dos.
  const ancha: ConfigSilencio = { ...UTC, horaInicio: 20, horaFin: 8 };
  const dentro = idx('2026-03-10T20:30:00Z');
  const movido = desplazarFueraDeSilencio(dentro, ancha);
  assert.equal(enHorasDeSilencio(movido, ancha), false);
  assert.equal(movido - dentro, 108, 'dos saltos de 54 UE');
});

// --- agendamiento integrado -------------------------------------------------
test('agendarSiguiente nunca deja un esfuerzo dentro de la ventana', () => {
  const rangos = [
    [FASES.fase_1.min, FASES.fase_1.max], [FASES.fase_2.min, FASES.fase_2.max],
    [FASES.fase_3.min, FASES.fase_3.max], [RANGO_GRAFO.min, RANGO_GRAFO.max],
  ] as const;
  const base = idx('2026-03-10T00:00:00Z');
  for (let hora = 0; hora < 24; hora++) {
    for (const [min, max] of rangos) {
      for (let intento = 0; intento < 25; intento++) {
        const agendado = agendarSiguiente(base + hora * 6, min, max, UTC);
        assert.equal(enHorasDeSilencio(agendado, UTC), false,
          `hora ${hora}, rango ${min}-${max}: agendado en silencio`);
      }
    }
  }
});

test('agendarSiguiente respeta el rango de la etapa cuando no hay desplazamiento', () => {
  const base = idx('2026-03-10T09:00:00Z');   // media manana: lejos de la ventana
  for (let i = 0; i < 200; i++) {
    const delta = agendarSiguiente(base, FASES.fase_1.min, FASES.fase_1.max, UTC) - base;
    assert.ok(delta >= 2 && delta <= 6, `delta fuera del rango de fase_1: ${delta}`);
  }
});

test('describirVentana resume la configuracion para el registro', () => {
  assert.equal(describirVentana(LIMA), 'silencio de 22:00 a 07:00 (America/Lima, 9 h)');
  assert.equal(describirVentana({ ...LIMA, activo: false }), 'horas de silencio desactivadas');
});
