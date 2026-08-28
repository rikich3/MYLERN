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
for c in milern-postgres milern-backend milern-n8n milern-webapp milern-proxy; do
  comprobar "$c en ejecucion" bash -c "docker ps --format '{{.Names}}' | grep -qx $c"
done

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

if command -v curl >/dev/null 2>&1; then
  comprobar "el proxy sirve /salud sobre HTTPS"          proxy_sirve_salud
  comprobar "el proxy sirve la SPA"                      proxy_sirve_spa
  comprobar "/api/v1/internal/* devuelve 403 desde fuera" proxy_bloquea_interno
  comprobar "la API exige token (401 sin credenciales)"  api_exige_token
else
  echo "  [aviso] curl no disponible: se omiten las comprobaciones del proxy"
fi

echo "== certificado TLS =="
if command -v docker >/dev/null 2>&1; then
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

echo "== proxy de entrada =="
if [ "${CONFIAR_EN_CLOUDFLARE:-false}" = "true" ]; then
  comprobar "rangos de Cloudflare cargados en nginx" \
    docker exec milern-proxy test -f /etc/nginx/conf.d/00-cloudflare.conf
  echo "  [info]  CONFIAR_EN_CLOUDFLARE=true: la IP real se toma de CF-Connecting-IP"
else
  echo "  [info]  CONFIAR_EN_CLOUDFLARE=false: nginx usa la IP de conexion directa"
fi

echo
if [ "$fallos" -eq 0 ]; then
  echo "verificacion completa: sin fallos"
else
  echo "verificacion completa: $fallos comprobacion(es) fallida(s)" >&2
  exit 1
fi
