# Keyfount Desktop — Design

**Status:** Draft · **Date:** 2026-05-25 · **Authors:** Loule

---

## 1. Vision

Keyfount Desktop brings the [Keyfount](https://github.com/Keyfount/extension) deterministic password manager to native desktop (macOS, Windows) and mobile (iOS, Android), with **a single codebase**, **bit-for-bit identical crypto** to the browser extension, and **first-class OS integration** (Liquid Glass, Mica, Touch ID, Windows Hello, menu bar, global hotkey).

The promise is unchanged from the extension: nothing leaves the user's machine. Generated passwords are recomputed on demand from `master + domain + email` and never stored. The desktop app adds resident surfaces (menu bar, global hotkey, Quick Search), system integrations (biometrics, autofill), and a polished local UI with optional encrypted local export and zero-knowledge sync to the existing Keyfount server.

---

## 2. Goals & non-goals

### Goals

1. **Identical algorithm.** Every `(master, domain, email, profile, counter)` produces the exact same password as the extension. Validated by a shared golden-vector test suite.
2. **One codebase, four targets.** macOS, Windows, iOS, Android share the same Rust backend and Preact frontend.
3. **Native feel.** Liquid Glass on macOS 26+, Mica on Windows 11, Material You on Android, native pickers and haptics where appropriate. Not a webview wrapper that feels like a webpage.
4. **Stable.** Pinned dependencies, narrow attack surface, the same `clippy -D warnings` + `tsc strict` discipline as the rest of the Keyfount org.
5. **Same design language as the website and the extension.** OKLCH cool-grey neutrals, single desaturated electric-blue accent, Geist + Geist Mono, pill buttons, spring transitions.

### Non-goals

- We do not maintain a separate "web app" surface. The website is marketing; the desktop app is the standalone application.
- We do not chase pixel-perfect parity with every OS HIG. We adopt the platform's chrome (window controls, vibrancy material, native dialogs) but keep the application's interior visual identity stable across platforms.
- We do not ship a recovery / "forgot master password" flow. The product is deterministic; recovery would invalidate the property that nothing leaves the user's machine.

---

## 3. Threat model

| Asset                                     | Threat                                  | Mitigation                                                                                                 |
| ----------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Master password                           | Phishing, keylogger, shoulder-surf      | Outside our scope; we never transmit it; UI hides it by default                                            |
| Master password (PIN mode, at rest)       | Local disk compromise                   | AES-GCM with a key derived via PBKDF2-SHA256 (600 000 it.) from a user PIN, then sealed in the OS keychain |
| Master password (biometric mode, at rest) | Local disk compromise                   | Same blob, additionally protected by Touch ID / Windows Hello via Secure Enclave / TPM                     |
| Per-site preferences, account history     | Local disk compromise                   | Not secret; leaking them does not leak any password                                                        |
| Sync session (OPAQUE export_key)          | Local disk compromise                   | Sealed in the OS keychain                                                                                  |
| Generated password                        | Brute-force from a leaked site password | Argon2id with `m=64 MiB, t=3, p=1` (same as extension)                                                     |
| Code supply chain                         | Malicious dependency                    | Locked Cargo and npm dependencies, narrow allow-list, Dependabot, manual review for every PR               |
| Sync server compromise                    | Offline brute-force of master           | OPAQUE protocol — even a complete DB dump leaks nothing usable to crack the master                         |

Out of scope: malware running with the same OS user privileges (no application can defend against `mimikatz`-class attackers); hardware attacks; OS keychain compromise (we trust Keychain Services / Credential Manager).

---

## 4. Architecture

### 4.1 High-level

```
┌──────────────────────────────────────────────────────────────────┐
│                        Tauri 2 App                                │
├──────────────────────────────────────────────────────────────────┤
│  Frontend (WebView)                  │  Backend (Rust)            │
│  ────────────────────                │  ──────────────            │
│  Preact 10 + signals                 │  • crypto module           │
│  Tailwind v4                         │    - argon2id (KDF)        │
│  framer-motion                       │    - render (random)       │
│  Geist + Geist Mono                  │    - memorable (EFF)       │
│                                      │    - fingerprint (emoji)   │
│  Shared design tokens with the       │    - pin (AES-GCM)         │
│  extension (theme.css, atoms.css,    │  • storage module          │
│  motion.ts, icons.tsx)               │    - SQLite WAL            │
│                                      │    - profiles, accounts    │
│  Screens:                            │    - settings              │
│  • Setup, Unlock, Main               │  • native module           │
│  • Account detail, list, settings    │    - OS keychain wrapper   │
│  • Sync, Vaults, Profile             │    - biometric             │
│  • Quick Search (overlay)            │    - menu bar / tray       │
│  • Preferences pane                  │    - global hotkey         │
│                                      │    - autofill bridge       │
│                                      │  • sync module             │
│                                      │    - OPAQUE client         │
│                                      │    - payload AES-GCM       │
│                                      │  • updater (Tauri)         │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
            ┌─────────────────────────────────┐
            │  Keyfount Server (existing)     │
            │  Fastify + SQLite + OPAQUE      │
            └─────────────────────────────────┘
```

### 4.2 IPC surface

The Tauri command surface mirrors the extension's `Request` discriminated union almost exactly (see `extension/src/shared/messages.ts`). Each command:

- is a Rust `#[tauri::command]` function with typed args and typed return.
- is callable from the frontend via `invoke("command_name", { ...args })`.
- shares its request/response types with the frontend via codegen (`ts-rs` exports each Rust struct to TypeScript).

Command groups:

| Group          | Commands                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session**    | `status`, `setup`, `unlock`, `unlock_with_pin`, `unlock_biometric`, `lock`, `fingerprint`                                                                             |
| **Generation** | `generate`, `get_profile`, `set_profile`, `delete_profile`, `set_default_profile`                                                                                     |
| **Accounts**   | `list_accounts`, `record_account`, `update_account_profile`, `rename_account`, `delete_account`                                                                       |
| **Settings**   | `get_state`, `set_auto_lock_minutes`, `set_history_enabled`, `set_favicon_fallback_enabled`, `set_clipboard_clear_seconds`, `set_pin`, `remove_pin`, `wipe`           |
| **Clipboard**  | `copy_with_auto_clear`, `arm_clipboard_clear`, `cancel_clipboard_clear`                                                                                               |
| **Vaults**     | `list_vaults`, `switch_vault`, `delete_vault`, `start_new_vault`                                                                                                      |
| **Sync**       | `sync_status`, `sync_test_connection`, `sync_connect`, `sync_poll_approval`, `sync_disconnect`, `sync_pull`, `sync_push_all`, `get_account_sync_info`, `get_sync_map` |
| **Native**     | `open_preferences`, `show_quick_search`, `register_hotkey`, `unregister_hotkey`, `enable_autofill`, `disable_autofill`, `autofill_now`                                |
| **Export**     | `export_vault`, `import_vault`                                                                                                                                        |

### 4.3 Process model

A single Tauri process. On macOS, the app runs as a **menu bar app** by default: the dock icon can be hidden (`activation_policy = "Accessory"`), and the main window is a popover anchored to the menu bar item. The user can promote it to a full dock app from preferences.

On Windows, the system tray icon plays the same role; the main window opens on click.

The Quick Search overlay is a separate borderless transparent window that uses Liquid Glass / Mica as its background, anchored to the active display. It's hidden by default and toggled by the global hotkey.

---

## 5. Crypto module (the load-bearing part)

The Rust crypto module must be **byte-for-byte identical** to the extension's TypeScript implementation. This is the property that lets a user move between the extension and the desktop app without losing access to any of their passwords.

### 5.1 Module layout

```
src-tauri/src/crypto/
├── mod.rs              # public re-exports
├── argon2.rs           # KDF + salt construction
├── render.rs           # random-character rendering
├── memorable.rs        # EFF wordlist rendering
├── fingerprint.rs      # 3-byte / 3-emoji master fingerprint
├── pin.rs              # AES-GCM + PBKDF2 for PIN mode
├── wordlist.rs         # EFF Large Wordlist (embedded as &[&str; 7776])
└── emoji_table.rs      # 256-entry fingerprint emoji table
```

### 5.2 Parameters (frozen)

```rust
pub const ARGON2_MEMORY_KIB: u32 = 65536; // 64 MiB
pub const ARGON2_ITERATIONS: u32 = 3;
pub const ARGON2_PARALLELISM: u32 = 1;
pub const ARGON2_HASH_LEN: usize = 32;
pub const FINGERPRINT_SALT: &[u8] = b"keyfount:verify";
pub const FINGERPRINT_HASH_LEN: usize = 16;
pub const PIN_PBKDF2_ITERATIONS: u32 = 600_000;
pub const PIN_SALT_LEN: usize = 16;
pub const PIN_IV_LEN: usize = 12;
```

These constants are mirrored from the extension and **must not change** in v1.x. Any change is a breaking algorithm migration and is handled at the design level, not silently.

### 5.3 Derivation flow

```rust
pub async fn derive_password(
    inputs: &DerivationInputs,
    profile: &Profile,
) -> Result<String, CryptoError> {
    let normalised = normalise(inputs);
    let salt = build_salt(&normalised.domain, &normalised.email, profile.counter());
    let entropy_bytes = argon2id(&normalised.master, &salt, &ARGON2_PARAMS).await?;
    let entropy = bytes_to_big_int(&entropy_bytes);

    match profile {
        Profile::Random(p) => render_random(&entropy, p),
        Profile::Memorable(p) => render_memorable(&entropy, p),
    }
}
```

### 5.4 Golden vectors

A JSON file at `tests/golden-vectors.json` contains a set of `{master, domain, email, profile, counter, expected_password}` tuples generated from the extension's test suite. A Rust integration test (`tests/golden_vectors.rs`) loads this file and asserts that `derive_password` produces `expected_password` for every entry. CI fails the build on any mismatch.

The same JSON file is also referenced by the extension to keep both sides honest — a refactor on either side that produces a different output is caught immediately.

### 5.5 EFF wordlist

The EFF Large Wordlist (7 776 words, ~12.92 bits/word) is bundled as a compile-time constant in `wordlist.rs`:

```rust
pub const EFF_LARGE_WORDLIST: [&str; 7776] = include!("wordlist_data.rs");
```

The file `wordlist_data.rs` is generated once from the extension's `wordlist.ts` (it's the same list) and committed.

