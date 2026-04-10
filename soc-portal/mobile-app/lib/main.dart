import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  runApp(const SocMobileApp());
}

class SocMobileApp extends StatelessWidget {
  const SocMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF0EA5E9),
        brightness: Brightness.light,
      ),
    );

    return MaterialApp(
      title: 'SOC Mobile',
      debugShowCheckedModeBanner: false,
      theme: base.copyWith(
        scaffoldBackgroundColor: const Color(0xFFF5F7FB),
        textTheme: GoogleFonts.soraTextTheme(base.textTheme),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          elevation: 0,
          scrolledUnderElevation: 0,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: Color(0xFF0EA5E9), width: 1.4),
          ),
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        ),
      ),
      home: const LinkDeviceScreen(),
    );
  }
}

class LinkDeviceScreen extends StatefulWidget {
  const LinkDeviceScreen({super.key});

  @override
  State<LinkDeviceScreen> createState() => _LinkDeviceScreenState();
}

class _LinkDeviceScreenState extends State<LinkDeviceScreen> {
  static const _defaultBaseUrl = 'http://10.0.2.2:4000';

  final _baseUrlCtrl = TextEditingController();
  final _deviceNameCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();
  final _scanner = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates);

  bool _loadingSettings = true;
  bool _linking = false;
  bool _scanActive = true;
  String? _error;
  String? _success;
  String? _lastScanned;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  @override
  void dispose() {
    _baseUrlCtrl.dispose();
    _deviceNameCtrl.dispose();
    _codeCtrl.dispose();
    _scanner.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString('soc_base_url') ?? _defaultBaseUrl;
    _baseUrlCtrl.text = url;
    setState(() {
      _loadingSettings = false;
    });
  }

  Future<void> _saveBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final normalized = _normalizeBaseUrl(_baseUrlCtrl.text);
    _baseUrlCtrl.text = normalized;
    await prefs.setString('soc_base_url', normalized);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Server URL saved')),
      );
    }
  }

  String _normalizeBaseUrl(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return _defaultBaseUrl;
    if (trimmed.endsWith('/')) {
      return trimmed.substring(0, trimmed.length - 1);
    }
    return trimmed;
  }

  String _platformName() {
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.iOS:
        return 'ios';
      case TargetPlatform.macOS:
        return 'macos';
      case TargetPlatform.windows:
        return 'windows';
      case TargetPlatform.linux:
        return 'linux';
      case TargetPlatform.fuchsia:
        return 'fuchsia';
    }
  }

  PairingInput _parsePairingInput(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) return const PairingInput.empty();

    try {
      final uri = Uri.parse(trimmed);
      final token = uri.queryParameters['token'];
      final code = uri.queryParameters['code'];
      if (token != null || code != null) {
        return PairingInput(token: token, code: code);
      }
    } catch (_) {}

    if (RegExp(r'^[0-9]{4,10}$').hasMatch(trimmed)) {
      return PairingInput(code: trimmed);
    }

    return PairingInput(token: trimmed);
  }

  Future<void> _linkWithInput(PairingInput input) async {
    setState(() {
      _linking = true;
      _error = null;
      _success = null;
    });

    final baseUrl = _normalizeBaseUrl(_baseUrlCtrl.text);
    final uri = Uri.parse('$baseUrl/api/pairing/consume');
    final deviceName = _deviceNameCtrl.text.trim();

    final body = <String, dynamic>{
      if (input.token != null) 'token': input.token,
      if (input.code != null) 'code': input.code,
      'device': <String, dynamic>{
        if (deviceName.isNotEmpty) 'name': deviceName,
        'platform': _platformName(),
      }
    };

    try {
      final res = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
      final data = res.body.isNotEmpty ? jsonDecode(res.body) : null;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setState(() {
          _success = 'Device linked successfully';
        });
      } else {
        final message = data is Map<String, dynamic> ? data['error'] : null;
        setState(() {
          _error = message?.toString() ?? 'Linking failed';
        });
      }
    } catch (err) {
      setState(() {
        _error = err.toString();
      });
    } finally {
      setState(() {
        _linking = false;
      });
    }
  }

  void _handleScan(String raw) {
    final parsed = _parsePairingInput(raw);
    if (parsed.isEmpty) {
      setState(() => _error = 'Invalid QR code');
      return;
    }
    _linkWithInput(parsed);
  }

  @override
  Widget build(BuildContext context) {
    if (_loadingSettings) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _HeroHeader(),
                const SizedBox(height: 20),
                _buildServerCard(context),
                const SizedBox(height: 20),
                _buildLinkCard(context),
                const SizedBox(height: 16),
                _buildStatusCard(context),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildServerCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 16,
            offset: const Offset(0, 8),
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Server URL', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            'Set the SOC Portal address that issues pairing codes.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF64748B)),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _baseUrlCtrl,
            keyboardType: TextInputType.url,
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _saveBaseUrl(),
            decoration: const InputDecoration(
              hintText: 'http://10.0.2.2:4000',
            ),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: _saveBaseUrl,
              child: const Text('Save'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLinkCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 16,
            offset: const Offset(0, 8),
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Link Device', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Text(
            'Scan the QR code or type the pairing code shown on the portal.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF64748B)),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _deviceNameCtrl,
            textInputAction: TextInputAction.done,
            decoration: const InputDecoration(
              labelText: 'Device Name',
              hintText: 'My iPhone 15',
            ),
          ),
          const SizedBox(height: 16),
          TabBar(
            labelColor: const Color(0xFF0F172A),
            unselectedLabelColor: const Color(0xFF94A3B8),
            indicator: BoxDecoration(
              color: const Color(0xFFE2F3FB),
              borderRadius: BorderRadius.circular(12),
            ),
            tabs: const [
              Tab(text: 'Scan QR'),
              Tab(text: 'Enter Code'),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 360,
            child: TabBarView(
              children: [
                _buildScanTab(),
                _buildCodeTab(context),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildScanTab() {
    return Column(
      children: [
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Stack(
              children: [
                MobileScanner(
                  controller: _scanner,
                  onDetect: (capture) {
                    if (!_scanActive) return;
                    final raw = capture.barcodes.firstOrNull?.rawValue;
                    if (raw == null) return;
                    setState(() {
                      _scanActive = false;
                      _lastScanned = raw;
                    });
                    _handleScan(raw);
                  },
                ),
                Positioned.fill(
                  child: Container(
                    decoration: BoxDecoration(
                      border: Border.all(color: Colors.white.withOpacity(0.6), width: 2),
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        if (_lastScanned != null)
          Text(
            'Last scanned: ${_lastScanned!.length > 26 ? '${_lastScanned!.substring(0, 26)}...' : _lastScanned}',
            style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
          ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () {
                  setState(() {
                    _scanActive = true;
                    _lastScanned = null;
                  });
                },
                child: const Text('Scan Again'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildCodeTab(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _codeCtrl,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Pairing Code',
            hintText: 'Enter 6-digit code',
          ),
        ),
        const Spacer(),
        FilledButton.icon(
          onPressed: _linking
              ? null
              : () {
                  final input = _parsePairingInput(_codeCtrl.text);
                  if (input.isEmpty) {
                    setState(() => _error = 'Enter a valid code');
                    return;
                  }
                  _linkWithInput(input);
                },
          icon: _linking
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.link),
          label: Text(_linking ? 'Linking...' : 'Link Device'),
        ),
      ],
    );
  }

  Widget _buildStatusCard(BuildContext context) {
    final statusText = _success ?? _error;
    final isSuccess = _success != null;
    final isError = _error != null;

    if (statusText == null) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFFECFEFF),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFF99F6E4)),
        ),
        child: Row(
          children: [
            const Icon(Icons.shield_outlined, color: Color(0xFF0F766E)),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Ready to link. Generate a QR code in the SOC Portal.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: const Color(0xFF0F766E)),
              ),
            ),
          ],
        ),
      );
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isSuccess ? const Color(0xFFF0FDF4) : const Color(0xFFFFF1F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isSuccess ? const Color(0xFF86EFAC) : const Color(0xFFFDA4AF)),
      ),
      child: Row(
        children: [
          Icon(
            isSuccess ? Icons.check_circle_outline : Icons.error_outline,
            color: isSuccess ? const Color(0xFF15803D) : const Color(0xFFBE123C),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              statusText,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: isSuccess ? const Color(0xFF15803D) : const Color(0xFFBE123C),
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroHeader extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      height: 180,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
          colors: [Color(0xFF0EA5E9), Color(0xFF22C55E)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            top: -40,
            right: -30,
            child: _bubble(120),
          ),
          Positioned(
            bottom: -50,
            left: -20,
            child: _bubble(140),
          ),
          Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('SOC Mobile', style: Theme.of(context).textTheme.titleLarge?.copyWith(color: Colors.white)),
                const SizedBox(height: 8),
                Text(
                  'Securely link your phone to the SOC Portal in seconds.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Colors.white.withOpacity(0.9)),
                ),
                const Spacer(),
                Row(
                  children: [
                    const Icon(Icons.qr_code, color: Colors.white),
                    const SizedBox(width: 8),
                    Text(
                      'QR or Code Pairing',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.white),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _bubble(double size) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.white.withOpacity(0.16),
      ),
    );
  }
}

class PairingInput {
  final String? token;
  final String? code;

  const PairingInput({this.token, this.code});

  const PairingInput.empty() : token = null, code = null;

  bool get isEmpty => token == null && code == null;
}

extension _BarcodeListFirst on List<Barcode> {
  Barcode? get firstOrNull => isEmpty ? null : first;
}
