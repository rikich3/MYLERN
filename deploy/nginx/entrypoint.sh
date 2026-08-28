#!/bin/sh
# Sustituye ${DOMINIO} en la plantilla y genera un certificado autofirmado si
# aun no hay uno real montado en /etc/nginx/certs (util para pruebas locales).
set -e

: "${DOMINIO:=localhost}"
envsubst '${DOMINIO}' \
  < /etc/nginx/plantillas/mylern.conf.template \
  > /etc/nginx/conf.d/default.conf

if [ ! -f /etc/nginx/certs/fullchain.pem ] || [ ! -f /etc/nginx/certs/privkey.pem ]; then
  echo "[mylern] sin certificado en /etc/nginx/certs: generando autofirmado para ${DOMINIO}"
  mkdir -p /etc/nginx/certs
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout /etc/nginx/certs/privkey.pem \
    -out    /etc/nginx/certs/fullchain.pem \
    -subj "/CN=${DOMINIO}" >/dev/null 2>&1
fi

mkdir -p /var/www/certbot
