# Decisiones de diseño

Registro de las partes del sistema que el documento `ASI.md` no describe de
forma explícita, o que admitían más de una lectura. Cada entrada indica qué dice
el ASI, qué se decidió y por qué. Las decisiones están referenciadas desde el
código y desde `trazabilidad.md`.

---

## DEC-001 — Modelo de datos unificado para nodo suelto y nodo de grafo

**Qué dice el ASI.** La *feature 1.2* enumera los campos de scheduling de un
nodo (`id`, `fase`, `indice_siguiente_esfuerzo`, `indice_fecha_limite`,
`conteo_esfuerzo`, `activo`). La *feature 2.1* enumera los campos de un nodo de
grafo (`id`, `grafo_id`, `parent_id`, `enlace_contenido`, `contenido`,
`is_leaf`, `activo`). No dice si son la misma entidad.

**Decisión.** Una sola tabla `nodos` con ambos conjuntos de columnas; las de
grafo son nulables hasta que el nodo se integra.

**Por qué.** El ASI describe una transición, no una copia: *"Si un nodo no
temporal alcanza la cuarta fase, se transiciona su estado a `fase_4` y se
transfiere su generacion de esfuerzos al grafo de conocimiento asociado"*. Con
dos tablas, esa transferencia obligaría a mover la fila y a reescribir las
claves foráneas del histórico de esfuerzos. Con una sola tabla es un `UPDATE` y
la identidad del nodo se conserva a lo largo de todo su ciclo de vida.

**Dónde.** `deploy/postgres/init/001_schema.sql`, tabla `nodos`.

---

## DEC-002 — Los umbrales 36 / 84 / 108 son por etapa, no acumulados

**Qué dice el ASI.** La *feature 1.1* declara *"36 esfuerzos para pasar a la
siguiente etapa"* en la primera etapa, 84 en la segunda y 108 en la tercera. La
*feature 1.2* menciona un único campo `conteo_esfuerzo` y dice *"Se evalua la
transicion de fase segun los umbrales (36, 84, 108 esfuerzos)"*. Ambas lecturas
son gramaticalmente posibles: umbrales acumulados sobre un contador único, o
requisitos por etapa.

**Decisión.** Requisitos **por etapa**. Se añade `conteo_esfuerzo_fase`, que se
reinicia en cada transición; `conteo_esfuerzo` se conserva como el acumulado
total que exige la *feature 1.2*.

**Por qué.** La lectura por etapa es la única que reproduce los promedios que el
propio ASI declara:

| etapa | intervalo | promedio del intervalo | esfuerzos | total  | promedio declarado |
|-------|-----------|------------------------|-----------|--------|--------------------|
| 1     | 2–6 UE    | 4 UE                   | 36        | 144 UE | 24 horas ✓         |
| 2     | 9–15 UE   | 12 UE                  | 84        | 1008 UE| 1 semana ✓         |
| 3     | 21–35 UE  | 28 UE                  | 108       | 3024 UE| 3 semanas ✓        |

