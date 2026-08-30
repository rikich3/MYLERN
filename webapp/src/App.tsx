import { useEffect, useState } from 'react';
import { api, sesion } from './lib/api';
import { Ingreso } from './pages/Ingreso';
import { Nodos } from './pages/Nodos';
import { Grafos } from './pages/Grafos';
import { Evaluaciones } from './pages/Evaluaciones';
import { Mejoras } from './pages/Mejoras';

type Vista = 'nodos' | 'grafos' | 'evaluaciones' | 'mejoras';

const PESTANAS: Array<{ id: Vista; etiqueta: string; tecla: string }> = [
  { id: 'nodos', etiqueta: 'Nodos', tecla: '1' },
  { id: 'grafos', etiqueta: 'Grafos', tecla: '2' },
  { id: 'evaluaciones', etiqueta: 'Evaluaciones', tecla: '3' },
  { id: 'mejoras', etiqueta: 'Avance', tecla: '4' },
];

export function App() {
  const [autenticado, setAutenticado] = useState(sesion.token() !== null);
  const [vista, setVista] = useState<Vista>('nodos');
  const [perfil, setPerfil] = useState<{ email: string } | null>(null);

  useEffect(() => {
    if (!autenticado) { setPerfil(null); return; }
    void api<{ perfil: { email: string } }>('GET', '/api/v1/auth/perfil')
      .then((r) => setPerfil({ email: r.perfil.email }))
      .catch(() => setAutenticado(false));
  }, [autenticado]);

  // Navegacion rapida por teclado: Alt + numero de pestana.
  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (!e.altKey) return;
      const pestana = PESTANAS.find((p) => p.tecla === e.key);
      if (pestana) { e.preventDefault(); setVista(pestana.id); }
    }
    window.addEventListener('keydown', alTeclado);
    return () => window.removeEventListener('keydown', alTeclado);
  }, []);

  if (!autenticado) return <Ingreso onEntrar={() => setAutenticado(true)} />;

  return (
    <div className="app">
      <nav className="nav" aria-label="Secciones">
        <span className="marca">MILERN</span>
        {PESTANAS.map((p) => (
          <button key={p.id} type="button"
                  className={vista === p.id ? 'activo' : ''}
                  aria-current={vista === p.id}
                  onClick={() => setVista(p.id)}>
            {p.etiqueta} <kbd>alt+{p.tecla}</kbd>
          </button>
        ))}
        <span className="espaciador" />
        <span className="tenue">{perfil?.email}</span>
        <button type="button" className="enlace"
                onClick={() => { sesion.cerrar(); setAutenticado(false); }}>
          Salir
        </button>
      </nav>

      <main>
        {vista === 'nodos' && <Nodos />}
        {vista === 'grafos' && <Grafos />}
        {vista === 'evaluaciones' && <Evaluaciones />}
        {vista === 'mejoras' && <Mejoras />}
      </main>
    </div>
  );
}
