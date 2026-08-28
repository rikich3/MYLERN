import { useCallback, useEffect, useState } from 'react';
import { api, sesion, type Evaluacion, type ItemEvaluacion, ErrorApi } from '../lib/api';
import { Aviso } from '../components/Aviso';

/**
 * [feature 2.5] Panel integrado de descarga y calificacion de evaluaciones
 * periodicas dominicales. [caso de uso 2, paso 2] ejecucion y autoevaluacion.
 */
export function Evaluaciones() {
  const [lista, setLista] = useState<Evaluacion[]>([]);
  const [abierta, setAbierta] = useState<Evaluacion | null>(null);
  const [items, setItems] = useState<ItemEvaluacion[]>([]);
  const [revelados, setRevelados] = useState<Set<string>>(new Set());
  const [historico, setHistorico] = useState<Array<{ semana_iso: string; puntaje: number }>>([]);
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'ok'; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    const r = await api<{ evaluaciones: Evaluacion[] }>('GET', '/api/v1/evaluaciones');
    setLista(r.evaluaciones);
    const h = await api<{ historico: Array<{ semana_iso: string; puntaje: number }> }>(
      'GET', '/api/v1/evaluaciones/retencion',
    );
    setHistorico(h.historico);
  }, []);

  useEffect(() => { void cargar().catch(() => undefined); }, [cargar]);

  async function abrir(e: Evaluacion) {
    const r = await api<{ evaluacion: Evaluacion; items: ItemEvaluacion[] }>(
      'GET', `/api/v1/evaluaciones/${e.id}`,
    );
    setAbierta(r.evaluacion);
    setItems(r.items);
    setRevelados(new Set());
  }

  async function generar() {
    try {
      const r = await api<{ evaluacion: Evaluacion; creada: boolean }>('POST', '/api/v1/evaluaciones/generar');
      await cargar();
      await abrir(r.evaluacion);
      setAviso({
        tipo: 'ok',
        texto: r.creada ? 'Evaluacion generada.' : 'La evaluacion de esta semana ya existia.',
      });
    } catch (e) {
      setAviso({ tipo: 'error', texto: e instanceof ErrorApi ? e.message : 'Error' });
    }
  }

  /** Autocalificacion: el fallo reagenda el nodo una etapa atras. */
  async function calificar(item: ItemEvaluacion, resultado: 'acierto' | 'fallo') {
    if (!abierta) return;
    try {
      const r = await api<{ evaluacion: Evaluacion; ajuste: { fase_nueva: string } | null }>(
        'POST', `/api/v1/evaluaciones/${abierta.id}/items/${item.id}`, { resultado },
      );
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, resultado } : i)));
      setAbierta(r.evaluacion);
      await cargar();
      if (r.ajuste) {
        setAviso({ tipo: 'ok', texto: `Nodo reagendado a ${r.ajuste.fase_nueva} para reforzar.` });
      }
    } catch (e) {
      setAviso({ tipo: 'error', texto: e instanceof ErrorApi ? e.message : 'Error' });
    }
  }

  /** Descarga del formato offline; el token viaja en el encabezado. */
  async function descargar(e: Evaluacion) {
    const res = await fetch(`/api/v1/evaluaciones/${e.id}/descargar`, {
      headers: { authorization: `Bearer ${sesion.token() ?? ''}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evaluacion-${e.semana_iso}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="pagina">
      <header className="pagina-cabecera">
        <h2>Evaluaciones</h2>
        <button type="button" className="primario" onClick={generar}>
          Generar la de esta semana
        </button>
      </header>

      {aviso && <Aviso tipo={aviso.tipo} texto={aviso.texto} onCerrar={() => setAviso(null)} />}

      {historico.length > 0 && (
        <div className="tarjeta retencion">
          <h3>Retencion historica</h3>
          <div className="sparkline" role="img" aria-label="Serie de puntajes de retencion">
            {[...historico].reverse().map((h) => (
              <div key={h.semana_iso} className="barra-vertical" title={`${h.semana_iso}: ${h.puntaje}%`}>
                <div style={{ height: `${Math.max(2, h.puntaje)}%` }} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="evaluaciones-cuerpo">
        <ul className="lista-evaluaciones">
          {lista.map((e) => (
            <li key={e.id} className={`tarjeta ${abierta?.id === e.id ? 'activa' : ''}`}>
              <button type="button" className="enlace" onClick={() => abrir(e)}>
                <strong>{e.semana_iso}</strong>
              </button>
              <span className={`pastilla ${e.estado}`}>{e.estado}</span>
              <span className="tenue">
                {e.aciertos}✓ / {e.fallos}✗ de {e.total_items}
                {e.puntaje !== null && ` · ${e.puntaje}%`}
              </span>
              <button type="button" onClick={() => descargar(e)}>Descargar</button>
            </li>
          ))}
          {lista.length === 0 && <li className="vacio">Aun no hay evaluaciones.</li>}
        </ul>

        {abierta && (
          <ol className="cuestionario">
            {items.map((item) => (
              <li key={item.id} className={`tarjeta item-${item.resultado}`}>
                <p className="premisa">{item.premisa}</p>
                {revelados.has(item.id)
                  ? <pre className="contraste">{item.contraste}</pre>
                  : (
                    <button type="button" className="enlace"
                            onClick={() => setRevelados((s) => new Set(s).add(item.id))}>
                      Revelar contraste
                    </button>
                  )}
                <div className="acciones">
                  <button type="button" className={item.resultado === 'acierto' ? 'activo' : ''}
                          onClick={() => calificar(item, 'acierto')}>Acierto</button>
                  <button type="button" className={item.resultado === 'fallo' ? 'activo peligro' : ''}
                          onClick={() => calificar(item, 'fallo')}>Fallo</button>
                </div>
              </li>
            ))}
            {items.length === 0 && (
              <li className="vacio">
                La evaluacion no tiene items: aun no hay nodos en fase 3 o 4.
              </li>
            )}
          </ol>
        )}
      </div>
    </div>
  );
}
