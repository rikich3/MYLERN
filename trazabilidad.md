# Trazabilidad — MILERN / MyLern

Este documento enlaza cada especificación del documento `ASI.md` con los
artefactos que la implementan.

- **Sección 1 — ASI referenciado.** Copia íntegra de `ASI.md` con cada
  especificación anotada al costado con `[nombre, nemonico, id, tipo]`.
- **Sección 2 — Cuadro de trazabilidad de usuario.** Un cuadro por
  especificación con los campos `nombre, nemonico, id, tipo, feature, escenario,
  dado, cuando, especificacion, traza`, donde cada ítem de la traza lleva
  **índice** y **ubicación**.

## Criterio de identificación

Se identificaron las especificaciones por los tres patrones sintácticos que el
propio encargo define:

| Tipo | Patrón | Ocurrencias |
|---|---|---|
| `pseudocodigo` | `func [identificador] ([entradas]):` | ESP-002, ESP-004, ESP-006 |
| `logica` | conjunto de instrucciones indexadas con `-> [logica]` | ESP-001, ESP-003, ESP-005, ESP-008 |
| `protocolo` | conjunto de ítems indexados con `[n]_ [protocolo]` | ESP-007 |

**Total: 8 especificaciones.** El resto de `ASI.md` son *descripciones* (qué se
debe implementar) y quedan recogidas en el Anexo A, que traza los procedimientos
y casos de uso que no responden a ninguno de los tres patrones.

## Catálogo de features

Los `feature` usados en los cuadros son los que el propio `ASI.md` establece:

| Clave | Feature | Origen en ASI.md |
|---|---|---|
| `MOD-1` | Servicio de repetición espaciada por canal de mensajería (Telegram) | `# descripcion` |
| `MOD-2` | Técnica de evaluación para medir el éxito objetivo | `# descripcion` |
| `MOD-3` | Sistema de desarrollo para hacer avanzar el sistema | `# descripcion` |
| `F1` | feature 1 — sistema de espaciado | `## lista de features` |
| `F1.1` | feature 1.1 — clasificación de los esfuerzos | subfeature |
| `F1.2` | feature 1.2 — generación y agendación de esfuerzos | subfeature |
| `F1.3` | feature 1.3 — horas de silencio | subfeature |
| `F2` | feature 2 — grafo de conocimiento | `## lista de features` |
| `F2.1` | feature 2.1 — representación del grafo como adjacency list | subfeature |
| `F2.2` | feature 2.2 — inserción y reparenteo de nodos | subfeature |
| `F2.3` | feature 2.3 — eliminación y desconexión de nodos | subfeature |
| `F2.4` | feature 2.4 — protección e integridad de datos | subfeature |
| `F2.5` | feature 2.5 — aplicación de administración de grafos y evaluación | subfeature |

---

# Sección 1 — `<ASI_referenciado>`

> Copia de `ASI.md`. Las especificaciones llevan al costado, en negrita y entre
> corchetes, su `[nombre, nemonico, id, tipo]`.

---

# descripcion
system to learn stuff up to the second level of knowledge based on the blooms taxonomy 2001.
The system has 3 modules:
- an spaced repetition service through messaging channel (telegram).
- an evaluation technique to measure objective success.
- a developing system to guide the system to achieve more success.

## lista de features
- feature 1: sistema de espaciado
* La unidad de espaciado equivale a 10 minutos, se abrevia como UE (1 UE = 600 segundos).
Este sistema es el que define:
* effort scheduling.
* clasificacion de los esfuerzos.
Se usara una unidad de tiempo para estandarizar los movimientos

subfeatures
---
- feature 1.1: clasificacion de los esfuerzos
* El usuario envia mensajes al bot para registrar nodos [los nodos representan conocimiento].
* Registrar un nodo es la operacion por defecto del bot, El mensaje que registra un nodo tiene la siguiente estructura:
[nodo_esfuerzo] | [nodo_crudo] <opcionalmente> | [fecha_limite] </opcionalmente>
* El esfuerzo del nodo es la primera parte del mensaje, que se va a enviar al usuario para implementar la repeticion espaciada. [Concepto o dato que oculta su parte clave, análogo al front de un flashcard].
* La parte nodo_crudo es el concepto o dato importante en su totalidad [análogo al back de un flashcard].
* Cuando el usuario registra el nodo con una fecha, significa que el nodo debe generar esfuerzos hasta esa fecha y luego ser archivado. Se clasifica al nodo como "nodo temporal".
* Los nodos eliminados o inactivos se consideran archivados en la base de datos con estado de baja lógica.
* El ciclo de vida de un nodo se divide en 4 etapas:
** primera etapa: el contenido del esfuerzo es el nodo_esfuerzo, los esfuerzos se envian cada 2 - 6 UE, con 36 esfuerzos para pasar a la siguiente etapa. (promedio de 24 horas)
** segunda etapa: los esfuerzos se envian cada 9 - 15 UE, con 84 esfuerzos para pasar a la siguiente etapa. (promedio de 1 semana)
** tercera etapa: los esfuerzos se envian cada 21 - 35 UE, con 108 esfuerzos para pasar a la siguiente etapa. (promedio 3 semanas)
** cuarta etapa: El nodo entra a la reserva de conocimiento o se integra en un grafo de conocimiento. A partir de aqui los grafos de conocimiento son los que generan los esfuerzos cada 54 - 66 UE [9 a 11 horas].
* Un nodo temporal cuando llega a la cuarta etapa no entra a un grafo de conocimiento, sino que seguira generando esfuerzos en intervalos de 54 - 66 UE hasta la fecha limite.

- feature 1.2: generacion y agendacion de esfuerzos
* Se utilizan indices enteros discretos para identificar el tiempo global, tomando el punto de partida del sistema POSIX Unix Epoch en segundos:
  $$\text{indice\_global} = \lfloor \frac{\text{unix\_timestamp\_seconds}}{600} \rfloor$$
* La logica con el que los nodos generan esfuerzos es la siguiente:   **[Generacion y agendacion de esfuerzos de nodos, LOG-GEN-NODO, ESP-001, logica]**
-> Considerando los siguientes campos de un nodo: [id: UUID/INT, fase: ENUM('fase_1', 'fase_2', 'fase_3', 'fase_4', 'archivado'), indice_siguiente_esfuerzo: NUM, indice_fecha_limite: NUM?, conteo_esfuerzo: NUM, activo: BOOL]
-> Cuando el workflow de cada 10 min (tick de 1 UE) inicia:
-> Se marcan como inactivos/archivados los nodos con `indice_fecha_limite < indice_global`.
-> Se seleccionan los nodos candidatos para generacion que cumplan:
-> * `activo = verdadero`
-> * `fase IN ('fase_1', 'fase_2', 'fase_3')` O `(fase = 'fase_4' Y es_temporal = verdadero)`
-> * `indice_siguiente_esfuerzo <= indice_global`
-> Se encolan en la tabla transaccional de despacho de esfuerzos.
-> Cuando se registra y confirma el envio de un esfuerzo:
-> * Se incrementa `conteo_esfuerzo`.
-> * Se evalua la transicion de fase segun los umbrales (36, 84, 108 esfuerzos).
-> * Si un nodo no temporal alcanza la cuarta fase, se transiciona su estado a `fase_4` y se transfiere su generacion de esfuerzos al grafo de conocimiento asociado.
-> * De acuerdo a la fase resultante, se calcula el nuevo `indice_siguiente_esfuerzo` sumando un delta pseudoaleatorio uniforme dentro del rango de la etapa.
* En la cuarta etapa, los esfuerzos de nodos estructurados son gobernados por la entidad Grafo de Conocimiento.
* Cada grafo tiene su propio `indice_siguiente_esfuerzo` y su puntero de rotacion Round Robin.
* El grafo de conocimiento se representa mediante una adjacency list: cada nodo mantiene una referencia directa (`parent_id`) a su padre.
* El contenido de los esfuerzos generados por los grafos de conocimientos es generado con el siguiente algoritmo:
func generar_esfuerzo(index, const &nodos_hojas):   **[Generacion del contenido del esfuerzo del grafo, PSC-GEN-ESF, ESP-002, pseudocodigo]**
  nodos_hojas_length = nodos_hojas.len()
  si nodos_hojas_length == 0:
    retornar null
  index = index % nodos_hojas_length
  nodo = nodos_hojas[index]
  si nodo.parent_id != null Y nodo.enlace_contenido != null:
    esfuerzo.contenido = nodo.padre.contenido + " " + nodo.enlace_contenido + " " + nodo.contenido
  si_no:
    esfuerzo.contenido = nodo.contenido
  retornar esfuerzo