### 5.6 PIN mode

```rust
pub fn encrypt_master(master: &str, pin: &str) -> Result<PinBlob, CryptoError> {
    let salt = random_bytes(PIN_SALT_LEN);
    let key = pbkdf2_sha256(pin.as_bytes(), &salt, PIN_PBKDF2_ITERATIONS, 32);
    let iv = random_bytes(PIN_IV_LEN);
    let ciphertext = aes_gcm_encrypt(&key, &iv, master.as_bytes())?;
    Ok(PinBlob { ciphertext, iv, salt, iterations: PIN_PBKDF2_ITERATIONS })
}
```

The resulting `PinBlob` is serialised (base64 fields) and sealed in the OS keychain rather than written directly to disk.

---

## 6. Storage layout

### 6.1 SQLite schema

The local store is a single SQLite file at:

- macOS: `~/Library/Application Support/Keyfount/<vault-id>/vault.db`
- Windows: `%APPDATA%\Keyfount\<vault-id>\vault.db`
- Linux: `~/.local/share/Keyfount/<vault-id>/vault.db`
- iOS: app container `Documents/`
- Android: app private storage `files/`

SQLite is opened in WAL mode with `synchronous = NORMAL`. Schema (v1):

```sql
CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;

CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    default_profile_json TEXT NOT NULL,
    auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
    history_enabled INTEGER NOT NULL DEFAULT 0,
    favicon_fallback_enabled INTEGER NOT NULL DEFAULT 1,
    clipboard_clear_seconds INTEGER NOT NULL DEFAULT 30,
    fingerprint TEXT,
    pin_blob_id TEXT
) STRICT;

CREATE TABLE sites (
    domain TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE accounts (
    domain TEXT NOT NULL,
    username TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    last_synced_at INTEGER,
    last_synced_dir TEXT CHECK (last_synced_dir IN ('push', 'pull')),
    PRIMARY KEY (domain, username)
) STRICT;

CREATE TABLE pending_saves (
    domain TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    profile_json TEXT,
    created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE recent_usernames (
    domain TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;
```

