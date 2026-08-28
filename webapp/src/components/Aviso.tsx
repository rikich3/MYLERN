export function Aviso({ tipo, texto, onCerrar }: {
  tipo: 'error' | 'ok' | 'info';
  texto: string;
  onCerrar?: () => void;
}) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <span>{texto}</span>
      {onCerrar && <button type="button" className="aviso-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>}
    </div>
  );
}
