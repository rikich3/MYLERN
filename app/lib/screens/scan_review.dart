import 'dart:io';

import 'package:flutter/material.dart';

import '../models/learning_node.dart';
import '../services/document_scanner.dart';
import '../services/node_controller.dart';
import 'node_editor.dart';

class ScanReview extends StatefulWidget {
  const ScanReview({super.key, required this.path, required this.controller});
  final String path;
  final NodeController controller;
  @override
  State<ScanReview> createState() => _ScanReviewState();
}

class _ScanReviewState extends State<ScanReview> {
  late final drafts = mockDocumentNodes(widget.controller.nodes);
  final selected = <int>{0, 1, 2};
  bool saving = false;
  String? error;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Revisar documento')),
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: Image.file(
                File(widget.path),
                height: 200,
                fit: BoxFit.contain,
                errorBuilder: (_, _, _) => const SizedBox(
                  height: 100,
                  child: Center(child: Text('Vista previa no disponible')),
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'De una página a pequeñas ideas',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFFFEAC9),
                borderRadius: BorderRadius.circular(16),
              ),
              child: const Text(
                'GENERACIÓN SIMULADA\nEstos 3 nodos son ejemplos sobre aprendizaje. No se ha leído el contenido del documento. Puedes editarlos y elegir cuáles guardar.',
              ),
            ),
            const SizedBox(height: 20),
            for (var i = 0; i < drafts.length; i++)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: Column(
                    children: [
                      CheckboxListTile(
                        value: selected.contains(i),
                        onChanged: saving
                            ? null
                            : (value) => setState(() {
                                value! ? selected.add(i) : selected.remove(i);
                              }),
                        title: Text(drafts[i].prompt),
                        subtitle: Text(
                          '${drafts[i].timeLabel} · ${drafts[i].enabled ? 'Diario' : 'Pausado'}',
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Text(drafts[i].answer),
                        ),
                      ),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: saving
                              ? null
                              : () async {
                                  final edited =
                                      await Navigator.push<LearningNode>(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) => NodeEditor(
                                            initial: drafts[i],
                                            existing: [
                                              ...widget.controller.nodes,
                                              for (final index in selected)
                                                if (index != i) drafts[index],
                                            ],
                                          ),
                                        ),
                                      );
                                  if (edited != null && mounted) {
                                    setState(() => drafts[i] = edited);
                                  }
                                },
                          icon: const Icon(Icons.edit_outlined, size: 18),
                          label: const Text('Editar ejemplo'),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            if (error != null)
              Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: saving || selected.isEmpty
                  ? null
                  : () async {
                      setState(() {
                        saving = true;
                        error = null;
                      });
                      try {
                        await widget.controller.save([
                          for (final i in selected) drafts[i],
                        ]);
                        if (context.mounted) {
                          Navigator.pop(context, selected.length);
                        }
                      } on FormatException catch (e) {
                        if (mounted) setState(() => error = e.message);
                      } catch (_) {
                        if (mounted) {
                          setState(
                            () => error = 'No se pudieron guardar los nodos. Inténtalo de nuevo.',
                          );
                        }
                      } finally {
                        if (mounted) setState(() => saving = false);
                      }
                    },
              icon: saving
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.add_rounded),
              label: Text('Guardar ${selected.length} nodos'),
            ),
          ],
        ),
      ),
    ),
  );
}
