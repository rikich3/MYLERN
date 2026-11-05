import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/learning_node.dart';

class NodeRepository {
  NodeRepository(this.db);
  final Database db;
  static Future<NodeRepository> open({
    String? path,
    DatabaseFactory? factory,
  }) async {
    final f = factory ?? databaseFactory;
    final database = await f.openDatabase(
      path ?? p.join(await f.getDatabasesPath(), 'milern.db'),
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, version) async {
          await db.execute('''CREATE TABLE nodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt TEXT NOT NULL, answer TEXT NOT NULL,
          minute INTEGER NOT NULL CHECK (minute >= 420 AND minute < 1320),
          enabled INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL, reviews INTEGER NOT NULL DEFAULT 0
        )''');
        },
      ),
    );
    return NodeRepository(database);
  }

  Future<List<LearningNode>> all() async => (await db.query(
    'nodes',
    orderBy: 'id DESC',
  )).map(LearningNode.fromMap).toList();
  Future<void> saveAll(List<LearningNode> nodes) => db.transaction((txn) async {
    for (final node in nodes) {
      if (node.id == null) {
        await txn.insert('nodes', node.toMap());
      } else {
        await txn.update(
          'nodes',
          node.toMap(),
          where: 'id = ?',
          whereArgs: [node.id],
        );
      }
    }
  });
  Future<void> delete(int id) async {
    await db.delete('nodes', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> review(int id) async {
    await db.rawUpdate('UPDATE nodes SET reviews = reviews + 1 WHERE id = ?', [
      id,
    ]);
  }
}
