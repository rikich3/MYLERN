import 'package:flutter/material.dart';
import 'package:image_cropper/image_cropper.dart';
import 'package:image_picker/image_picker.dart';

import '../models/learning_node.dart';

class DocumentScanner {
  final picker = ImagePicker();
  Future<String?> capture(ImageSource source) async {
    final image = await picker.pickImage(
      source: source,
      maxWidth: 2400,
      imageQuality: 88,
    );
    if (image == null) return null;
    return crop(image.path);
  }

  Future<String?> recover() async {
    final response = await picker.retrieveLostData();
    if (response.exception != null) throw response.exception!;
    final images = response.files;
    return images == null || images.isEmpty ? null : images.first.path;
  }

  Future<String?> crop(String path) async {
    final result = await ImageCropper().cropImage(
      sourcePath: path,
      uiSettings: [
        AndroidUiSettings(
          toolbarTitle: 'Recortar documento',
          toolbarColor: const Color(0xFF182B28),
          toolbarWidgetColor: Colors.white,
          lockAspectRatio: false,
        ),
        IOSUiSettings(
          title: 'Recortar documento',
          doneButtonTitle: 'Usar',
          cancelButtonTitle: 'Cancelar',
        ),
      ],
    );
    return result?.path;
  }
}

/// Intentionally independent of image contents: no OCR, model or network request.
List<LearningNode> mockDocumentNodes(List<LearningNode> existing) {
  const examples = [
    (
      '¿Qué es la recuperación activa?',
      'Intentar recordar una idea sin consultar el material de estudio.',
    ),
    (
      '¿Para qué sirve la repetición espaciada?',
      'Para reforzar la memoria distribuyendo los repasos a lo largo del tiempo.',
    ),
    (
      '¿Cómo puedes comprobar que comprendiste una idea?',
      'Explicándola con tus propias palabras y construyendo un ejemplo.',
    ),
  ];
  final allocated = [...existing];
  final result = <LearningNode>[];
  for (final (prompt, answer) in examples) {
    final node = LearningNode(
      prompt: prompt,
      answer: answer,
      minuteOfDay: availableMinute(allocated),
      source: 'Escaneo · ejemplo',
    );
    result.add(node);
    allocated.add(node);
  }
  return result;
}
