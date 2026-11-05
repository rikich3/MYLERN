import 'package:flutter/material.dart';

import '../models/learning_node.dart';
import '../services/node_controller.dart';
import 'node_editor.dart';

class NodeDetail extends StatefulWidget {
  const NodeDetail({super.key, required this.node, required this.controller});
  final LearningNode node;
  final NodeController controller;
  @override
  State<NodeDetail> createState() => _NodeDetailState();
}

class _NodeDetailState extends State<NodeDetail> {
  bool revealed = false;
  bool busy = false;
  late LearningNode node = widget.node;
  Future<void> perform(Future<void> Function() action) async {
    setState(() => busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e is FormatException
                  ? e.message
                  : 'No se pudo completar la acción. Inténtalo de nuevo.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Tu esfuerzo'),
      actions: [
        IconButton(
          tooltip: 'Editar nodo',
          onPressed: busy
              ? null
              : () async {
                  final result = await Navigator.push<LearningNode>(
                    context,
                    MaterialPageRoute(
                      builder: (_) => NodeEditor(
                        initial: node,
                        existing: widget.controller.nodes,
                      ),
                    ),
                  );
                  if (result == null || !mounted) return;
                  await perform(() async {
                    await widget.controller.save([result]);
                    if (mounted) {
                      setState(() {
                        node = result;
                        revealed = false;
                      });
                    }
                  });
                },
          icon: const Icon(Icons.edit_outlined),
        ),
        IconButton(
          tooltip: 'Eliminar nodo',
          onPressed: busy
              ? null
              : () async {
                  final confirmed = await showDialog<bool>(
                    context: context,
                    builder: (context) => AlertDialog(
                      title: const Text('¿Eliminar este nodo?'),
                      content: const Text(
                        'Se borrará del teléfono y se cancelará su recordatorio.',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: const Text('Conservar'),
                        ),
                        FilledButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: const Text('Eliminar'),
                        ),
                      ],
                    ),
                  );
                  if (confirmed != true || !mounted) return;
                  await perform(() async {
                    await widget.controller.delete(node);
                    if (context.mounted) Navigator.pop(context);
                  });
                },
          icon: const Icon(Icons.delete_outline_rounded),
        ),
      ],
    ),
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680),
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              '${node.source.toUpperCase()}  ·  ${node.timeLabel}',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 32),
            const Icon(
              Icons.psychology_alt_outlined,
              size: 56,
              color: Color(0xFF266658),
            ),
            const SizedBox(height: 24),
            Text(
              node.prompt,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 16),
            const Text('Haz una pausa e intenta responder antes de mirar.'),
            const SizedBox(height: 32),
            if (!revealed)
              OutlinedButton.icon(
                onPressed: () => setState(() => revealed = true),
                icon: const Icon(Icons.visibility_outlined),
                label: const Text('Mostrar respuesta'),
              ),
            if (revealed) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: SelectableText(
                    node.answer,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: busy
                    ? null
                    : () => perform(() async {
                        await widget.controller.review(node);
                        if (context.mounted) Navigator.pop(context);
                      }),
                icon: const Icon(Icons.check_rounded),
                label: const Text('Registrar repaso'),
              ),
            ],
            const SizedBox(height: 28),
            Text(
              '${node.reviews} repasos completados',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Recordatorio diario'),
              subtitle: Text(
                node.enabled ? 'Cada día a las ${node.timeLabel}' : 'En pausa',
              ),
              value: node.enabled,
              onChanged: busy
                  ? null
                  : (value) => perform(() async {
                      final updated = node.copyWith(enabled: value);
                      await widget.controller.save([updated]);
                      if (mounted) setState(() => node = updated);
                    }),
            ),
          ],
        ),
      ),
    ),
  );
}
