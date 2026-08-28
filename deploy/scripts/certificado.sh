#!/usr/bin/env bash
# ============================================================================
# Ciclo de vida del certificado TLS de Let's Encrypt (contenedor 05).
#
#   certificado.sh emitir    primera emision
#   certificado.sh renovar   renovacion (idempotente, apta para cron)
#   certificado.sh estado    fecha de caducidad del certificado en uso
#
# Usa el metodo webroot: nginx sigue en pie durante todo el proceso y sirve el
# reto ACME desde /.well-known/acme-challenge/. No hace falta liberar el puerto
# 80 ni detener el sistema.
#
# Si sirves detras de Cloudflare NO necesitas este script: usa un Origin
# Certificate (15 anios, sin renovacion). Ver guia_despligue.md, seccion 4.3.
# ============================================================================
set -euo pipefail

# El subcomando se valida ANTES de cargar el entorno: si no, un argumento mal
# escrito se reporta como "falta .env", que despista.
ACCION="${1:-}"
case "$ACCION" in
  emitir|renovar|estado) ;;
  *) echo "uso: $0 {emitir|renovar|estado}" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."          # deploy/
ENV_FILE="${ENV_FILE:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "error: no existe deploy/$ENV_FILE (copialo de .env.example)" >&2
  echo "       o indica otro con:  ENV_FILE=.env.staging $0 $ACCION" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a && . "./$ENV_FILE" && set +a

: "${DOMINIO:?falta DOMINIO en $ENV_FILE}"
CORREO="${CERTBOT_EMAIL:-}"
COMPOSE=(docker compose --env-file "$ENV_FILE")

registro_acme() {
  if [ -n "$CORREO" ]; then echo "--email $CORREO"; else echo "--register-unsafely-without-email"; fi
}

# Copia el material emitido al directorio que monta el proxy y recarga nginx
# sin cortar las conexiones en curso.
publicar_y_recargar() {
  "${COMPOSE[@]}" --profile certbot run --rm --entrypoint sh certbot -c "
    set -e
    cp -L /etc/letsencrypt/live/$DOMINIO/fullchain.pem /salida/fullchain.pem
    cp -L /etc/letsencrypt/live/$DOMINIO/privkey.pem   /salida/privkey.pem
    chmod 644 /salida/fullchain.pem
    chmod 600 /salida/privkey.pem
  "
  "${COMPOSE[@]}" exec -T proxy nginx -s reload
  echo "certificado publicado y nginx recargado"
}

case "$ACCION" in
  emitir)
    echo "==> el proxy debe estar en pie para responder el reto ACME"
    "${COMPOSE[@]}" up -d proxy
    # Comprobacion previa: si el reto no es alcanzable, certbot fallaria igual
    # pero sin decir por que. Mejor detectarlo aqui.
    echo "==> comprobando que http://$DOMINIO/.well-known/acme-challenge/ es alcanzable"
    "${COMPOSE[@]}" exec -T proxy sh -c 'mkdir -p /var/www/certbot && echo prueba > /var/www/certbot/prueba'
    if curl -fsS --max-time 15 "http://$DOMINIO/.well-known/acme-challenge/prueba" | grep -q prueba; then
      echo "    alcanzable"
    else
      echo "    NO alcanzable. Revisa, en este orden:" >&2
      echo "      1. el DNS de $DOMINIO apunta a este host" >&2
      echo "      2. el puerto 80 esta abierto en el firewall del proveedor" >&2
      echo "      3. el puerto 80 esta abierto en el firewall del propio host" >&2
      echo "         (en Oracle Cloud hay que abrirlo en AMBOS sitios)" >&2
      "${COMPOSE[@]}" exec -T proxy rm -f /var/www/certbot/prueba || true
      exit 1
    fi
    "${COMPOSE[@]}" exec -T proxy rm -f /var/www/certbot/prueba

    echo "==> solicitando el certificado a Let's Encrypt"
    # shellcheck disable=SC2046
    "${COMPOSE[@]}" --profile certbot run --rm certbot certonly \
      --webroot --webroot-path=/var/www/certbot \
      -d "$DOMINIO" --agree-tos --non-interactive $(registro_acme)
    publicar_y_recargar
    echo
    echo "Programa la renovacion en el cron del host (ver guia_despligue.md, 4.4)."
    ;;

  renovar)
    # certbot solo renueva si faltan menos de 30 dias; con --deploy-hook no
    # publicariamos nada cuando no toca, asi que se compara el certificado.
    ANTES="$("${COMPOSE[@]}" --profile certbot run --rm --entrypoint sh certbot -c \
      "cat /etc/letsencrypt/live/$DOMINIO/fullchain.pem 2>/dev/null | sha256sum" || true)"

    "${COMPOSE[@]}" --profile certbot run --rm certbot renew \
      --webroot --webroot-path=/var/www/certbot --non-interactive

    DESPUES="$("${COMPOSE[@]}" --profile certbot run --rm --entrypoint sh certbot -c \
      "cat /etc/letsencrypt/live/$DOMINIO/fullchain.pem 2>/dev/null | sha256sum" || true)"

    if [ "$ANTES" != "$DESPUES" ]; then
      echo "el certificado cambio: publicando y recargando"
      publicar_y_recargar
    else
      echo "sin cambios: el certificado aun no tocaba renovar"
    fi
    ;;

  estado)
    echo "== certificado en uso por el proxy =="
    "${COMPOSE[@]}" exec -T proxy openssl x509 -in /etc/nginx/certs/fullchain.pem \
      -noout -subject -issuer -enddate
    echo
    echo "== visto desde fuera =="
    echo | openssl s_client -connect "$DOMINIO:443" -servername "$DOMINIO" 2>/dev/null \
      | openssl x509 -noout -subject -issuer -enddate 2>/dev/null \
      || echo "  no se pudo negociar TLS con $DOMINIO:443"
    ;;

esac
