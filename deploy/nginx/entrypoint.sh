#!/bin/sh
# Preparacion del reverse proxy TLS (contenedor 05):
#   1. resuelve ${DOMINIO} en la plantilla de sitio;
#   2. activa la restauracion de IP real si se sirve detras de Cloudflare;
#   3. genera un certificado autofirmado si aun no hay uno montado, para que
#      nginx pueda arrancar y responder al reto ACME.
set -e

: "${DOMINIO:=localhost}"
: "${CONFIAR_EN_CLOUDFLARE:=false}"

envsubst '${DOMINIO}' \
  < /etc/nginx/plantillas/mylern.conf.template \
  > /etc/nginx/conf.d/default.conf

# --- IP real del visitante ---------------------------------------------------
# Detras de Cloudflare toda peticion llega con IP de Cloudflare. Sin restaurar
# la IP original, el limitador de caudal trataria a todos los visitantes como un
# unico origen y los registros no servirian para nada.
# Solo se activa de forma explicita: confiar en cabeceras de IP sin estar detras
# de un proxy conocido permitiria falsificar la IP y esquivar el limitador.
if [ "$CONFIAR_EN_CLOUDFLARE" = "true" ]; then
  cp /etc/nginx/plantillas/cloudflare-ips.conf /etc/nginx/conf.d/00-cloudflare.conf
  echo "[mylern] confianza en Cloudflare ACTIVADA: IP real desde CF-Connecting-IP"
else
  rm -f /etc/nginx/conf.d/00-cloudflare.conf
  echo "[mylern] confianza en Cloudflare desactivada (CONFIAR_EN_CLOUDFLARE=$CONFIAR_EN_CLOUDFLARE)"
fi

# --- material TLS ------------------------------------------------------------
mkdir -p /var/www/certbot /etc/nginx/certs
if [ ! -f /etc/nginx/certs/fullchain.pem ] || [ ! -f /etc/nginx/certs/privkey.pem ]; then
  echo "[mylern] sin certificado en /etc/nginx/certs: generando autofirmado para ${DOMINIO}"
  echo "[mylern] SOLO PARA ARRANCAR. Sustituyelo antes de exponer el sistema:"
  echo "[mylern]   - con Cloudflare: Origin Certificate (ver guia_despligue.md, 4.3)"
  echo "[mylern]   - sin Cloudflare: bash scripts/certificado.sh emitir"
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout /etc/nginx/certs/privkey.pem \
    -out    /etc/nginx/certs/fullchain.pem \
    -subj "/CN=${DOMINIO}" >/dev/null 2>&1
fi
