#!/usr/bin/env bash
# Restaura un respaldo generado por respaldo.sh. DESTRUCTIVO.
set -euo pipefail

ARCHIVO="${1:?uso: restaurar.sh <archivo.sql.gz> [contenedor]}"
CONTENEDOR="${2:-milern-postgres}"

read -r -p "Esto SOBRESCRIBE la base de $CONTENEDOR. Escribe 'restaurar' para continuar: " ok
[ "$ok" = "restaurar" ] || { echo "cancelado"; exit 1; }

USUARIO="$(docker exec "$CONTENEDOR" printenv POSTGRES_USER)"
BASE="$(docker exec "$CONTENEDOR" printenv POSTGRES_DB)"

gunzip -c "$ARCHIVO" | docker exec -i "$CONTENEDOR" psql -U "$USUARIO" -d "$BASE"
echo "restauracion completada desde $ARCHIVO"
