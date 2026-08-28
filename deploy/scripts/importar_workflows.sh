#!/usr/bin/env bash
# Importa las definiciones de space_repetition/ dentro del contenedor de n8n.
# Los workflows quedan INACTIVOS: hay que asignarles la credencial de Telegram
# y activarlos desde el editor (ver guia_despligue.md, paso 6).
set -euo pipefail

CONTENEDOR="${1:-milern-n8n}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
  echo "error: el contenedor '$CONTENEDOR' no esta en ejecucion" >&2
  exit 1
fi

echo "==> importando workflows en $CONTENEDOR"
docker exec -u node "$CONTENEDOR" n8n import:workflow --separate --input=/workflows

echo "==> workflows presentes:"
docker exec -u node "$CONTENEDOR" n8n list:workflow

cat <<'FIN'

Siguiente paso manual (requiere el editor de n8n):
  1. Crear la credencial "Telegram MILERN" (tipo Telegram API) con el token del bot.
  2. Asignarla en los nodos Telegram de los workflows 01, 03 y 04.
  3. Activar los cuatro workflows.
  4. Registrar el webhook del bot con la URL de produccion:
       curl -F "url=https://<DOMINIO>/webhook/milern-telegram-ingesta" \
            https://api.telegram.org/bot<TOKEN>/setWebhook
FIN
