# Workflows de n8n — contenedor 02

Definiciones versionadas de los cuatro workflows del **contenedor 02 "workflow
n8n mylern"**. Se montan dentro del contenedor en `/workflows` y se importan con
`deploy/scripts/importar_workflows.sh`.

| Archivo | Disparo | Especificación del ASI |
|---|---|---|
| `01_ingesta_telegram.json` | webhook de Telegram | procedimiento 1 "registrando un nodo" |
| `02_tick_espaciado.json` | cada 10 minutos (1 UE) | `LOG-GEN-NODO` (ESP-001), `LOG-GEN-GRAFO` (ESP-003) |
| `03_worker_despacho.json` | cada minuto | procedimiento "recibiendo esfuerzos", paso 2 |
| `04_evaluacion_dominical.json` | cron `0 0 * * 0` (UTC) | caso de uso 2 "EVALUANDO APRENDIZAJE" |

## Principio de diseño

n8n es el **motor de integración**, no la sede de la lógica: los workflows
disparan, llaman a `POST /api/v1/internal/*` y hablan con la API de Telegram.
Toda la lógica de dominio vive en el contenedor 01, donde es tipada,
versionable y verificable con pruebas automáticas (ver DEC-007 en
`docs/decisiones.md`).

## Variables de entorno que consumen

Se leen con `$env` dentro de los nodos, lo que exige
`N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (ya fijado en `docker-compose.yml`):

| Variable | Valor |
|---|---|
| `MILERN_API_BASE` | `http://backend:3000` (red interna de Docker) |
| `MILERN_INTERNAL_SECRET` | secreto compartido, enviado en `x-internal-secret` |

## Credenciales

Los workflows se importan **inactivos y sin credenciales**: el token del bot
nunca se versiona. Tras importarlos hay que crear en n8n una credencial de tipo
*Telegram API* llamada exactamente **`Telegram MILERN`** y asignarla a los nodos
de Telegram de los workflows 01, 03 y 04.

El campo `meta` de cada JSON es documentación propia de este repositorio: n8n lo
ignora al importar.
