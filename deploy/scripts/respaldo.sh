#!/usr/bin/env bash
# Respaldo logico de la base (contenedor 03). Conserva los ultimos 14 archivos.
set -euo pipefail

DESTINO="${1:-./respaldos}"
CONTENEDOR="${2:-milern-postgres}"
mkdir -p "$DESTINO"

USUARIO="$(docker exec "$CONTENEDOR" printenv POSTGRES_USER)"
BASE="$(docker exec "$CONTENEDOR" printenv POSTGRES_DB)"
ARCHIVO="$DESTINO/milern-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

docker exec "$CONTENEDOR" pg_dump -U "$USUARIO" -d "$BASE" --clean --if-exists \
  | gzip -9 > "$ARCHIVO"

echo "respaldo escrito en $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
ls -1t "$DESTINO"/milern-*.sql.gz | tail -n +15 | xargs -r rm --
