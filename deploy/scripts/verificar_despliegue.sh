#!/usr/bin/env bash
# Comprobaciones posteriores al despliegue. No modifica estado.
set -uo pipefail

fallos=0
comprobar() {
  local etiqueta="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  [ok]    %s\n' "$etiqueta"
  else
    printf '  [FALLA] %s\n' "$etiqueta"
    fallos=$((fallos + 1))
  fi
}

echo "== contenedores =="
for c in milern-postgres milern-backend milern-n8n milern-webapp; do
  comprobar "$c en ejecucion" bash -c "docker ps --format '{{.Names}}' | grep -qx $c"
done
if docker ps --format '{{.Names}}' | grep -qx milern-proxy; then
  PROXY_PROPIO=1
  echo "  [ok]    milern-proxy en ejecucion (perfil proxy-propio)"
else
  PROXY_PROPIO=0
  echo "  [info]  milern-proxy no se usa: el enrutado lo hace un proxy externo"
fi

echo "== salud del backend =="
comprobar "backend responde /salud/listo" \
  docker exec milern-backend wget -qO- http://127.0.0.1:3000/salud/listo

echo "== base de datos =="
comprobar "tabla nodos existe" \
  docker exec milern-postgres psql -U "${PGUSER:-mylern}" -d "${PGDATABASE:-mylern}" -c 'SELECT 1 FROM nodos LIMIT 1'
comprobar "constraint del par atomico presente" \
  docker exec milern-postgres psql -U "${PGUSER:-mylern}" -d "${PGDATABASE:-mylern}" \
    -c "SELECT 1 FROM pg_constraint WHERE conname = 'chk_par_atomico'"
comprobar "trigger de aciclicidad presente" \
  docker exec milern-postgres psql -U "${PGUSER:-mylern}" -d "${PGDATABASE:-mylern}" \
    -c "SELECT 1 FROM pg_trigger WHERE tgname = 'tg_nodos_aciclicidad'"
comprobar "fases_config sembrada con 4 etapas" \
  docker exec milern-postgres psql -U "${PGUSER:-mylern}" -d "${PGDATABASE:-mylern}" \
    -c "SELECT 1 FROM fases_config HAVING count(*) = 4"

echo "== proxy =="
if [ "${PROXY_PROPIO:-0}" = "0" ]; then
  echo "  [info]  proxy externo: comprueba a mano https://$DOMINIO desde fuera"
fi
# Las comprobaciones del proxy se hacen desde el host: es la posicion de un
# cliente externo real. Requiere curl (--insecure admite el autofirmado local).
DOMINIO_LOCAL="${DOMINIO:-localhost}"

codigo_http() {
  curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "$1"
}

