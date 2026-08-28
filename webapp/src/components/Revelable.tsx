import { useState, type ReactNode } from 'react';

/**
 * Patron de *Progressive Disclosure*: los detalles avanzados permanecen
 * plegados para evitar sobrecarga operativa y se despliegan bajo demanda
 * (procedimiento "manejando el conocimiento usando la app web", paso 2).
 */
export function Revelable({
  titulo, children, abiertoPorDefecto = false,
}: { titulo: string; children: ReactNode; abiertoPorDefecto?: boolean }) {
  const [abierto, setAbierto] = useState(abiertoPorDefecto);
  return (
    <section className="revelable">
      <button type="button" className="revelable-cabecera"
              aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <span className="chevron" aria-hidden>{abierto ? '▾' : '▸'}</span> {titulo}
      </button>
      {abierto && <div className="revelable-cuerpo">{children}</div>}
    </section>
  );
}
