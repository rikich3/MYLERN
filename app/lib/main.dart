import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'data/node_repository.dart';
import 'services/node_controller.dart';
import 'services/reminders.dart';
import 'screens/home_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MilernApp());
}

class MilernApp extends StatelessWidget {
  const MilernApp({super.key, this.home});
  final Widget? home;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'MILERN',
    debugShowCheckedModeBanner: false,
    locale: const Locale('es'),
    supportedLocales: const [Locale('es')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    theme: ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: const Color(0xFFF7F8F2),
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF285E4D),
        surface: const Color(0xFFF7F8F2),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFFF7F8F2),
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: Color(0xFFE4E8DF)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.all(18),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFFD7DFD5)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFFD7DFD5)),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: Color(0xFFD4E9B9),
        foregroundColor: Color(0xFF183E35),
        elevation: 2,
      ),
      navigationBarTheme: const NavigationBarThemeData(
        backgroundColor: Colors.white,
        indicatorColor: Color(0xFFDCE8D3),
      ),
    ),
    home: home ?? const Bootstrap(),
  );
}

class Bootstrap extends StatefulWidget {
  const Bootstrap({super.key});
  @override
  State<Bootstrap> createState() => _BootstrapState();
}

class _BootstrapState extends State<Bootstrap> {
  NodeController? controller;
  LocalReminders? reminders;
  bool failed = false;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() => failed = false);
    NodeRepository? repository;
    try {
      repository = await NodeRepository.open();
      final service = LocalReminders();
      final state = NodeController(repository, service);
      await state.reload();
      if (!mounted) {
        await repository.db.close();
        state.dispose();
        return;
      }
      setState(() {
        controller = state;
        reminders = service;
      });
    } catch (_) {
      await repository?.db.close();
      if (mounted) setState(() => failed = true);
    }
  }

  @override
  void dispose() {
    controller?.repository.db.close();
    controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (controller != null) {
      return HomeScreen(controller: controller!, localReminders: reminders);
    }
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset('res/logo.jpg', width: 220),
              const SizedBox(height: 32),
              if (!failed) const CircularProgressIndicator(),
              if (failed) ...[
                const Text(
                  'No pudimos iniciar MILERN. Tus datos no se han eliminado.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                FilledButton(onPressed: load, child: const Text('Reintentar')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
