import { useCallback, useEffect, useState } from 'react';
import { api, type Oportunidad, type Solucion, ErrorApi } from '../lib/api';
import { Aviso } from '../components/Aviso';

const COLUMNAS = [
  { estado: 'backlog', titulo: 'Backlog' },
  { estado: 'en_progreso', titulo: 'En Progreso' },
  { estado: 'completado', titulo: 'Completado' },
] as const;

/** [caso de uso 3 "AVANZANDO MILERN"] registro, consolidacion y seguimiento. */
export function Mejoras() {
  const [oportunidades, setOportunidades] = useState<Oportunidad[]>([]);
  const [soluciones, setSoluciones] = useState<Solucion[]>([]);
  const [situacion, setSituacion] = useState('');
  const [observacion, setObservacion] = useState('');
  const [titulo, setTitulo] = useState('');
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'ok'; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const o = await api<{ oportunidades: Oportunidad[] }>('GET', '/api/v1/oportunidades');
    const s = await api<{ soluciones: Solucion[] }>('GET', '/api/v1/soluciones');
    setOportunidades(o.oportunidades);
    setSoluciones(s.soluciones);
  }, []);

  useEffect(() => { void cargar().catch(() => undefined); }, [cargar]);

  const fallar = (e: unknown) =>
    setAviso({ tipo: 'error', texto: e instanceof ErrorApi ? e.message : 'Error' });

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/api/v1/oportunidades', { situacion, observacion });
      setSituacion(''); setObservacion('');
      await cargar();
      setAviso({ tipo: 'ok', texto: 'Oportunidad registrada.' });
    } catch (e) { fallar(e); }
  }

  /** Vincula multiples observaciones bajo una propuesta formal de solucion. */
  async function consolidar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/api/v1/soluciones', { titulo, oportunidades: [...seleccion] });
      setTitulo(''); setSeleccion(new Set());
      await cargar();
      setAviso({ tipo: 'ok', texto: 'Solucion creada con las observaciones vinculadas.' });
    } catch (e) { fallar(e); }
  }

  async function mover(s: Solucion, estado: string) {
    try {
      await api('PATCH', `/api/v1/soluciones/${s.id}`, { estado });
      await cargar();
    } catch (e) { fallar(e); }
  }

  const sueltas = oportunidades.filter((o) => o.solucion_id === null);

  return (
    <div className="pagina">
      <header className="pagina-cabecera"><h2>Avance del sistema</h2></header>
      {aviso && <Aviso tipo={aviso.tipo} texto={aviso.texto} onCerrar={() => setAviso(null)} />}

      <div className="mejoras-cuerpo">
        <form className="tarjeta" onSubmit={registrar}>
          <h3>Registrar oportunidad</h3>
          <label>
            Situacion
            <input value={situacion} required maxLength={4000}
                   onChange={(e) => setSituacion(e.target.value)}
                   placeholder="Que ocurrio" />
          </label>
          <label>
            Observacion
            <textarea value={observacion} required rows={3} maxLength={8000}
                      onChange={(e) => setObservacion(e.target.value)}
                      placeholder="Que friccion de aprendizaje se detecto" />
          </label>
          <button type="submit" className="primario">Registrar</button>
        </form>

        <form className="tarjeta" onSubmit={consolidar}>
          <h3>Consolidar solucion</h3>
          <input value={titulo} required placeholder="Propuesta arquitectonica o metodologica"
                 onChange={(e) => setTitulo(e.target.value)} />
          <p className="ayuda">Selecciona las observaciones que esta solucion resuelve:</p>
          <ul className="lista-observaciones">
            {sueltas.map((o) => (
              <li key={o.id}>
                <label className="check">
                  <input type="checkbox" checked={seleccion.has(o.id)}
                         onChange={(e) => setSeleccion((prev) => {
                           const s = new Set(prev);
                           if (e.target.checked) s.add(o.id); else s.delete(o.id);
                           return s;
                         })} />
                  <span><strong>{o.situacion}</strong> — {o.observacion}</span>
                </label>
              </li>
            ))}
            {sueltas.length === 0 && <li className="vacio">Sin observaciones libres.</li>}
          </ul>
          <button type="submit" className="primario" disabled={seleccion.size === 0}>
            Crear solucion ({seleccion.size})
          </button>
        </form>
      </div>

      <div className="tablero">
        {COLUMNAS.map((col) => (
          <section key={col.estado} className="columna">
            <h3>{col.titulo}</h3>
            {soluciones.filter((s) => s.estado === col.estado).map((s) => (
              <article key={s.id} className="tarjeta solucion">
                <strong>{s.titulo}</strong>
                <span className="tenue">{s.total_observaciones} observaciones</span>
                <div className="acciones">
                  {COLUMNAS.filter((c) => c.estado !== s.estado).map((c) => (
                    <button key={c.estado} type="button" onClick={() => mover(s, c.estado)}>
                      → {c.titulo}
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {soluciones.filter((s) => s.estado === col.estado).length === 0 && (
              <p className="vacio">—</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
