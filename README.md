# MILERN / MyLern

Sistema para aprender hasta el segundo nivel de conocimiento de la taxonomía de
Bloom (2001), implementado según la especificación de [`ASI.md`](ASI.md).

Se compone de tres módulos:

1. **Repetición espaciada** por canal de mensajería (Telegram).
2. **Evaluación** para medir el éxito objetivo.
3. **Desarrollo del sistema**, para hacerlo avanzar hacia más éxito.

---

## Documentación

| Documento | Contenido |
|---|---|
| [`ASI.md`](ASI.md) | Especificación original del sistema |
| [`trazabilidad.md`](trazabilidad.md) | ASI anotado + cuadro de trazabilidad especificación → artefactos |
| [`guia_despligue.md`](guia_despligue.md) | Puesta en producción paso a paso |
| [`docs/decisiones.md`](docs/decisiones.md) | Decisiones de diseño no descritas en el ASI, con su justificación |
| [`docs/seguridad_removida.md`](docs/seguridad_removida.md) | Medidas de seguridad retiradas: de qué protegen y cuándo recuperarlas |

---

## Estructura

```
milern/
├── backend/            contenedor 01 — API REST, lógica de grafos y scheduling
├── webapp/             contenedor 04 — SPA de administración visual
├── cli/                cliente de terminal mylern-cli
├── space_repetition/   contenedor 02 — workflows de n8n (JSON)
├── deploy/             artefactos de despliegue
│   ├── docker-compose.yml
│   ├── .env.example
│   ├── postgres/init/  contenedor 03 — esquema, funciones y triggers
│   ├── nginx/          contenedor 05 — reverse proxy TLS (perfil opcional)
│   └── scripts/        importación de workflows, respaldo, verificación
└── docs/
```

---

## Cómo funciona

### Unidad de espaciado

Todo el sistema se mide en **UE** (unidades de espaciado): `1 UE = 600 s`. El
tiempo global es un entero discreto:

```
indice_global = floor(unix_timestamp_seconds / 600)
```

### Ciclo de vida de un nodo

Un **nodo** representa una pieza de conocimiento. Su `nodo_esfuerzo` es el
frente de la flashcard (oculta la parte clave) y su `nodo_crudo` el reverso.

| Etapa | Intervalo | Esfuerzos para avanzar | Duración media |
|---|---|---|---|
| 1 | 2–6 UE | 36 | ~24 horas |
| 2 | 9–15 UE | 84 | ~1 semana |
| 3 | 21–35 UE | 108 | ~3 semanas |
| 4 | 54–66 UE | — | permanente |

Al llegar a la cuarta etapa, un nodo no temporal se integra a un **grafo de
conocimiento** y deja de agendar por su cuenta: a partir de ahí es el grafo el
que emite esfuerzos, rotando por sus nodos hoja en Round Robin y componiendo el
texto como `padre + enlace + contenido`.

Un nodo registrado con fecha límite es **temporal**: no entra al grafo y sigue
emitiendo cada 54–66 UE hasta archivarse.

### Horas de silencio

No se envían esfuerzos **entre las 10pm y las 7am** (hora local de
`ZONA_HORARIA`). El tick no genera nada dentro de la franja, el worker no
entrega lo que quedara en cola, y cualquier `indice_siguiente_esfuerzo` que
fuese a caer ahí se desplaza +54 UE (9 h). Nada se pierde: se aplaza.

### Flujo de un esfuerzo

```
n8n (cada 10 min)  ->  POST /internal/scheduler/tick
                          si es hora de silencio: solo archiva y se detiene
                          archiva vencidos, encola nodos y grafos elegibles
n8n (cada minuto)  ->  POST /internal/despacho/siguiente
                          entrega 1 esfuerzo (máx. 10 por UE, 1 por minuto)
                       ->  Telegram sendMessage
                       ->  POST /internal/despacho/:id/confirmar
                          incrementa contador, evalúa transición, reagenda
```

---

## Puesta en marcha rápida

```bash
cd deploy
cp .env.example .env      # ajusta ZONA_HORARIA y las contraseñas
docker compose --env-file .env up -d --build
bash scripts/importar_workflows.sh
bash scripts/verificar_despliegue.sh
```

Los servicios escuchan en `127.0.0.1` para que un proxy externo (Nginx Proxy
Manager) los publique. El procedimiento completo —NPM, Cloudflare, Oracle Cloud y
el bot de Telegram— está en [`guia_despligue.md`](guia_despligue.md).

