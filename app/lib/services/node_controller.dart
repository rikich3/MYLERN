import 'package:flutter/foundation.dart';

import '../data/node_repository.dart';
import '../models/learning_node.dart';
import 'reminders.dart';

class NodeController extends ChangeNotifier {
  NodeController(this.repository, this.reminders);
  final NodeRepository repository;
  final Reminders reminders;
  List<LearningNode> nodes = [];
  bool permission = false;
  bool busy = false;
  String? notificationError;

  Future<void> reload() async {
    nodes = await repository.all();
    await _sync();
    notifyListeners();
  }

  Future<void> _sync() async {
    try {
      permission = await reminders.allowed();
      await reminders.sync(nodes);
      notificationError = null;
    } catch (_) {
      notificationError = 'Tus nodos están guardados, pero no se pudieron programar los avisos. Pulsa Reintentar.';
    }
  }

  Future<void> _mutate(Future<void> Function() action) async {
    if (busy) throw StateError('Espera a que termine la operación anterior.');
    busy = true;
    notifyListeners();
    try {
      await action();
      await reload();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> save(List<LearningNode> batch) => _mutate(() async {
    final simulated = [...nodes];
    for (final node in batch) {
      final error = validateNode(node, simulated);
      if (error != null) throw FormatException(error);
      simulated.removeWhere((n) => n.id != null && n.id == node.id);
      simulated.add(node);
    }
    await repository.saveAll(batch);
  });
  Future<void> delete(LearningNode node) => _mutate(() async {
    // Cancellation first: failure must not leave an unmanageable recurring alert.
    await reminders.cancel(node.id!);
    await repository.delete(node.id!);
  });
  Future<void> review(LearningNode node) =>
      _mutate(() => repository.review(node.id!));
  Future<void> enableNotifications() async {
    await reminders.requestPermission();
    await reload();
  }
}
