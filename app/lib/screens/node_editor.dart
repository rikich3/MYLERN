import 'package:flutter/material.dart';

import '../models/learning_node.dart';

class NodeEditor extends StatefulWidget {
  const NodeEditor({super.key, required this.initial, required this.existing});
  final LearningNode initial;
  final List<LearningNode> existing;
  @override
  State<NodeEditor> createState() => _NodeEditorState();
}

class _NodeEditorState extends State<NodeEditor> {
  final form = GlobalKey<FormState>();
  late final prompt = TextEditingController(text: widget.initial.prompt);
  late final answer = TextEditingController(text: widget.initial.answer);
  late int minute = widget.initial.minuteOfDay;
  late bool enabled = widget.initial.enabled;
  String? error;
  @override
  void dispose() {
    prompt.dispose();
    answer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.initial.id == null ? 'Crear nodo' : 'Editar nodo'),
    ),
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 680),
        child: Form(
          key: form,
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Text(
                'Una idea. Un pequeño esfuerzo.',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              const Text(
                'Escribe una pregunta que te invite a recordar. La respuesta se queda oculta hasta que la necesites.',
              ),
              const SizedBox(height: 28),
              TextFormField(
                controller: prompt,
                minLines: 2,
                maxLines: 5,
                maxLength: 1000,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Esfuerzo',
                  hintText: '¿Qué quiero recordar?',
                  alignLabelWithHint: true,
                ),
                validator: (value) =>
                    value!.trim().isEmpty ? 'Escribe un esfuerzo.' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: answer,
                minLines: 3,
                maxLines: 8,
                maxLength: 4000,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Respuesta',
                  hintText: 'La idea completa, con tus palabras',
                  alignLabelWithHint: true,
                ),
                validator: (value) =>
                    value!.trim().isEmpty ? 'Escribe una respuesta.' : null,
              ),
              const SizedBox(height: 16),
              Card(
                child: Column(
                  children: [
                    SwitchListTile(
                      title: const Text('Esfuerzo diario'),
                      subtitle: const Text(
                        'Una notificación, incluso sin internet',
                      ),
                      value: enabled,
                      onChanged: (value) => setState(() => enabled = value),
                    ),
                    ListTile(
                      leading: const Icon(Icons.schedule_rounded),
                      title: const Text('Hora del esfuerzo'),
                      trailing: TextButton(
                        onPressed: () async {
                          final time = await showTimePicker(
                            context: context,
                            initialTime: TimeOfDay(
                              hour: minute ~/ 60,
                              minute: minute % 60,
                            ),
                            helpText: 'Entre las 07:00 y las 21:59',
                          );
                          if (time != null) {
                            setState(
                              () => minute = time.hour * 60 + time.minute,
                            );
                          }
                        },
                        child: Text(
                          TimeOfDay(
                            hour: minute ~/ 60,
                            minute: minute % 60,
                          ).format(context),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Descanso de 22:00 a 07:00. Cada nodo tiene su propio minuto para que los esfuerzos lleguen separados.',
              ),
              if (error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              const SizedBox(height: 28),
              FilledButton.icon(
                onPressed: () {
                  if (!form.currentState!.validate()) return;
                  final node = widget.initial.copyWith(
                    prompt: prompt.text.trim(),
                    answer: answer.text.trim(),
                    minuteOfDay: minute,
                    enabled: enabled,
                  );
                  final validation = validateNode(node, widget.existing);
                  if (validation != null) {
                    setState(() => error = validation);
                    return;
                  }
                  Navigator.pop(context, node);
                },
                icon: const Icon(Icons.check_rounded),
                label: const Text('Guardar nodo'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
