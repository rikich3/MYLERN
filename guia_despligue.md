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
| Puertos | 80, 443 | los usa Nginx Proxy Manager. Los de MILERN quedan en `127.0.0.1` |
| DNS | registro A | apuntando al host. Con Cloudflare, con la nube naranja activada |
| Proxy | Nginx Proxy Manager | ya instalado en el host (o usa el proxy propio del ASI, ver 5.3) |

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
| `ZONA_HORARIA` | **imprescindible**: define cuándo empiezan las horas de silencio (sección 4) |
| `CORS_ORIGEN` | el origen desde el que abres la app en el navegador; puedes borrarla y se deriva de `DOMINIO` |
| `PUERTO_WEBAPP` / `PUERTO_API` / `PUERTO_N8N` | dónde escucha cada servicio para que NPM lo alcance. Formato `ip:puerto` (ver 5.1) |

> `N8N_ENCRYPTION_KEY` no se puede cambiar después sin invalidar las
> credenciales ya guardadas. Respáldala junto con el resto de secretos.

```bash
chmod 600 .env    # contiene secretos en claro
```

### Sobre `CORS_ORIGEN`

Es el origen **exacto** desde el que el navegador abre la aplicación: el mismo
que aparece en la barra de direcciones, con esquema, **sin barra final** y sin
ruta.

```bash
CORS_ORIGEN=https://milern.midominio.com     # correcto
CORS_ORIGEN=https://milern.midominio.com/    # la barra final NO casa
CORS_ORIGEN=milern.midominio.com             # falta el esquema
```

Puedes **borrar la línea**: por defecto se deriva como `https://${DOMINIO}`.

Con la configuración de esta guía —la SPA y la API bajo el mismo dominio, que es
lo que hace NPM con las *custom locations*— el navegador hace peticiones del
**mismo origen** y CORS ni siquiera se evalúa. La variable queda como red de
seguridad, no como algo que tengas que acertar para que funcione.

Solo pasa a ser determinante si algún día separas la SPA y la API en subdominios
distintos. En ese caso el valor es el subdominio **de la SPA** (donde está el
navegador), no el de la API:

```bash
# SPA en https://app.midominio.com, API en https://api.midominio.com
CORS_ORIGEN=https://app.midominio.com
```

Nada de esto afecta a la CLI, a n8n ni a Telegram: CORS es una restricción que
aplican los navegadores, y esos clientes no envían cabecera `Origin`.

> **Seguridad reducida a propósito.** Este despliegue asume un solo usuario
> detrás de NPM y Cloudflare, así que el secreto compartido de
> `/api/v1/internal/*` y el limitador de caudal vienen **apagados**.
> `docs/seguridad_removida.md` explica de qué protege cada medida y cuándo
> conviene volver a encenderla.

---

## 4. Horas de silencio: la zona horaria

Antes de levantar nada, un ajuste que conviene no dejar para después.

El sistema no envía esfuerzos **entre las 10pm y las 7am**. Esa franja es hora de
**reloj de pared**, pero el `indice_global` deriva del epoch Unix, que es UTC.
Hace falta decirle en qué huso vives:

```bash
# deploy/.env
ZONA_HORARIA=America/Lima        # identificador IANA
SILENCIO_ACTIVO=true
SILENCIO_HORA_INICIO=22          # 10pm, inclusive
SILENCIO_HORA_FIN=7              # 7am, exclusive
SILENCIO_DESPLAZAMIENTO_UE=54    # 9 horas, lo que dura la ventana
```

**Es el ajuste más fácil de olvidar y el que peor avisa cuando está mal**: con
`UTC` en un huso UTC-5, el silencio caería entre las 17:00 y las 02:00 locales.
Dejaría de enviar por la tarde y seguiría enviando de madrugada, justo lo
contrario de lo que buscas, y sin ningún error en los registros.

Hay dos salvaguardas:

- El backend **valida la zona al arrancar** y se niega a arrancar si no la
  reconoce; también rechaza una ventana de 24 h, que silenciaría el sistema para
  siempre.
- `verificar_despliegue.sh` imprime qué hora local cree el sistema que es, para
  que la contrastes con tu reloj (sección 7).

Cómo se comporta:

| Momento | Qué ocurre |
|---|---|
| Tick de 10 min dentro de la franja | no genera ni encola nada; sí archiva nodos vencidos |
| Worker dentro de la franja | no entrega mensajes, ni siquiera los encolados antes de las 22:00 |
| Un esfuerzo cae a las 23:40 | se desplaza +54 UE (9 h) → 08:40 |
| Un esfuerzo cae a las 15:00 | se deja tal cual |

