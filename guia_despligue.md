# Guía de despliegue — MILERN / MyLern

Despliegue completo de los cinco contenedores del ASI sobre un único host con
Docker. El procedimiento está verificado de extremo a extremo: arranque,
migraciones, importación de workflows, ciclo de esfuerzos y cierre TLS.

- **Contenedor 01** `backend` — API REST, lógica de grafos y validaciones
- **Contenedor 02** `n8n` — webhooks de Telegram y triggers cronometrados
- **Contenedor 03** `postgres` — motor relacional con CTE y constraints
- **Contenedor 04** `webapp` — SPA de administración visual
- **Contenedor 05** `proxy` — reverse proxy TLS que aísla la red interna

---

## 1. Requisitos

| Requisito | Mínimo | Notas |
|---|---|---|
| Docker Engine | 24+ | con el plugin `docker compose` v2 |
| RAM | 2 GB | 4 GB recomendado (n8n es el más pesado) |
| Disco | 10 GB | crece con el histórico de esfuerzos y ejecuciones |
| Puertos | 80, 443 | libres en el host y abiertos en el firewall |
| DNS | registro A | apuntando al host, necesario para el certificado |

Además: un **bot de Telegram** creado con [@BotFather](https://t.me/BotFather) y
su token.

> El reloj del host debe estar sincronizado (NTP). El índice global se deriva
> del *timestamp* Unix y el cron dominical se dispara a las 00:00 **UTC**; una
> desviación grande altera la agenda de esfuerzos.

---

## 2. Obtener el código

```bash
git clone <URL-DEL-REPOSITORIO> milern
cd milern
```

Estructura relevante:

```
milern/
├── ASI.md                  documento de especificación
├── trazabilidad.md         trazabilidad especificación -> artefactos
├── guia_despligue.md       este documento
├── backend/                contenedor 01
├── webapp/                 contenedor 04
├── cli/                    cliente de terminal (mylern-cli)
├── space_repetition/       workflows de n8n en JSON
├── deploy/                 artefactos de despliegue
└── docs/decisiones.md      decisiones de diseño no descritas en el ASI
```

---

## 3. Configurar el entorno

```bash
cd deploy
cp .env.example .env
```

Genera un valor distinto para cada secreto:

```bash
openssl rand -base64 36    # ejecutar una vez por secreto
```

Edita `.env` y sustituye **todos** los valores marcados `CAMBIAR`:

| Variable | Qué es |
|---|---|
| `DOMINIO` | dominio público, p. ej. `milern.midominio.com` |
| `PGPASSWORD` | contraseña de PostgreSQL |
| `JWT_SECRET` | firma de los tokens de sesión de la app web |
| `INTERNAL_API_SECRET` | secreto compartido backend ↔ n8n |
| `N8N_PASSWORD` | acceso básico al editor de n8n |
| `N8N_ENCRYPTION_KEY` | cifra las credenciales guardadas por n8n |
| `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` | cuenta inicial creada al arrancar |

> `N8N_ENCRYPTION_KEY` no se puede cambiar después sin invalidar las
> credenciales ya guardadas. Respáldala junto con el resto de secretos.

```bash
chmod 600 .env    # contiene secretos en claro
```

---

## 4. Certificado TLS

El proxy busca `deploy/nginx/certs/fullchain.pem` y `privkey.pem`. **Si no los
encuentra, genera un autofirmado** y arranca igualmente: útil para probar, no
para producción.

### Producción — Let's Encrypt

Con los puertos 80/443 libres y el DNS ya apuntando al host:

```bash
cd deploy
docker run --rm -p 80:80 \
  -v "$PWD/nginx/certs:/etc/letsencrypt/live-out" \
  -v milern_certbot:/etc/letsencrypt \
  certbot/certbot certonly --standalone \
  -d "$(grep '^DOMINIO=' .env | cut -d= -f2)" \
  --agree-tos --register-unsafely-without-email

# copiar el material emitido al directorio que monta el proxy
DOM=$(grep '^DOMINIO=' .env | cut -d= -f2)
docker run --rm -v milern_certbot:/etc/letsencrypt -v "$PWD/nginx/certs:/salida" alpine \
  sh -c "cp /etc/letsencrypt/live/$DOM/fullchain.pem /salida/ && \
         cp /etc/letsencrypt/live/$DOM/privkey.pem   /salida/"
```

**Renovación.** Los certificados de Let's Encrypt duran 90 días. Programa la
renovación en el cron del host:

```cron
0 3 1 * * cd /ruta/a/milern/deploy && docker compose restart proxy
```

(precedido del `certbot renew` correspondiente a tu método de emisión).

---

## 5. Levantar el sistema

```bash
cd deploy
docker compose --env-file .env up -d --build
```

La primera construcción tarda varios minutos. El orden de arranque está resuelto
por *healthchecks*: `postgres` debe estar sano antes de que arranquen `backend`
y `n8n`.

Comprueba el estado:

```bash
docker compose --env-file .env ps
```

Los cinco servicios deben aparecer `Up`; `postgres`, `backend` y `webapp`
además como `(healthy)`.

### Esquema de la base

Los scripts de `deploy/postgres/init/` se ejecutan **automáticamente** en el
primer arranque del volumen: crean tablas, tipos, constraints, triggers, vistas
y siembran `fases_config` con las cuatro etapas.

Si despliegas sobre una base **ya existente**, aplica las migraciones de forma
idempotente:

```bash
docker compose --env-file .env exec backend node dist/db/migrate.js
```

---

## 6. Configurar los workflows de n8n

Los cuatro workflows viven versionados en `space_repetition/` y están montados
dentro del contenedor en `/workflows`.

### 6.1 Importarlos

```bash
cd deploy
bash scripts/importar_workflows.sh
```

Debe informar `Successfully imported 4 workflows`.

### 6.2 Crear la credencial de Telegram

Los workflows entran **inactivos** y sin credenciales: el token del bot nunca se
versiona en el repositorio.

1. Abre el editor de n8n. No está expuesto por el proxy; publica un túnel local:
   ```bash
   ssh -L 5678:localhost:5678 usuario@tu-host
   docker compose --env-file .env exec n8n sh -c 'echo n8n escuchando en 5678'
   ```
   Si prefieres exponerlo temporalmente, añade `ports: ["127.0.0.1:5678:5678"]`
   al servicio `n8n` y `docker compose up -d n8n`. **Quítalo después.**
2. Entra con `N8N_USER` / `N8N_PASSWORD`.
3. **Credentials → New → Telegram API**. Nómbrala exactamente
   `Telegram MILERN` y pega el token de BotFather.
4. Abre los workflows **01**, **03** y **04** y asigna esa credencial a cada
   nodo de Telegram.

### 6.3 Activar

Activa los cuatro workflows con el interruptor de la esquina superior derecha:

| Workflow | Disparo | Qué hace |
|---|---|---|
| 01 Ingesta Telegram | webhook | recibe mensajes y registra nodos |
| 02 Tick de espaciado | cada 10 min | genera y agenda esfuerzos |
| 03 Worker de despacho | cada minuto | envía como máximo 1 esfuerzo |
| 04 Evaluación dominical | domingo 00:00 UTC | genera el cuestionario semanal |

### 6.4 Registrar el webhook del bot

```bash
curl -F "url=https://TU-DOMINIO/webhook/milern-telegram-ingesta" \
     "https://api.telegram.org/botTU_TOKEN/setWebhook"
```

Verifica:

```bash
curl "https://api.telegram.org/botTU_TOKEN/getWebhookInfo"
```

`pending_update_count` debe ser 0 y `last_error_message` no debe aparecer.

---

## 7. Verificar el despliegue

```bash
cd deploy
set -a && . ./.env && set +a
bash scripts/verificar_despliegue.sh
```

Comprueba contenedores, salud del backend, integridad del esquema (constraint
del par atómico, trigger de aciclicidad, `fases_config`) y el proxy, incluido
que `/api/v1/internal/*` responde **403** desde fuera. Debe terminar con
`verificacion completa: sin fallos`.

### Prueba manual del ciclo completo

```bash
# 1. entrar con la cuenta bootstrap
TOKEN=$(curl -s -X POST https://TU-DOMINIO/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"TU_EMAIL","password":"TU_PASSWORD"}' | jq -r .token)

# 2. registrar un nodo
curl -s -X POST https://TU-DOMINIO/api/v1/nodos \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"nodo_esfuerzo":"Prueba","nodo_crudo":"Contenido de prueba"}' | jq

# 3. estadísticas por etapa
curl -s https://TU-DOMINIO/api/v1/nodos/estadisticas \
  -H "authorization: Bearer $TOKEN" | jq
```

Desde Telegram: abre el bot, envía `/ayuda`, vincula el chat con
`/vincular <codigo>` (el código aparece en la app web, pie de página → "Conectar
Telegram") y luego escribe un nodo directamente:

```
Taxonomia de Bloom | Recordar, comprender, aplicar, analizar, evaluar, crear
```

El primer esfuerzo llega entre 20 y 60 minutos después (2–6 UE).

---

## 8. Operación

### Registros

```bash
docker compose --env-file .env logs -f backend
docker compose --env-file .env logs -f n8n
docker compose --env-file .env logs --tail=100 proxy
```

### Estado de la cola de despacho

```bash
docker compose --env-file .env exec n8n \
  wget -qO- --header="x-internal-secret: $INTERNAL_API_SECRET" \
  --post-data='' http://backend:3000/api/v1/internal/despacho/estado
```

### Respaldos

```bash
cd deploy
bash scripts/respaldo.sh ./respaldos      # conserva los últimos 14
```

Automatízalo en el cron del host:

```cron
30 2 * * * cd /ruta/a/milern/deploy && bash scripts/respaldo.sh /var/backups/milern
```

Restaurar (**destructivo**, pide confirmación explícita):

```bash
bash scripts/restaurar.sh /var/backups/milern/milern-20260101T023000Z.sql.gz
```

### Actualizar

```bash
git pull
cd deploy
docker compose --env-file .env up -d --build
docker compose --env-file .env exec backend node dist/db/migrate.js
bash scripts/verificar_despliegue.sh
```

### Detener

```bash
docker compose --env-file .env down       # conserva los datos
docker compose --env-file .env down -v    # BORRA los volúmenes
```

---

## 9. Cliente de terminal (`mylern-cli`)

### Emitir un API Token

```bash
curl -s -X POST https://TU-DOMINIO/api/v1/auth/tokens \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"nombre":"portatil"}' | jq -r .token
```

El token se muestra **una sola vez**: la base guarda solo su hash.

### Instalación local

```bash
cd cli && npm install && npm run build
node dist/index.js config https://TU-DOMINIO mlk_EL_TOKEN
node dist/index.js stats
```

Opcionalmente enlázalo al `PATH`: `npm link`.

### Uso desde el contenedor auxiliar

```bash
cd deploy
MYLERN_CLI_TOKEN=mlk_EL_TOKEN docker compose --env-file .env \
  --profile herramientas run --rm cli ls --limite 20
```

### Comandos

```
config <url> <token>     guarda credenciales
add "<esfuerzo> | <crudo> | <fecha>"    registra un nodo
import <archivo>         inserción masiva (una línea por nodo)
ls [--fase X] [--q texto]  lista nodos
graphs / graph <id>      grafos y adjacency list
gnew <nombre>            crea un grafo
gadd <grafo> "<texto>" [--padre <id> --enlace "<texto>"]
link <nodo> <padre> "<enlace>"   reparentea (valida aciclicidad)
unlink <nodo>            desconecta del padre
rm <nodo>                baja lógica preservando descendientes
log / undo               historial y reversión de la última operación
eval [--id <uuid>]       evaluaciones semanales
```

---

## 10. Diagnóstico

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `backend` reinicia en bucle | falta una variable en `.env` | `docker compose logs backend`; busca `Variable de entorno requerida ausente` |
| `502 Bad Gateway` | el backend aún no está sano | `docker compose ps`; espera el `(healthy)` |
| El bot no responde | webhook no registrado o TLS inválido | `getWebhookInfo`; Telegram exige un certificado válido, **no vale el autofirmado** |
| No llegan esfuerzos | workflows inactivos o chat sin vincular | activa 02 y 03; envía `/vincular <codigo>` |
| Llegan menos de 10 por UE | comportamiento correcto | el caudal es 1/min con tope de 10 por UE |
| `duplicate key` al importar workflows | ya estaban importados | son idempotentes por nombre; revisa con `n8n list:workflow` |
| El grafo no genera esfuerzos | no tiene nodos hoja | `generar_esfuerzo` devuelve `null` con `nodos_hojas` vacío |
| Evaluación vacía el domingo | ningún nodo en fase 3 o 4 | esperado en instalaciones nuevas |
| `403` en `/api/v1/internal/*` | comportamiento correcto | esa superficie es solo para n8n, por red interna |

### Consultas útiles

```bash
docker compose --env-file .env exec postgres psql -U mylern -d mylern

-- distribución por etapa
SELECT fase, count(*) FROM nodos WHERE activo GROUP BY fase;

-- índice global actual
SELECT fn_indice_global();

-- próximos esfuerzos agendados
SELECT nodo_esfuerzo, fase,
       indice_siguiente_esfuerzo - fn_indice_global() AS faltan_ue
  FROM nodos WHERE activo ORDER BY indice_siguiente_esfuerzo LIMIT 10;

-- estado de la cola
SELECT estado, count(*) FROM effort_dispatch_queue GROUP BY estado;

-- nodos hoja de cada grafo (los que alimentan el Round Robin)
SELECT grafo_id, count(*) FROM v_nodos_hojas GROUP BY grafo_id;
```

---

## 11. Seguridad

Antes de exponer el sistema a Internet:

- [ ] Todos los valores `CAMBIAR` de `.env` sustituidos por secretos generados
- [ ] `chmod 600 deploy/.env`
- [ ] `.env` **no** versionado (ya está en `.gitignore`)
- [ ] Certificado TLS real, no el autofirmado
- [ ] Solo 80 y 443 abiertos en el firewall del host
- [ ] El editor de n8n **no** publicado (acceso por túnel SSH)
- [ ] `verificar_despliegue.sh` confirma el 403 en `/api/v1/internal/*`
- [ ] Respaldos programados y **restauración probada al menos una vez**
- [ ] `N8N_ENCRYPTION_KEY` respaldada fuera del host

Ningún contenedor salvo el proxy publica puertos: `backend`, `n8n` y `postgres`
solo son alcanzables desde la red interna de Docker.
