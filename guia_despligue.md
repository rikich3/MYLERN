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
| Puertos | 80, 443 | libres y abiertos en el firewall. Con Cloudflare Tunnel no hace falta abrir ninguno (ver 4.3) |
| DNS | registro A | apuntando al host. Con Cloudflare, con la nube naranja activada |

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
| `CONFIAR_EN_CLOUDFLARE` | `true` **solo** si Cloudflare está delante (ver 4.3). No lleva secreto |
| `CERTBOT_EMAIL` | avisos de caducidad de Let's Encrypt. Se deja vacío si usas Cloudflare |

> `N8N_ENCRYPTION_KEY` no se puede cambiar después sin invalidar las
> credenciales ya guardadas. Respáldala junto con el resto de secretos.

```bash
chmod 600 .env    # contiene secretos en claro
```

---

## 4. Certificado TLS

### 4.1 Qué es y por qué el proxy lo necesita

Un **certificado TLS** hace dos cosas a la vez:

1. **Cifra** el tráfico entre el navegador y el servidor. Sin él, todo viaja en
   texto plano y cualquiera en el camino —el wifi de un café, el proveedor de
   internet, un router intermedio— puede leerlo. En MILERN eso significaría
   exponer la contraseña del ingreso, el token de sesión, los API Token de la
   CLI y el contenido completo de todos los nodos.
2. **Acredita la identidad** del servidor. El certificado lo firma una autoridad
   en la que el navegador ya confía, de modo que el cliente puede comprobar que
   habla con tu dominio y no con alguien que se ha colado en medio. Sin esa
   firma, el cifrado protegería una conversación con un desconocido.

El **contenedor 05** es quien lo necesita porque es el único que recibe tráfico
de fuera. Es el punto donde termina el TLS (*TLS termination*): descifra lo que
llega, decide a dónde va —SPA, `/api`, `/webhook`— y lo reenvía en texto plano
por la red interna de Docker, que no sale de la máquina. Los contenedores 01–04
no publican puertos y por eso no necesitan certificado propio.

Hay además dos motivos que no son opcionales en este sistema:

- **Telegram exige HTTPS con certificado válido** para entregar webhooks. Con un
  autofirmado, `setWebhook` falla y el bot deja de recibir mensajes.
- Los navegadores tratan el HTTP plano como inseguro y bloquean parte de la API
  web moderna.

> El proxy genera un certificado **autofirmado** si no encuentra otro, solo para
> poder arrancar. Sirve para probar en local, pero el navegador mostrará aviso y
> Telegram lo rechazará. Hay que sustituirlo antes de exponer el sistema.

### 4.2 Qué camino te toca

La respuesta depende de si hay algo delante de tu servidor:

| Tu situación | Qué usar | ¿Renovación? |
|---|---|---|
| **Cloudflare delante** (nube naranja) | **Cloudflare Origin Certificate** | **No**: dura 15 años |
| Servidor expuesto directo a internet | Let's Encrypt vía `scripts/certificado.sh` | Sí, cada 90 días |
| Solo pruebas en local | El autofirmado que se genera solo | No aplica |

**Si usas Oracle Cloud + Cloudflare, te toca la primera fila: la 4.3.** No
necesitas Let's Encrypt, ni certbot, ni cron de renovación.

### 4.3 Con Cloudflare (Oracle Cloud + Cloudflare)

Cuando activas la nube naranja en Cloudflare, el tráfico deja de ir directo a tu
servidor y pasa a hacer dos saltos:

```
Navegador  ──HTTPS──>  Cloudflare  ──HTTPS──>  tu servidor (proxy MILERN)
           certificado              certificado
           de Cloudflare            de origen
           (automático)             (el que instalas tú)
```

El primer salto ya está resuelto: Cloudflare pone su propio certificado, válido
y renovado por ellos. Lo que sigue haciendo falta es el **segundo salto**, y
aquí está la razón por la que no puedes saltártelo:

Cloudflare ofrece un modo llamado **Flexible** que deja ese segundo tramo en HTTP
plano. El candado aparece en el navegador, pero el trayecto entre Cloudflare y tu
máquina en Oracle Cloud cruza internet **sin cifrar**. Es el peor escenario:
parece seguro y no lo es. **No uses Flexible.**

#### Paso 1 — Emitir el Origin Certificate

Es gratuito, lo emite Cloudflare y **dura 15 años**, así que no hay renovación
que programar.

1. Panel de Cloudflare → tu dominio → **SSL/TLS** → **Origin Server**.
2. **Create Certificate**. Deja *Let Cloudflare generate a private key and CSR*.
3. En *Hostnames* añade tu dominio y el comodín: `milern.midominio.com` y
   `*.midominio.com`.
4. Validez: **15 años**. Formato: **PEM**.
5. Te muestra dos bloques **una sola vez**. Cópialos a tu servidor:

```bash
cd milern/deploy
nano nginx/certs/fullchain.pem   # pega "Origin Certificate"
nano nginx/certs/privkey.pem     # pega "Private Key"
chmod 644 nginx/certs/fullchain.pem
chmod 600 nginx/certs/privkey.pem
```