proxy_sirve_salud()   { [ "$(codigo_http "https://${DOMINIO_LOCAL}/salud")" = "200" ]; }
proxy_sirve_spa()     { [ "$(codigo_http "https://${DOMINIO_LOCAL}/")" = "200" ]; }
proxy_bloquea_interno() {
  [ "$(codigo_http "https://${DOMINIO_LOCAL}/api/v1/internal/despacho/estado")" = "403" ]
}
api_exige_token()     { [ "$(codigo_http "https://${DOMINIO_LOCAL}/api/v1/nodos")" = "401" ]; }

if [ "${PROXY_PROPIO:-0}" = "1" ] && command -v curl >/dev/null 2>&1; then
  comprobar "el proxy sirve /salud sobre HTTPS"          proxy_sirve_salud
  comprobar "el proxy sirve la SPA"                      proxy_sirve_spa
  comprobar "/api/v1/internal/* devuelve 403 desde fuera" proxy_bloquea_interno
  comprobar "la API exige token (401 sin credenciales)"  api_exige_token
elif [ "${PROXY_PROPIO:-0}" = "1" ]; then
  echo "  [aviso] curl no disponible: se omiten las comprobaciones del proxy"
fi

echo "== [feature 1.3] horas de silencio =="
if docker exec milern-backend node -e "1" >/dev/null 2>&1; then
  docker exec milern-backend node -e "
    const h = process.env.SILENCIO_HORA_INICIO || '22';
    const f = process.env.SILENCIO_HORA_FIN || '7';
    const z = process.env.ZONA_HORARIA || 'UTC';
    const act = (process.env.SILENCIO_ACTIVO || 'true') !== 'false';
    if (!act) { console.log('  [aviso] horas de silencio DESACTIVADAS'); process.exit(0); }
    const ahora = new Intl.DateTimeFormat('es-ES', { timeZone: z, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric', hour12: false }).format(new Date())) % 24;
    const dentro = Number(h) > Number(f) ? (hora >= Number(h) || hora < Number(f)) : (hora >= Number(h) && hora < Number(f));
    console.log('  ventana : ' + h + ':00 a ' + f + ':00 (' + z + ')');
    console.log('  ahora   : ' + ahora + ' -> ' + (dentro ? 'EN SILENCIO, no se envian esfuerzos' : 'fuera de la ventana, se envian esfuerzos'));
    console.log('  [!] comprueba que esa hora coincide con tu reloj; si no, ajusta ZONA_HORARIA');
  " 2>/dev/null || echo "  [aviso] no se pudo leer la configuracion de silencio"
fi

echo "== medidas de seguridad activas =="
if [ -n "${INTERNAL_API_SECRET:-}" ]; then
  echo "  [ok]    secreto interno ACTIVO en /api/v1/internal/*"
else
  echo "  [info]  secreto interno apagado (docs/seguridad_removida.md, punto 1)"
fi
if [ "${RATE_LIMIT_ACTIVO:-false}" = "true" ]; then
  echo "  [ok]    limitador de caudal ACTIVO"
else
  echo "  [info]  limitador de caudal apagado (docs/seguridad_removida.md, punto 2)"
fi
for p in "${PUERTO_API:-127.0.0.1:3000}" "${PUERTO_WEBAPP:-127.0.0.1:8080}" "${PUERTO_N8N:-127.0.0.1:5678}"; do
  case "$p" in
    127.0.0.1:*|localhost:*) echo "  [ok]    $p solo accesible desde el propio host" ;;
    *) echo "  [AVISO] $p esta publicado mas alla de 127.0.0.1: enciende INTERNAL_API_SECRET" ;;
  esac
done

echo "== certificado TLS =="
if [ "${PROXY_PROPIO:-0}" = "0" ]; then
  echo "  [info]  lo gestiona el proxy externo (Nginx Proxy Manager / Cloudflare)"
elif command -v docker >/dev/null 2>&1; then
  info_cert=$(docker exec milern-proxy openssl x509 -in /etc/nginx/certs/fullchain.pem \
                -noout -issuer -enddate 2>/dev/null || true)
  if [ -n "$info_cert" ]; then
    echo "$info_cert" | sed 's/^/  /'
    # Un autofirmado se reconoce porque emisor y sujeto coinciden.
    emisor=$(docker exec milern-proxy openssl x509 -in /etc/nginx/certs/fullchain.pem -noout -issuer 2>/dev/null)
    sujeto=$(docker exec milern-proxy openssl x509 -in /etc/nginx/certs/fullchain.pem -noout -subject 2>/dev/null)
    if [ "${emisor#issuer=}" = "${sujeto#subject=}" ]; then
      echo "  [aviso] es un certificado AUTOFIRMADO: Telegram rechazara el webhook."
      echo "          Instala uno real antes de exponer el sistema (guia_despligue.md, seccion 4)."
    else
      echo "  [ok]    certificado emitido por una autoridad externa"
    fi
  fi
fi

echo
if [ "$fallos" -eq 0 ]; then
  echo "verificacion completa: sin fallos"
else
  echo "verificacion completa: $fallos comprobacion(es) fallida(s)" >&2
  exit 1
fi
