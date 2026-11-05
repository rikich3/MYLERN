import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:milern/main.dart';
import 'package:milern/models/learning_node.dart';
import 'package:milern/screens/node_editor.dart';

void main() {
  testWidgets('formulario valida vacios y devuelve nodo con contenido', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(800, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    LearningNode? result;
    await tester.pumpWidget(
      MilernApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                result = await Navigator.push<LearningNode>(
                  context,
                  MaterialPageRoute(
                    builder: (_) => const NodeEditor(
                      initial: LearningNode(
                        prompt: '',
                        answer: '',
                        minuteOfDay: 540,
                      ),
                      existing: [],
                    ),
                  ),
                );
              },
              child: const Text('Crear'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Crear'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Guardar nodo'));
    await tester.tap(find.text('Guardar nodo'));
    await tester.pumpAndSettle();
    expect(find.text('Escribe un esfuerzo.'), findsOneWidget);
    expect(find.text('Escribe una respuesta.'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).at(0), '¿Qué aprendí?');
    await tester.enterText(find.byType(TextFormField).at(1), 'Una idea nueva');
    await tester.ensureVisible(find.text('Guardar nodo'));
    await tester.tap(find.text('Guardar nodo'));
    await tester.pumpAndSettle();
    expect(result?.prompt, '¿Qué aprendí?');
    expect(result?.minuteOfDay, 540);
  });
}