#### Paso 2 — Modo de cifrado Full (strict)

En **SSL/TLS → Overview**, elige **Full (strict)**.

| Modo | Segundo salto | Veredicto |
|---|---|---|
| Off | sin cifrar | no |
| Flexible | **sin cifrar** | no, aunque el navegador muestre candado |
| Full | cifrado, sin validar | acepta un impostor en el segundo salto |
| **Full (strict)** | cifrado y validado | **este** |

El Origin Certificate solo lo reconoce Cloudflare, no los navegadores. Eso es
exactamente lo que se quiere: el visitante ve el certificado de Cloudflare y
Cloudflare valida el tuyo. Si entras por la IP del servidor saltándote
Cloudflare, verás un aviso de certificado: es lo esperado.

#### Paso 3 — Decirle al proxy que está detrás de Cloudflare

En `deploy/.env`:

```bash
CONFIAR_EN_CLOUDFLARE=true
```

**Esto no es cosmético.** Detrás de Cloudflare, todas las peticiones llegan al
proxy con IP *de Cloudflare*. Sin esta opción, el limitador de caudal metería a
todos los visitantes del mundo en el mismo cubo —un solo usuario abusivo
bloquearía a los demás— y los registros solo mostrarían IPs de Cloudflare.

Con la opción activada, nginx recupera la IP real desde la cabecera
`CF-Connecting-IP`, y solo la acepta si la petición viene de un rango de IP de
Cloudflare (`deploy/nginx/cloudflare-ips.conf`). Por eso la opción está apagada
por defecto: confiar en esa cabecera sin un proxy conocido delante permitiría a
cualquiera falsificar su IP y esquivar el limitador.

Aplica el cambio:

```bash
docker compose --env-file .env up -d proxy
```

Comprueba que la IP real llega bien:

```bash
docker compose --env-file .env logs --tail=20 proxy
```

Deben aparecer IPs de visitantes reales, no rangos `104.16.x` o `172.64.x`. Si
siguen apareciendo IPs de Cloudflare, refresca los rangos:

```bash
bash scripts/actualizar_ips_cloudflare.sh
docker compose --env-file .env up -d --build proxy
```

#### Paso 4 — Ajustes de Cloudflare para este sistema

- **DNS**: registro `A` hacia la IP pública de tu instancia, con la **nube
  naranja activada** (proxied).
- **SSL/TLS → Edge Certificates → Always Use HTTPS**: activado.
- **Telegram**: funciona sin más. El bot habla con Cloudflare, que presenta un
  certificado válido. Recuerda que Telegram solo entrega webhooks en los puertos
  443, 80, 88 y 8443; el 443 de Cloudflare cumple.
- **Ojo con las reglas de caché**: no caches `/api/`. Cloudflare no cachea
  respuestas de API por defecto, pero si has creado alguna *Page Rule* de
  "Cache Everything", exclúyelo explícitamente.

#### Alternativa: Cloudflare Tunnel

Si prefieres **no abrir ningún puerto** en Oracle Cloud —muy razonable, y evita
por completo el problema de que alguien descubra tu IP de origen—, usa
`cloudflared`. El túnel sale desde tu servidor hacia Cloudflare, así que no hace
falta ingreso ninguno ni certificado de origen: el propio túnel va cifrado.

Apunta el túnel a `http://localhost:80` y mantén `CONFIAR_EN_CLOUDFLARE=true`.
En ese caso puedes cerrar 80 y 443 en la lista de seguridad de la VCN.

### 4.4 Sin Cloudflare: Let's Encrypt y su renovación

Solo si tu servidor está expuesto directamente a internet. Requiere que el
**puerto 80 sea alcanzable desde fuera**: es por donde Let's Encrypt comprueba
que el dominio es tuyo (reto ACME HTTP-01).

#### Emisión

El sistema tiene que estar levantado: nginx sirve el reto desde
`/.well-known/acme-challenge/` mientras sigue atendiendo el resto.

```bash
cd deploy
docker compose --env-file .env up -d
bash scripts/certificado.sh emitir
```

El script comprueba primero que el reto sea alcanzable y, si no lo es, dice qué
mirar en vez de dejarte un error opaco de certbot. Después pide el certificado,
lo copia a `nginx/certs/` y recarga nginx **sin cortar conexiones**.

#### Renovación con el cron del host

Los certificados de Let's Encrypt duran **90 días**. `certbot renew` solo actúa
cuando quedan menos de 30, así que puedes ejecutarlo a diario o semanalmente sin
riesgo: si no toca renovar, no hace nada.

Edita el cron del usuario que administra el despliegue:

```bash
crontab -e
```

Y añade (ajusta la ruta):

```cron
# Renovación del certificado TLS de MILERN — lunes a las 03:17
17 3 * * 1 cd /home/ubuntu/milern/deploy && /bin/bash scripts/certificado.sh renovar >> /var/log/milern-certificado.log 2>&1
```

Sobre esa línea:

