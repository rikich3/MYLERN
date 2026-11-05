# Esfuerzos por WhatsApp — Evolution API v2

Flujos n8n derivados de `workflows/ejecutar_cada_1_UE.json` y
`workflows/worker_despacho.json`. Destino fijo: **51991436832**.

- `ejecutar_cada_1_UE.json`: ejecuta el scheduler cada 10 minutos.
- `worker_despacho.json`: reclama un esfuerzo cada minuto, envía su contenido
  mediante `POST /message/sendText/{instance}` y confirma o registra el fallo.

El backend conserva la cola, el límite de 10 esfuerzos por UE, la separación de
60 segundos, el silencio de 22:00 a 07:00 según `ZONA_HORARIA`, el Round Robin,
los contadores y las transiciones de etapa. No se necesita un chat de Telegram
para enviar. El texto se conserva literalmente, sin convertir `<`, `>` o `&`
en entidades HTML.

## Configuración e importación

En el proceso que ejecuta n8n, configura estas variables (si usas Docker,
deben estar incluidas en el entorno del contenedor, no solo en un archivo `.env`):

```dotenv
MILERN_API_BASE=http://backend:3000
MILERN_INTERNAL_SECRET=<mismo secreto interno del backend>
EVOLUTION_API_BASE=https://evolution.example.com
EVOLUTION_INSTANCE=<nombre exacto de la instancia conectada>
EVOLUTION_API_KEY=<clave de Evolution>
```

Usa la dirección real del backend de tu instalación. `EVOLUTION_API_BASE` es
la raíz de tu servidor Evolution **v2**, sin añadir `/v2` ni `/message/sendText`.
La instancia debe estar conectada a WhatsApp. La clave viaja en la cabecera
`apikey`; el cuerpo v2 contiene `number`, `text` y `linkPreview`.
Consulta el [código oficial de Evolution](https://github.com/EvolutionAPI/evolution-api/blob/main/src/api/routes/sendMessage.router.ts).

1. Importa ambos JSON desde el editor de n8n. Se entregan inactivos, sin IDs
   de workflows ni credenciales de la instalación original.
2. Permite a estos nodos acceder a las variables de entorno según la
   configuración de tu n8n.
3. Mantén **un solo tick** activo: el existente o la copia de esta carpeta.
4. Desactiva `worker_despacho` de Telegram y activa `whatsapp_worker_despacho`.
   Ambos consumen la misma cola: ejecutarlos juntos reparte los esfuerzos entre
   canales, no entrega una copia en cada uno. Este destino fijo recibe todos
   los esfuerzos reclamados, incluso si la base tiene varios usuarios.
5. Puedes mantener la ingesta de Telegram y las evaluaciones existentes.
   Estos nuevos flujos cubren el envío de esfuerzos, no comandos entrantes ni
   avisos de evaluación por WhatsApp.

El script `deploy/scripts/importar_workflows.sh` importa `space_repetition/`;
no importa automáticamente esta carpeta.

## Confirmación y recuperación

Solo se confirma si Evolution devuelve `key.id`, `key.fromMe=true` y un estado
de aceptación (`PENDING`, `SERVER_ACK`, `DELIVERY_ACK`, `READ` o `PLAYED`). La
aceptación por la API no equivale a lectura ni entrega en el teléfono.
Los errores HTTP y respuestas inválidas pasan a `/despacho/:id/fallo`, que
reencola hasta `DESPACHO_MAX_INTENTOS` sin incrementar el contador del nodo.

El contrato actual de `/confirmar` solo admite `telegram_message_id` numérico;
se envía `null`. El ID alfanumérico de WhatsApp queda en el historial de n8n,
no en la base del backend. No hay migraciones de esquema.

La confirmación del backend no es idempotente, por lo que este worker no la
reintenta automáticamente. Si falla después del envío, revisa el historial de
n8n y el estado del despacho antes de intervenir: puede haberse confirmado
aunque la respuesta se haya perdido. No vuelvas a ejecutar el envío completo.
Un timeout de Evolution también puede ocurrir después de aceptar el mensaje;
el reintento de la cola puede duplicarlo. No se garantiza entrega exactamente
una vez con los contratos actuales.

## Validación local

```bash
node --test workflows/whatsapp/workflows.test.mjs
```

Prueba estructura y rutas del flujo, configuración, payload v2 y aceptación o
rechazo de respuestas con datos simulados; no envía mensajes reales.
