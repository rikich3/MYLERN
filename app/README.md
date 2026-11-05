# MILERN móvil

App Flutter en español para crear nodos y practicar con notificaciones locales.
Funciona sin cuenta, backend, WhatsApp, Firebase ni conexión a internet.

## Ejecutar

Desarrollada con Flutter **3.47.7 / Dart 3.13.5**, usando la instalación existente.

```bash
cd app
flutter pub get
flutter run                 # Android o iOS conectado
flutter analyze
flutter test
flutter build apk --debug
```

Android requiere API 24 o superior. El proyecto incluye iOS; compilarlo requiere
macOS y Xcode. No se han añadido plataformas web/escritorio: el almacenamiento,
la cámara y la programación de avisos están destinados a Android/iOS.
El APK debug se genera en `build/app/outputs/flutter-apk/app-debug.apk`.
La configuración release generada por Flutter usa firma debug; configura tu
firma de distribución antes de publicar en una tienda.

## Uso

1. En **Mis nodos**, pulsa **Crear nodo** y escribe el esfuerzo (pregunta) y su
   respuesta. Elige un horario entre 07:00 y 21:59.
2. Pulsa **Activar** para conceder permiso de notificaciones. Si ya fue rechazado
   permanentemente, habilítalo desde los ajustes del teléfono.
3. En **Esfuerzos**, consulta los horarios y usa **Probar aviso** para comprobar
   el permiso y el canal de notificaciones.
4. Toca un nodo o su notificación: primero se muestra el esfuerzo. Revela la
   respuesta y pulsa **Registrar repaso**. Puedes editar, pausar o eliminar nodos.
5. **Escanear documento** abre la cámara o el selector de imágenes y permite
   recortar/rotar la fotografía. Se muestran tres nodos simulados, seleccionables
   y editables. Solo se guardan los seleccionados al confirmar.

El escaneo es una captura real con recorte manual; no detecta automáticamente
los bordes, no procesa PDFs ni ejecuta OCR. La generación es deliberadamente un
mock determinista sobre técnicas de aprendizaje, independiente del documento.
Las imágenes son temporales del capturador/recortador; la app no las conserva
como adjuntos de los nodos ni las envía a ningún servicio.

## Simplificación del sistema

- Se conservan esfuerzo + respuesta, práctica, horario de descanso y separación
  mínima de un minuto entre horarios programados.
- Un esfuerzo **diario recurrente por nodo**, con horario editable. No se replica
  el motor de fases 36/84/108, unidades de espaciado, grafos ni evaluación semanal.
- Máximo **60 nodos activos**, para permanecer bajo el límite de 64 solicitudes
  pendientes de iOS. Se pueden guardar más nodos pausados.
- El contador es de **repasos confirmados por la persona**, no de notificaciones
  supuestamente entregadas. Programar un aviso no demuestra su entrega.
- SQLite es la fuente de verdad. Al iniciar y volver a primer plano se concilian
  los recordatorios con los nodos guardados, reutilizando sus IDs para evitar
  duplicar solicitudes. Cambios e importaciones se guardan en transacciones.

## Notificaciones offline

`flutter_local_notifications` registra recordatorios diarios en el sistema
operativo; no depende de temporizadores Dart ni de un servidor. La programación
se repite aunque se cierre la interfaz, sin una ventana finita que necesite
renovarse. Android restaura los avisos tras reiniciar o actualizar mediante los
receivers declarados en el manifest. Al tocar una notificación se abre su nodo,
tanto con la app abierta como desde un arranque en frío.

Se usa la zona horaria del dispositivo (`flutter_timezone` + `timezone`). Abre
la app después de cambiar de zona para volver a conciliar los horarios.

Android usa `inexactAllowWhileIdle`: no requiere permiso de alarmas exactas.
El ahorro de batería, las restricciones del fabricante, el modo No molestar o
la detención forzada pueden retrasar o impedir un aviso. No se garantiza entrega
al minuto ni que un aviso retrasado llegue antes de las 22:00. La ventana de
silencio restringe el horario **programado**. Tras forzar la detención, vuelve a
abrir la app. El permiso y los ajustes del canal también deben estar activos.

No se solicita permiso de internet en el manifest principal de Android; Flutter
lo incluye únicamente en debug/profile para sus herramientas de desarrollo.
Android tiene backup automático desactivado. SQLite permanece en el sandbox de
la app; desinstalar o borrar sus datos elimina los nodos. iOS puede incluir sus
datos en las copias del dispositivo según los ajustes del usuario.

Referencias de integración: [notificaciones locales](https://pub.dev/packages/flutter_local_notifications),
[selector de imágenes](https://pub.dev/packages/image_picker),
[recorte nativo](https://pub.dev/packages/image_cropper).

## Código y pruebas

- `lib/models/`: nodo y validación de contenido, horarios y cupo.
- `lib/data/`: SQLite y transacciones.
- `lib/services/`: coordinación de persistencia/avisos, zona horaria y captura/mock.
- `lib/screens/`: biblioteca, agenda, edición, práctica e importación.
- `test/`: reglas, horario de verano, persistencia real con SQLite FFI, fallos de
  programación/cancelación, permisos denegados, importación atómica y formulario.

Validación realizada: `flutter analyze` sin incidencias y 15 pruebas aprobadas
con `flutter test`, incluidas biblioteca/agenda en pantalla estrecha, respuesta
oculta y selección de ejemplos del escaneo. No se realizaron pruebas en emulador.

## Verificación en un teléfono

Además de las pruebas automatizadas, valida en un dispositivo Android/iOS:

1. En modo avión, crear un nodo para un minuto futuro libre y conceder permisos.
2. Cerrar la interfaz y esperar el aviso (el sistema puede retrasarlo). Tocarlo
   debe abrir el esfuerzo correcto; la respuesta debe estar oculta inicialmente.
3. Reiniciar Android y comprobar otro aviso; revisar también rechazo/revocación
   de permisos y recuperación al concederlos de nuevo.
4. Editar, pausar y eliminar un nodo: su aviso anterior debe cambiar o cancelarse.
5. Capturar/recortar un documento sin red; cancelar no debe crear nodos. Guardar
   dos ejemplos debe crear exactamente dos, persistentes al reiniciar la app.

No hay dispositivo móvil conectado en el entorno de desarrollo; la entrega real,
la cámara y el reinicio deben verificarse en un teléfono. iOS no se compila desde
este entorno Linux.
