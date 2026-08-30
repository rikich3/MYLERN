import { useEffect, useState } from 'react';
import { api, type Nodo, type Fase, ErrorApi } from '../lib/api';
import { Aviso } from '../components/Aviso';
import { Revelable } from '../components/Revelable';

const ETIQUETA_FASE: Record<Fase, string> = {
  fase_1: '1 · ~24 h',
  fase_2: '2 · ~1 semana',
  fase_3: '3 · ~3 semanas',
  fase_4: '4 · reserva',
  archivado: 'archivado',
};

const UMBRAL: Record<string, number> = { fase_1: 36, fase_2: 84, fase_3: 108 };

function convertirIndiceAHoraLima(indice: number): string {
  const fecha = new Date(indice * 600 * 1000);
  return fecha.toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function Nodos() {
  const [nodos, setNodos] = useState<Nodo[]>([]);
  const [stats, setStats] = useState<{ total: number; por_fase: Array<{ fase: Fase; total: number }>; indice_global: number } | null>(null);
  const [indiceGlobalActual, setIndiceGlobalActual] = useState<number>(() => Math.floor(Date.now() / 1000 / 600));
  const [esfuerzo, setEsfuerzo] = useState('');
  const [crudo, setCrudo] = useState('');
  const [fecha, setFecha] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtroFase, setFiltroFase] = useState<Fase | ''>('');
  const [mostrarDetalles, setMostrarDetalles] = useState(false);
  const [detallesExpandidos, setDetallesExpandidos] = useState<Record<string, boolean>>({});
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'ok'; texto: string } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndiceGlobalActual(Math.floor(Date.now() / 1000 / 600));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  async function recargar() {
    const q = new URLSearchParams({ activo: 'true', limite: '100' });
    if (busqueda) q.set('busqueda', busqueda);
    if (filtroFase) q.set('fase', filtroFase);
    const r = await api<{ nodos: Nodo[] }>('GET', `/api/v1/nodos?${q}`);
    setNodos(r.nodos);
    setStats(await api('GET', '/api/v1/nodos/estadisticas'));
  }

  useEffect(() => { void recargar().catch(() => undefined); }, [busqueda, filtroFase]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('POST', '/api/v1/nodos', {
        nodo_esfuerzo: esfuerzo,
        nodo_crudo: crudo === '' ? null : crudo,
        fecha_limite: fecha === '' ? null : fecha,
      });
      setEsfuerzo(''); setCrudo(''); setFecha('');
      setAviso({ tipo: 'ok', texto: 'Nodo registrado en fase 1.' });
      await recargar();
    } catch (err) {
      setAviso({ tipo: 'error', texto: err instanceof ErrorApi ? err.message : 'Error' });
    }
  }

  async function eliminarNodo(id: string) {
    if (!window.confirm('¿Seguro que deseas eliminar (desactivar) este nodo?')) return;
    try {
      await api('DELETE', `/api/v1/nodos/${id}`);
      setAviso({ tipo: 'ok', texto: 'Nodo desactivado (dado de baja).' });
      await recargar();
    } catch (err) {
      setAviso({ tipo: 'error', texto: err instanceof ErrorApi ? err.message : 'Error al eliminar nodo' });
    }
  }

  const toggleDetalleNodo = (id: string) => {
    setDetallesExpandidos((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="pagina">
      <header className="pagina-cabecera">
        <h2>Nodos</h2>
        <div className="metricas">
          {stats && (
            <>
              <span className="metrica"><b>{stats.total}</b> activos</span>
              {stats.por_fase.map((f) => (
                <span key={f.fase} className={`pastilla ${f.fase}`}>{ETIQUETA_FASE[f.fase]}: {f.total}</span>
              ))}
            </>
          )}
          <span className="metrica tenue">indice global en vivo: <b>{indiceGlobalActual}</b></span>
        </div>
      </header>

      {aviso && <Aviso tipo={aviso.tipo} texto={aviso.texto} onCerrar={() => setAviso(null)} />}

      <form className="tarjeta formulario-nodo" onSubmit={crear}>
        <label>
          Esfuerzo <span className="ayuda">frente: oculta la parte clave</span>
          <input value={esfuerzo} required maxLength={4000}
                 onChange={(e) => setEsfuerzo(e.target.value)}
                 placeholder="Teorema de Bayes" />
        </label>
        <label>
          Contenido crudo <span className="ayuda">reverso: el dato completo</span>
          <textarea value={crudo} rows={2} maxLength={20000}
                    onChange={(e) => setCrudo(e.target.value)}
                    placeholder="Formula que invierte la probabilidad condicional…" />
        </label>
        <Revelable titulo="Opciones avanzadas">
          <label>
            Fecha limite <span className="ayuda">convierte el nodo en temporal</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
        </Revelable>
        <button type="submit" className="primario">Registrar nodo</button>
      </form>

      <div className="filtros">
        <input placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <select value={filtroFase} onChange={(e) => setFiltroFase(e.target.value as Fase | '')}>
          <option value="">Todas las etapas</option>
          {(['fase_1', 'fase_2', 'fase_3', 'fase_4'] as Fase[]).map((f) => (
            <option key={f} value={f}>{ETIQUETA_FASE[f]}</option>
          ))}
        </select>
        <button type="button" onClick={() => setMostrarDetalles(!mostrarDetalles)}>
          {mostrarDetalles ? 'Ocultar detalles' : 'Mostrar detalles'}
        </button>
      </div>

      <ul className="lista-nodos">
        {nodos.map((n) => {
          const umbral = UMBRAL[n.fase];
          const avance = umbral ? Math.min(100, (n.conteo_esfuerzo_fase / umbral) * 100) : 100;
          const verDetalle = mostrarDetalles || Boolean(detallesExpandidos[n.id]);
          return (
            <li key={n.id} className="tarjeta nodo-tarjeta">
              <div className="nodo-fila">
                <div className="nodo-fila-texto">
                  <strong>{n.nodo_esfuerzo}</strong>
                  {n.nodo_crudo && <p className="tenue">{n.nodo_crudo}</p>}
                </div>
                <div className="nodo-fila-meta">
                  <span className={`pastilla ${n.fase}`}>{ETIQUETA_FASE[n.fase]}</span>
                  {n.es_temporal && <span className="pastilla temporal">temporal</span>}
                  <span className="tenue">{n.conteo_esfuerzo_fase}{umbral ? `/${umbral}` : ''} esfuerzos</span>
                  <div className="barra" aria-label={`avance ${Math.round(avance)}%`}>
                    <div className="barra-relleno" style={{ width: `${avance}%` }} />
                  </div>
                  <button type="button" onClick={() => toggleDetalleNodo(n.id)}>
                    {verDetalle ? 'Ocultar' : 'Detalles'}
                  </button>
                  <button type="button" className="peligro" onClick={() => eliminarNodo(n.id)} title="Dar de baja el nodo">
                    Eliminar
                  </button>
                </div>
              </div>

              {verDetalle && (
                <div className="revelable-cuerpo" style={{ borderTop: '1px solid var(--borde)', paddingTop: '8px' }}>
                  <dl className="detalle">
                    <dt>id</dt><dd><code>{n.id}</code></dd>
                    <dt>siguiente esfuerzo (indice global)</dt><dd><b>{n.indice_siguiente_esfuerzo}</b></dd>
                    <dt>siguiente esfuerzo (America/Lima)</dt><dd><b>{convertirIndiceAHoraLima(n.indice_siguiente_esfuerzo)}</b> (America/Lima)</dd>
                    <dt>conteo de esfuerzos</dt><dd>{n.conteo_esfuerzo} total ({n.conteo_esfuerzo_fase} en esta etapa)</dd>
                    {n.indice_fecha_limite !== null && (
                      <>
                        <dt>fecha limite (indice)</dt><dd>{n.indice_fecha_limite}</dd>
                        <dt>fecha limite (America/Lima)</dt><dd>{convertirIndiceAHoraLima(n.indice_fecha_limite)} (America/Lima)</dd>
                      </>
                    )}
                    {n.grafo_id && (
                      <>
                        <dt>grafo id</dt><dd><code>{n.grafo_id}</code></dd>
                      </>
                    )}
                  </dl>
                </div>
              )}
            </li>
          );
        })}
        {nodos.length === 0 && <li className="vacio">Sin nodos que coincidan.</li>}
      </ul>
    </div>
  );
}

