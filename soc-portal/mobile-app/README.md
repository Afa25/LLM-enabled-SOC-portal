# SOC Mobile App (Flutter)

Modern Flutter companion app for linking a mobile device to the SOC Portal using QR or a short code.

## Quick Start

1. Install Flutter (3.19+ recommended).
2. If platform folders are missing, run `flutter create .` in this folder.
3. Then run:
   - `flutter pub get`
   - `flutter run`

## Server URL

The app defaults to `http://10.0.2.2:4000` for Android emulators.

You can edit and save the server URL inside the app.

## Pairing Flow

1. In the SOC Portal, open Devices and generate a pairing QR or code.
2. In the app, scan the QR or enter the code.
3. The device links immediately (no admin approval).

## Permissions

The QR scanner needs camera access.

If you later add iOS/Android platform folders, ensure camera permissions are enabled:
   - Android: `android/app/src/main/AndroidManifest.xml`
   - iOS: `ios/Runner/Info.plist`
