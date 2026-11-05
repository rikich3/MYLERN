import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../models/learning_node.dart';
import '../services/document_scanner.dart';
import '../services/node_controller.dart';
import '../services/reminders.dart';
import 'node_detail.dart';
import 'node_editor.dart';
import 'scan_review.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller, this.localReminders});
  final NodeController controller;
  final LocalReminders? localReminders;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  final scanner = DocumentScanner();
  int tab = 0;
  String query = '';
  bool scanning = false;
  bool refreshing = false;
  bool detailOpen = false;
  NodeController get controller => widget.controller;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    widget.localReminders?.onOpen = openNotification;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final id = widget.localReminders?.launchNodeId;
      widget.localReminders?.launchNodeId = null;
      if (id != null) openNotification(id);
      if (Platform.isAndroid) {
        try {
          final recovered = await scanner.recover();
          if (recovered != null && mounted) await preview(recovered);
        } catch (_) {
          message(
            'No se pudo recuperar la fotografía. Puedes volver a escanearla.',
          );
        }
      }
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.localReminders?.onOpen = null;
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !refreshing && !controller.busy) {
      refresh();
    }
  }

  Future<void> refresh() async {
    refreshing = true;
    try {
      await controller.reload();
    } catch (_) {
      message('No se pudieron cargar los nodos. Inténtalo de nuevo.');
    } finally {
      refreshing = false;
    }
  }

  void message(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }

  void openNotification(int id) {
    final found = controller.nodes.where((n) => n.id == id);
    if (found.isNotEmpty && mounted) {
      openNode(found.first);
    } else {
      message('Este nodo ya no está disponible.');
    }
  }

  Future<void> openNode(LearningNode node) async {
    if (detailOpen) return;
    detailOpen = true;
    await Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (_) => NodeDetail(node: node, controller: controller),
      ),
    );
    detailOpen = false;
  }

  Future<void> create() async {
    final result = await Navigator.push<LearningNode>(
      context,
      MaterialPageRoute(
        builder: (_) => NodeEditor(
          initial: LearningNode(
            prompt: '',
            answer: '',
            minuteOfDay: availableMinute(controller.nodes),
          ),
          existing: controller.nodes,
        ),
      ),
    );
    if (result == null || !mounted) return;
    try {
      await controller.save([result]);
      message('Nodo guardado en tu teléfono.');
    } catch (e) {
      message(e is FormatException ? e.message : 'No se pudo guardar el nodo.');
    }
  }

  Future<void> preview(String path) async {
    if (!mounted) return;
    final count = await Navigator.push<int>(
      context,
      MaterialPageRoute(
        builder: (_) => ScanReview(path: path, controller: controller),
      ),
    );
    if (count != null) message('$count nodos guardados.');
  }

  Future<void> scan() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Capturar un documento',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text(
                  'Fotografía o elige una imagen y recórtala. Luego revisa los nodos de ejemplo.',
                ),
              ),
              ListTile(
                leading: const Icon(Icons.camera_alt_outlined),
                title: const Text('Abrir cámara'),
                onTap: () => Navigator.pop(context, ImageSource.camera),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('Elegir imagen'),
                onTap: () => Navigator.pop(context, ImageSource.gallery),
              ),
            ],
          ),
        ),
      ),
    );
    if (source == null || !mounted) return;
    setState(() => scanning = true);
    try {
      final path = await scanner.capture(source);
      if (path != null) await preview(path);
    } catch (_) {
      message(
        'No se pudo abrir el documento. Comprueba el permiso de cámara o elige una imagen.',
      );
    } finally {
      if (mounted) setState(() => scanning = false);
    }
  }

  Future<void> permissions() async {
    try {
      await controller.enableNotifications();
      if (!controller.permission) {
        message(
          'Activa las notificaciones de MILERN en Ajustes del teléfono. Tus nodos siguen guardados.',
        );
      }
    } catch (_) {
      message(
        'No se pudieron activar los avisos. Revisa los permisos en Ajustes.',
      );
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final active = controller.nodes.where((n) => n.enabled).toList()
        ..sort((a, b) => a.minuteOfDay.compareTo(b.minuteOfDay));
      final filtered = controller.nodes
          .where(
            (n) => '${n.prompt} ${n.answer}'.toLowerCase().contains(
              query.toLowerCase(),
            ),
          )
          .toList();
      return Scaffold(
        appBar: AppBar(
          title: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.asset(
                  'res/logo.jpg',
                  width: 48,
                  height: 48,
                  fit: BoxFit.cover,
                ),
              ),
              const SizedBox(width: 12),
              const Text(
                'MILERN',
                style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 2),
              ),
            ],
          ),
          actions: [
            IconButton(
              tooltip: 'Cómo funciona',
              icon: const Icon(Icons.info_outline_rounded),
              onPressed: () => showDialog<void>(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('Tu aprendizaje, contigo'),
                  content: const SingleChildScrollView(
                    child: Text(
                      'Crea una pregunta y su respuesta. Recibirás un esfuerzo diario por cada nodo activo, sin internet.\n\nLa versión simplificada usa horarios diarios, sin grafos ni etapas. Admite 60 nodos activos; puedes guardar más en pausa.\n\nLos avisos son aproximados: el ahorro de batería puede retrasarlos. Si fuerzas la detención de la app, vuelve a abrirla. Al cambiar de zona horaria, abre MILERN para actualizar los horarios.\n\nEl escaneo captura y recorta una imagen. Los nodos generados son ejemplos simulados, no una lectura del documento.\n\nLos datos se guardan únicamente en este teléfono.',
                    ),
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Entendido'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 850),
              child: RefreshIndicator(
                onRefresh: refresh,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(24, 16, 24, 110),
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 7,
                          height: 7,
                          decoration: const BoxDecoration(
                            color: Color(0xFF27715C),
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 8),
                        const Text(
                          'TU ESPACIO OFFLINE',
                          style: TextStyle(
                            fontSize: 11,
                            letterSpacing: 2,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      tab == 0
                          ? 'Lo que aprendes,\nse queda contigo.'
                          : 'Un momento\npara recordar.',
                      style: Theme.of(context).textTheme.headlineLarge
                          ?.copyWith(
                            fontWeight: FontWeight.w700,
                            height: 1.15,
                            letterSpacing: -1,
                          ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      tab == 0
                          ? 'Pequeñas ideas. Un hábito que crece cada día.'
                          : 'Tus esfuerzos diarios, a la hora que elegiste.',
                      style: const TextStyle(color: Color(0xFF63716C)),
                    ),
                    const SizedBox(height: 24),
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: const Color(0xFF183E35),
                        borderRadius: BorderRadius.circular(22),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: stat(
                              '${controller.nodes.length}',
                              'nodos guardados',
                            ),
                          ),
                          Expanded(
                            child: stat('${active.length}', 'esfuerzos al día'),
                          ),
                          Expanded(
                            child: stat(
                              '${controller.nodes.fold<int>(0, (sum, n) => sum + n.reviews)}',
                              'repasos',
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    if (!controller.permission)
                      notice(
                        'Activa tus recordatorios',
                        'Permite las notificaciones para recibir esfuerzos sin abrir la app.',
                        'Activar',
                        permissions,
                      ),
                    if (controller.notificationError != null)
                      notice(
                        'Los avisos necesitan atención',
                        controller.notificationError!,
                        'Reintentar',
                        refresh,
                      ),
                    if (tab == 0) ...[
                      Card(
                        color: const Color(0xFFE9E9DE),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(20),
                          onTap: scanning || controller.busy ? null : scan,
                          child: Padding(
                            padding: const EdgeInsets.all(20),
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withValues(alpha: .7),
                                    borderRadius: BorderRadius.circular(14),
                                  ),
                                  child: scanning
                                      ? const SizedBox.square(
                                          dimension: 28,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                          ),
                                        )
                                      : const Icon(
                                          Icons.document_scanner_outlined,
                                          size: 28,
                                        ),
                                ),
                                const SizedBox(width: 16),
                                const Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Escanear documento',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w700,
                                          fontSize: 16,
                                        ),
                                      ),
                                      SizedBox(height: 5),
                                      Text(
                                        'Captura, recorta y crea nodos de ejemplo.',
                                        style: TextStyle(fontSize: 13),
                                      ),
                                    ],
                                  ),
                                ),
                                const Icon(
                                  Icons.arrow_forward_rounded,
                                  size: 20,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 28),
                      Row(
                        children: [
                          Text(
                            'Mis nodos',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          const Spacer(),
                          Text(
                            '${controller.nodes.length}',
                            style: const TextStyle(color: Color(0xFF63716C)),
                          ),
                        ],
                      ),
                      if (controller.nodes.isNotEmpty) ...[
                        const SizedBox(height: 14),
                        TextField(
                          onChanged: (value) => setState(() => query = value),
                          decoration: const InputDecoration(
                            hintText: 'Buscar una idea…',
                            prefixIcon: Icon(Icons.search_rounded),
                          ),
                        ),
                      ],
                      const SizedBox(height: 16),
                      if (controller.nodes.isEmpty)
                        empty(
                          'Tu primera idea empieza aquí',
                          'Crea un nodo con algo que quieras recordar o captura una página de tus apuntes.',
                          Icons.auto_awesome_outlined,
                        ),
                      if (controller.nodes.isNotEmpty && filtered.isEmpty)
                        empty(
                          'No encontramos esa idea',
                          'Prueba con otra palabra.',
                          Icons.search_off_rounded,
                        ),
                      for (final node in filtered) nodeCard(node),
                    ] else ...[
                      Wrap(
                        alignment: WrapAlignment.spaceBetween,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        spacing: 16,
                        children: [
                          Text(
                            'Cada día',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          TextButton.icon(
                            onPressed: controller.permission
                                ? () async {
                                    try {
                                      await controller.reminders.test();
                                      message(
                                        'Aviso de prueba solicitado. Revisa tus notificaciones.',
                                      );
                                    } catch (_) {
                                      message(
                                        'No se pudo mostrar el aviso de prueba.',
                                      );
                                    }
                                  }
                                : permissions,
                            icon: const Icon(
                              Icons.notifications_active_outlined,
                              size: 18,
                            ),
                            label: const Text('Probar aviso'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      if (active.isEmpty)
                        empty(
                          'Tu agenda está tranquila',
                          'Activa el recordatorio de un nodo para verlo aquí.',
                          Icons.wb_sunny_outlined,
                        ),
                      for (final node in active)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              SizedBox(
                                width: 62,
                                child: Padding(
                                  padding: const EdgeInsets.only(top: 22),
                                  child: Text(
                                    node.timeLabel,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ),
                              Expanded(child: nodeCard(node)),
                            ],
                          ),
                        ),
                      const SizedBox(height: 12),
                      const ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(Icons.bedtime_outlined),
                        title: Text('Tiempo de descanso'),
                        subtitle: Text(
                          'Sin esfuerzos programados de 22:00 a 07:00. Los horarios son aproximados.',
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: controller.busy ? null : create,
          icon: const Icon(Icons.add_rounded),
          label: const Text('Crear nodo'),
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (value) => setState(() => tab = value),
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.grid_view_outlined),
              selectedIcon: Icon(Icons.grid_view_rounded),
              label: 'Mis nodos',
            ),
            NavigationDestination(
              icon: Icon(Icons.schedule_outlined),
              selectedIcon: Icon(Icons.schedule_rounded),
              label: 'Esfuerzos',
            ),
          ],
        ),
      );
    },
  );
  Widget stat(String value, String label) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        value,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 28,
          fontWeight: FontWeight.w600,
        ),
      ),
      const SizedBox(height: 4),
      Text(
        label,
        style: const TextStyle(color: Color(0xFFC1D6CA), fontSize: 11),
      ),
    ],
  );
  Widget notice(String title, String text, String action, VoidCallback onTap) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFFFEAC9),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 5),
              Text(text),
              TextButton(onPressed: onTap, child: Text(action)),
            ],
          ),
        ),
      );
  Widget empty(String title, String text, IconData icon) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 32),
    child: Column(
      children: [
        Icon(icon, size: 44, color: const Color(0xFF678B78)),
        const SizedBox(height: 20),
        Text(
          title,
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(color: Color(0xFF63716C)),
        ),
      ],
    ),
  );
  Widget nodeCard(LearningNode node) => Card(
    margin: const EdgeInsets.only(bottom: 12),
    child: InkWell(
      onTap: controller.busy ? null : () => openNode(node),
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  node.source == 'Manual'
                      ? Icons.lightbulb_outline_rounded
                      : Icons.description_outlined,
                  size: 16,
                  color: const Color(0xFF63716C),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    node.source,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFF63716C),
                    ),
                  ),
                ),
                Text(
                  node.enabled ? node.timeLabel : 'En pausa',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Text(
              node.prompt,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Text(
                  '${node.reviews} repasos',
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF63716C),
                  ),
                ),
                const Spacer(),
                const Icon(Icons.arrow_forward_rounded, size: 18),
              ],
            ),
          ],
        ),
      ),
    ),
  );
}