Los esfuerzos no se pierden: se aplazan. Al reanudar a las 07:00, la cola sale al
ritmo de siempre (1 por minuto, máximo 10 por UE).

---

## 5. Levantar el sistema y publicarlo con Nginx Proxy Manager

```bash
cd deploy
docker compose --env-file .env up -d --build
```

La primera construcción tarda varios minutos. El orden de arranque lo resuelven
los *healthchecks*: `postgres` debe estar sano antes de que arranquen `backend` y
`n8n`.

```bash
docker compose --env-file .env ps
```

Deben aparecer cuatro servicios: `postgres`, `backend`, `n8n` y `webapp`.
**No hay contenedor `proxy`**: el enrutado lo hace Nginx Proxy Manager. Si algún
día quieres el proxy propio del ASI, está en la sección 5.3.

### Esquema de la base

Los scripts de `deploy/postgres/init/` se ejecutan **automáticamente** en el
primer arranque del volumen. Sobre una base ya existente:

```bash
docker compose --env-file .env exec backend node dist/db/migrate.js
```

### 5.1 Cómo alcanza NPM a los contenedores

Los servicios publican sus puertos **solo en `127.0.0.1`**:

| Servicio | Puerto por defecto | Para qué |
|---|---|---|
| `webapp` | `127.0.0.1:8080` | la SPA |
| `backend` | `127.0.0.1:3000` | la API |
| `n8n` | `127.0.0.1:5678` | webhook de Telegram y editor |

Si alguno choca con algo que ya corre en tu VPS, cámbialo en `.env`
(`PUERTO_WEBAPP`, `PUERTO_API`, `PUERTO_N8N`). El 8080 es el que más suele estar
ocupado.

**El formato es `ip:puerto`, no solo el número.** Es importante:

| Valor en `.env` | Resultado | |
|---|---|---|
| `127.0.0.1:3000` | solo accesible desde la propia máquina | correcto |
| *(vacío o la línea borrada)* | igual que el anterior: se usa el valor por defecto | correcto |
| `3000` | equivale a `0.0.0.0:3000`: **accesible desde toda la red** | evítalo |

Dejar la variable vacía **no** desactiva la publicación: la sintaxis
`${VAR:-defecto}` de Compose trata el vacío como ausente y aplica el valor por
defecto. Para no publicar nada —solo tiene sentido con el proxy propio— existe
`docker-compose.proxy-propio.yml` (sección 5.3).

`verificar_despliegue.sh` avisa si algún puerto ha quedado más allá de
`127.0.0.1`.

Hay dos formas de que NPM llegue hasta aquí:

**Opción A — por red compartida (recomendada).** Si NPM corre en Docker en el
mismo host, conéctalo a la red de MILERN y podrás enrutar por nombre de
contenedor, sin depender de puertos del host:

```bash
docker network connect milern_entrada <contenedor-de-npm>
```

En NPM usarás `backend`, `webapp` y `n8n` como nombres de host, con los puertos
internos 3000, 80 y 5678.

**Opción B — por puertos del host.** Apunta NPM a `172.17.0.1` (la puerta del
bridge de Docker) con los puertos publicados. Más simple de configurar, pero
depende de que los puertos no cambien.

### 5.2 Configuración en Nginx Proxy Manager

Crea **un solo Proxy Host** para tu dominio, con tres localizaciones.

**Details:**

| Campo | Valor (opción A) |
|---|---|
| Domain Names | `milern.midominio.com` |
| Scheme | `http` |
| Forward Hostname | `webapp` |
| Forward Port | `80` |
| Block Common Exploits | activado |
| Websockets Support | activado |

**Custom locations** (pestaña *Custom locations*):

| Location | Scheme | Forward Hostname | Forward Port |
|---|---|---|---|
| `/api/v1/` | http | `backend` | `3000` |
| `/webhook/` | http | `n8n` | `5678` |
| `/salud` | http | `backend` | `3000` |

**SSL:** pestaña *SSL* → *Request a new SSL Certificate*, con *Force SSL* y
*HTTP/2* activados. NPM pide y **renueva solo** el certificado: no hay cron que
programar.

> Si usas Cloudflare con la nube naranja, en NPM elige el método DNS Challenge
> con tu token de Cloudflare. El HTTP challenge también funciona, pero el DNS
> evita depender de que el puerto 80 esté abierto.

**Bloquea la superficie interna.** `/api/v1/internal/*` es la que dispara ticks
y consume la cola; solo la usa n8n por la red interna. Como queda cubierta por la
localización `/api/v1/`, añade una localización más para cerrarla:

| Location | Configuración avanzada |
|---|---|
| `/api/v1/internal/` | en *Advanced*: `return 403;` |

Compruébalo después:

```bash
curl -o /dev/null -w "%{http_code}\n" https://milern.midominio.com/api/v1/internal/despacho/estado
# debe responder 403
```

### Cloudflare

- **DNS**: registro `A` a la IP pública del VPS, nube naranja activada.
- **SSL/TLS → Overview**: **Full (strict)**. Nunca *Flexible*: ese modo deja el
  tramo Cloudflare→VPS **sin cifrar** aunque el navegador muestre candado.
- **No caches `/api/`**. Cloudflare no cachea APIs por defecto, pero si tienes
  alguna regla de *Cache Everything*, exclúyelo.
- **Telegram** funciona sin más: habla con Cloudflare, que presenta certificado
  válido. Solo entrega webhooks en los puertos 443, 80, 88 y 8443; el 443 vale.

> **Recomendación.** Con Cloudflare Access (gratis hasta 50 usuarios) pones una
> pantalla de acceso en el borde: nadie llega a tu VPS sin autenticarse. Es la
> forma más cómoda de blindar un despliegue personal, y no toca el código.
> Aplícalo a `milern.midominio.com` **excepto** a `/webhook/`, que debe seguir
> siendo alcanzable por Telegram.

### Oracle Cloud: el firewall doble

Abrir el puerto en la consola **no basta**; hay dos cortafuegos y olvidar el
segundo es la causa más habitual de "responde en el servidor pero no desde
fuera".

**1. Red virtual (consola OCI).** Networking → *Virtual Cloud Networks* → tu VCN
→ *Security Lists*. Ingreso TCP a los puertos **80 y 443** (los de NPM). Los
puertos de MILERN no se abren: viven en `127.0.0.1`.

**2. Cortafuegos de la instancia.** Las imágenes de OCI llegan con reglas
restrictivas:

```bash
# Ubuntu
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save        # sin esto se pierde al reiniciar

# Oracle Linux
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

> **Capacidad.** El *Always Free* AMD da 1 GB de RAM y n8n con PostgreSQL se
> queda corto. Las instancias ARM (VM.Standard.A1.Flex) llegan a 24 GB gratis:
> si puedes elegir, ARM. Todas las imágenes tienen variante `arm64`.

### 5.3 Si prefieres el proxy propio del ASI

El contenedor 05 sigue en el repositorio. Para usarlo en lugar de NPM:

```bash
docker compose --env-file .env \
  -f docker-compose.yml -f docker-compose.proxy-propio.yml \
  --profile proxy-propio up -d --build
```

La superposición retira la publicación de puertos al host: con el proxy propio,
backend, webapp y n8n solo deben alcanzarse por la red interna de Docker.

En ese caso vuelven a aplicar la gestión de certificados
(`scripts/certificado.sh emitir` y su renovación en cron) y
`CONFIAR_EN_CLOUDFLARE=true`, que restaura la IP real del visitante. Los detalles
están en `docs/seguridad_removida.md`, puntos 3 a 5.

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

1. Abre el editor de n8n. Escucha en `127.0.0.1:5678` del VPS, así que llega
   por un túnel SSH desde tu máquina:
   ```bash
   ssh -L 5678:127.0.0.1:5678 usuario@tu-vps
   ```
   Y entra en `http://localhost:5678`. No publiques el editor en NPM: guarda el
   token de tu bot de Telegram.
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

Esa ruta la sirve NPM con la *custom location* `/webhook/` que creaste en 5.2.
Si usas Cloudflare Access, **exclúyela**: Telegram no puede autenticarse.

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
del par atómico, trigger de aciclicidad, `fases_config`), qué medidas de
seguridad están activas y si los puertos están en `127.0.0.1`. Debe terminar con
`verificacion completa: sin fallos`.

**Presta atención al bloque de horas de silencio**, que imprime algo así:

```
== [feature 1.3] horas de silencio ==
  ventana : 22:00 a 7:00 (America/Lima)
  ahora   : 19:24 -> fuera de la ventana, se envian esfuerzos
  [!] comprueba que esa hora coincide con tu reloj; si no, ajusta ZONA_HORARIA
```

Si esa hora no coincide con la de tu reloj, `ZONA_HORARIA` está mal y los
esfuerzos llegarán a deshora.

Y comprueba a mano que la superficie interna está cerrada en NPM:

```bash
curl -o /dev/null -w "%{http_code}\n" https://TU-DOMINIO/api/v1/internal/despacho/estado
# debe responder 403
```

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