* `nodos_hojas` se define como el conjunto de nodos activos pertenecientes al grafo que no poseen descendientes (`children_count == 0`), independientemente de si tienen padre asignado o son raices/aislados.
* La logica con el que los grafos generan esfuerzos es la siguiente:   **[Generacion y agendacion de esfuerzos de grafos, LOG-GEN-GRAFO, ESP-003, logica]**
-> Cuando el workflow de cada 10 minutos empieza:
-> Se identifican los grafos donde `indice_siguiente_esfuerzo <= indice_global`.
-> Se inserta la solicitud de esfuerzo en la cola de despacho transaccional.
-> Se actualiza el cursor Round Robin del grafo y se agenda su nuevo `indice_siguiente_esfuerzo` sumando un valor pseudoaleatorio entre 54 y 66 UE.

- feature 1.3: horas de silencio
* No se va a enviar esfuerzos desde las 10pm hasta las 7am.
* La logica con la que se implementa este requisito es la siguiente:   **[Horas de silencio, LOG-SILENCIO, ESP-008, logica]**
-> cuando se activa el workflow cada 10 minutos se comprueba que el indice no corresponda al rango de horas 10pm - 7am
-> cuando se va a generar un nuevo indice_siguiente_esfuerzo para un nodo o grafo este se suma 54 UE (9 horas) si es que el indice_siguiente_esfuerzo iba a estar en el rango de horas 10pm - 7am

- feature 2: grafo de conocimiento
Estructura jerarquica y de red para organizar el conocimiento en memoria de largo plazo.
Un nodo que forma parte de un grafo de conocimiento contiene los siguientes campos:
* parent_id: referencia opcional al nodo padre.
* enlace_contenido: descripcion semantica de la relacion con el padre (obligatorio si `parent_id` existe).
* contenido: texto representativo del concepto o proposicion.

subfeatures
---
- feature 2.1: representacion del grafo como adjacency list
* Cada nodo del grafo mantiene los siguientes campos persistidos en base de datos:
[id: UUID, grafo_id: UUID, parent_id: UUID?, enlace_contenido: TEXT?, contenido: TEXT, is_leaf: BOOL, activo: BOOL]
* `parent_id` y `enlace_contenido` constituyen un par atomico: ambos presentes o ambos nulos.
* En PostgreSQL, la jerarquia y pertenencia de hijos se deriva y valida mediante indices sobre `parent_id` y CTEs recursivas (`WITH RECURSIVE`).
* `is_leaf` se mantiene como flag booleano indexado, actualizado mediante triggers de insercion/eliminacion de relaciones, permitiendo alimentar `nodos_hojas` en O(1).

- feature 2.2: insercion y reparenteo de nodos
func insertar_nodo(grafo_id, contenido, parent_id?, enlace_contenido?):   **[Insercion de nodo en el grafo, PSC-INS-NODO, ESP-004, pseudocodigo]**
  si parent_id != null:
    validar_existencia_y_grafo(parent_id, grafo_id)
  nodo = crear_registro_nodo(grafo_id, contenido, parent_id, enlace_contenido, is_leaf=verdadero)
  si parent_id != null:
    actualizar_nodo(parent_id, is_leaf=falso)
  retornar nodo

* La validacion de aciclicidad en inserciones o actualizaciones de parent_id se ejecuta bajo la siguiente logica:   **[Validacion de aciclicidad en insercion y reparenteo, LOG-ACICLICIDAD, ESP-005, logica]**
-> Si `parent_id == nodo.id`, rechazar de inmediato.
-> Ejecutar recorrido ascendente por ancestros (`WITH RECURSIVE`). Si el `nodo.id` coincide con algun ancestro en la ruta del `parent_id` propuesto, abortar por deteccion de ciclo.

- feature 2.3: eliminacion y desconexion de nodos
func eliminar_nodo(nodo_id):   **[Eliminacion y desconexion de nodos, PSC-DEL-NODO, ESP-006, pseudocodigo]**
  nodo = obtener_nodo(nodo_id)
  desvincular_hijos_directos(padre_id = nodo_id) // Asigna parent_id=null y enlace_contenido=null a sus hijos
  si nodo.parent_id != null:
    si contar_hijos_activos(nodo.parent_id) == 1:
      actualizar_nodo(nodo.parent_id, is_leaf=verdadero)
  marcar_baja_logica(nodo_id)

- feature 2.4: proteccion e integridad de datos
* Protocolo de integridad:   **[Protocolo de integridad del grafo, PRT-INTEGRIDAD, ESP-007, protocolo]**
1_ `parent_id` y `enlace_contenido` verificados por Check Constraint a nivel base de datos (`(parent_id IS NULL AND enlace_contenido IS NULL) OR (parent_id IS NOT NULL AND enlace_contenido IS NOT NULL)`).
2_ Validacion de no-ciclos ejecutada de forma transaccional previa a cada confirmacion de reparenteo.
3_ Eliminacion de nodos aplica desvinculacion huerfana segura por defecto, preservando los descendientes en el grafo como nodos raices/aislados.

- feature 2.5: aplicacion de administracion de grafos y evaluacion
* Interfaz reactiva para operaciones de creacion, enlace, navegacion visual y evaluacion de conocimiento.
* Panel integrado de descarga y calificacion de evaluaciones periodicas dominicales.

# caso de uso 1 "USANDO MYLERN"

## lista de procedimientos

### procedimiento 1 "registrando un nodo"
paso 1 "recepcionando un nodo":
- El webhook del servicio de workflows recepciona el mensaje de Telegram del usuario.
- Si el mensaje no contiene comandos de control, se enruta al parser de creacion de nodos.
paso 2 "guardando nodo":
- Se extraen los tokens del payload: `[nodo_esfuerzo]`, `[nodo_crudo]` y opcionalmente `[fecha_limite]`.
- Se valida la integridad del formato; ante discordancia sintactica, se responde con un mensaje explicativo y finaliza el flujo.
- Se inserta el nuevo nodo en la tabla `nodos` inicializando `fase = 'fase_1'`, `conteo_esfuerzo = 0`, `activo = verdadero` y calculando `indice_siguiente_esfuerzo = indice_global + random(2, 6)`.

