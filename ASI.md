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
ejemplos:
"ISO que se encarga de la calidad de software | ISO 25010 | 2026-12-12"
"ubicacion areopuerto Arequipa | Zamacola Cerro Colorado"
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
* La logica con el que los nodos generan esfuerzos es la siguiente:
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
func generar_esfuerzo(index, const &nodos_hojas):
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
* La logica con el que los grafos generan esfuerzos es la siguiente:
-> Cuando el workflow de cada 10 minutos empieza:
-> Se identifican los grafos donde `indice_siguiente_esfuerzo <= indice_global`.
-> Se inserta la solicitud de esfuerzo en la cola de despacho transaccional.
-> Se actualiza el cursor Round Robin del grafo y se agenda su nuevo `indice_siguiente_esfuerzo` sumando un valor pseudoaleatorio entre 54 y 66 UE.

- feature 1.3: horas de silencio
* No se va a enviar esfuerzos desde las 10pm hasta las 7am.
* La logica con la que se implementa este requisito es la siguiente:
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
func insertar_nodo(grafo_id, contenido, parent_id?, enlace_contenido?):
  si parent_id != null:
    validar_existencia_y_grafo(parent_id, grafo_id)
  nodo = crear_registro_nodo(grafo_id, contenido, parent_id, enlace_contenido, is_leaf=verdadero)
  si parent_id != null:
    actualizar_nodo(parent_id, is_leaf=falso)
  retornar nodo

* La validacion de aciclicidad en inserciones o actualizaciones de parent_id se ejecuta bajo la siguiente logica:
-> Si `parent_id == nodo.id`, rechazar de inmediato.
-> Ejecutar recorrido ascendente por ancestros (`WITH RECURSIVE`). Si el `nodo.id` coincide con algun ancestro en la ruta del `parent_id` propuesto, abortar por deteccion de ciclo.

- feature 2.3: eliminacion y desconexion de nodos
func eliminar_nodo(nodo_id):
  nodo = obtener_nodo(nodo_id)
  desvincular_hijos_directos(padre_id = nodo_id) // Asigna parent_id=null y enlace_contenido=null a sus hijos
  si nodo.parent_id != null:
    si contar_hijos_activos(nodo.parent_id) == 1:
      actualizar_nodo(nodo.parent_id, is_leaf=verdadero)
  marcar_baja_logica(nodo_id)

- feature 2.4: proteccion e integridad de datos
* Protocolo de integridad:
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