import 'dart:io';

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../models/learning_node.dart';

abstract class Reminders {
  Future<bool> allowed();
  Future<bool> requestPermission();
  Future<void> sync(List<LearningNode> nodes);
  Future<void> cancel(int id);
  Future<void> test();
}

tz.TZDateTime nextReminder(tz.TZDateTime now, int minute) {
  var date = tz.TZDateTime(
    now.location,
    now.year,
    now.month,
    now.day,
    minute ~/ 60,
    minute % 60,
  );
  if (!date.isAfter(now)) {
    date = tz.TZDateTime(
      now.location,
      now.year,
      now.month,
      now.day + 1,
      minute ~/ 60,
      minute % 60,
    );
  }
  return date;
}

class LocalReminders implements Reminders {
  final plugin = FlutterLocalNotificationsPlugin();
  void Function(int)? onOpen;
  int? launchNodeId;
  bool _initialized = false;
  static const details = NotificationDetails(
    android: AndroidNotificationDetails(
      'efforts_daily_v1',
      'Esfuerzos diarios',
      channelDescription: 'Recordatorios locales para practicar tus nodos',
      importance: Importance.high,
      priority: Priority.high,
      styleInformation: BigTextStyleInformation(''),
      category: AndroidNotificationCategory.reminder,
    ),
    iOS: DarwinNotificationDetails(presentAlert: true, presentSound: true),
  );

  Future<void> initialize() async {
    if (_initialized) return;
    tzdata.initializeTimeZones();
    await _timezone();
    await plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('ic_notification'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
      onDidReceiveNotificationResponse: (response) {
        final id = int.tryParse(response.payload ?? '');
        if (id != null) {
          if (onOpen != null) {
            onOpen!(id);
          } else {
            launchNodeId = id;
          }
        }
      },
    );
    final launch = await plugin.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp ?? false) {
      launchNodeId = int.tryParse(launch?.notificationResponse?.payload ?? '');
    }
    _initialized = true;
  }

  Future<void> _timezone() async {
    final zone = await FlutterTimezone.getLocalTimezone();
    tz.setLocalLocation(tz.getLocation(zone.identifier));
  }

  @override
  Future<bool> allowed() async {
    await initialize();
    if (Platform.isAndroid) {
      return await plugin
              .resolvePlatformSpecificImplementation<
                AndroidFlutterLocalNotificationsPlugin
              >()!
              .areNotificationsEnabled() ??
          false;
    }
    final permissions = await plugin
        .resolvePlatformSpecificImplementation<
          IOSFlutterLocalNotificationsPlugin
        >()!
        .checkPermissions();
    return permissions?.isEnabled ?? false;
  }

  @override
  Future<bool> requestPermission() async {
    await initialize();
    if (Platform.isAndroid) {
      return await plugin
              .resolvePlatformSpecificImplementation<
                AndroidFlutterLocalNotificationsPlugin
              >()!
              .requestNotificationsPermission() ??
          false;
    }
    return await plugin
            .resolvePlatformSpecificImplementation<
              IOSFlutterLocalNotificationsPlugin
            >()!
            .requestPermissions(alert: true, sound: true, badge: false) ??
        false;
  }

  @override
  Future<void> sync(List<LearningNode> nodes) async {
    await initialize();
    await _timezone();
    final active = nodes.where((n) => n.enabled).toList();
    if (active.length > maxActiveNodes) {
      throw StateError('Demasiados recordatorios activos');
    }
    final ids = active.map((n) => n.id).toSet();
    for (final request in await plugin.pendingNotificationRequests()) {
      if (!ids.contains(request.id)) await cancel(request.id);
    }
    if (!await allowed()) return;
    for (final node in active) {
      await plugin.zonedSchedule(
        id: node.id!,
        title: 'Un momento para recordar',
        body: node.prompt,
        scheduledDate: nextReminder(
          tz.TZDateTime.now(tz.local),
          node.minuteOfDay,
        ),
        notificationDetails: details,
        payload: node.id.toString(),
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        matchDateTimeComponents: DateTimeComponents.time,
      );
    }
  }

  @override
  Future<void> cancel(int id) async {
    await initialize();
    await plugin.cancel(id: id);
  }

  @override
  Future<void> test() => plugin.show(
    id: 2147483647,
    title: 'MILERN está contigo',
    body: 'Este es un esfuerzo local. No necesita conexión a internet.',
    notificationDetails: details,
  );
}