## procedimiento "recibiendo esfuerzos"
paso 1 "trigger cronometrado de despacho":
- Cada 10 minutos el motor de tareas ejecuta el tick temporal calculando `indice_global = floor(unix_timestamp / 600)`.
paso 2 "procesamiento de cola y envio rate-limited":
- Se consultan los nodos y grafos elegibles que requieran envio (`indice_siguiente_esfuerzo <= indice_global`).
- Se cargan los registros priorizados en la tabla de cola `effort_dispatch_queue`.
- Un worker procesa los items de la cola enviando un maximo de 10 mensajes espaciados uniformemente a razon de 1 mensaje por minuto hacia el chat de Telegram.
- Se actualizan indices futuros y contadores tras cada confirmacion de recepcion de la API de Telegram.

## procedimiento "manejando el conocimiento usando la app web"
paso 1 "acceso y sincronizacion":
- El usuario se autentica e ingresa a la aplicacion web servida de forma centralizada.
paso 2 "administracion reactiva":
- El usuario crea, vincula, reparentea o reestructura grafos de conocimiento mediante un lienzo visual interactivo.
- El sistema provee soporte de navegacion rapida por teclado y patrones de *Progressive Disclosure* para evitar sobrecarga operativa.

## procedimiento "manejando el conocimiento usando la terminal"
paso 1 "ejecucion de cliente CLI":
- El usuario ejecuta localmente la herramienta de linea de comandos (`mylern-cli`).
paso 2 "operacion guiada via API":
- La CLI se comunica via HTTPS contra el backend centralizado autenticandose por API Token.
- Permite operaciones estructuradas de alta velocidad: insercion masiva, consulta de nodos y reparacion de enlaces, con comando `undo` soportado a nivel log de transacciones.

## lista de contenedores
- contenedor 01 "servidor backend & api mylern": Servicio de backend que expone API REST/GraphQL, logica de grafos y validaciones.
- contenedor 02 "workflow n8n mylern": Motor de integracion para webhooks de Telegram y triggers cronometrados.
- contenedor 03 "base de datos postgres mylern": Motor relacional transaccional con soporte CTE y constraints.
- contenedor 04 "web app mylern": Servidor de frontend SPA/SSR con cliente web de administracion visual.
- contenedor 05 "reverse proxy tls": Proxy inverso Nginx que enruta trafico HTTPS y aisla la red interna de Docker.

# caso de uso 2 "EVALUANDO APRENDIZAJE"
## procedimiento "tomando evaluacion directa"
paso 1 "generacion de evaluacion fin de semana":
- El domingo a las 00:00 UTC, el sistema selecciona aleatoriamente hasta 20 nodos activos que pertenezcan a `fase_3` o `fase_4`.
- Se genera un cuestionario estructurado combinando el `nodo_esfuerzo` como premisa y contrastando contra el `nodo_crudo` y enlaces jerarquicos.
paso 2 "ejecucion y autoevaluacion":
- El usuario accede a la seccion de evaluaciones en la Web App o descarga el formato offline.
- Completa las respuestas y registra su autocalificacion (acierto/fallo).
- El sistema almacena la metrica historica de retencion y ajusta el scheduling de los nodos fallidos si es necesario.

## lista de contenedores
- contenedor 01
- contenedor 02
- contenedor 03
- contenedor 04
- contenedor 05

# caso de uso 3 "AVANZANDO MILERN"
## procedimiento
paso 1 "registro de oportunidades de mejora":
- El usuario registra incidencias o fricciones de aprendizaje mediante el formulario estructurado: `[situacion]` y `[observacion]`.
paso 2 "analisis y consolidacion de soluciones":
- La plataforma permite vincular multiples observaciones bajo una propuesta formal de solucion arquitectonica o metodologica.
paso 3 "seguimiento y resolucion":
- Las soluciones se gestionan bajo un ciclo de vida (*Backlog*, *En Progreso*, *Completado*) reflejando las evoluciones del sistema.

## lista de contenedores
- contenedor 01
- contenedor 03
- contenedor 04
- contenedor 05

---

**Fin de `<ASI_referenciado>`**

---

# Sección 2 — Cuadro de trazabilidad de usuario

## 2.0 Índice de especificaciones

| id | nombre | nemónico | tipo | feature | traza (n.º artefactos) |
|---|---|---|---|---|---|
| ESP-001 | Generación y agendación de esfuerzos de nodos | `LOG-GEN-NODO` | lógica | `F1.2` (`F1.1`, `MOD-1`) | 12 |
| ESP-002 | Generación del contenido del esfuerzo del grafo | `PSC-GEN-ESF` | pseudocódigo | `F1.2` (`F2`, `F2.1`) | 8 |
| ESP-003 | Generación y agendación de esfuerzos de grafos | `LOG-GEN-GRAFO` | lógica | `F1.2` (`F2`, `MOD-1`) | 9 |
| ESP-004 | Inserción de nodo en el grafo | `PSC-INS-NODO` | pseudocódigo | `F2.2` (`F2.1`, `F2.5`) | 9 |
| ESP-005 | Validación de aciclicidad en inserción y reparenteo | `LOG-ACICLICIDAD` | lógica | `F2.2` (`F2.4`) | 9 |
| ESP-006 | Eliminación y desconexión de nodos | `PSC-DEL-NODO` | pseudocódigo | `F2.3` (`F2.4`, `F2.5`) | 9 |
| ESP-007 | Protocolo de integridad del grafo | `PRT-INTEGRIDAD` | protocolo | `F2.4` (`F2.1`–`F2.3`) | 10 |
| ESP-008 | Horas de silencio | `LOG-SILENCIO` | lógica | `F1.3` (`F1.2`, `MOD-1`) | 11 |

---

## 2.1 ESP-001 — Generación y agendación de esfuerzos de nodos

| Campo | Valor |
|---|---|
| **nombre** | Generación y agendación de esfuerzos de nodos |
| **nemónico** | `LOG-GEN-NODO` |
| **id** | `ESP-001` |
| **tipo** | `logica` |
| **feature** | `F1.2` generación y agendación de esfuerzos — deriva de `F1.1` clasificación de los esfuerzos; pertenece al módulo `MOD-1` |
| **escenario** | El tick de 1 UE archiva los nodos vencidos, encola los nodos elegibles y, al confirmarse cada envío, avanza el contador, evalúa la transición de etapa y reagenda el nodo |
| **dado** | Dado un conjunto de nodos persistidos con los campos `id`, `fase`, `indice_siguiente_esfuerzo`, `indice_fecha_limite`, `conteo_esfuerzo` y `activo`; y dado el tiempo global discreto `indice_global = floor(unix_timestamp_seconds / 600)` |
| **cuando** | Cuando arranca el workflow de cada 10 minutos (tick de 1 UE); y después, cuando se registra y confirma el envío de un esfuerzo |
| **especificación** | Se marcan como inactivos/archivados los nodos con `indice_fecha_limite < indice_global`. Se seleccionan los nodos candidatos que cumplan `activo = verdadero`, `fase IN ('fase_1','fase_2','fase_3')` O `(fase = 'fase_4' Y es_temporal = verdadero)`, e `indice_siguiente_esfuerzo <= indice_global`. Se encolan en la tabla transaccional de despacho. Al confirmarse el envío: se incrementa `conteo_esfuerzo`; se evalúa la transición de fase según los umbrales (36, 84, 108); si un nodo no temporal alcanza la cuarta fase se transiciona a `fase_4` y se transfiere su generación de esfuerzos al grafo asociado; y según la fase resultante se calcula el nuevo `indice_siguiente_esfuerzo` sumando un delta pseudoaleatorio uniforme dentro del rango de la etapa |
| **traza** | T-001.1 … T-001.12 |

