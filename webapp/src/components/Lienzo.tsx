import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Nodo } from '../lib/api';
import { calcularLayout, limites, ANCHO_NODO, ALTO_NODO, type NodoPosicionado } from '../lib/grafo';

interface Props {
  nodos: Nodo[];
  seleccionado: string | null;
  onSeleccionar: (id: string | null) => void;
  onEnlazar: (hijoId: string, padreId: string) => void;
}

/**
 * [feature 2.5] Lienzo visual interactivo del grafo de conocimiento.
 * Soporta pan (arrastre), zoom (rueda) y navegacion rapida por teclado
 * (procedimiento "manejando el conocimiento usando la app web", paso 2).
 *
 * Teclas: flechas = moverse por la jerarquia | Enter = enfocar |
 *         Esc = deseleccionar | +/- = zoom | 0 = ajustar a la vista |
 *         l = enlazar el nodo seleccionado como hijo del siguiente clic.
 */
export function Lienzo({ nodos, seleccionado, onSeleccionar, onEnlazar }: Props) {
  const { nodos: ubicados, aristas } = useMemo(() => calcularLayout(nodos), [nodos]);
  const caja = useMemo(() => limites(ubicados), [ubicados]);

  const [escala, setEscala] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [modoEnlace, setModoEnlace] = useState(false);
  const arrastre = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const ajustar = useCallback(() => {
    setEscala(1);
    setPan({ x: -caja.minX, y: -caja.minY });
  }, [caja.minX, caja.minY]);

  useEffect(() => { ajustar(); }, [ajustar]);

  const porId = useMemo(() => new Map(ubicados.map((n) => [n.id, n])), [ubicados]);

  /** Navegacion por teclado sobre la jerarquia. */
  const navegar = useCallback((direccion: 'arriba' | 'abajo' | 'izq' | 'der') => {
    if (ubicados.length === 0) return;
    const actual = seleccionado ? porId.get(seleccionado) : undefined;
    if (!actual) { onSeleccionar(ubicados[0]!.id); return; }

    if (direccion === 'arriba' && actual.parent_id && porId.has(actual.parent_id)) {
      onSeleccionar(actual.parent_id);
      return;
    }
    if (direccion === 'abajo') {
      const hijo = ubicados
        .filter((n) => n.parent_id === actual.id)
        .sort((a, b) => a.x - b.x)[0];
      if (hijo) onSeleccionar(hijo.id);
      return;
    }
    // Hermanos ordenados por posicion horizontal.
    const hermanos = ubicados
      .filter((n) => n.parent_id === actual.parent_id)
      .sort((a, b) => a.x - b.x);
    const i = hermanos.findIndex((n) => n.id === actual.id);
    const destino = direccion === 'izq' ? hermanos[i - 1] : hermanos[i + 1];
    if (destino) onSeleccionar(destino.id);
  }, [ubicados, porId, seleccionado, onSeleccionar]);

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      const objetivo = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(objetivo.tagName)) return;

      switch (e.key) {
        case 'ArrowUp':    e.preventDefault(); navegar('arriba'); break;
        case 'ArrowDown':  e.preventDefault(); navegar('abajo'); break;
        case 'ArrowLeft':  e.preventDefault(); navegar('izq'); break;
        case 'ArrowRight': e.preventDefault(); navegar('der'); break;
        case 'Escape':     onSeleccionar(null); setModoEnlace(false); break;
        case '+': case '=': setEscala((s) => Math.min(2.5, s * 1.2)); break;
        case '-':           setEscala((s) => Math.max(0.25, s / 1.2)); break;
        case '0':           ajustar(); break;
        case 'l': case 'L': if (seleccionado) setModoEnlace((v) => !v); break;
      }
    }
    window.addEventListener('keydown', alTeclado);
    return () => window.removeEventListener('keydown', alTeclado);
  }, [navegar, onSeleccionar, ajustar, seleccionado]);

  function alClicNodo(n: NodoPosicionado) {
    if (modoEnlace && seleccionado && seleccionado !== n.id) {
      onEnlazar(seleccionado, n.id);
      setModoEnlace(false);
      return;
    }
    onSeleccionar(n.id);
  }

  return (
    <div className="lienzo">
      <div className="lienzo-barra">
        <span className="pista">
          ↑↓←→ navegar · <kbd>l</kbd> enlazar · <kbd>+</kbd>/<kbd>-</kbd> zoom · <kbd>0</kbd> ajustar · <kbd>Esc</kbd> salir
        </span>
        {modoEnlace && <span className="aviso-enlace">Modo enlace: elige el nodo PADRE</span>}
        <span className="contador">{nodos.length} nodos</span>
      </div>
      <svg
        ref={svgRef}
        className="lienzo-svg"
        role="application"
        aria-label="Lienzo del grafo de conocimiento"
        onWheel={(e) => {
          const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          setEscala((s) => Math.min(2.5, Math.max(0.25, s * factor)));
        }}
        onPointerDown={(e) => {
          if (e.target === svgRef.current) {
            arrastre.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
            (e.target as Element).setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          const a = arrastre.current;
          if (!a) return;
          setPan({ x: a.panX + (e.clientX - a.x) / escala, y: a.panY + (e.clientY - a.y) / escala });
        }}
        onPointerUp={() => { arrastre.current = null; }}
        onClick={(e) => { if (e.target === svgRef.current) onSeleccionar(null); }}
      >
        <defs>
          <marker id="flecha" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="flecha" />
          </marker>
        </defs>

        <g transform={`scale(${escala}) translate(${pan.x}, ${pan.y})`}>
          {aristas.map((a) => {
            const x1 = a.desde.x + ANCHO_NODO / 2;
            const y1 = a.desde.y + ALTO_NODO;
            const x2 = a.hacia.x + ANCHO_NODO / 2;
            const y2 = a.hacia.y;
            const ym = (y1 + y2) / 2;
            return (
              <g key={`${a.desde.id}-${a.hacia.id}`} className="arista">
                <path d={`M ${x1} ${y1} C ${x1} ${ym}, ${x2} ${ym}, ${x2} ${y2}`}
                      markerEnd="url(#flecha)" />
                {a.etiqueta && (
                  <text x={(x1 + x2) / 2} y={ym - 4} textAnchor="middle" className="arista-etiqueta">
                    {a.etiqueta.length > 26 ? `${a.etiqueta.slice(0, 25)}…` : a.etiqueta}
                  </text>
                )}
              </g>
            );
          })}

          {ubicados.map((n) => (
            <g key={n.id}
               transform={`translate(${n.x}, ${n.y})`}
               className={[
                 'nodo',
                 n.is_leaf ? 'es-hoja' : '',
                 seleccionado === n.id ? 'seleccionado' : '',
               ].join(' ')}
               tabIndex={0}
               role="button"
               aria-label={n.contenido}
               onClick={() => alClicNodo(n)}
               onKeyDown={(e) => { if (e.key === 'Enter') alClicNodo(n); }}>
              <rect width={ANCHO_NODO} height={ALTO_NODO} rx={10} />
              <text x={10} y={22} className="nodo-titulo">
                {n.contenido.length > 24 ? `${n.contenido.slice(0, 23)}…` : n.contenido}
              </text>
              <text x={10} y={42} className="nodo-meta">
                {n.fase} · {n.is_leaf ? 'hoja' : `${n.children_count ?? 0} hijos`}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