Generated passwords are **never** written. The only thing close to a secret here is the `fingerprint` column, which is a 3-byte hash of the master and reveals essentially nothing.

### 6.2 OS keychain entries

| Key in keychain                       | Contents                                                     |
| ------------------------------------- | ------------------------------------------------------------ |
| `keyfount.vault.<vault-id>.pin`       | `PinBlob` (JSON, base64 fields)                              |
| `keyfount.vault.<vault-id>.biometric` | `PinBlob`-shaped blob, additionally Secure-Enclave-protected |
| `keyfount.vault.<vault-id>.sync`      | Sync session JSON (OPAQUE export_key, server URL, device id) |

The vault id is a UUID v7 generated at first-run.

### 6.3 Vault registry

A single root JSON file `vaults.json` (next to the per-vault directories) lists every vault and tracks the active one:

```json
{
  "schema_version": 1,
  "active_id": "0192abcd-...",
  "vaults": [
    {
      "id": "0192abcd-...",
      "fingerprint": "ab12cd",
      "created_at": 1748400000000,
      "last_used_at": 1748490000000
    }
  ]
}
```

---

## 7. UI

### 7.1 Shared design tokens

The frontend imports a `theme.css` that is the same recipe as the extension and the website:

- OKLCH cool-grey neutrals (`--color-ink-*`, `--color-surface-*`)
- A single desaturated electric-blue accent (`--color-accent-*`)
- Pill primary buttons with a spring transition (`--ease-spring`)
- Geist Variable + Geist Mono Variable
- Light / dark via `prefers-color-scheme` and a `.dark` class