### Traza — ESP-001

| índice | ubicación | artefacto |
|---|---|---|
| T-001.1 | `deploy/postgres/init/001_schema.sql:100` | Tabla `nodos`: campos de scheduling (`fase`, `indice_siguiente_esfuerzo`, `indice_fecha_limite`, `conteo_esfuerzo`, `activo`, `es_temporal`) |
| T-001.2 | `deploy/postgres/init/001_schema.sql:57` | Tabla `fases_config`: rangos 2–6 / 9–15 / 21–35 / 54–66 UE y umbrales 36 / 84 / 108 |
| T-001.3 | `deploy/postgres/init/002_funciones_triggers.sql:9` | `fn_indice_global()`: `floor(epoch/600)` en la base |
| T-001.4 | `deploy/postgres/init/002_funciones_triggers.sql:165` | Vista `v_nodos_elegibles`: condición de candidatura declarada en SQL |
| T-001.5 | `backend/src/utils/tiempo.ts:7` | `indiceGlobal()`: tiempo global discreto en la aplicación |
| T-001.6 | `backend/src/utils/tiempo.ts:20` | `deltaUE(min, max)`: delta pseudoaleatorio uniforme del rango de la etapa |
| T-001.7 | `backend/src/domain/fases.ts:24` | `FASES`: tabla de etapas con rango, umbral y fase siguiente |
| T-001.8 | `backend/src/domain/fases.ts:54` | `evaluarTransicion()`: incremento del contador, evaluación de umbral y marca `ingresa_a_grafo` |
| T-001.9 | `backend/src/repositories/nodos.repo.ts:77` | `archivarVencidos()`: baja lógica de los nodos con fecha límite superada |
| T-001.10 | `backend/src/repositories/nodos.repo.ts:99` | `candidatos()`: selección de nodos elegibles con `FOR UPDATE SKIP LOCKED` |
| T-001.11 | `backend/src/services/scheduler.service.ts:32` | `ejecutarTick()`: orquesta archivado y encolado en una sola transacción |
| T-001.12 | `backend/src/services/despacho.service.ts:89` | `confirmarEnvio()`: aplica contador, transición, ingreso al grafo y reagendamiento |
| T-001.V1 | `space_repetition/02_tick_espaciado.json` | Workflow que dispara el tick cada 10 minutos |
| T-001.V2 | `backend/test/dominio.test.ts:43,50,59,65` | Pruebas de umbrales, promedios declarados y transición a `fase_4` |
| T-001.V3 | `backend/test/integracion.test.ts:79,114,126` | Pruebas de ciclo completo, archivado de vencidos e ingreso al grafo |

---

## 2.2 ESP-002 — Generación del contenido del esfuerzo del grafo

| Campo | Valor |
|---|---|
| **nombre** | Generación del contenido del esfuerzo del grafo |
| **nemónico** | `PSC-GEN-ESF` |
| **id** | `ESP-002` |
| **tipo** | `pseudocodigo` |
| **feature** | `F1.2` generación y agendación de esfuerzos — opera sobre `F2` grafo de conocimiento y consume la estructura de `F2.1` |
| **escenario** | Un grafo compone el texto de un esfuerzo tomando un nodo hoja por rotación y concatenando la relación con su padre |
| **dado** | Dado un índice de rotación entero y la referencia constante a `nodos_hojas` — los nodos activos del grafo sin descendientes (`children_count == 0`), tengan o no padre |
| **cuando** | Cuando el grafo debe emitir un esfuerzo, es decir cuando `generar_esfuerzo(index, &nodos_hojas)` es invocado durante el tick |
| **especificación** | `func generar_esfuerzo(index, const &nodos_hojas)`: si `nodos_hojas.len() == 0` retorna `null`; en otro caso `index = index % nodos_hojas_length` y `nodo = nodos_hojas[index]`; si `nodo.parent_id != null Y nodo.enlace_contenido != null` entonces `esfuerzo.contenido = nodo.padre.contenido + " " + nodo.enlace_contenido + " " + nodo.contenido`, si no `esfuerzo.contenido = nodo.contenido`; retorna el esfuerzo |
| **traza** | T-002.1 … T-002.8 |

### Traza — ESP-002

| índice | ubicación | artefacto |
|---|---|---|
| T-002.1 | `backend/src/domain/esfuerzos.ts:25` | `generarEsfuerzo()`: transcripción directa del pseudocódigo, función pura |
| T-002.2 | `backend/src/domain/tipos.ts:39` | Tipo `NodoHoja`: proyección con `parent_id`, `enlace_contenido`, `contenido` y `contenido_padre` |
| T-002.3 | `backend/src/repositories/nodos.repo.ts:147` | `hojasDeGrafo()`: materializa `nodos_hojas` con el contenido del padre precargado |
| T-002.4 | `deploy/postgres/init/002_funciones_triggers.sql:152` | Vista `v_nodos_hojas`: definición SQL del conjunto de hojas |
| T-002.5 | `deploy/postgres/init/001_schema.sql:132` | Columna `nodos.is_leaf` indexada, que alimenta `nodos_hojas` en O(1) |
| T-002.6 | `deploy/postgres/init/001_schema.sql:152` | Índice `ix_nodos_hojas (grafo_id, is_leaf)` |
| T-002.7 | `backend/src/services/scheduler.service.ts:64` | Punto de invocación: el tick llama a `generarEsfuerzo` con el cursor Round Robin |
| T-002.8 | `deploy/postgres/init/001_schema.sql:107` | Columna `contenido` generada: `COALESCE(nodo_crudo, nodo_esfuerzo)` |
| T-002.V1 | `backend/test/dominio.test.ts:16,20,31,35` | Pruebas de conjunto vacío, concatenación con padre, nodo raíz y rotación `index % len` |
| T-002.V2 | `backend/test/integracion.test.ts:170` | Prueba del contenido compuesto sobre un grafo real |

---

## 2.3 ESP-003 — Generación y agendación de esfuerzos de grafos

| Campo | Valor |
|---|---|
| **nombre** | Generación y agendación de esfuerzos de grafos |
| **nemónico** | `LOG-GEN-GRAFO` |
| **id** | `ESP-003` |
| **tipo** | `logica` |
| **feature** | `F1.2` generación y agendación de esfuerzos — gobierna la cuarta etapa de `F2` grafo de conocimiento; pertenece al módulo `MOD-1` |
| **escenario** | El tick de 1 UE identifica los grafos vencidos, encola su esfuerzo, avanza el cursor Round Robin y los reagenda entre 54 y 66 UE |
| **dado** | Dados los grafos de conocimiento, cada uno con su propio `indice_siguiente_esfuerzo` y su puntero de rotación Round Robin |
| **cuando** | Cuando empieza el workflow de cada 10 minutos |
| **especificación** | Se identifican los grafos donde `indice_siguiente_esfuerzo <= indice_global`. Se inserta la solicitud de esfuerzo en la cola de despacho transaccional. Se actualiza el cursor Round Robin del grafo y se agenda su nuevo `indice_siguiente_esfuerzo` sumando un valor pseudoaleatorio entre 54 y 66 UE |
| **traza** | T-003.1 … T-003.9 |

### Traza — ESP-003