### Instalación e ingreso

```bash
cd cli && npm install && npm run build
node dist/index.js login https://TU-DOMINIO tu@correo.com
# pide la contrasena por stdin: no queda en el historial del shell
node dist/index.js stats
```

Opcionalmente enlázalo al `PATH`: `npm link`.

### API Token (alternativa)

Si automatizas desde otra máquina, es preferible un token dedicado: se revoca de
uno en uno sin cambiar tu contraseña.

```bash
TOKEN=$(curl -s -X POST https://TU-DOMINIO/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"tu@correo.com","password":"..."}' | jq -r .token)

curl -s -X POST https://TU-DOMINIO/api/v1/auth/tokens \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"nombre":"portatil"}' | jq -r .token

node dist/index.js config https://TU-DOMINIO mlk_EL_TOKEN
```

El token se muestra **una sola vez**: la base guarda solo su hash.

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
| `521`/`522` de Cloudflare | Cloudflare no alcanza NPM | revisa los **dos** cortafuegos de Oracle Cloud (5.2) |
| `526` de Cloudflare | Full (strict) sin certificado válido en NPM | pide el certificado desde la pestaña SSL de NPM |
| NPM da `502` | no alcanza al contenedor | opción A: ¿conectaste NPM a `milern_entrada`? opción B: ¿los puertos de `.env` son los correctos? |
| `Bind for 0.0.0.0:8080 failed` al levantar | el puerto ya está ocupado en el host | cambia `PUERTO_WEBAPP` en `.env` |
| Responde en el servidor pero no desde fuera | cortafuegos de la instancia | `iptables` / `firewalld` en la propia VM (5.2) |
| **Los esfuerzos llegan de madrugada** | `ZONA_HORARIA` incorrecta | `bash scripts/verificar_despliegue.sh` muestra qué hora cree el sistema que es |
| **No llega nada en todo el día** | ventana de silencio mal configurada | mismo comando; revisa `SILENCIO_HORA_INICIO` / `SILENCIO_HORA_FIN` |
| El tick devuelve `en_silencio: true` | comportamiento correcto | estás dentro de la franja 22:00–07:00 |
| El backend no arranca y menciona `ZONA_HORARIA` | identificador IANA inválido | usa por ejemplo `America/Lima`, no `GMT-5` |

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

-- [feature 1.3] proximos esfuerzos en hora local: ninguno debe caer entre las
-- 22:00 y las 07:00
SELECT nodo_esfuerzo,
       to_char(to_timestamp(indice_siguiente_esfuerzo * 600)
                 AT TIME ZONE 'America/Lima', 'DD/MM HH24:MI') AS proximo_local
  FROM nodos WHERE activo ORDER BY indice_siguiente_esfuerzo LIMIT 15;

-- nodos hoja de cada grafo (los que alimentan el Round Robin)
SELECT grafo_id, count(*) FROM v_nodos_hojas GROUP BY grafo_id;
```

---

## 11. Seguridad

Este despliegue lleva la superficie de seguridad **reducida a propósito**: un
solo usuario, detrás de NPM y Cloudflare. Lo retirado no se ha borrado del
código; `docs/seguridad_removida.md` explica de qué protege cada medida, por qué
se apagó y cómo recuperarla.

Antes de exponerlo:

- [ ] `JWT_SECRET`, `PGPASSWORD`, `N8N_PASSWORD` y `N8N_ENCRYPTION_KEY` con
      valores propios (`openssl rand -base64 36`)
- [ ] `chmod 600 deploy/.env`, y `.env` no versionado (ya está en `.gitignore`)
- [ ] `ZONA_HORARIA` correcta y comprobada contra tu reloj (sección 7)
- [ ] Los tres puertos de MILERN en `127.0.0.1`, no en `0.0.0.0`
- [ ] En Oracle Cloud, solo 80 y 443 abiertos, en los **dos** cortafuegos
- [ ] En NPM, `/api/v1/internal/` devuelve **403** desde fuera
- [ ] Cloudflare en **Full (strict)**, nunca *Flexible*
- [ ] `N8N_ENCRYPTION_KEY` respaldada fuera del host (cifra el token del bot)
- [ ] Respaldos programados y **restauración probada al menos una vez**

Opcionales, según cuánto quieras cerrar:

- [ ] Cloudflare Access delante del dominio (excepto `/webhook/`)
- [ ] `INTERNAL_API_SECRET` definido, si publicas la API más allá de `127.0.0.1`
- [ ] `RATE_LIMIT_ACTIVO=true`, si el sistema deja de ser solo tuyo
