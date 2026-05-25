# Mobile (iOS + Android)

Keyfount Desktop is built on Tauri 2, which supports iOS and Android from the same codebase. The Rust crypto, storage, and sync layers are reused as-is; the Preact UI re-flows to mobile viewports.

## Initial setup (one time per checkout)

### iOS

Requirements: macOS host, Xcode + Command Line Tools, an Apple Developer account, a working `Team ID`.

```bash
# Install the iOS Rust targets and Tauri's iOS skeleton.
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
npm run tauri ios init

# Run the iOS dev build against the simulator
npm run dev:ios
```

The first `ios init` generates `src-tauri/gen/apple/` with the Swift shell, the WKWebView wrapper, and the Xcode project. **Commit** the generated files so future contributors don't have to re-run init.

### Android

Requirements: Android Studio with NDK + JDK 17, `ANDROID_HOME` and `NDK_HOME` set.

```bash
# Install the Android Rust targets and Tauri's Android skeleton.
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
npm run tauri android init

# Run the Android dev build on an emulator or device
npm run dev:android
```

This generates `src-tauri/gen/android/` with a Kotlin shell + Gradle project. Same rule: commit the generated files.

## Mobile-specific deviations

| Surface | Desktop | Mobile |
|---|---|---|
| Window chrome | Resizable popover + tray | Full-screen activity / view controller |
| Global hotkey | `⌘⇧K` / `Ctrl+Shift+K` | Replaced by a home-screen Quick Action / 3D Touch shortcut |
| Biometric | Touch ID / Windows Hello via `LocalAuthentication` / `UserConsentVerifier` | Face ID / Touch ID via `LAPolicy.deviceOwnerAuthenticationWithBiometrics`; Android `BiometricPrompt` |
| Autofill | macOS Accessibility / Windows UI Automation | iOS AutoFill Credential Provider Extension; Android `AutofillService` |
| Sync | OPAQUE over HTTPS | Same |
| Storage | SQLite under `Application Support` / `%APPDATA%` | App-container `Documents/` (iOS) / app-private `files/` (Android) |

## Credential providers

The two mobile platforms expose system-level autofill through dedicated extensions, not through the same accessibility surface as the desktop. Each ships as a separate native bundle inside the main app:

- **iOS**: an `ASCredentialProviderViewController` subclass in a Swift extension target that links the same Rust crate (via the `mobile` feature of `keyfount_lib`) for password derivation.
- **Android**: an `AutofillService` subclass in a Kotlin module that calls into the Rust core through JNI.

Both extensions only need the user's master + currently active vault id; they never get to see the OPAQUE export key or talk to the sync server directly.

## Store submission

| Store | Format | Notes |
|---|---|---|
| App Store | `.ipa` (App Store Connect) | Apple Review 4.2: ship a meaningful native surface (the credential provider) on top of the WebView so the app is not classified as a "browser wrapper". |
| Play Store | `.aab` (Play Console) | Target API ≥ 34; opt out of advertising id (we don't use one). |

The store-listing copy lives in `docs/STORE_LISTING.md` (M10.2).

## Status

M10 lands in two phases:

1. **M10.1 — Init** *(this PR)*: documentation + scripts (`npm run dev:ios`, `npm run dev:android`, `npm run build:ios`, `npm run build:android`) wired up; mobile init left to a contributor with the Xcode + Android SDK install on their machine.
2. **M10.2 — Credential providers + store submission**: the iOS extension target, the Android `AutofillService`, and the first store builds.