| índice | ubicación | artefacto |
|---|---|---|
| T-003.1 | `deploy/postgres/init/001_schema.sql:80` | Tabla `grafos`: `indice_siguiente_esfuerzo` y `cursor_rr` propios de cada grafo |
| T-003.2 | `deploy/postgres/init/001_schema.sql:93` | Índice parcial `ix_grafos_agenda` sobre la agenda de grafos activos |
| T-003.3 | `backend/src/domain/fases.ts:32` | `RANGO_GRAFO`: rango 54–66 UE |
| T-003.4 | `backend/src/repositories/grafos.repo.ts:64` | `elegibles()`: grafos con la agenda vencida y sin esfuerzo vivo en cola |
| T-003.5 | `backend/src/repositories/grafos.repo.ts:84` | `avanzarRoundRobin()`: avance del cursor y reagendamiento en una sentencia |
| T-003.6 | `backend/src/repositories/cola.repo.ts:18` | `encolar()`: inserción idempotente en `effort_dispatch_queue` |
| T-003.7 | `deploy/postgres/init/001_schema.sql:186` | Índice único `ux_cola_grafo_tick (grafo_id, indice_global)` |
| T-003.8 | `backend/src/services/scheduler.service.ts:63` | Bucle de grafos dentro del tick, con reagendamiento incluso sin hojas |
| T-003.9 | `backend/src/repositories/grafos.repo.ts:97` | `reservaDeConocimiento()`: grafo por defecto que recibe los nodos de `fase_4` |
| T-003.V1 | `space_repetition/02_tick_espaciado.json` | Workflow que dispara el tick |
| T-003.V2 | `backend/test/integracion.test.ts:170` | Prueba de rotación, avance del cursor y reagendamiento en 54–66 UE |

---

## 2.4 ESP-004 — Inserción de nodo en el grafo

| Campo | Valor |
|---|---|
| **nombre** | Inserción de nodo en el grafo |
| **nemónico** | `PSC-INS-NODO` |
| **id** | `ESP-004` |
| **tipo** | `pseudocodigo` |
| **feature** | `F2.2` inserción y reparenteo de nodos — sobre la estructura de `F2.1`, expuesta por `F2.5` |
| **escenario** | Alta de un nodo en un grafo, opcionalmente colgado de un padre, dejando el flag de hoja consistente |
| **dado** | Dado un `grafo_id` existente, un `contenido`, y opcionalmente un `parent_id` con su `enlace_contenido` |
| **cuando** | Cuando se invoca `insertar_nodo(grafo_id, contenido, parent_id?, enlace_contenido?)` desde la app web o la CLI |
| **especificación** | Si `parent_id != null` se ejecuta `validar_existencia_y_grafo(parent_id, grafo_id)`. Se crea el registro con `crear_registro_nodo(grafo_id, contenido, parent_id, enlace_contenido, is_leaf=verdadero)`. Si `parent_id != null` se ejecuta `actualizar_nodo(parent_id, is_leaf=falso)`. Se retorna el nodo |
| **traza** | T-004.1 … T-004.9 |

### Traza — ESP-004

| índice | ubicación | artefacto |
|---|---|---|
| T-004.1 | `backend/src/services/grafos.service.ts:55` | `insertarNodo()`: transcripción del pseudocódigo, dentro de una transacción |
| T-004.2 | `backend/src/repositories/nodos.repo.ts:20` | `crear()`: `crear_registro_nodo` con `is_leaf = TRUE` |
| T-004.3 | `backend/src/repositories/nodos.repo.ts:218` | `marcarIsLeaf()`: `actualizar_nodo(parent_id, is_leaf = falso)` |
| T-004.4 | `deploy/postgres/init/002_funciones_triggers.sql:121` | `fn_sync_is_leaf()` + `tg_nodos_is_leaf`: mantiene el flag también ante escrituras directas |
| T-004.5 | `deploy/postgres/init/002_funciones_triggers.sql:51` | `fn_validar_aciclicidad()`: implementa `validar_existencia_y_grafo` en la base |
| T-004.6 | `backend/src/routes/grafos.routes.ts:27` | `POST /api/v1/grafos/:id/nodos`: superficie REST de la operación |
| T-004.7 | `webapp/src/pages/Grafos.tsx:49` | Formulario "Insertar nodo" del lienzo visual |
| T-004.8 | `cli/src/index.ts:157` | Comando `gadd`, con validación del par atómico en cliente |
| T-004.9 | `backend/src/repositories/auditoria.repo.ts:22` | Registro en `transacciones_log`, que habilita el `undo` del alta |
| T-004.V1 | `backend/test/integracion.test.ts:152,224` | Pruebas de alta con padre, pérdida de condición de hoja y par atómico |

---

## 2.5 ESP-005 — Validación de aciclicidad en inserción y reparenteo

| Campo | Valor |
|---|---|
| **nombre** | Validación de aciclicidad en inserción y reparenteo |
| **nemónico** | `LOG-ACICLICIDAD` |
| **id** | `ESP-005` |
| **tipo** | `logica` |
| **feature** | `F2.2` inserción y reparenteo de nodos — es el punto 2 del protocolo de `F2.4` |
| **escenario** | Un reparenteo que cerraría un ciclo en el grafo se aborta antes de confirmar la transacción |
| **dado** | Dado un nodo y un `parent_id` propuesto dentro del mismo grafo |
| **cuando** | Cuando se inserta un nodo con padre o se actualiza el `parent_id` de un nodo existente |
| **especificación** | Si `parent_id == nodo.id`, rechazar de inmediato. Ejecutar recorrido ascendente por ancestros (`WITH RECURSIVE`); si el `nodo.id` coincide con algún ancestro en la ruta del `parent_id` propuesto, abortar por detección de ciclo |
| **traza** | T-005.1 … T-005.9 |

### Traza — ESP-005

| índice | ubicación | artefacto |
|---|---|---|
| T-005.1 | `backend/src/domain/aciclicidad.ts:18` | `validarAciclicidad()`: los dos pasos del algoritmo, como función pura |
| T-005.2 | `backend/src/repositories/nodos.repo.ts:177` | `rutaAncestros()`: `WITH RECURSIVE` ascendente desde el padre propuesto |
| T-005.3 | `backend/src/services/grafos.service.ts:113` | `reparentear()`: valida dentro de la transacción antes de confirmar |
| T-005.4 | `deploy/postgres/init/002_funciones_triggers.sql:51` | `fn_validar_aciclicidad()`: segunda barrera en la base |
| T-005.5 | `deploy/postgres/init/002_funciones_triggers.sql:98` | `tg_nodos_aciclicidad`: trigger `BEFORE INSERT OR UPDATE OF parent_id` |
| T-005.6 | `deploy/postgres/init/001_schema.sql:150` | `CHECK chk_no_autopadre`: rechazo declarativo de la autoreferencia |
| T-005.7 | `backend/src/db/pool.ts:45` | `enTransaccion()`: garantiza la ejecución transaccional previa al commit |
| T-005.8 | `backend/src/routes/grafos.routes.ts:39` | `PATCH /api/v1/nodos/:id/padre`: superficie REST del reparenteo |
| T-005.9 | `cli/src/index.ts:176` | Comando `link` (reparación de enlaces desde la terminal) |
| T-005.V1 | `backend/test/dominio.test.ts:75,79,84,88` | Pruebas de autoreferencia, ciclo detectado, caso válido y desconexión |
| T-005.V2 | `backend/test/integracion.test.ts:212` | Prueba del rechazo contra base real |

---

## 2.6 ESP-006 — Eliminación y desconexión de nodos