The token file lives at `src/shared/theme.css` and is kept synchronised with the extension's version. A drift-check job in CI diffs the two and fails the build if they have diverged.

### 7.2 Screens

Each screen mirrors its extension counterpart, with extra desktop-only chrome:

| Screen                     | Source                                                   | Desktop-only additions                                                                 |
| -------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Loading                    | `extension/src/popup/components/LoadingScreen.tsx`       | —                                                                                      |
| Setup                      | `extension/src/popup/components/SetupScreen.tsx`         | Optional biometric enrolment after master setup                                        |
| Unlock                     | `extension/src/popup/components/UnlockScreen.tsx`        | Biometric button (Touch ID / Hello)                                                    |
| Main                       | `extension/src/popup/components/MainScreen.tsx`          | "Active site" replaced by a domain picker (no active tab)                              |
| Account detail             | `extension/src/popup/components/AccountDetailScreen.tsx` | —                                                                                      |
| Settings                   | `extension/src/popup/components/SettingsScreen.tsx`      | Global hotkey config, autofill toggle, biometric toggle, theme override, export/import |
| Sync                       | `extension/src/popup/components/SyncScreen.tsx`          | —                                                                                      |
| Vaults                     | `extension/src/popup/components/VaultsScreen.tsx`        | —                                                                                      |
| **Quick Search** (new)     | —                                                        | Spotlight-style overlay; domain typeahead, returns generated password                  |
| **Preferences pane** (new) | —                                                        | Native window with sidebar (General / Sync / Security / About)                         |

### 7.3 Quick Search overlay