---

## Desarrollo

```bash
# backend
cd backend && npm install
npm run dev                       # requiere PostgreSQL accesible
npx tsx --test test/dominio.test.ts    # pruebas de dominio, sin base de datos

# webapp
cd webapp && npm install && npm run dev

# cli
cd cli && npm install && npm run build
```

### Pruebas

Hay dos clases de pruebas, según si necesitan una **base de datos PostgreSQL en
marcha** para poder ejecutarse:

| Suite | Qué cubre | ¿PostgreSQL? |
|---|---|---|
| `backend/test/dominio.test.ts` | 23 pruebas: `generar_esfuerzo`, umbrales de etapa, aciclicidad, parser, tiempo global | no |
| `backend/test/silencio.test.ts` | 13 pruebas: fronteras de la ventana, hora local, desplazamiento de 54 UE | no |
| `backend/test/integracion.test.ts` | 13 pruebas: ciclo completo de esfuerzos, Round Robin, bajas, evaluación, `undo`, caudal | **sí** |
| `backend/test/silencio-tick.test.ts` | 5 pruebas: compuertas del tick y del worker durante el silencio | **sí** |

**Las que no la necesitan** ejercitan funciones puras: entra un valor, sale otro.
Corren en milisegundos, sin configuración, en cualquier máquina. Cubren la
aritmética del sistema —los umbrales de etapa, el `index % len` del Round Robin,
el desplazamiento de 54 UE, el parser de mensajes—, que es donde vive la mayor
parte de la lógica del ASI.

**Las que sí la necesitan** insertan filas de verdad, ejecutan el tick contra la
base y vuelven a leer el resultado. Son las únicas que pueden comprobar lo que
vive *dentro* de PostgreSQL y no se puede simular: los `CHECK` del par atómico,
el trigger que mantiene `is_leaf`, el trigger de aciclicidad con `WITH
RECURSIVE`, el `FOR UPDATE SKIP LOCKED` de la cola y los índices únicos que
hacen idempotente el tick. Sin una base viva fallan al conectar.

Para levantar una desechable:

```bash
docker run -d --rm --name milern-test-pg \
  -e POSTGRES_USER=mylern -e POSTGRES_PASSWORD=test -e POSTGRES_DB=mylern -e TZ=UTC \
  -v "$PWD/deploy/postgres/init:/docker-entrypoint-initdb.d:ro" \
  -p 55432:5432 postgres:16-alpine
```

Al montar `deploy/postgres/init/` como scripts de arranque, la propia base se
crea con el esquema real del proyecto: ejecutar estas pruebas valida también las
migraciones.

```bash
cd backend

# funciones puras: sin base, sin variables de entorno
npm test

# contra la base desechable de arriba
PGHOST=127.0.0.1 PGPORT=55432 PGUSER=mylern PGPASSWORD=test PGDATABASE=mylern \
  JWT_SECRET=x ZONA_HORARIA=America/Lima npm run test:db

docker rm -f milern-test-pg    # al terminar
```

> `test:db` pasa `--test-concurrency=1` a propósito. `node --test` ejecuta los
> ficheros en procesos paralelos y `ejecutarTick()` opera sobre **todos** los
> usuarios: en paralelo, el tick de un fichero encola nodos del usuario del otro
> y las aserciones de aislamiento fallan de forma intermitente.

---

## Uso desde Telegram

Registrar un nodo es la operación por defecto: basta escribir el mensaje.

```
[nodo_esfuerzo] | [nodo_crudo] <opcional> | [fecha ISO 8601] </opcional>
```

Los dos primeros segmentos son obligatorios; solo la fecha límite es opcional.
El `|` es el separador literal de segmentos: si el texto lo contiene, se escapa
como `\|`.

```
ISO para la calidad de software _ | ISO 25010 | 2026-12-12
```

Cualquier mensaje que no siga la estructura se rechaza sin crear nada, y el bot
responde explicando el formato.

| Comando | Efecto |
|---|---|
| `/ayuda` | ayuda del bot |
| `/nodo <texto>` | registra un nodo explícitamente |
| `/listar` | últimos nodos activos |
| `/stats` | nodos por etapa e índice global |
| `/grafos` | grafos y número de hojas |
| `/evaluacion` | estado de la evaluación semanal |
| `/mejora [situacion] \| [observacion]` | registra una oportunidad de mejora |