| Campo | Valor |
|---|---|
| **nombre** | Eliminación y desconexión de nodos |
| **nemónico** | `PSC-DEL-NODO` |
| **id** | `ESP-006` |
| **tipo** | `pseudocodigo` |
| **feature** | `F2.3` eliminación y desconexión de nodos — realiza el punto 3 del protocolo de `F2.4`; se opera desde `F2.5` |
| **escenario** | Baja de un nodo preservando a sus descendientes como raíces del grafo y devolviendo al padre su condición de hoja si procede |
| **dado** | Dado un nodo activo que puede tener padre y descendientes directos |
| **cuando** | Cuando se invoca `eliminar_nodo(nodo_id)` desde la app web o la CLI |
| **especificación** | `nodo = obtener_nodo(nodo_id)`; `desvincular_hijos_directos(padre_id = nodo_id)` asignando `parent_id = null` y `enlace_contenido = null` a sus hijos; si `nodo.parent_id != null` y `contar_hijos_activos(nodo.parent_id) == 1`, entonces `actualizar_nodo(nodo.parent_id, is_leaf = verdadero)`; finalmente `marcar_baja_logica(nodo_id)` |
| **traza** | T-006.1 … T-006.9 |

### Traza — ESP-006

| índice | ubicación | artefacto |
|---|---|---|
| T-006.1 | `backend/src/services/grafos.service.ts:166` | `eliminarNodo()`: transcripción del pseudocódigo, transaccional |
| T-006.2 | `backend/src/repositories/nodos.repo.ts:207` | `desvincularHijosDirectos()`: anula `parent_id` y `enlace_contenido` de los hijos |
| T-006.3 | `backend/src/repositories/nodos.repo.ts:193` | `contarHijosActivos()`: cuenta solo descendientes activos |
| T-006.4 | `backend/src/repositories/nodos.repo.ts:218` | `marcarIsLeaf()`: devuelve al padre la condición de hoja |
| T-006.5 | `backend/src/repositories/nodos.repo.ts:223` | `marcarBajaLogica()`: archiva sin borrar físicamente |
| T-006.6 | `deploy/postgres/init/001_schema.sql:124` | Columnas `activo` y `archivado_en`: soporte de la baja lógica |
| T-006.7 | `backend/src/routes/grafos.routes.ts:49` | `DELETE /api/v1/nodos/:id`: superficie REST |
| T-006.8 | `webapp/src/pages/Grafos.tsx:90` | Acción "Dar de baja" con confirmación explícita en el lienzo |
| T-006.9 | `cli/src/index.ts:194` | Comando `rm`, que informa cuántos hijos quedaron preservados |
| T-006.V1 | `backend/test/integracion.test.ts:187` | Prueba de desvinculación de hijos, retorno del padre a hoja y baja lógica |

---

## 2.7 ESP-007 — Protocolo de integridad del grafo

| Campo | Valor |
|---|---|
| **nombre** | Protocolo de integridad del grafo |
| **nemónico** | `PRT-INTEGRIDAD` |
| **id** | `ESP-007` |
| **tipo** | `protocolo` |
| **feature** | `F2.4` protección e integridad de datos — cubre transversalmente `F2.1`, `F2.2` y `F2.3` |
| **escenario** | Las tres invariantes del grafo se sostienen aunque la escritura no pase por la capa de aplicación |
| **dado** | Dado el grafo de conocimiento persistido como adjacency list en PostgreSQL |
| **cuando** | Cuando se inserta, reparentea o elimina cualquier nodo, por cualquier vía (API, CLI, n8n o SQL directo) |
| **especificación** | **1_** `parent_id` y `enlace_contenido` verificados por Check Constraint a nivel base de datos: `(parent_id IS NULL AND enlace_contenido IS NULL) OR (parent_id IS NOT NULL AND enlace_contenido IS NOT NULL)`. **2_** Validación de no-ciclos ejecutada de forma transaccional previa a cada confirmación de reparenteo. **3_** La eliminación de nodos aplica desvinculación huérfana segura por defecto, preservando los descendientes en el grafo como nodos raíces/aislados |
| **traza** | T-007.1 … T-007.10 |

### Traza — ESP-007

| índice | ubicación | artefacto | ítem |
|---|---|---|---|
| T-007.1 | `deploy/postgres/init/001_schema.sql:132` | `CHECK chk_par_atomico`: el constraint literal del protocolo | 1_ |
| T-007.2 | `backend/src/services/grafos.service.ts:64` | Validación del par atómico en el alta, antes de tocar la base | 1_ |
| T-007.3 | `backend/src/services/grafos.service.ts:65` | Validación del par atómico en el reparenteo | 1_ |
| T-007.4 | `backend/src/db/pool.ts:45` | `enTransaccion()`: BEGIN / COMMIT / ROLLBACK alrededor de cada mutación | 2_ |
| T-007.5 | `backend/src/services/grafos.service.ts:138` | Validación de no-ciclos previa a la confirmación del reparenteo | 2_ |
| T-007.6 | `deploy/postgres/init/002_funciones_triggers.sql:98` | `tg_nodos_aciclicidad`: barrera de base de datos | 2_ |
| T-007.7 | `backend/src/repositories/nodos.repo.ts:207` | `desvincularHijosDirectos()`: desvinculación huérfana segura | 3_ |
| T-007.8 | `deploy/postgres/init/001_schema.sql:122` | FK `parent_id ... ON DELETE SET NULL`: red de seguridad ante borrado físico | 3_ |
| T-007.9 | `backend/src/server.ts:59` | Manejador que traduce violaciones de constraint (`23514`, `23505`, `23503`) a `409 INTEGRIDAD` | 1_–3_ |
| T-007.10 | `deploy/postgres/init/001_schema.sql:152` | `CHECK chk_padre_requiere_grafo`: un nodo con padre pertenece a un grafo | 1_ |
| T-007.V1 | `backend/test/integracion.test.ts:187,212,224` | Pruebas de los tres ítems contra base real |
| T-007.V2 | `deploy/scripts/verificar_despliegue.sh` | Verificación en despliegue de la existencia del constraint y del trigger |

---

## 2.8 ESP-008 — Horas de silencio

| Campo | Valor |
|---|---|
| **nombre** | Horas de silencio |
| **nemónico** | `LOG-SILENCIO` |
| **id** | `ESP-008` |
| **tipo** | `logica` |
| **feature** | `F1.3` horas de silencio — condiciona `F1.2` generación y agendación de esfuerzos; pertenece al módulo `MOD-1` |
| **escenario** | Entre las 10pm y las 7am no se envía ningún esfuerzo: el tick no genera y todo índice que fuese a caer en esa franja se desplaza fuera |
| **dado** | Dado el tiempo global discreto `indice_global` y una franja horaria de reloj de pared que va de las 22:00 (inclusive) a las 07:00 (exclusive) |
| **cuando** | Cuando se activa el workflow de cada 10 minutos; y cuando se va a generar un nuevo `indice_siguiente_esfuerzo` para un nodo o para un grafo |
| **especificación** | Cuando se activa el workflow cada 10 minutos se comprueba que el índice no corresponda al rango de horas 10pm - 7am. Cuando se va a generar un nuevo `indice_siguiente_esfuerzo` para un nodo o grafo, este se suma 54 UE (9 horas) si es que el `indice_siguiente_esfuerzo` iba a estar en el rango de horas 10pm - 7am |
| **traza** | T-008.1 … T-008.11 |

### Traza — ESP-008

