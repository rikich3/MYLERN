import { useState } from 'react';
import { api, sesion, ErrorApi } from '../lib/api';
import { Aviso } from '../components/Aviso';

/** [procedimiento "manejando el conocimiento usando la app web", paso 1] */
export function Ingreso({ onEntrar }: { onEntrar: () => void }) {
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const ruta = modo === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/registro';
      const r = await api<{ token: string }>('POST', ruta, { email, password });
      sesion.guardar(r.token);
      onEntrar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'Error de conexion');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="ingreso">
      <form className="tarjeta ingreso-form" onSubmit={enviar}>
        <h1>MILERN</h1>
        <p className="subtitulo">Repeticion espaciada y grafos de conocimiento</p>
        {error && <Aviso tipo="error" texto={error} onCerrar={() => setError(null)} />}
        <label>
          Correo
          <input type="email" value={email} required autoComplete="username"
                 onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contrasena
          <input type="password" value={password} required minLength={8}
                 autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
                 onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" className="primario" disabled={cargando}>
          {cargando ? 'Procesando…' : modo === 'login' ? 'Ingresar' : 'Crear cuenta'}
        </button>
        <button type="button" className="enlace"
                onClick={() => setModo(modo === 'login' ? 'registro' : 'login')}>
          {modo === 'login' ? 'No tengo cuenta' : 'Ya tengo cuenta'}
        </button>
      </form>
    </div>
  );
}