| Parte | Por qué |
|---|---|
| `17 3 * * 1` | lunes a las 03:17. Let's Encrypt **pide** no usar horas en punto: reparte la carga de sus servidores |
| `cd .../deploy` | el script busca `.env` y `docker-compose.yml` en su directorio |
| `/bin/bash` | cron usa `/bin/sh`, y el script necesita bash |
| `>> ... 2>&1` | sin esto, cron intenta enviarte un correo y el fallo pasa desapercibido |

El script es **idempotente**: compara el certificado antes y después, y solo
publica y recarga nginx si de verdad cambió.

Comprueba que el cron funciona sin esperar 90 días:

```bash
cd deploy
bash scripts/certificado.sh renovar     # debe decir "sin cambios"
bash scripts/certificado.sh estado      # fecha de caducidad
tail /var/log/milern-certificado.log
```

Y programa un aviso propio por si la renovación falla en silencio:

```cron
0 9 * * 1 cd /home/ubuntu/milern/deploy && /bin/bash scripts/certificado.sh estado | mail -s "MILERN: estado del certificado" tu@correo
```

### 4.5 Oracle Cloud: el firewall doble

En Oracle Cloud **no basta con abrir el puerto en la consola**. Hay dos
cortafuegos y la mayoría de despliegues fallidos se explican por olvidar el
segundo:

**1. Red virtual (consola de OCI).** Networking → *Virtual Cloud Networks* → tu
VCN → *Security Lists* (o *Network Security Groups*). Añade reglas de ingreso:

| Origen | Protocolo | Puerto |
|---|---|---|
| `0.0.0.0/0` | TCP | 443 |
| `0.0.0.0/0` | TCP | 80 |

Con Cloudflare puedes restringir el origen a los rangos de
`deploy/nginx/cloudflare-ips.conf` en lugar de `0.0.0.0/0`: así nadie llega a tu
origen saltándose Cloudflare. Con Cloudflare Tunnel no necesitas ninguna regla.

**2. Cortafuegos de la propia instancia.** Las imágenes de OCI llegan con reglas
restrictivas ya puestas:

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

Verifica desde **fuera** de la máquina:

```bash
curl -I http://TU-DOMINIO/
```

Si desde el servidor responde pero desde fuera no, el que falta es uno de estos
dos cortafuegos.

> **Nota de capacidad.** El *Always Free* de Oracle Cloud da 1 GB de RAM en las
> instancias AMD (VM.Standard.E2.1.Micro), y n8n con PostgreSQL se queda corto
> ahí. Las instancias ARM (VM.Standard.A1.Flex) permiten hasta 24 GB gratis: si
> puedes elegir, usa ARM. Todas las imágenes del `docker-compose.yml` tienen
> variante `arm64`.

---

## 5. Levantar el sistema

```bash
cd deploy
docker compose --env-file .env up -d --build
```

Si aún no has instalado el certificado de la sección 4, el proxy arranca con uno
autofirmado: el sistema funciona para probar, pero el navegador avisará y
Telegram rechazará el webhook.

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
| `521`/`522` de Cloudflare | Cloudflare no alcanza tu origen | revisa los **dos** cortafuegos de Oracle Cloud (4.5) y que el proxy esté en pie |
| `526` de Cloudflare | modo Full (strict) sin Origin Certificate válido | instala el Origin Certificate (4.3) o revisa que copiaste los dos bloques completos |
| Los registros solo muestran IPs `104.16.x` / `172.64.x` | falta `CONFIAR_EN_CLOUDFLARE=true` | actívalo; si persiste, `bash scripts/actualizar_ips_cloudflare.sh` |
| El limitador bloquea a usuarios legítimos | todos comparten cubo por la IP de Cloudflare | mismo arreglo que la fila anterior |
| `certificado.sh emitir` dice que el reto no es alcanzable | puerto 80 cerrado o DNS sin propagar | con Cloudflare no uses este script: te toca la 4.3 |
| Responde desde el servidor pero no desde fuera | cortafuegos de la instancia | `iptables` / `firewalld` en la propia VM (4.5) |

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
- [ ] Certificado TLS real, no el autofirmado (sección 4)
- [ ] Con Cloudflare: modo **Full (strict)**, nunca *Flexible*
- [ ] Con Cloudflare: `CONFIAR_EN_CLOUDFLARE=true`, y los registros muestran IPs reales
- [ ] Sin Cloudflare: renovación programada en cron y **probada** con `certificado.sh renovar`
- [ ] Solo 80 y 443 abiertos, en los **dos** cortafuegos de Oracle Cloud
- [ ] El editor de n8n **no** publicado (acceso por túnel SSH)
- [ ] `verificar_despliegue.sh` confirma el 403 en `/api/v1/internal/*`
- [ ] Respaldos programados y **restauración probada al menos una vez**
- [ ] `N8N_ENCRYPTION_KEY` respaldada fuera del host

Ningún contenedor salvo el proxy publica puertos: `backend`, `n8n` y `postgres`
solo son alcanzables desde la red interna de Docker.
