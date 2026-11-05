import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:milern/data/node_repository.dart';
import 'package:milern/models/learning_node.dart';
import 'package:milern/services/node_controller.dart';

import 'support.dart';

void main() {
  sqfliteFfiInit();
  late NodeRepository repository;
  late NodeController controller;
  late FakeReminders reminders;
  const node = LearningNode(
    prompt: '¿Qué es un nodo?',
    answer: 'Una idea',
    minuteOfDay: 540,
  );
  setUp(() async {
    repository = await NodeRepository.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
    reminders = FakeReminders();
    controller = NodeController(repository, reminders);
    await controller.reload();
  });
  tearDown(() async {
    controller.dispose();
    await repository.db.close();
  });
  test('crear, editar, repasar, pausar y borrar con cancelacion', () async {
    await controller.save([node]);
    final saved = controller.nodes.single;
    expect(saved.id, isNotNull);
    expect(reminders.scheduled.single.prompt, node.prompt);
    await controller.save([saved.copyWith(prompt: 'Editado')]);
    expect(reminders.scheduled.single.prompt, 'Editado');
    await controller.review(saved);
    expect(controller.nodes.single.reviews, 1);
    await controller.save([controller.nodes.single.copyWith(enabled: false)]);
    expect(reminders.scheduled, isEmpty);
    await controller.delete(saved);
    expect(controller.nodes, isEmpty);
    expect(reminders.cancelled, [saved.id]);
  });
  test('lote invalido no guarda parcialmente', () async {
    await expectLater(
      controller.save([node, node.copyWith(prompt: 'Otro')]),
      throwsFormatException,
    );
    expect(await repository.all(), isEmpty);
  });
  test('sin permiso conserva nodos sin afirmar que hay avisos', () async {
    reminders.permission = false;
    await controller.save([node]);
    expect(controller.nodes.length, 1);
    expect(controller.permission, false);
    expect(reminders.scheduled, isEmpty);
  });
  test(
    'fallo de programacion conserva contenido y permite recuperar',
    () async {
      reminders.fail = true;
      await controller.save([node]);
      expect(controller.nodes.length, 1);
      expect(controller.notificationError, isNotNull);
      reminders.fail = false;
      await controller.reload();
      expect(controller.notificationError, isNull);
      expect(reminders.scheduled.length, 1);
    },
  );
  test('si no se puede cancelar, borrar no elimina el nodo', () async {
    await controller.save([node]);
    reminders.fail = true;
    await expectLater(
      controller.delete(controller.nodes.single),
      throwsStateError,
    );
    expect((await repository.all()).length, 1);
  });
  test('persistencia tras cerrar y reabrir la base', () async {
    final dir = await Directory.systemTemp.createTemp('milern_test_');
    final path = '${dir.path}/nodes.db';
    final first = await NodeRepository.open(
      path: path,
      factory: databaseFactoryFfi,
    );
    await first.saveAll([node]);
    await first.db.close();
    final second = await NodeRepository.open(
      path: path,
      factory: databaseFactoryFfi,
    );
    expect((await second.all()).single.answer, 'Una idea');
    await second.db.close();
    await dir.delete(recursive: true);
  });
}
