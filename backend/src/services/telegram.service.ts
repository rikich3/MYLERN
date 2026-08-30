import { pool } from '../db/pool.js';
import * as usuariosRepo from '../repositories/usuarios.repo.js';
import * as nodosService from './nodos.service.js';
import * as mejorasService from './mejoras.service.js';
import * as evaluacionesService from './evaluaciones.service.js';
import * as grafosRepo from '../repositories/grafos.repo.js';
import * as nodosRepo from '../repositories/nodos.repo.js';
import { detectarComando, parsearMejora, parsearNodo } from '../domain/parser.js';
import { ErrorDominio } from '../utils/errors.js';
import { indiceGlobal } from '../utils/tiempo.js';

/** Payload minimo de un update de Telegram que el sistema consume. */
export interface UpdateTelegram {
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string };
    from?: { id?: number | string; first_name?: string };
  };
}

export interface RespuestaBot {
  chat_id: string;
  texto: string;
  ok: boolean;
  nodo_id?: string;
}

const AYUDA = [
  'MILERN -- bot de repeticion espaciada',
  '',
  'Registrar un nodo (operacion por defecto, sin comando):',
  '  [nodo_esfuerzo] | [nodo_crudo] | [fecha_limite]',
  '  Los dos primeros segmentos son obligatorios; la fecha limite es opcional.',
  '  Ej: Teorema de Bayes | Formula que invierte la condicional | 2026-12-31',
  '  Si el texto contiene "|", escapalo como \\| .',
  '',
  'Comandos de control:',
  '  /nodo <texto>   registra un nodo de forma explicita',
  '  /listar         ultimos nodos registrados',
  '  /stats          nodos por etapa e indice global actual',
  '  /grafos         grafos de conocimiento y sus hojas',
  '  /evaluacion     estado de la evaluacion de la semana',
  '  /mejora [situacion] | [observacion]   registra una oportunidad de mejora',
  '  /ayuda          muestra esta ayuda',
].join('\n');

/**
 * [procedimiento 1 "registrando un nodo", paso 1 "recepcionando un nodo"]
 * "Si el mensaje no contiene comandos de control, se enruta al parser de
 *  creacion de nodos."
 */
export async function procesarUpdate(update: UpdateTelegram): Promise<RespuestaBot> {
  const chatId = String(update.message?.chat?.id ?? '');
  const texto = (update.message?.text ?? '').trim();

  if (chatId === '') {
    return { chat_id: '', texto: 'Update sin chat identificable.', ok: false };
  }
  if (texto === '') {
    return { chat_id: chatId, texto: 'Solo se admiten mensajes de texto.', ok: false };
  }

  try {
    const comando = detectarComando(texto);

    if (comando?.comando === '/start' || comando?.comando === '/ayuda' || comando?.comando === '/help') {
      return { chat_id: chatId, texto: AYUDA, ok: true };
    }

    // La resolucion es perezosa a proposito: la ayuda la ve cualquiera, pero un
    // chat solo se adopta cuando hace trabajo real (registrar un nodo, listar).
    const usuario = await resolverUsuario(chatId);
    if (!usuario) {
      return {
        chat_id: chatId,
        texto: 'Este chat no corresponde a la cuenta de esta instancia de MILERN.',
        ok: false,
      };
    }

    // `return await` es deliberado: sin el, la promesa rechazada escaparia
    // este try/catch y el error de formato no llegaria al usuario como mensaje.
    switch (comando?.comando) {
      case '/listar':     return await listar(chatId, usuario.id);
      case '/stats':      return await stats(chatId, usuario.id);
      case '/grafos':     return await grafos(chatId, usuario.id);
      case '/evaluacion': return await evaluacion(chatId, usuario.id);
      case '/mejora':     return await mejora(chatId, usuario.id, comando.argumento);
      default:            return await registrarNodo(chatId, usuario.id, texto);
    }
  } catch (e) {
    // "ante discordancia sintactica, se responde con un mensaje explicativo y
    //  finaliza el flujo".
    if (e instanceof ErrorDominio) {
      return { chat_id: chatId, texto: `[${e.codigo}] ${e.message}`, ok: false };
    }
    throw e;
  }
}

