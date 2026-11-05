import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:milern/data/node_repository.dart';
import 'package:milern/main.dart';
import 'package:milern/models/learning_node.dart';
import 'package:milern/screens/home_screen.dart';
import 'package:milern/screens/node_detail.dart';
import 'package:milern/screens/scan_review.dart';
import 'package:milern/services/node_controller.dart';

import 'support.dart';

void main() {
  sqfliteFfiInit();
  late NodeController controller;
  const node = LearningNode(
    id: 1,
    prompt: '¿Qué es la memoria?',
    answer: 'La capacidad de recordar.',
    minuteOfDay: 540,
  );
  setUp(() async {
    final repository = await NodeRepository.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
    controller = NodeController(repository, FakeReminders());
    await controller.reload();
  });
  tearDown(() async {
    controller.dispose();
    await controller.repository.db.close();
  });
  testWidgets('biblioteca y agenda en pantalla estrecha', (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    controller.nodes = [node];
    await tester.pumpWidget(
      MilernApp(home: HomeScreen(controller: controller)),
    );
    await tester.pumpAndSettle();
    expect(find.text('Escanear documento'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Esfuerzos'));
    await tester.pumpAndSettle();
    expect(find.text('Cada día'), findsOneWidget);
    expect(find.text('Probar aviso'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('respuesta oculta hasta revelarla', (tester) async {
    await tester.pumpWidget(
      MilernApp(
        home: NodeDetail(node: node, controller: controller),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(node.answer), findsNothing);
    await tester.tap(find.text('Mostrar respuesta'));
    await tester.pumpAndSettle();
    expect(find.text(node.answer), findsOneWidget);
    expect(find.text('Registrar repaso'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('revision del escaneo identifica mock y permite seleccionar', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(700, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MilernApp(
        home: ScanReview(path: 'res/logo.jpg', controller: controller),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('GENERACIÓN SIMULADA'), findsOneWidget);
    expect(find.text('Guardar 3 nodos'), findsOneWidget);
    await tester.tap(find.byType(Checkbox).first);
    await tester.pumpAndSettle();
    expect(find.text('Guardar 2 nodos'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
