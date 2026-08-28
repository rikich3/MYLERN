#!/usr/bin/env bash
# Refresca deploy/nginx/cloudflare-ips.conf desde el origen oficial.
# Cloudflare cambia estos rangos muy rara vez; ejecutalo si el registro del
# proxy empieza a mostrar IPs de Cloudflare como IP de cliente.
set -euo pipefail

DESTINO="$(dirname "$0")/../nginx/cloudflare-ips.conf"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

{
  echo "# Rangos de IP de Cloudflare."
  echo "# Generado por actualizar_ips_cloudflare.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# Fuente: https://www.cloudflare.com/ips-v4 y https://www.cloudflare.com/ips-v6"
  echo
  curl -fsS https://www.cloudflare.com/ips-v4 | sed 's|^|set_real_ip_from |; s|$|;|'
  echo
  curl -fsS https://www.cloudflare.com/ips-v6 | sed 's|^|set_real_ip_from |; s|$|;|'
  echo
  echo "real_ip_header CF-Connecting-IP;"
  echo "real_ip_recursive on;"
} > "$TMP"

# No se sobrescribe el archivo bueno si la descarga vino vacia o incompleta.
if [ "$(grep -c set_real_ip_from "$TMP")" -lt 10 ]; then
  echo "error: la descarga devolvio menos rangos de los esperados; no se toca el archivo" >&2
  exit 1
fi

mv "$TMP" "$DESTINO"
trap - EXIT
echo "actualizado $DESTINO ($(grep -c set_real_ip_from "$DESTINO") rangos)"
echo "aplica el cambio con:  docker compose --env-file .env up -d --build proxy"