Triggered by the global hotkey or the menu bar click. Renders a borderless transparent window centred on the active display, with Liquid Glass / Mica background. The user types a domain (typeahead against known accounts and per-site profiles), picks a username if multiple exist, hits Enter, and the password is generated and copied to the clipboard (with the configured auto-clear). The window dismisses on Escape or focus loss.

---

## 8. Native integrations

### 8.1 Liquid Glass / Mica

- **macOS 26+:** `tauri-plugin-liquid-glass` wraps `NSGlassEffectView` (a private Apple API). The plugin is gated behind a Cargo feature `liquid-glass`; the default Mac App Store build uses `tauri-plugin-window-vibrancy` with `NSVisualEffectView` instead, since private APIs are grounds for App Store rejection.
- **Windows 11:** `window-vibrancy::apply_mica` for the system Mica material.
- **Older macOS / Windows / Linux:** flat surface with the standard token-driven background, no system blur.

### 8.2 Touch ID / Windows Hello

A small Rust wrapper around `LocalAuthentication.framework` (macOS) and `Windows.Security.Credentials.UI.UserConsentVerifier` (Windows). Both produce a "user is present and authenticated" event that we use to unseal a Secure-Enclave / TPM-protected master blob.

Layout (per-platform):

```
src-tauri/src/native/
├── biometric/
│   ├── mod.rs            # platform-agnostic trait
│   ├── macos.rs          # LocalAuthentication
│   ├── windows.rs        # UserConsentVerifier
│   └── stub.rs           # other platforms (always returns Unsupported)
```

### 8.3 Menu bar / system tray

Built on `tauri::tray::TrayIconBuilder`. The default left-click opens the popover (macOS) or the main window (Windows). Right-click shows a context menu with quick actions: Unlock / Lock, Quick Search, Open Preferences, Quit.

### 8.4 Global hotkey

`tauri-plugin-global-shortcut`. The hotkey is user-configurable in Preferences. Default is `Cmd+Shift+K` on macOS and `Ctrl+Shift+K` on Windows. It opens the Quick Search overlay.

### 8.5 Autofill bridge (opt-in)

A native module that watches focus events on password fields system-wide. Highly OS-specific:

- **macOS:** the Accessibility API (`AXObserver`) attached to the focused application. Requires the user to grant "Accessibility" permission in System Settings. The bridge proposes a popup near the focused field with a "Fill" button. We never read the user's typed input — we only observe focus state.
- **Windows:** UI Automation (`IUIAutomation::AddFocusChangedEventHandler`) plus the credential provider API for browser sign-in surfaces.
- **iOS / Android:** AutoFill Credential Provider Extension (iOS) / Autofill Service (Android). These are separate native bundles that ship inside the app.

This feature is **off by default** and ships behind a clear explanation of what permission is being granted and why.

### 8.6 Clipboard auto-clear

A background task watches the clipboard contents and clears them when:

1. The user has armed an auto-clear (`copy_with_auto_clear`).
2. The configured `clipboard_clear_seconds` has elapsed.
3. The clipboard still contains the value we wrote (we compare before clearing — if the user has copied something else, we leave it alone).

---

## 9. Sync

The sync client is a Rust port of `extension/src/shared/sync/` and `extension/src/background/sync/`. Same OPAQUE flow, same payload format, same endpoints on the existing Keyfount server.

- `@cloudflare/opaque-ts` (JS) ⇒ `opaque-ke` (Rust crate, RFC 9807).
- The OPAQUE `export_key` is sealed in the OS keychain (entry `keyfount.vault.<vault-id>.sync`).
- Payload encryption: AES-GCM with a key derived from `export_key` via HKDF-SHA256 (same domain-separation strings as the extension).

Sync direction stamps (`push` / `pull`), incremental cursor handling, and the device-approval flow are reproduced verbatim from the extension.

---

## 10. Packaging & distribution

