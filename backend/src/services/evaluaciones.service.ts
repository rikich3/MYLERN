import { enTransaccion, pool } from '../db/pool.js';
import * as evalRepo from '../repositories/evaluaciones.repo.js';
import * as nodosRepo from '../repositories/nodos.repo.js';
import * as usuariosRepo from '../repositories/usuarios.repo.js';
import { configDeFase } from '../domain/fases.js';
import { agendarSiguiente } from '../domain/silencio.js';
import { indiceGlobal, semanaISO } from '../utils/tiempo.js';
import { env } from '../config/env.js';
import { noEncontrado, invalido } from '../utils/errors.js';
import type { Fase } from '../domain/tipos.js';

/**
 * [caso de uso 2, paso 1 "generacion de evaluacion fin de semana"]
 * "El domingo a las 00:00 UTC, el sistema selecciona aleatoriamente hasta 20
 *  nodos activos que pertenezcan a `fase_3` o `fase_4`. Se genera un
 *  cuestionario estructurado combinando el `nodo_esfuerzo` como premisa y
 *  contrastando contra el `nodo_crudo` y enlaces jerarquicos."
 */
export async function generarSemanal(usuarioId: string, semana = semanaISO()) {
  return enTransaccion(async (cx) => {
    const existente = await evalRepo.porSemana(cx, usuarioId, semana);
    if (existente) return { evaluacion: existente, creada: false };

    const evaluacion = await evalRepo.crear(cx, {
      usuario_id: usuarioId,
      semana_iso: semana,
      indice_global: indiceGlobal(),
    });
    if (!evaluacion) {
      const yaCreada = await evalRepo.porSemana(cx, usuarioId, semana);
      return { evaluacion: yaCreada!, creada: false };
    }

    const nodos = await nodosRepo.muestraParaEvaluacion(cx, usuarioId, env.evaluacion.maxItems);

    const items = [] as Array<{ nodo_id: string; orden: number; premisa: string; contraste: string }>;
    for (const [i, nodo] of nodos.entries()) {
      const ruta = await nodosRepo.rutaAncestros(cx, nodo.id);
      const enlaces = ruta
        .slice(1)
        .map((a, j) => `${ruta[j]!.enlace_contenido ?? '->'} ${a.contenido}`)
        .join(' | ');

      const contraste = enlaces === ''
        ? (nodo.nodo_crudo ?? nodo.contenido)
        : `${nodo.nodo_crudo ?? nodo.contenido}\n[enlaces jerarquicos] ${enlaces}`;

      items.push({ nodo_id: nodo.id, orden: i + 1, premisa: nodo.nodo_esfuerzo, contraste });
    }

    await evalRepo.insertarItems(cx, evaluacion.id, items);
    const refrescada = await evalRepo.recalcular(cx, evaluacion.id);
    return { evaluacion: refrescada, creada: true, total_items: items.length };
  });
}

/** Genera la evaluacion dominical de todos los usuarios activos. */
export async function generarSemanalGlobal() {
  const usuarios = await usuariosRepo.activos(pool);
  const semana = semanaISO();
  const resultados = [];
  for (const u of usuarios) {
    const r = await generarSemanal(u.id, semana);
    resultados.push({
      usuario_id: u.id,
      evaluacion_id: r.evaluacion.id,
      creada: r.creada,
      total_items: r.evaluacion.total_items,
      telegram_chat_id: u.telegram_chat_id,
    });
  }
  return { semana_iso: semana, generadas: resultados };
}

export const listar = (usuarioId: string) => evalRepo.listar(pool, usuarioId);

export async function detalle(usuarioId: string, id: string) {
  const evaluacion = await evalRepo.obtener(pool, id, usuarioId);
  if (!evaluacion) throw noEncontrado('Evaluacion');
  return { evaluacion, items: await evalRepo.items(pool, id) };
}

/**
 * [caso de uso 2, paso 2 "ejecucion y autoevaluacion"]
 * Registra la autocalificacion (acierto/fallo), almacena la metrica historica
 * de retencion y ajusta el scheduling de los nodos fallidos.
 *
 * Ajuste aplicado a un fallo (ver docs/decisiones.md DEC-005): el nodo retrocede
 * una etapa, reinicia el contador de la etapa y se reagenda dentro del rango de
 * la etapa resultante, para reforzar antes lo que no se retuvo.
 */
export async function calificar(
  usuarioId: string,
  evaluacionId: string,
  itemId: string,
  resultado: 'acierto' | 'fallo',
) {
  return enTransaccion(async (cx) => {
    const evaluacion = await evalRepo.obtener(cx, evaluacionId, usuarioId);
    if (!evaluacion) throw noEncontrado('Evaluacion');

    const item = await evalRepo.calificarItem(cx, itemId, resultado);
    if (!item || item.evaluacion_id !== evaluacionId) throw noEncontrado('Item de evaluacion');

    let ajuste: { nodo_id: string; fase_anterior: Fase; fase_nueva: Fase } | null = null;

    if (resultado === 'fallo' && item.nodo_id !== null) {
      const nodo = await nodosRepo.obtenerParaActualizar(cx, item.nodo_id);
      if (nodo && nodo.activo) {
        const faseNueva = degradar(nodo.fase);
        const cfg = configDeFase(faseNueva);
        await nodosRepo.aplicarAgenda(cx, nodo.id, {
          fase: faseNueva,
          conteo_esfuerzo: nodo.conteo_esfuerzo,
          conteo_esfuerzo_fase: 0,
          indice_siguiente_esfuerzo: agendarSiguiente(indiceGlobal(), cfg.min, cfg.max),
        });
        ajuste = { nodo_id: nodo.id, fase_anterior: nodo.fase, fase_nueva: faseNueva };
      }
    }

    const actualizada = await evalRepo.recalcular(cx, evaluacionId);
    if (actualizada.estado === 'calificada') {
      await evalRepo.registrarRetencion(cx, actualizada);
    }
    return { evaluacion: actualizada, item, ajuste };
  });
}

function degradar(fase: Fase): Exclude<Fase, 'archivado'> {
  switch (fase) {
    case 'fase_4': return 'fase_3';
    case 'fase_3': return 'fase_2';
    case 'fase_2': return 'fase_1';
    default: return 'fase_1';
  }
}

/** Formato offline descargable del cuestionario (texto plano). */
export async function exportarTexto(usuarioId: string, id: string): Promise<string> {
  const { evaluacion, items } = await detalle(usuarioId, id);
  const lineas = [
    `EVALUACION MILERN -- semana ${evaluacion.semana_iso}`,
    `Generada: ${evaluacion.generada_en}`,
    `Items: ${evaluacion.total_items}`,
    '='.repeat(72),
    '',
  ];
  for (const it of items) {
    lineas.push(`${String(it.orden).padStart(2, '0')}. ${it.premisa}`);
    lineas.push('    Respuesta: ______________________________________________');
    lineas.push('');
  }
  lineas.push('', 'CLAVE DE CONTRASTE', '='.repeat(72), '');
  for (const it of items) {
    lineas.push(`${String(it.orden).padStart(2, '0')}. ${it.contraste.replace(/\n/g, '\n    ')}`);
    lineas.push('    [ ] acierto   [ ] fallo');
    lineas.push('');
  }
  return lineas.join('\n');
}

export const historicoRetencion = (usuarioId: string) => evalRepo.historicoRetencion(pool, usuarioId);

export function validarResultado(v: string): 'acierto' | 'fallo' {
  if (v !== 'acierto' && v !== 'fallo') {
    throw invalido('RESULTADO_INVALIDO', 'El resultado debe ser "acierto" o "fallo".');
  }
  return v;
}