| índice | ubicación | artefacto | paso |
|---|---|---|---|
| T-008.1 | `backend/src/domain/silencio.ts:37` | `enHorasDeSilencio()`: detección del rango, con cruce de medianoche | 1 |
| T-008.2 | `backend/src/domain/silencio.ts:56` | `desplazarFueraDeSilencio()`: suma de 54 UE al índice que caería dentro | 2 |
| T-008.3 | `backend/src/domain/silencio.ts:76` | `agendarSiguiente()`: punto único por el que pasa todo agendamiento | 2 |
| T-008.4 | `backend/src/utils/tiempo.ts:30` | `horaLocal()`: traduce el índice global a hora de reloj de pared | 1 |
| T-008.5 | `backend/src/config/env.ts:71` | Configuración de la ventana: zona, hora de inicio y de fin, desplazamiento | 1, 2 |
| T-008.6 | `backend/src/config/env.ts:103` | `validarConfigSilencio()`: falla al arrancar si la zona u horas son inválidas | 1 |
| T-008.7 | `backend/src/services/scheduler.service.ts:46` | Compuerta del tick: en silencio no se selecciona ni encola nada | 1 |
| T-008.8 | `backend/src/services/scheduler.service.ts:90` | Reagendamiento del grafo mediante `agendarSiguiente` | 2 |
| T-008.9 | `backend/src/services/despacho.service.ts:45` | Compuerta del worker: no entrega items en cola durante la ventana (DEC-017) | 1 |
| T-008.10 | `backend/src/services/despacho.service.ts:135` | Reagendamiento del nodo al confirmar el envío | 2 |
| T-008.11 | `backend/src/services/nodos.service.ts:34` | Índice inicial del nodo recién registrado | 2 |
| T-008.V1 | `backend/test/silencio.test.ts` | 13 pruebas: fronteras, cruce de medianoche, hora local, suma única, ventana ancha |
| T-008.V2 | `backend/test/silencio-tick.test.ts` | 5 pruebas contra base real: compuertas del tick y del worker, archivado durante el silencio |
| T-008.V3 | `space_repetition/02_tick_espaciado.json` | El workflow refleja `en_silencio` en el resumen de la ejecución |
| T-008.V4 | `deploy/scripts/verificar_despliegue.sh` | Imprime la ventana y la hora local que el sistema cree que es |

---

# Anexo A — Trazabilidad complementaria de las descripciones

Las siete especificaciones de la Sección 2 son las únicas que responden a los
tres patrones sintácticos del criterio de identificación. El resto de `ASI.md`
—procedimientos, casos de uso y features sin patrón— son **descripciones**: qué
debe implementarse. Se trazan aquí para que ninguna parte del ASI quede sin
artefacto asignado.

