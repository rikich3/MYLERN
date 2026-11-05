import 'package:milern/models/learning_node.dart';
import 'package:milern/services/reminders.dart';

class FakeReminders implements Reminders {
  bool permission = true;
  bool fail = false;
  List<LearningNode> scheduled = [];
  final cancelled = <int>[];
  @override
  Future<bool> allowed() async => permission;
  @override
  Future<bool> requestPermission() async => permission;
  @override
  Future<void> sync(List<LearningNode> nodes) async {
    if (fail) throw StateError('simulated platform failure');
    scheduled = permission ? nodes.where((n) => n.enabled).toList() : [];
  }

  @override
  Future<void> cancel(int id) async {
    if (fail) throw StateError('cancel failed');
    cancelled.add(id);
  }

  @override
  Future<void> test() async {}
}