| Target              | Output                                 | Channel                                                           |
| ------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| macOS Apple Silicon | `.dmg` (universal), `.app` notarised   | GitHub Releases + Mac App Store (separate build w/o private APIs) |
| Windows x64         | `.msix` (preferred) + `.exe` installer | GitHub Releases + Microsoft Store                                 |
| iOS                 | `.ipa`                                 | App Store Connect                                                 |
| Android             | `.aab` (Play) + `.apk` (sideload)      | Play Store + GitHub Releases                                      |

Auto-update on desktop is provided by `tauri-plugin-updater` against a signed `latest.json` manifest hosted on GitHub Releases. Updates are signed with `tauri-cli`'s `signer`, with the private key held only on the maintainer's machine.

---

## 11. Roadmap (milestones)

| M       | Title                            | Acceptance                                                                                                                              |
| ------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **M0**  | Scaffold, docs, CI               | `cargo check`, `npm run lint && typecheck && test` all green on a fresh clone. README and design doc complete.                          |
| **M1**  | Rust crypto + golden vectors     | `cargo test --all-features` passes the entire shared golden-vector suite against `argon2`, `render`, `memorable`, `fingerprint`, `pin`. |
| **M2**  | Tauri shell + Setup/Unlock       | App boots, deals with first-run setup and unlock, shows the live fingerprint, applies Liquid Glass on macOS / Mica on Windows.          |
| **M3**  | Storage + Settings               | SQLite vault DB, settings page wired, encrypted vault export/import.                                                                    |
| **M4**  | Generate + Accounts + Clipboard  | Full popup-equivalent generation flow, account history, clipboard auto-clear.                                                           |
| **M5**  | Menu bar + hotkey + Quick Search | Resident menu bar / tray, configurable global hotkey, Spotlight-style overlay.                                                          |
| **M6**  | OPAQUE sync                      | Connect, approve, pull, push, status — feature parity with the extension's sync.                                                        |
| **M7**  | Biometric unlock                 | Touch ID on macOS, Windows Hello on Windows, sealed via OS keychain.                                                                    |
| **M8**  | Autofill bridge (opt-in)         | Accessibility on macOS, UI Automation on Windows. Disabled by default with clear opt-in.                                                |
| **M9**  | Packaging + signing + updater    | Notarised DMG, signed MSIX, signed auto-update manifest.                                                                                |
| **M10** | iOS / Android                    | Same Preact + Rust pipeline targeted at Tauri mobile, with platform-specific autofill providers.                                        |

Each milestone lands as one or more small PRs on `main`, all green on CI before the next milestone starts.

---

## 12. Open questions

1. **Liquid Glass on Mac App Store.** We default to the `NSVisualEffectView` fallback for the MAS build to stay safe. Once Apple ships a public Liquid Glass API, we drop the fallback path.
2. **iOS / Android autofill UX.** Tauri mobile gives us a webview shell; the autofill credential provider needs a thin native module on each side that we still have to flesh out beyond the MVP.
3. **Quick Search privacy on autofill.** When the autofill bridge is enabled, Quick Search could optionally proactively show the matched account for the focused field. We default to off — the user must trigger it explicitly.
4. **Mobile sync vs. local-only.** On mobile we expect sync to be on by default since users will move between devices; on desktop it's still optional. We surface the recommendation in the onboarding copy.

---

## 13. Glossary

- **Argon2id** — Memory-hard KDF, winner of the 2015 Password Hashing Competition.
- **OPAQUE** — Asymmetric Password-Authenticated Key Exchange (RFC 9807). Lets the server authenticate a user without ever learning the password — even from a complete database dump.
- **EFF Large Wordlist** — 7 776 words selected by the EFF for passphrase generation, ~13 bits/word.
- **Fingerprint** — Short visual hash of the master password used to detect typos without revealing the master.
- **Liquid Glass** — Apple's new material introduced in macOS 26 Tahoe, exposed via the private `NSGlassEffectView` class.
- **Mica** — Microsoft's translucent material in Windows 11.
