# Medidas de seguridad retiradas

Este despliegue está pensado para **un solo usuario** en un VPS de Oracle,
detrás de **Nginx Proxy Manager** y **Cloudflare**. Con ese contexto se
retiraron varias medidas que el diseño original traía.

Ninguna se ha borrado del código: todas siguen implementadas y se encienden con
una variable. Este documento explica **qué protege cada una y cuándo volverías a
necesitarla**, para que la decisión sea informada y reversible.

## Resumen

| Medida | Estado | Cómo se recupera |
|---|---|---|
| Secreto compartido en `/api/v1/internal/*` | apagada | `INTERNAL_API_SECRET=<secreto>` |
| Limitador de caudal de la API | apagada | `RATE_LIMIT_ACTIVO=true` |
| Contenedor 05 (proxy TLS propio) | opcional | `--profile proxy-propio` |
| Gestión de certificados (Let's Encrypt, certbot, cron) | retirada | la asume Cloudflare + NPM |
| Bloqueo de `/api/v1/internal/*` en el proxy | pasa a NPM | no exponer esa ruta en NPM |
| Restauración de IP real de Cloudflare | ya no aplica | solo servía al proxy propio |
| Emisión de API Token para la CLI | simplificada | sigue disponible en la app web |

Lo que **no** se tocó, porque sin ello el sistema no funciona o queda abierto de
par en par: el ingreso con contraseña de la app web, las credenciales de n8n, el
cifrado de credenciales de n8n, y el aislamiento de puertos en `127.0.0.1`.

---

## 1. Secreto compartido en `/api/v1/internal/*`

**Qué es.** Los endpoints que consume n8n —disparar el tick, reclamar un
esfuerzo de la cola, confirmar un envío— exigían la cabecera
`x-internal-secret` con un valor compartido entre backend y n8n.

**De qué protege.** De que cualquiera que alcance el puerto del backend pueda
disparar ticks, **vaciar tu cola de esfuerzos** o marcar como enviados esfuerzos
que nunca llegaron. No expone datos, pero corrompe la agenda de repetición
espaciada: los contadores avanzan sin que tú hayas visto nada.

**Por qué se retira aquí.** El backend publica su puerto solo en `127.0.0.1`, y
n8n le habla por la red interna de Docker. Para llegar a esa superficie habría
que tener ya una sesión en el VPS, y en ese punto el secreto —que está en texto
plano en el mismo `.env`— no detiene a nadie.

**Cuándo volver a encenderlo:**
- Si cambias `PUERTO_API` a `0.0.0.0:3000` o a una IP pública.
- Si el VPS lo comparte más gente.
- Si expones `/api/v1/internal/` en Nginx Proxy Manager (no lo hagas).

```bash
# .env
INTERNAL_API_SECRET=$(openssl rand -base64 36)
```

Los cuatro workflows ya envían la cabecera leyendo `MILERN_INTERNAL_SECRET`, así
que basta con definir la variable y reiniciar: no hay que tocar n8n.

---

## 2. Limitador de caudal de la API

**Qué es.** Un tope de peticiones por minuto y por IP sobre `/api/v1/*`.

**De qué protege.** De ataques de fuerza bruta contra el ingreso y de que un
cliente descontrolado sature el backend.

**Por qué se retira aquí.** El único cliente eres tú, y delante ya está
Cloudflare, que absorbe tráfico abusivo antes de que llegue al VPS. Además, un
limitador mal calibrado te bloquea a ti mismo durante una importación masiva con
la CLI, que es justo el caso de uso que más peticiones seguidas genera.

**Cuándo volver a encenderlo:** si abres el sistema a más gente, o si Cloudflare
deja de estar delante.

```bash
# .env
RATE_LIMIT_ACTIVO=true
RATE_LIMIT_MAX=300
```

---

## 3. Contenedor 05: el reverse proxy TLS propio

**Qué es.** El nginx que el ASI especifica como contenedor 05: termina TLS,
enruta `/`, `/api` y `/webhook`, y aísla la red interna.

**Por qué se vuelve opcional.** Nginx Proxy Manager hace exactamente lo mismo, y
tener dos proxies encadenados solo añade un salto, una configuración duplicada y
un sitio más donde equivocarse.

**No se ha eliminado**: el ASI lo especifica y sigue en el repositorio, con su
Dockerfile y su configuración. Se levanta cuando lo quieras:

```bash
docker compose --env-file .env --profile proxy-propio up -d
```

**Cuándo lo querrías:** si dejas de usar Nginx Proxy Manager, o si quieres el
despliegue autocontenido tal como lo describe el ASI.

> **Lo que ahora te toca a ti en NPM.** El proxy propio bloqueaba
> `/api/v1/internal/*` con un `deny all`. NPM no lo hace solo: simplemente **no
> crees una *custom location* para esa ruta**. Con la configuración de la guía,
> NPM solo enruta `/` y `/api/v1/` hacia backend y webapp; `/api/v1/internal/`
> queda cubierto por `/api/v1/`, así que **sí conviene añadir un bloqueo
> explícito** si publicas la API. Está en la sección 5 de `guia_despligue.md`.

---

## 4. Gestión de certificados TLS

**Qué era.** Emisión con Let's Encrypt por webroot, publicación del material,
recarga de nginx y renovación programada en el cron del host.

**Por qué se retira.** Con Cloudflare y NPM ya no la haces tú:

- **Cloudflare** presenta el certificado al visitante y lo renueva solo.
- **Nginx Proxy Manager** pide y renueva su propio certificado desde su interfaz,
  o acepta un Cloudflare Origin Certificate de 15 años.

Los artefactos (`scripts/certificado.sh`, el servicio `certbot`,
`cloudflare-ips.conf`) siguen ahí, asociados al perfil `proxy-propio`. Solo
tienen sentido si vuelves al contenedor 05.

**Lo que sigue siendo obligatorio.** El tramo entre Cloudflare y tu VPS tiene que
ir cifrado: modo **Full (strict)** en Cloudflare, nunca *Flexible*. Con
*Flexible* el candado aparece en el navegador y el trayecto real por internet va
en claro. Eso no es una medida "extra": es la diferencia entre tener TLS y
aparentarlo.

---

## 5. Restauración de la IP real de Cloudflare

**Qué era.** `CONFIAR_EN_CLOUDFLARE=true` hacía que el proxy propio leyera la IP
del visitante de `CF-Connecting-IP` en lugar de ver la de Cloudflare.

**Por qué ya no aplica.** Servía a dos cosas del contenedor 05: que el limitador
de caudal no metiera a todos en el mismo cubo, y que los registros fueran útiles.
Sin proxy propio y sin limitador, no queda nada que arreglar. Nginx Proxy Manager
trae su propia gestión de `X-Forwarded-For`.

**Si vuelves al proxy propio**, vuelve también esta opción: sin ella el limitador
trataría a todos los visitantes como un único origen.

---

## 6. Emisión de API Token para la CLI

**Qué era.** Un paso aparte: llamar a `POST /api/v1/auth/tokens`, copiar el
token —que solo se muestra una vez— y configurarlo en la CLI.

**Qué cambia.** La CLI ahora puede autenticarse directamente con tu correo y
contraseña (`mylern-cli login`), y guarda la sesión. Un paso menos, la misma
autenticación.

**Los API Token siguen existiendo** y son preferibles si automatizas algo desde
otra máquina: se revocan de uno en uno sin cambiar tu contraseña.

---

## Lo que se mantuvo, y por qué

### Ingreso con contraseña en la app web

Podría parecer prescindible siendo un solo usuario, pero **la app está publicada
en internet**. Sin ingreso, cualquiera que dé con el dominio —o lo encuentre en
los registros de Certificate Transparency, que son públicos— leería y
modificaría todo tu conocimiento. "Solo yo conozco la URL" no es una barrera:
es una suposición que se rompe sola.

> **Mejora que te recomiendo.** Cloudflare Access (gratis hasta 50 usuarios) pone
> una pantalla de acceso en el borde, antes de que el tráfico llegue al VPS. Con
> eso ni siquiera se alcanza tu servidor sin estar autenticado, y es el modo más
> cómodo de blindar un despliegue personal. Está en `guia_despligue.md`.

### Credenciales de n8n

No son seguridad extra: n8n **guarda el token de tu bot de Telegram**. Quien
entre en su interfaz puede leerlo, y con él controla el bot. Además `/webhook/`
queda expuesto por necesidad, así que la interfaz tiene que estar protegida.

### `N8N_ENCRYPTION_KEY`

Cifra las credenciales que n8n guarda en la base. Sin ella quedarían en claro en
PostgreSQL, y cualquier respaldo se llevaría el token del bot en texto plano.

### Puertos en `127.0.0.1`

`PUERTO_API`, `PUERTO_WEBAPP` y `PUERTO_N8N` se publican solo en la interfaz
local. No cuesta nada y evita el fallo más común de estos despliegues: dejar la
base de datos o la API escuchando en `0.0.0.0` con la lista de seguridad de
Oracle Cloud más abierta de lo que creías.

---

## Comprobación rápida

```bash
cd deploy
bash scripts/verificar_despliegue.sh
```

Informa de qué medidas están activas y cuáles no, para que el estado real nunca
sea una sorpresa.