Con umbrales acumulados, la segunda etapa duraría 48 esfuerzos (84 − 36) ≈ 4
días, y la tercera 108 − 84 = 24 esfuerzos ≈ 4,7 días: ninguno coincide con lo
declarado. La verificación aritmética está automatizada en
`backend/test/dominio.test.ts` ("los promedios declarados en el ASI se
reproducen con los umbrales por etapa").

**Dónde.** `backend/src/domain/fases.ts`; columna `nodos.conteo_esfuerzo_fase`.

---

## DEC-003 — Contenido del esfuerzo en las etapas 2 y 3

**Qué dice el ASI.** Solo especifica el contenido en la primera etapa: *"el
contenido del esfuerzo es el nodo_esfuerzo"*. Para las etapas 2 y 3 no lo dice.

**Decisión.** Todo esfuerzo originado por un nodo envía el `nodo_esfuerzo`.

**Por qué.** El `nodo_esfuerzo` es, por definición del ASI, *"el concepto o dato
que oculta su parte clave, análogo al front de un flashcard"*. Enviar el
`nodo_crudo` (el reverso) eliminaría el acto de recuperación, que es el
mecanismo entero de la repetición espaciada. El cambio de contenido llega en la
cuarta etapa, donde el Grafo de Conocimiento compone padre + enlace + contenido.

**Dónde.** `backend/src/services/scheduler.service.ts`.

---

## DEC-004 — Grafo destino al alcanzar la cuarta etapa

**Qué dice el ASI.** *"se transfiere su generacion de esfuerzos al grafo de
conocimiento asociado"*. No define cómo un nodo queda asociado a un grafo si el
usuario nunca lo asignó.

**Decisión.** Si el nodo ya tiene `grafo_id`, se respeta. Si no, entra a la
**Reserva de Conocimiento**: el grafo por defecto del usuario, creado bajo
demanda la primera vez que hace falta.

**Por qué.** El ASI dice que en la cuarta etapa el nodo *"entra a la reserva de
conocimiento **o** se integra en un grafo de conocimiento"*: son las dos salidas
previstas, y la reserva es la que no exige intervención del usuario. Dejar el
nodo sin grafo lo haría dejar de generar esfuerzos por completo, porque en
`fase_4` los nodos no temporales ya no generan esfuerzos propios.

**Dónde.** `backend/src/repositories/grafos.repo.ts` (`reservaDeConocimiento`),
`backend/src/services/despacho.service.ts`.

---

## DEC-005 — Ajuste de scheduling de los nodos fallidos en la evaluación

**Qué dice el ASI.** *"El sistema almacena la metrica historica de retencion y
ajusta el scheduling de los nodos fallidos si es necesario"*. No define el
ajuste.

**Decisión.** Un `fallo` retrocede el nodo una etapa (4→3, 3→2, 2→1), reinicia
`conteo_esfuerzo_fase` y lo reagenda dentro del rango de la etapa resultante.
`conteo_esfuerzo` (acumulado histórico) no se toca.

**Por qué.** Un fallo en la evaluación es evidencia directa de que el intervalo
actual excede la retención real del nodo. Retroceder una etapa acorta el
intervalo al rango inmediatamente anterior —que el usuario ya superó una vez— en
lugar de reiniciar todo el progreso. Preservar el acumulado mantiene intacta la
métrica histórica.

**Dónde.** `backend/src/services/evaluaciones.service.ts` (`degradar`).

---

## DEC-006 — Reagendamiento del nodo al confirmar, del grafo al encolar

**Qué dice el ASI.** Para nodos: *"Cuando se registra y confirma el envio de un
esfuerzo: [...] se calcula el nuevo `indice_siguiente_esfuerzo`"*. Para grafos:
*"Se inserta la solicitud [...] Se actualiza el cursor Round Robin del grafo y
se agenda su nuevo `indice_siguiente_esfuerzo`"*.

**Decisión.** Se respeta la asimetría literal: el nodo se reagenda al confirmar
el envío; el grafo, al encolar.

**Consecuencia y mitigación.** Entre el encolado y la confirmación, un nodo
sigue cumpliendo la condición de elegibilidad, de modo que el tick siguiente lo
volvería a encolar. La selección de candidatos excluye por tanto los nodos con
un esfuerzo vivo en la cola (`estado IN ('pendiente','en_proceso')`). Además, un
índice único `(nodo_id, indice_global)` hace idempotente el propio tick, por si
se ejecuta dos veces dentro de la misma UE.

**Por qué.** La asimetría es coherente con el modelo: el contador del nodo mide
esfuerzos *recibidos*, así que solo un envío confirmado debe avanzarlo. El
grafo, en cambio, no lleva contador de progreso: solo rota, y su rotación no
depende de que el mensaje llegue.

**Dónde.** `backend/src/repositories/nodos.repo.ts` (`candidatos`),
`deploy/postgres/init/001_schema.sql` (`ux_cola_nodo_tick`).

---

## DEC-007 — Reparto de responsabilidades entre n8n y el backend

**Qué dice el ASI.** El contenedor 02 es el *"Motor de integracion para webhooks
de Telegram y triggers cronometrados"*; el contenedor 01 expone *"API
REST/GraphQL, logica de grafos y validaciones"*.

**Decisión.** n8n no contiene lógica de dominio. Los cuatro workflows solo
disparan, llaman a `POST /api/v1/internal/*` y hablan con la API de Telegram.
Toda la lógica vive en el backend.

**Por qué.** Es la lectura literal de "motor de integración". Además, la lógica
en el backend es versionable, tipada y verificable con pruebas automáticas; la
misma lógica dentro de nodos Function de n8n solo sería auditable abriendo el
editor. El límite de caudal se aplica en el backend por la misma razón: es una
invariante del dominio, no del transporte.

**Dónde.** `space_repetition/*.json`, `backend/src/routes/internal.routes.ts`.

---

## DEC-008 — Caudal de 10 mensajes por UE con espaciado de 1 minuto

**Qué dice el ASI.** *"Un worker procesa los items de la cola enviando un maximo
de 10 mensajes espaciados uniformemente a razon de 1 mensaje por minuto"*.

**Decisión.** El workflow 03 se dispara **cada minuto** y pide un solo esfuerzo.
El backend aplica las dos restricciones antes de entregarlo: menos de 10 envíos
confirmados en los últimos 600 s, y al menos 60 s desde el último envío.

**Por qué.** La alternativa —un único workflow de 10 minutos con nodos `Wait`
intercalados— mantiene una ejecución viva diez minutos y pierde el progreso si
n8n se reinicia. Con un disparo por minuto cada ejecución es atómica y el estado
vive en la base. Que el límite se evalúe en el backend, y no en n8n, lo hace
válido aunque se añadan más workers.

**Dónde.** `backend/src/services/despacho.service.ts`,
`space_repetition/03_worker_despacho.json`.

---

## DEC-009 — Escape del separador `|` en el mensaje de Telegram

**Qué dice el ASI.** El formato es `[nodo_esfuerzo] | [nodo_crudo] |
[fecha_limite]` y exige validar la integridad del formato, respondiendo con un
mensaje explicativo ante discordancia sintáctica.

**Decisión.** Se mantiene la regla estricta de 2 segmentos como mínimo y 3 como
máximo, y se admite `\|` para un `|` literal dentro del contenido.

En el formato del ASI la etiqueta `<opcionalmente>` abre **después** de
`[nodo_crudo]`: lo único opcional es la fecha límite. Un mensaje suelto sin
separador (`hola`) no es un nodo válido — es el frente de la tarjeta sin
reverso, y la evaluación dominical necesita el crudo para contrastar la
respuesta (DSC-028).

**Por qué.** El contenido legítimo lleva barras verticales con frecuencia en
este dominio: `P(A|B)`, notación de conjuntos, tablas. Sin escape, registrar el
teorema de Bayes es imposible. Interpretar heurísticamente los segmentos
sobrantes rompería la validación explícita que el ASI pide; el escape la
conserva intacta. El mensaje de error menciona el escape, y `/ayuda` lo
documenta.

**Dónde.** `backend/src/domain/parser.ts` (`segmentar`).

---

## DEC-010 — `contenido` derivado y `es_temporal` derivado

**Qué dice el ASI.** La *feature 2* define `contenido` como *"texto
representativo del concepto o proposicion"*. La *feature 1.1* define
`nodo_esfuerzo` y `nodo_crudo`. La *feature 1.2* usa `es_temporal` en la
condición de elegibilidad, pero la lista de campos solo incluye
`indice_fecha_limite`.

**Decisión.** Ambas son columnas generadas (`GENERATED ALWAYS AS ... STORED`):
`contenido = COALESCE(nodo_crudo, nodo_esfuerzo)` y
`es_temporal = (indice_fecha_limite IS NOT NULL)`.

**Por qué.** El ASI define un nodo temporal exactamente como *"cuando el usuario
registra el nodo con una fecha"*: `es_temporal` no es un dato independiente sino
una función de `indice_fecha_limite`, y como columna generada no puede
desincronizarse. Lo mismo aplica a `contenido`: cuando el nodo tiene reverso,
ese es el texto representativo; cuando no, lo es el frente.

**Dónde.** `deploy/postgres/init/001_schema.sql`.

---

## DEC-011 — `is_leaf` mantenido por trigger y validado por CTE recursiva

**Qué dice el ASI.** *"`is_leaf` se mantiene como flag booleano indexado,
actualizado mediante triggers de insercion/eliminacion de relaciones,
permitiendo alimentar `nodos_hojas` en O(1)"* y *"la jerarquia y pertenencia de
hijos se deriva y valida mediante indices sobre `parent_id` y CTEs recursivas"*.

**Decisión.** Se implementan los dos mecanismos, con roles distintos: el trigger
`tg_nodos_is_leaf` mantiene el flag en cada alta, baja o reparenteo; la CTE
recursiva se usa para la validación de aciclicidad y para reconstruir rutas
ancestrales. `is_leaf` cuenta **solo hijos activos**, de modo que la baja lógica
del último hijo devuelve al padre a la condición de hoja.

**Por qué.** El ASI los pide a ambos y les da funciones diferentes: el flag es
para leer barato (`nodos_hojas` en O(1)); la CTE es para validar. Contar solo
hijos activos es lo que exige el pseudocódigo `eliminar_nodo`, que evalúa
`contar_hijos_activos(nodo.parent_id) == 1`.

**Dónde.** `deploy/postgres/init/002_funciones_triggers.sql`.

---

## DEC-012 — Cómo sabe el bot a qué cuenta pertenece un chat

**Qué dice el ASI.** Da por supuesta la relación —el worker envía *"hacia el
chat de Telegram"* del usuario— y no describe ninguna ceremonia para
establecerla. El comportamiento esperado es que registrar un nodo baste para
empezar a recibir esfuerzos.

**Decisión.** No hay paso de vinculación. La cuenta única del despliegue adopta
al primer chat que le habla; a partir de ahí queda ocupada y el bot ignora
cualquier otro chat. En la práctica el vínculo ya viene hecho desde el
despliegue vía `BOOTSTRAP_TELEGRAM_CHAT_ID` y esa adopción nunca llega a
ejecutarse.

**Por qué.** Una versión anterior añadía un comando `/vincular <uuid>` más una
tarjeta en la app web. Era alcance inventado: nada en el ASI lo pide, y además
metía un portero que rechazaba los mensajes de un chat no vinculado antes de
llegar al parser. Que la cuenta quede ocupada tras el primer chat es lo que
impide que un tercero que encuentre el bot escriba en el conocimiento ajeno;
sin esa condición, cualquiera podría registrar nodos y leerlos con `/listar`.

**Límite conocido.** Esto solo se sostiene mientras el despliegue sea de un solo
usuario, que es lo que describe el ASI. Con varias cuentas activas
`resolverUsuario` devuelve `null` y el bot deja de atender chats nuevos: haría
falta volver a plantear el problema.

**Dónde.** `backend/src/services/telegram.service.ts` (`resolverUsuario`).

---

## DEC-013 — Alcance del comando `undo`

**Qué dice el ASI.** *"con comando `undo` soportado a nivel log de
transacciones"*. No enumera qué operaciones son reversibles.

**Decisión.** `transacciones_log` guarda el estado anterior y posterior de cada
mutación. `undo` revierte la última operación no deshecha del usuario y cubre:
alta de nodo, alta por lote, reparenteo, actualización de contenido,
eliminación, integración a grafo y creación de grafo. Una operación no cubierta
responde `UNDO_NO_SOPORTADO` en lugar de fallar de forma ambigua.

**Por qué.** El ASI ata el `undo` al log de transacciones, así que el log es la
fuente de verdad y el alcance queda determinado por lo que el log registra. El
propio `undo` se registra, de modo que la operación es auditable y no se puede
deshacer dos veces la misma transacción.

**Dónde.** `backend/src/services/undo.service.ts`.

---

## DEC-014 — Autenticación y aislamiento de la superficie interna

**Qué dice el ASI.** *"La CLI se comunica via HTTPS contra el backend
centralizado autenticandose por API Token"* y el contenedor 05 *"enruta trafico
HTTPS y aisla la red interna de Docker"*. No define el esquema de la app web ni
el de n8n.

**Decisión.** Tres portadores: JWT para la app web, API Token con prefijo `mlk_`
para la CLI (guardado solo como hash SHA-256) y un secreto compartido
`x-internal-secret` para `/api/v1/internal/*`. El proxy devuelve 403 a
`/api/v1/internal/*` desde Internet; solo se alcanza por la red interna. Ningún
contenedor salvo el proxy publica puertos al host.

**Por qué.** La superficie interna dispara el tick y consume la cola: expuesta,
permitiría a cualquiera vaciar la cola de esfuerzos de otro usuario. El
aislamiento en dos capas —red y proxy— evita depender de una sola.

**Dónde.** `backend/src/middleware/auth.ts`, `deploy/nginx/conf.d/mylern.conf`,
`deploy/docker-compose.yml`.

---

## DEC-015 — Ausencia de GraphQL

**Qué dice el ASI.** El contenedor 01 *"expone API REST/GraphQL"*.

**Decisión.** Se implementa solo REST.

**Por qué.** La disyunción del ASI admite cualquiera de los dos. Los tres
consumidores (app web, CLI, n8n) tienen necesidades de datos fijas y conocidas;
GraphQL añadiría superficie sin resolver ningún problema presente. Si más
adelante hace falta, se monta sobre la misma capa de servicios sin tocar el
dominio.

**Dónde.** `backend/src/routes/`.

---

## DEC-016 — El desplazamiento de 54 UE se aplica en bucle, no una sola vez

**Qué dice el ASI.** *"cuando se va a generar un nuevo `indice_siguiente_esfuerzo`
para un nodo o grafo este se suma 54 UE (9 horas) si es que el
`indice_siguiente_esfuerzo` iba a estar en el rango de horas 10pm - 7am"*.

**Decisión.** Se suma el desplazamiento **mientras** el índice siga cayendo en la
ventana, no exactamente una vez.

**Por qué.** Con la configuración del requisito las dos formas son idénticas: la
ventana 22:00→07:00 dura 9 horas y el desplazamiento son 9 horas, así que
cualquier punto de la ventana escapa con **una sola suma** —está comprobado
recorriendo las 54 UE de la ventana una por una en
`backend/test/silencio.test.ts`. El bucle solo actúa si alguien configura una
ventana más ancha que el salto (por ejemplo 20:00→08:00, 12 horas), caso en el
que una única suma dejaría el esfuerzo todavía de madrugada y el requisito se
incumpliría en silencio. Es un superconjunto que se reduce a la especificación
literal con los valores por defecto.

La frontera es cerrada por la izquierda y abierta por la derecha —a las 22:00 ya
hay silencio, a las 07:00 ya no— para que las dos fronteras no se solapen y la
suma de 9 horas siempre caiga fuera.

**Dónde.** `backend/src/domain/silencio.ts` (`desplazarFueraDeSilencio`).

---

## DEC-017 — El worker de despacho también respeta las horas de silencio

**Qué dice el ASI.** La descripción es *"No se va a enviar esfuerzos desde las
10pm hasta las 7am"*. La lógica que la acompaña cubre dos puntos: el tick de 10
minutos y el cálculo del siguiente índice.

**Decisión.** Además de esos dos puntos, el worker que entrega mensajes a
Telegram comprueba la ventana antes de soltar un item.

**Por qué.** Los dos puntos de la lógica evitan *generar* esfuerzos, pero no
cubren los que ya estaban en la cola. La cola admite hasta 10 items por UE y se
drena a razón de uno por minuto: un lote encolado a las 21:59 tardaría hasta diez
minutos en salir y varios mensajes llegarían pasadas las 22:00. Sin esta tercera
comprobación, el requisito —que habla de **enviar**, no de generar— se
incumpliría en el caso más habitual, justo en la frontera.

Los items no se descartan: quedan en `pendiente` y salen a partir de las 07:00.

**Dónde.** `backend/src/services/despacho.service.ts` (`reclamarSiguiente`,
motivo `horas_silencio`).

---

## DEC-018 — El archivado de vencidos sigue ocurriendo durante el silencio

**Qué dice el ASI.** *"cuando se activa el workflow cada 10 minutos se comprueba
que el indice no corresponda al rango de horas 10pm - 7am"*.

**Decisión.** Durante la ventana el tick no selecciona candidatos ni encola nada,
pero sí archiva los nodos temporales cuya fecha límite venció.

**Por qué.** Archivar no es enviar. Aplazarlo nueve horas dejaría nodos vencidos
marcados como activos toda la noche, y el primer tick de la mañana enviaría
esfuerzos de nodos que debieron archivarse. El requisito busca no molestar de
madrugada, no congelar la coherencia de los datos.

**Dónde.** `backend/src/services/scheduler.service.ts` (`ejecutarTick`).

---

## DEC-019 — La ventana es hora local, y la zona horaria es obligatoria

**Qué dice el ASI.** Habla de "10pm" y "7am" sin mencionar zona horaria. El resto
del sistema trabaja en UTC, porque el `indice_global` deriva del epoch Unix.

**Decisión.** La ventana se evalúa en la zona horaria de `ZONA_HORARIA`
(identificador IANA). El valor por defecto del código es `UTC`, pero
`.env.example` viene con `America/Lima` y un aviso.

**Por qué.** "10pm" es una hora de reloj de pared: se refiere a cuándo el usuario
se va a dormir, no a un instante UTC. Con `ZONA_HORARIA=UTC` en un huso UTC-5 el
silencio caería entre las 17:00 y las 02:00 locales: dejaría de enviar por la
tarde y seguiría enviando de madrugada, exactamente lo contrario de lo pedido.

Como un valor equivocado no produce ningún error visible —solo mensajes a
deshora— hay dos salvaguardas: el backend **valida la zona al arrancar** y
rechaza arrancar si no la reconoce, y `verificar_despliegue.sh` imprime la hora
local que el sistema cree que es, para poder contrastarla con el reloj propio.

**Dónde.** `backend/src/config/env.ts` (`validarConfigSilencio`),
`backend/src/utils/tiempo.ts` (`horaLocal`),
`deploy/scripts/verificar_despliegue.sh`.

---

## DEC-020 — Superficie de seguridad reducida para un despliegue personal

**Contexto.** Un solo usuario, VPS de Oracle, Nginx Proxy Manager y Cloudflare
delante.

**Decisión.** Se apagan por defecto el secreto compartido de
`/api/v1/internal/*` y el limitador de caudal; el contenedor 05 pasa a un perfil
opcional y la gestión de certificados se delega en Cloudflare y NPM. Nada se
elimina del código: todo se reactiva con una variable o un perfil.

**Por qué.** Cada una de esas medidas protege de un escenario que aquí no se da
—terceros en la red, clientes hostiles, un proxy propio que termina TLS— y a
cambio añade valores que gestionar y vías de fallo. Mantenerlas apagadas pero
presentes conserva la reversibilidad sin cobrar el coste operativo.

**Lo que no se tocó**, porque sí protege de algo real: el ingreso de la app web
(está publicada en internet), las credenciales de n8n (guarda el token del bot),
`N8N_ENCRYPTION_KEY` (si no, ese token queda en claro en los respaldos) y la
publicación de puertos únicamente en `127.0.0.1`.

**Dónde.** `docs/seguridad_removida.md` desarrolla cada punto: de qué protege,
por qué se retira y cuándo recuperarla.