async function registrarNodo(chatId: string, usuarioId: string, texto: string): Promise<RespuestaBot> {
  const parseado = parsearNodo(texto);
  const nodo = await nodosService.registrar(usuarioId, parseado, 'telegram');
  const faltan = nodo.indice_siguiente_esfuerzo - indiceGlobal();
  const partes = [
    `Nodo registrado (${nodo.es_temporal ? 'temporal' : 'permanente'}).`,
    `esfuerzo : ${nodo.nodo_esfuerzo}`,
    nodo.nodo_crudo ? `crudo    : ${nodo.nodo_crudo}` : null,
    `etapa    : ${nodo.fase}`,
    `1er env. : en ~${faltan} UE (${faltan * 10} min)`,
    nodo.indice_fecha_limite ? `limite   : indice ${nodo.indice_fecha_limite}` : null,
    `id       : ${nodo.id}`,
  ].filter(Boolean);
  return { chat_id: chatId, texto: partes.join('\n'), ok: true, nodo_id: nodo.id };
}

async function listar(chatId: string, usuarioId: string): Promise<RespuestaBot> {
  const nodos = await nodosRepo.listar(pool, { usuario_id: usuarioId, activo: true, limite: 10 });
  if (nodos.length === 0) return { chat_id: chatId, texto: 'Aun no hay nodos activos.', ok: true };
  const texto = nodos
    .map((n) => `- [${n.fase}|${n.conteo_esfuerzo_fase}] ${n.nodo_esfuerzo}`)
    .join('\n');
  return { chat_id: chatId, texto: `Ultimos nodos activos:\n${texto}`, ok: true };
}

async function stats(chatId: string, usuarioId: string): Promise<RespuestaBot> {
  const s = await nodosService.estadisticas(usuarioId);
  const detalle = s.por_fase.map((f) => `  ${f.fase}: ${f.total}`).join('\n');
  return {
    chat_id: chatId,
    texto: `Nodos activos: ${s.total}\n${detalle}\nindice_global: ${s.indice_global}`,
    ok: true,
  };
}

async function grafos(chatId: string, usuarioId: string): Promise<RespuestaBot> {
  const lista = await grafosRepo.listar(pool, usuarioId);
  if (lista.length === 0) return { chat_id: chatId, texto: 'Aun no hay grafos de conocimiento.', ok: true };
  const texto = lista
    .map((g) => `- ${g.nombre}: ${g.total_nodos} nodos / ${g.total_hojas} hojas`)
    .join('\n');
  return { chat_id: chatId, texto: `Grafos de conocimiento:\n${texto}`, ok: true };
}

async function evaluacion(chatId: string, usuarioId: string): Promise<RespuestaBot> {
  const lista = await evaluacionesService.listar(usuarioId);
  const ultima = lista[0];
  if (!ultima) return { chat_id: chatId, texto: 'Aun no hay evaluaciones generadas.', ok: true };
  return {
    chat_id: chatId,
    texto:
      `Evaluacion ${ultima.semana_iso} -- ${ultima.estado}\n` +
      `items: ${ultima.total_items} | aciertos: ${ultima.aciertos} | fallos: ${ultima.fallos}` +
      (ultima.puntaje !== null ? `\nretencion: ${ultima.puntaje}%` : '') +
      '\nCompletala en la app web, seccion Evaluaciones.',
    ok: true,
  };
}

async function mejora(chatId: string, usuarioId: string, argumento: string): Promise<RespuestaBot> {
  const datos = parsearMejora(argumento);
  const o = await mejorasService.registrarOportunidad(usuarioId, datos, 'telegram');
  return { chat_id: chatId, texto: `Oportunidad de mejora registrada (${o.id}).`, ok: true };
}

/**
 * Cuenta a la que pertenece un chat.
 *
 * El ASI da por hecha la relacion chat <-> usuario ("un worker [...] enviando
 * mensajes hacia el chat de Telegram") y no describe ninguna ceremonia para
 * establecerla: registrar un nodo debe bastar para empezar a recibir esfuerzos.
 * MILERN es un despliegue de un solo usuario, asi que la cuenta unica adopta al
 * primer chat que le habla. A partir de ahi queda ocupada y el bot ignora a
 * cualquier otro chat, de modo que un tercero que encuentre el bot no puede
 * escribir en el conocimiento de su duenno.
 *
 * En la practica el vinculo ya viene hecho desde el despliegue cuando se define
 * BOOTSTRAP_TELEGRAM_CHAT_ID (ver bootstrap.ts), y esta ruta no llega a usarse.
 */
async function resolverUsuario(chatId: string) {
  const porChat = await usuariosRepo.porChatTelegram(pool, chatId);
  if (porChat) return porChat;

  const cuentas = await usuariosRepo.activos(pool);
  const unica = cuentas.length === 1 ? cuentas[0]! : null;
  if (!unica || unica.telegram_chat_id !== null) return null;

  await usuariosRepo.vincularTelegram(pool, unica.id, chatId);
  return { ...unica, telegram_chat_id: chatId };
}
