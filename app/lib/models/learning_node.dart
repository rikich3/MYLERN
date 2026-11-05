class LearningNode {
  const LearningNode({
    this.id,
    required this.prompt,
    required this.answer,
    required this.minuteOfDay,
    this.enabled = true,
    this.source = 'Manual',
    this.reviews = 0,
  });

  final int? id;
  final String prompt;
  final String answer;
  final int minuteOfDay;
  final bool enabled;
  final String source;
  final int reviews;

  String get timeLabel =>
      '${(minuteOfDay ~/ 60).toString().padLeft(2, '0')}:${(minuteOfDay % 60).toString().padLeft(2, '0')}';

  LearningNode copyWith({
    int? id,
    String? prompt,
    String? answer,
    int? minuteOfDay,
    bool? enabled,
    int? reviews,
  }) => LearningNode(
    id: id ?? this.id,
    prompt: prompt ?? this.prompt,
    answer: answer ?? this.answer,
    minuteOfDay: minuteOfDay ?? this.minuteOfDay,
    enabled: enabled ?? this.enabled,
    source: source,
    reviews: reviews ?? this.reviews,
  );

  Map<String, Object?> toMap() => {
    if (id != null) 'id': id,
    'prompt': prompt,
    'answer': answer,
    'minute': minuteOfDay,
    'enabled': enabled ? 1 : 0,
    'source': source,
    'reviews': reviews,
  };
  factory LearningNode.fromMap(Map<String, Object?> map) => LearningNode(
    id: map['id'] as int,
    prompt: map['prompt'] as String,
    answer: map['answer'] as String,
    minuteOfDay: map['minute'] as int,
    enabled: map['enabled'] == 1,
    source: map['source'] as String,
    reviews: map['reviews'] as int,
  );
}

/// One recurring request per active node; leaves room under iOS's 64-request limit.
const maxActiveNodes = 60;
String? validateNode(LearningNode node, List<LearningNode> existing) {
  if (node.prompt.trim().isEmpty || node.answer.trim().isEmpty) {
    return 'Completa el esfuerzo y la respuesta.';
  }
  if (node.prompt.length > 1000 || node.answer.length > 4000) {
    return 'El esfuerzo admite 1000 caracteres y la respuesta 4000.';
  }
  if (node.minuteOfDay < 7 * 60 || node.minuteOfDay >= 22 * 60) {
    return 'Elige una hora entre las 07:00 y las 21:59.';
  }
  final others = existing.where((n) => n.id != node.id || node.id == null);
  if (node.enabled && others.where((n) => n.enabled).length >= maxActiveNodes) {
    return 'Puedes tener hasta 60 nodos activos. Pausa uno para continuar.';
  }
  if (node.enabled &&
      others.any((n) => n.enabled && n.minuteOfDay == node.minuteOfDay)) {
    return 'Ya hay un esfuerzo a esa hora. Elige otro minuto.';
  }
  return null;
}

int availableMinute(List<LearningNode> nodes) {
  final occupied = nodes
      .where((n) => n.enabled)
      .map((n) => n.minuteOfDay)
      .toSet();
  for (var offset = 0; offset < 15 * 60; offset++) {
    final minute = 7 * 60 + (2 * 60 + offset) % (15 * 60);
    if (!occupied.contains(minute)) return minute;
  }
  throw StateError('No hay horarios disponibles.');
}