| id | descripción | origen en ASI.md | feature | traza |
|---|---|---|---|---|
| DSC-001 | Unidad de espaciado: 1 UE = 600 s | feature 1 | `F1` | `backend/src/config/env.ts:71` `SEGUNDOS_POR_UE`; `deploy/postgres/init/002_funciones_triggers.sql:9` |
| DSC-002 | Estructura del mensaje de registro `[nodo_esfuerzo] \| [nodo_crudo] \| [fecha_limite]` | feature 1.1 | `F1.1` | `backend/src/domain/parser.ts:99` `parsearNodo()`; `backend/test/dominio.test.ts:93` |
| DSC-003 | Registrar un nodo es la operación por defecto del bot | feature 1.1 / procedimiento 1 | `F1.1`, `MOD-1` | `backend/src/domain/parser.ts:29` `detectarComando()`; `backend/src/services/telegram.service.ts:90` rama `default` |
| DSC-004 | Nodo temporal: genera esfuerzos hasta la fecha límite y luego se archiva | feature 1.1 | `F1.1` | `deploy/postgres/init/001_schema.sql:118` columna generada `es_temporal`; `backend/src/repositories/nodos.repo.ts:77` |
| DSC-005 | Los nodos eliminados o inactivos quedan archivados con baja lógica | feature 1.1 | `F1.1`, `F2.3` | `backend/src/repositories/nodos.repo.ts:223` `marcarBajaLogica()` |
| DSC-006 | Ciclo de vida en 4 etapas con sus rangos y umbrales | feature 1.1 | `F1.1` | `backend/src/domain/fases.ts:24` `FASES`; `deploy/postgres/init/001_schema.sql:57` `fases_config` |
| DSC-007 | El nodo temporal en cuarta etapa no entra al grafo y sigue generando 54–66 UE | feature 1.1 | `F1.1`, `F1.2` | `backend/src/domain/fases.ts:88` `generaEsfuerzosPropios()`; `backend/test/dominio.test.ts:65` |
| DSC-007b | No se envían esfuerzos entre las 10pm y las 7am | feature 1.3 | `F1.3`, `MOD-1` | `backend/src/domain/silencio.ts`; `backend/src/services/despacho.service.ts:45`; `backend/test/silencio-tick.test.ts` |
| DSC-008 | Grafo como adjacency list: `parent_id`, `enlace_contenido`, `contenido` | feature 2 / 2.1 | `F2`, `F2.1` | `deploy/postgres/init/001_schema.sql:100` tabla `nodos`; `deploy/postgres/init/002_funciones_triggers.sql:174` `v_grafo_adyacencia` |
| DSC-009 | `is_leaf` mantenido por triggers para alimentar `nodos_hojas` en O(1) | feature 2.1 | `F2.1` | `deploy/postgres/init/002_funciones_triggers.sql:121` `fn_sync_is_leaf()` |
| DSC-010 | Jerarquía validada con índices sobre `parent_id` y CTEs recursivas | feature 2.1 | `F2.1` | `deploy/postgres/init/001_schema.sql:150` `ix_nodos_parent`; `backend/src/repositories/nodos.repo.ts:177` |
| DSC-011 | Interfaz reactiva de creación, enlace, navegación visual y evaluación | feature 2.5 | `F2.5` | `webapp/src/pages/Grafos.tsx`; `webapp/src/components/Lienzo.tsx` |
| DSC-012 | Panel integrado de descarga y calificación de evaluaciones dominicales | feature 2.5 | `F2.5`, `MOD-2` | `webapp/src/pages/Evaluaciones.tsx`; `backend/src/routes/evaluaciones.routes.ts:21` |
| DSC-013 | Recepción del mensaje de Telegram por el webhook del servicio de workflows | procedimiento 1, paso 1 | `MOD-1` | `space_repetition/01_ingesta_telegram.json`; `backend/src/routes/internal.routes.ts:18` |
| DSC-014 | Guardado del nodo con `fase_1`, `conteo_esfuerzo = 0`, `activo`, `indice_global + random(2,6)` | procedimiento 1, paso 2 | `F1.1`, `MOD-1` | `backend/src/services/nodos.service.ts:22` `registrar()`; `backend/test/integracion.test.ts:50` |
| DSC-015 | Respuesta explicativa ante discordancia sintáctica y fin del flujo | procedimiento 1, paso 2 | `MOD-1` | `backend/src/services/telegram.service.ts:92` `catch (ErrorDominio)`; `backend/test/integracion.test.ts:87`, `:98` |
| DSC-016 | Tick cronometrado cada 10 min que calcula `indice_global` | procedimiento "recibiendo esfuerzos", paso 1 | `F1.2`, `MOD-1` | `space_repetition/02_tick_espaciado.json`; `backend/src/services/scheduler.service.ts:32` |
| DSC-017 | Cola `effort_dispatch_queue` con registros priorizados | procedimiento "recibiendo esfuerzos", paso 2 | `F1.2` | `deploy/postgres/init/001_schema.sql:160`; `backend/src/repositories/cola.repo.ts` |
| DSC-018 | Worker: máximo 10 mensajes por UE, espaciados a 1 por minuto | procedimiento "recibiendo esfuerzos", paso 2 | `F1.2`, `MOD-1` | `backend/src/services/despacho.service.ts:36` `reclamarSiguiente()`; `space_repetition/03_worker_despacho.json`; `backend/test/integracion.test.ts:263` |
| DSC-019 | Actualización de índices y contadores tras confirmar recepción de Telegram | procedimiento "recibiendo esfuerzos", paso 2 | `F1.2` | `backend/src/services/despacho.service.ts:89` `confirmarEnvio()` |
| DSC-020 | Autenticación e ingreso a la aplicación web centralizada | procedimiento "app web", paso 1 | `F2.5` | `webapp/src/pages/Ingreso.tsx`; `backend/src/routes/auth.routes.ts` |
| DSC-021 | Lienzo visual interactivo para crear, vincular y reparentear | procedimiento "app web", paso 2 | `F2.5` | `webapp/src/components/Lienzo.tsx`; `webapp/src/lib/grafo.ts` |
| DSC-022 | Navegación rápida por teclado y *Progressive Disclosure* | procedimiento "app web", paso 2 | `F2.5` | `webapp/src/components/Lienzo.tsx:41` navegación; `webapp/src/components/Revelable.tsx`; `webapp/src/App.tsx:34` atajos `alt+n` |
| DSC-023 | Cliente de línea de comandos `mylern-cli` | procedimiento "terminal", paso 1 | `MOD-1` | `cli/src/index.ts`; `deploy/cli/Dockerfile` |
| DSC-024 | Comunicación por HTTPS autenticada con API Token | procedimiento "terminal", paso 2 | — | `cli/src/api.ts:39`; `backend/src/middleware/auth.ts:24`; `backend/src/services/auth.service.ts:58` |
| DSC-025 | Inserción masiva, consulta de nodos y reparación de enlaces | procedimiento "terminal", paso 2 | — | `cli/src/index.ts:87` `import`; `cli/src/index.ts:176` `link`; `backend/src/routes/nodos.routes.ts:47` lote |
| DSC-026 | Comando `undo` a nivel log de transacciones | procedimiento "terminal", paso 2 | — | `backend/src/services/undo.service.ts:12`; `deploy/postgres/init/001_schema.sql:289` `transacciones_log` |
| DSC-027 | Domingo 00:00 UTC: hasta 20 nodos aleatorios de `fase_3` o `fase_4` | caso de uso 2, paso 1 | `MOD-2` | `space_repetition/04_evaluacion_dominical.json`; `backend/src/repositories/nodos.repo.ts:267` |
| DSC-028 | Cuestionario con `nodo_esfuerzo` como premisa contra `nodo_crudo` y enlaces jerárquicos | caso de uso 2, paso 1 | `MOD-2` | `backend/src/services/evaluaciones.service.ts:19` `generarSemanal()` |
| DSC-029 | Ejecución en la web o descarga del formato offline | caso de uso 2, paso 2 | `MOD-2`, `F2.5` | `backend/src/services/evaluaciones.service.ts:139` `exportarTexto()`; `webapp/src/pages/Evaluaciones.tsx:70` |
| DSC-030 | Autocalificación acierto/fallo | caso de uso 2, paso 2 | `MOD-2` | `backend/src/services/evaluaciones.service.ts:92` `calificar()` |
| DSC-031 | Métrica histórica de retención y ajuste del scheduling de los fallidos | caso de uso 2, paso 2 | `MOD-2` | `deploy/postgres/init/001_schema.sql:239` `retencion_historico`; `backend/src/services/evaluaciones.service.ts:130` `degradar()` — ver DEC-005 |
| DSC-032 | Registro de oportunidades con `[situacion]` y `[observacion]` | caso de uso 3, paso 1 | `MOD-3` | `backend/src/services/mejoras.service.ts:14`; `webapp/src/pages/Mejoras.tsx` |
| DSC-033 | Vinculación de múltiples observaciones bajo una solución formal | caso de uso 3, paso 2 | `MOD-3` | `backend/src/repositories/mejoras.repo.ts:55` `vincularOportunidades()` |
| DSC-034 | Ciclo de vida Backlog / En Progreso / Completado | caso de uso 3, paso 3 | `MOD-3` | `backend/src/services/mejoras.service.ts:61` `cambiarEstado()`; `webapp/src/pages/Mejoras.tsx:5` tablero |
| DSC-035 | Contenedor 01 — backend & API, lógica de grafos y validaciones | lista de contenedores | — | `backend/`; `deploy/backend/Dockerfile` |
| DSC-036 | Contenedor 02 — workflows n8n para webhooks y triggers | lista de contenedores | — | `space_repetition/*.json`; `deploy/docker-compose.yml` servicio `n8n` |
| DSC-037 | Contenedor 03 — PostgreSQL con soporte CTE y constraints | lista de contenedores | — | `deploy/postgres/init/`; `deploy/docker-compose.yml` servicio `postgres` |
| DSC-038 | Contenedor 04 — web app SPA de administración visual | lista de contenedores | — | `webapp/`; `deploy/webapp/Dockerfile` |
| DSC-039 | Contenedor 05 — reverse proxy TLS que aísla la red interna | lista de contenedores | — | `deploy/nginx/`; `deploy/docker-compose.yml` servicio `proxy` |

## Decisiones de diseño asociadas

Las descripciones que admitían más de una lectura, o que el ASI no cubre, están
resueltas y justificadas en [`docs/decisiones.md`](docs/decisiones.md):

| Decisión | Afecta a |
|---|---|
| DEC-001 modelo de datos unificado | ESP-001, DSC-008 |
| DEC-002 umbrales por etapa (36 / 84 / 108) | ESP-001, DSC-006 |
| DEC-003 contenido del esfuerzo en etapas 2 y 3 | ESP-001, DSC-003 |
| DEC-004 grafo destino al alcanzar la cuarta etapa | ESP-001, ESP-003 |
| DEC-005 ajuste de scheduling de nodos fallidos | DSC-031 |
| DEC-006 reagendamiento: nodo al confirmar, grafo al encolar | ESP-001, ESP-003 |
| DEC-007 reparto n8n / backend | DSC-013, DSC-016, DSC-036 |
| DEC-008 caudal 10 por UE con espaciado de 1 minuto | DSC-018 |
| DEC-009 escape del separador `\|` | DSC-002 |
| DEC-010 `contenido` y `es_temporal` derivados | ESP-002, DSC-004 |
| DEC-011 `is_leaf` por trigger y CTE recursiva | ESP-002, DSC-009, DSC-010 |
| DEC-012 vinculación cuenta web ↔ chat de Telegram | DSC-013 |
| DEC-013 alcance del comando `undo` | DSC-026 |
| DEC-014 autenticación y aislamiento de la superficie interna | DSC-024, DSC-039 |
| DEC-015 ausencia de GraphQL | DSC-035 |
| DEC-016 desplazamiento aplicado en bucle | ESP-008 |
| DEC-017 el worker también respeta el silencio | ESP-008, DSC-007b, DSC-018 |
| DEC-018 el archivado sigue durante el silencio | ESP-008, DSC-004 |
| DEC-019 la ventana es hora local | ESP-008 |
| DEC-020 superficie de seguridad reducida | DSC-024, DSC-035, DSC-039 |
