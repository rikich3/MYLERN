#!/usr/bin/env node
/**
 * mylern-cli -- operacion guiada via API sobre el backend centralizado.
 *
 * Permite operaciones estructuradas de alta velocidad: insercion masiva,
 * consulta de nodos y reparacion de enlaces, con comando `undo` soportado a
 * nivel log de transacciones.
 */
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { api, guardarConfig, iniciarSesion } from './api.js';

const AYUDA = `mylern-cli -- cliente de terminal de MILERN

  login <url> [correo]              inicia sesion con correo y contrasena
  config <url> <token>              guarda un API Token ya emitido
  add "<esfuerzo> | <crudo> | <fecha>"   registra un nodo
  import <archivo>                  insercion masiva (una linea por nodo)
  ls [--fase X] [--q texto] [--limite N]   lista nodos
  show <nodo_id>                    detalle de un nodo
  stats                             nodos por etapa e indice global
  graphs                            lista los grafos de conocimiento
  graph <grafo_id>                  vuelca un grafo como adjacency list
  gnew <nombre>                     crea un grafo de conocimiento
  gadd <grafo_id> "<contenido>" [--padre <id> --enlace "<texto>"]
                                    inserta un nodo en el grafo
  link <nodo_id> <padre_id> "<enlace>"     reparentea (valida aciclicidad)
  unlink <nodo_id>                  desconecta el nodo de su padre
  rm <nodo_id>                      baja logica con desvinculacion huerfana segura
  log [--limite N]                  historial del log de transacciones
  undo                              revierte la ultima operacion reversible
  eval [--id <uuid>]                lista o descarga la evaluacion semanal
  help                              esta ayuda
`;

type Args = { _: string[]; [k: string]: string | boolean | string[] };

function parsearArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const clave = a.slice(2);
      const sig = argv[i + 1];
      if (sig === undefined || sig.startsWith('--')) out[clave] = true;
      else { out[clave] = sig; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const tabla = (filas: Record<string, unknown>[]): string => {
  if (filas.length === 0) return '(sin resultados)';
  return filas.map((f) => Object.entries(f).map(([k, v]) => `${k}=${String(v)}`).join('  ')).join('\n');
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const comando = argv[0] ?? 'help';
  const args = parsearArgs(argv.slice(1));
  const pos = args._;

  switch (comando) {
    case 'help': case '--help': case '-h':
      process.stdout.write(AYUDA);
      return;

    case 'login': {
      const [url, correoArg] = pos;
      if (!url) throw new Error('Uso: mylern-cli login <url> [correo]');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const correo = correoArg ?? (await rl.question('correo: '));
        // La contrasena se pide por stdin: no queda en el historial del shell.
        const password = await rl.question('contrasena: ');
        await iniciarSesion(url, correo.trim(), password);
      } finally {
        rl.close();
      }
      console.log('sesion iniciada');
      return;
    }

    case 'config': {
      const [url, token] = pos;
      if (!url || !token) throw new Error('Uso: mylern-cli config <url> <token>');
      const ruta = await guardarConfig({ base_url: url, token });
      console.log(`Configuracion guardada en ${ruta}`);
      return;
    }

    case 'add': {
      const linea = pos.join(' ');
      if (linea === '') throw new Error('Uso: mylern-cli add "<esfuerzo> | <crudo> | <fecha>"');
      const r = await api<{ creados: number; nodos: Array<{ id: string; nodo_esfuerzo: string }> }>(
        'POST', '/api/v1/nodos/lote', { lineas: [linea] },
      );
      console.log(`creado ${r.nodos[0]!.id}  ${r.nodos[0]!.nodo_esfuerzo}`);
      return;
    }

    /** Insercion masiva: una linea por nodo, formato identico al de Telegram. */
    case 'import': {
      const archivo = pos[0];
      if (!archivo) throw new Error('Uso: mylern-cli import <archivo>');
      const lineas = (await readFile(archivo, 'utf8'))
        .split('\n').map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#'));
      if (lineas.length === 0) throw new Error('El archivo no contiene lineas utiles.');

      // Se envia en bloques para no exceder el limite del endpoint (500/lote).
      let total = 0;
      for (let i = 0; i < lineas.length; i += 500) {
        const bloque = lineas.slice(i, i + 500);
        const r = await api<{ creados: number }>('POST', '/api/v1/nodos/lote', { lineas: bloque });
        total += r.creados;
        console.log(`bloque ${i / 500 + 1}: ${r.creados} nodos`);
      }
      console.log(`total insertado: ${total}`);
      return;
    }

    case 'ls': {
      const q = new URLSearchParams();
      if (typeof args.fase === 'string') q.set('fase', args.fase);
      if (typeof args.q === 'string') q.set('busqueda', args.q);
      q.set('limite', typeof args.limite === 'string' ? args.limite : '30');
      q.set('activo', 'true');
      const r = await api<{ nodos: Array<Record<string, unknown>> }>('GET', `/api/v1/nodos?${q}`);
      console.log(tabla(r.nodos.map((n) => ({
        id: n.id, fase: n.fase, n: n.conteo_esfuerzo_fase, esfuerzo: n.nodo_esfuerzo,
      }))));
      return;
    }

    case 'show': {
      if (!pos[0]) throw new Error('Uso: mylern-cli show <nodo_id>');
      console.log(JSON.stringify(await api('GET', `/api/v1/nodos/${pos[0]}`), null, 2));
      return;
    }

    case 'stats':
      console.log(JSON.stringify(await api('GET', '/api/v1/nodos/estadisticas'), null, 2));
      return;

    case 'graphs': {
      const r = await api<{ grafos: Array<Record<string, unknown>> }>('GET', '/api/v1/grafos');
      console.log(tabla(r.grafos.map((g) => ({
        id: g.id, nombre: g.nombre, nodos: g.total_nodos, hojas: g.total_hojas,
        siguiente: g.indice_siguiente_esfuerzo, rr: g.cursor_rr,
      }))));
      return;
    }

    case 'graph': {
      if (!pos[0]) throw new Error('Uso: mylern-cli graph <grafo_id>');
      const r = await api<{ nodos: Array<Record<string, unknown>> }>('GET', `/api/v1/grafos/${pos[0]}`);
      console.log(tabla(r.nodos.map((n) => ({
        id: n.id, padre: n.parent_id ?? '-', enlace: n.enlace_contenido ?? '-',
        hoja: n.is_leaf, contenido: n.contenido,
      }))));
      return;
    }

    case 'gnew': {
      const nombre = pos.join(' ');
      if (nombre === '') throw new Error('Uso: mylern-cli gnew <nombre>');
      const g = await api<{ id: string }>('POST', '/api/v1/grafos', { nombre });
      console.log(`grafo creado ${g.id}`);
      return;
    }

    case 'gadd': {
      const [grafoId, ...resto] = pos;
      const contenido = resto.join(' ');
      if (!grafoId || contenido === '') {
        throw new Error('Uso: mylern-cli gadd <grafo_id> "<contenido>" [--padre <id> --enlace "<texto>"]');
      }
      const padre = typeof args.padre === 'string' ? args.padre : null;
      const enlace = typeof args.enlace === 'string' ? args.enlace : null;
      if ((padre === null) !== (enlace === null)) {
        throw new Error('--padre y --enlace forman un par atomico: usa ambos o ninguno.');
      }
      const n = await api<{ id: string }>('POST', `/api/v1/grafos/${grafoId}/nodos`, {
        contenido, parent_id: padre, enlace_contenido: enlace,
      });
      console.log(`nodo insertado ${n.id}`);
      return;
    }

    /** Reparacion de enlaces: reparenteo validado contra ciclos. */
    case 'link': {
      const [nodoId, padreId, ...resto] = pos;
      const enlace = resto.join(' ');
      if (!nodoId || !padreId || enlace === '') {
        throw new Error('Uso: mylern-cli link <nodo_id> <padre_id> "<enlace>"');
      }
      await api('PATCH', `/api/v1/nodos/${nodoId}/padre`, { parent_id: padreId, enlace_contenido: enlace });
      console.log(`enlace establecido: ${nodoId} -> ${padreId}`);
      return;
    }

    case 'unlink': {
      if (!pos[0]) throw new Error('Uso: mylern-cli unlink <nodo_id>');
      await api('PATCH', `/api/v1/nodos/${pos[0]}/padre`, { parent_id: null, enlace_contenido: null });
      console.log(`nodo ${pos[0]} desconectado de su padre`);
      return;
    }

    case 'rm': {
      if (!pos[0]) throw new Error('Uso: mylern-cli rm <nodo_id>');
      const r = await api<{ hijos_desvinculados: string[] }>('DELETE', `/api/v1/nodos/${pos[0]}`);
      console.log(`nodo dado de baja; hijos preservados como raices: ${r.hijos_desvinculados.length}`);
      return;
    }

    case 'log': {
      const limite = typeof args.limite === 'string' ? args.limite : '20';
      const r = await api<{ transacciones: Array<Record<string, unknown>> }>(
        'GET', `/api/v1/transacciones?limite=${limite}`,
      );
      console.log(tabla(r.transacciones.map((t) => ({
        id: t.id, op: t.operacion, entidad: t.entidad, ref: t.entidad_id ?? '-',
        deshecha: t.deshecha, fecha: t.creado_en,
      }))));
      return;
    }

    case 'undo': {
      const r = await api<{ detalle: string }>('POST', '/api/v1/transacciones/undo');
      console.log(r.detalle);
      return;
    }

    case 'eval': {
      if (typeof args.id === 'string') {
        const r = await api<{ evaluacion: Record<string, unknown>; items: Array<Record<string, unknown>> }>(
          'GET', `/api/v1/evaluaciones/${args.id}`,
        );
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      const r = await api<{ evaluaciones: Array<Record<string, unknown>> }>('GET', '/api/v1/evaluaciones');
      console.log(tabla(r.evaluaciones.map((e) => ({
        id: e.id, semana: e.semana_iso, estado: e.estado,
        items: e.total_items, aciertos: e.aciertos, fallos: e.fallos, puntaje: e.puntaje ?? '-',
      }))));
      return;
    }

    default:
      process.stderr.write(`Comando desconocido: ${comando}\n\n${AYUDA}`);
      process.exitCode = 2;
  }
}

main().catch((e: Error) => {
  process.stderr.write(`error: ${e.message}\n`);
  process.exitCode = 1;
});
