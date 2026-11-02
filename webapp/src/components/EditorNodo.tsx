import { useState } from 'react';
import { api, type Nodo } from '../lib/api';

interface Props {
  nodo: Nodo;
  /** Permite editar tambien el enlace con el padre (solo dentro de un grafo). */
  conEnlace?: boolean;
  onGuardado: (nodo: Nodo) => void | Promise<void>;
  onCancelar: () => void;
  onError: (e: unknown) => void;
}

/**
 * Edicion del contenido de un nodo: frente (`nodo_esfuerzo`), reverso
 * (`nodo_crudo`) y, si tiene padre, el `enlace_contenido`. El cambio queda en el
 * log de transacciones y es reversible con `undo`.
 */
export function EditorNodo({ nodo, conEnlace = false, onGuardado, onCancelar, onError }: Props) {
  const [esfuerzo, setEsfuerzo] = useState(nodo.nodo_esfuerzo);
  const [crudo, setCrudo] = useState(nodo.nodo_crudo ?? '');
  const [enlace, setEnlace] = useState(nodo.enlace_contenido ?? '');
  const [guardando, setGuardando] = useState(false);

  const editaEnlace = conEnlace && nodo.parent_id !== null;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (esfuerzo.trim() === '') return;
    if (editaEnlace && enlace.trim() === '') {
      onError(new Error('El enlace es obligatorio mientras el nodo tenga padre (par atomico).'));
      return;
    }
    setGuardando(true);
    try {
      let actualizado = nodo;
      if (esfuerzo !== nodo.nodo_esfuerzo || crudo !== (nodo.nodo_crudo ?? '')) {
        actualizado = await api<Nodo>('PATCH', `/api/v1/nodos/${nodo.id}`, {
          nodo_esfuerzo: esfuerzo.trim(),
          nodo_crudo: crudo.trim() === '' ? null : crudo,
        });
      }
      if (editaEnlace && enlace !== (nodo.enlace_contenido ?? '')) {
        actualizado = await api<Nodo>('PATCH', `/api/v1/nodos/${nodo.id}/padre`, {
          parent_id: nodo.parent_id,
          enlace_contenido: enlace.trim(),
        });
      }
      await onGuardado(actualizado);
    } catch (err) {
      onError(err);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="editor-nodo" onSubmit={guardar}>
      <label>
        Esfuerzo <span className="ayuda">frente: oculta la parte clave</span>
        <input value={esfuerzo} required maxLength={4000}
               onChange={(e) => setEsfuerzo(e.target.value)} />
      </label>
      <label>
        Contenido crudo <span className="ayuda">reverso; vacio = se usa el esfuerzo</span>
        <textarea value={crudo} rows={3} maxLength={20000}
                  onChange={(e) => setCrudo(e.target.value)} />
      </label>
      {editaEnlace && (
        <label>
          Enlace <span className="ayuda">relacion con el padre</span>
          <input value={enlace} required maxLength={2000}
                 onChange={(e) => setEnlace(e.target.value)} />
        </label>
      )}
      <div className="acciones">
        <button type="submit" className="primario" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      </div>
    </form>
  );
}
