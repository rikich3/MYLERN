import { useCallback, useEffect, useState } from 'react';
import { api, type Grafo, type Nodo, ErrorApi } from '../lib/api';
import { Lienzo } from '../components/Lienzo';
import { Aviso } from '../components/Aviso';
import { Revelable } from '../components/Revelable';

/** [feature 2.5] Creacion, enlace, navegacion visual y evaluacion del grafo. */
export function Grafos() {
  const [grafos, setGrafos] = useState<Grafo[]>([]);
  const [activo, setActivo] = useState<string | null>(null);
  const [nodos, setNodos] = useState<Nodo[]>([]);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'ok'; texto: string } | null>(null);

  const [nombreGrafo, setNombreGrafo] = useState('');
  const [contenido, setContenido] = useState('');
  const [enlace, setEnlace] = useState('');
  const [comoHijo, setComoHijo] = useState(true);

  const cargarGrafos = useCallback(async () => {
    const r = await api<{ grafos: Grafo[] }>('GET', '/api/v1/grafos');
    setGrafos(r.grafos);
    setActivo((prev) => prev ?? r.grafos[0]?.id ?? null);
  }, []);

  const cargarNodos = useCallback(async (grafoId: string) => {
    const r = await api<{ nodos: Nodo[] }>('GET', `/api/v1/grafos/${grafoId}`);
    setNodos(r.nodos);
  }, []);

  useEffect(() => { void cargarGrafos().catch(() => undefined); }, [cargarGrafos]);
  useEffect(() => { if (activo) void cargarNodos(activo).catch(() => undefined); }, [activo, cargarNodos]);

  const fallar = (e: unknown) =>
    setAviso({ tipo: 'error', texto: e instanceof ErrorApi ? e.message : 'Error inesperado' });

  async function crearGrafo(e: React.FormEvent) {
    e.preventDefault();
    try {
      const g = await api<Grafo>('POST', '/api/v1/grafos', { nombre: nombreGrafo });
      setNombreGrafo('');
      await cargarGrafos();
      setActivo(g.id);
      setAviso({ tipo: 'ok', texto: `Grafo "${g.nombre}" creado.` });
    } catch (e) { fallar(e); }
  }

  /** [PSC-INS-NODO] insertar_nodo con par atomico (parent_id, enlace_contenido). */
  async function insertarNodo(e: React.FormEvent) {
    e.preventDefault();
    if (!activo) return;
    const usaPadre = comoHijo && seleccionado !== null;
    if (usaPadre && enlace.trim() === '') {
      setAviso({ tipo: 'error', texto: 'El enlace es obligatorio cuando se define un padre (par atomico).' });
      return;
    }
    try {
      await api('POST', `/api/v1/grafos/${activo}/nodos`, {
        contenido,
        parent_id: usaPadre ? seleccionado : null,
        enlace_contenido: usaPadre ? enlace : null,
      });
      setContenido(''); setEnlace('');
      await cargarNodos(activo);
      setAviso({ tipo: 'ok', texto: 'Nodo insertado.' });
    } catch (e) { fallar(e); }
  }

  /** [LOG-ACICLICIDAD] el backend rechaza el reparenteo si generase un ciclo. */
  async function enlazar(hijoId: string, padreId: string) {
    const texto = window.prompt('Describe la relacion con el padre (enlace_contenido):');
    if (texto === null || texto.trim() === '') return;
    try {
      await api('PATCH', `/api/v1/nodos/${hijoId}/padre`, { parent_id: padreId, enlace_contenido: texto });
      if (activo) await cargarNodos(activo);
      setAviso({ tipo: 'ok', texto: 'Enlace establecido.' });
    } catch (e) { fallar(e); }
  }

  async function desconectar() {
    if (!seleccionado) return;
    try {
      await api('PATCH', `/api/v1/nodos/${seleccionado}/padre`, { parent_id: null, enlace_contenido: null });
      if (activo) await cargarNodos(activo);
      setAviso({ tipo: 'ok', texto: 'Nodo desconectado de su padre.' });
    } catch (e) { fallar(e); }
  }

  /** [PSC-DEL-NODO] baja logica preservando descendientes como raices. */
  async function eliminar() {
    if (!seleccionado) return;
    if (!window.confirm('Dar de baja el nodo? Sus hijos quedaran como raices del grafo.')) return;
    try {
      const r = await api<{ hijos_desvinculados: string[] }>('DELETE', `/api/v1/nodos/${seleccionado}`);
      setSeleccionado(null);
      if (activo) await cargarNodos(activo);
      setAviso({ tipo: 'ok', texto: `Nodo archivado; ${r.hijos_desvinculados.length} hijos preservados.` });
    } catch (e) { fallar(e); }
  }

  const nodoSel = nodos.find((n) => n.id === seleccionado) ?? null;
  const grafoSel = grafos.find((g) => g.id === activo) ?? null;

  return (
    <div className="pagina pagina-grafos">
      <header className="pagina-cabecera">
        <h2>Grafos de conocimiento</h2>
        <select value={activo ?? ''} onChange={(e) => { setActivo(e.target.value); setSeleccionado(null); }}>
          {grafos.map((g) => (
            <option key={g.id} value={g.id}>{g.nombre} ({g.total_nodos ?? 0})</option>
          ))}
          {grafos.length === 0 && <option value="">— sin grafos —</option>}
        </select>
      </header>

      {aviso && <Aviso tipo={aviso.tipo} texto={aviso.texto} onCerrar={() => setAviso(null)} />}

      <div className="grafos-cuerpo">
        <div className="grafos-lienzo">
          {activo
            ? <Lienzo nodos={nodos} seleccionado={seleccionado}
                      onSeleccionar={setSeleccionado} onEnlazar={enlazar} />
            : <p className="vacio">Crea un grafo para empezar.</p>}
        </div>

        <aside className="grafos-panel">
          <form className="tarjeta" onSubmit={crearGrafo}>
            <h3>Nuevo grafo</h3>
            <input value={nombreGrafo} required placeholder="Nombre del grafo"
                   onChange={(e) => setNombreGrafo(e.target.value)} />
            <button type="submit" className="primario">Crear</button>
          </form>

          {activo && (
            <form className="tarjeta" onSubmit={insertarNodo}>
              <h3>Insertar nodo</h3>
              <textarea value={contenido} required rows={2} placeholder="Contenido del concepto"
                        onChange={(e) => setContenido(e.target.value)} />
              <label className="check">
                <input type="checkbox" checked={comoHijo} disabled={seleccionado === null}
                       onChange={(e) => setComoHijo(e.target.checked)} />
                Colgar del nodo seleccionado
              </label>
              {comoHijo && seleccionado !== null && (
                <input value={enlace} placeholder="Enlace: relacion con el padre"
                       onChange={(e) => setEnlace(e.target.value)} />
              )}
              <button type="submit" className="primario">Insertar</button>
            </form>
          )}

          {nodoSel && (
            <div className="tarjeta">
              <h3>Nodo seleccionado</h3>
              <p><strong>{nodoSel.contenido}</strong></p>
              <dl className="detalle">
                <dt>etapa</dt><dd>{nodoSel.fase}</dd>
                <dt>hoja</dt><dd>{nodoSel.is_leaf ? 'si' : 'no'}</dd>
                <dt>hijos</dt><dd>{nodoSel.children_count ?? 0}</dd>
                <dt>enlace</dt><dd>{nodoSel.enlace_contenido ?? '—'}</dd>
              </dl>
              <Revelable titulo="Operaciones sobre el nodo">
                <div className="acciones">
                  <button type="button" onClick={desconectar} disabled={nodoSel.parent_id === null}>
                    Desconectar del padre
                  </button>
                  <button type="button" className="peligro" onClick={eliminar}>Dar de baja</button>
                </div>
                <p className="ayuda">
                  La baja es logica: el nodo queda archivado y sus hijos se preservan como
                  raices del grafo.
                </p>
              </Revelable>
            </div>
          )}

          {grafoSel && (
            <Revelable titulo="Agenda del grafo">
              <dl className="detalle">
                <dt>siguiente esfuerzo</dt><dd>indice {grafoSel.indice_siguiente_esfuerzo}</dd>
                <dt>cursor Round Robin</dt><dd>{grafoSel.cursor_rr}</dd>
                <dt>hojas</dt><dd>{grafoSel.total_hojas ?? 0}</dd>
              </dl>
              <p className="ayuda">
                Los grafos generan un esfuerzo cada 54–66 UE (9 a 11 horas) rotando
                por sus nodos hoja.
              </p>
            </Revelable>
          )}
        </aside>
      </div>
    </div>
  );
}
