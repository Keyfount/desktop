# Keyfount Desktop

> Deterministic password manager — native desktop app for macOS and Windows, with iOS and Android targets on the same codebase. No vault, no cloud sync required, just an algorithm.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-WIP-orange.svg)](#status)
[![Tauri](https://img.shields.io/badge/Tauri-2-24c8db.svg)](https://tauri.app)

## What it is

Keyfount Desktop is the native sibling of the [Keyfount extension](https://github.com/Keyfount/extension). It does not store generated passwords — it **derives** them, on demand, from three inputs:

```
master_password + site_domain + email  ──►  Argon2id (m=64 MiB, t=3, p=1)  ──►  your site password
```

The desktop app speaks the **exact same algorithm** as the browser extension: every password computed in the extension is computed bit-for-bit identically here. A shared golden-vector test suite enforces this property at every build.

## What it adds on top of the extension

| Feature                                                              | Extension | Desktop                   |
| -------------------------------------------------------------------- | --------- | ------------------------- |
| Deterministic generation (Argon2id + base-conversion / EFF wordlist) | ✓         | ✓                         |
| Per-site profile, counter, multi-vault                               | ✓         | ✓                         |
| PIN mode                                                             | ✓         | ✓ (sealed by OS keychain) |
| Self-hostable zero-knowledge sync                                    | ✓         | ✓                         |
| Account history (opt-in)                                             | ✓         | ✓                         |
| Resident menu bar / system tray                                      | —         | ✓                         |
| Global hotkey (default `⌘⇧K` / `Ctrl+Shift+K`)                       | —         | ✓                         |
| Quick Search overlay (Spotlight-style)                               | —         | ✓                         |
| Biometric unlock (Touch ID, Windows Hello)                           | —         | ✓                         |
| Liquid Glass (macOS 26+) / Mica (Windows 11)                         | —         | ✓                         |
| Encrypted local export / import (`.keyfountvault`)                   | —         | ✓                         |
| System-wide autofill (opt-in, accessibility)                         | —         | ✓                         |
| Auto-update via signed releases                                      | —         | ✓                         |

## Status

🚧 **Work in progress.** The roadmap is split into 10 milestones — see [the design doc](./docs/design/2026-05-25-keyfount-desktop-design.md) for the full plan.

| Milestone | Scope                                                                                                              | State             |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ----------------- |
| M0        | Scaffold, docs, CI                                                                                                 | ✅ Landed         |
| M1        | Rust crypto + golden vectors (56 unit tests + cross-implementation vectors validated against the extension)        | ✅ Landed         |
| M2        | Tauri shell, Setup / Unlock / Main / Account detail / Settings / Sync / Vaults / Quick Search, Liquid Glass + Mica | ✅ Landed         |
| M3        | Local storage (SQLite), per-vault registry, settings, encrypted vault export / import                              | ✅ Landed         |
| M4        | Generate, account history, per-site profiles, clipboard auto-clear                                                 | ✅ Landed         |
| M5        | Resident menu bar / tray, global hotkey, Quick Search overlay route                                                | ✅ Landed         |
| M6.1      | OPAQUE sync foundation: HTTP client, payload AES-GCM, session shape                                                | ✅ Landed         |
| M6.2      | Full OPAQUE wire integration with the Keyfount server (gated on the server's opaque-ke v3.0 upgrade)               | 🚧 Planned        |
| M7.1      | Biometric module scaffold + keychain entry naming                                                                  | ✅ Landed         |
| M7.2      | Touch ID (`LocalAuthentication`) + Windows Hello (`UserConsentVerifier`) bridge with hardware test                 | 🚧 Planned        |
| M8.1      | Autofill module scaffold + opt-in toggle gated behind OS permission                                                | ✅ Landed         |
| M8.2      | macOS Accessibility + Windows UI Automation bridge, mobile credential providers                                    | 🚧 Planned        |
| M9        | Signed release pipeline (DMG / MSIX / EXE + auto-update manifest)                                                  | ✅ Pipeline ready |
| M10.1     | Mobile (iOS / Android) setup docs + scripts                                                                        | ✅ Landed         |
| M10.2     | `tauri ios init` + `tauri android init` checked in, credential provider extensions, store builds                   | 🚧 Planned        |

## Architecture (one-liner)

Tauri 2 shell with a Rust backend (crypto, storage, sync, native integrations) and a Preact + Tailwind v4 frontend that mirrors the extension's design tokens 1:1. macOS / Windows / iOS / Android from a single codebase, with native plugins per platform.

```
┌──────────────────────────────────────────────────────────┐
│                      Tauri 2 App                          │
│  ┌────────────────────┐   ┌───────────────────────────┐  │
│  │  Frontend           │   │  Backend (Rust)            │  │
│  │  Preact 10          │   │  • argon2 / render         │  │
│  │  Tailwind v4        │   │  • SQLite (storage)        │  │
│  │  framer-motion      │◄─►│  • OPAQUE client (sync)    │  │
│  │  signals            │   │  • OS keychain (PIN/sync)  │  │
│  │  shared tokens      │   │  • Touch ID / Hello        │  │
│  │                     │   │  • Liquid Glass / Mica     │  │
│  └────────────────────┘   └───────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Quick start

### Requirements

- **Node 22+** (`.nvmrc` pinned to 22)
- **Rust stable** (1.93+, install via `rustup`)
- **Xcode Command Line Tools** on macOS
- For iOS: Xcode + Apple Developer account
- For Android: Android Studio + JDK 17 + NDK
- For Windows: WebView2 runtime (preinstalled on Windows 11)

### Install & run

```bash
# Frontend dependencies
npm install

# Desktop dev (macOS / Windows)
npm run dev:tauri

# iOS dev (requires Xcode)
npm run dev:ios

# Android dev (requires Android Studio + NDK)
npm run dev:android
```

### Build a release

```bash
# macOS .dmg / .app
npm run build:tauri

# iOS .ipa
npm run build:ios

# Android .apk / .aab
npm run build:android
```

Signed releases are produced by CI on tag pushes — see [`.github/workflows/release.yml`](./.github/workflows/release.yml).

## Tests

```bash
# Frontend (Vitest + happy-dom)
npm test

# Rust crypto + storage (unit + golden vectors)
npm run test:rust

# Lint & format
npm run lint && npm run format:check
npm run lint:rust
```

The Rust crypto module is validated against [a frozen set of golden vectors](./tests/golden-vectors.json) shared with the extension. **Any change that produces a different output for the same inputs fails CI.** This is the load-bearing guarantee that lets users move between the extension and the desktop app without losing their passwords.

## Security

If you discover a security issue, please **do not** open a public issue. See [SECURITY.md](./SECURITY.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
