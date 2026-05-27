# Mobile UI design — Keyfount Android & iOS

**Date:** 2026-05-26
**Branch:** `feat/mobile-support`
**Status:** design, awaiting implementation
**Owner:** Loule

## 1. Context

Keyfount Desktop already runs on Tauri 2's iOS and Android runtimes — see [`docs/MOBILE.md`](../../MOBILE.md) and the `feat/mobile-support` branch that landed:

- the Android Gradle/Kotlin scaffold + the iOS Xcode/Swift scaffold;
- the Rust gates (`#[cfg(desktop)]` around tray, global-shortcut, updater);
- the rustls `ring` provider install on Android/iOS so the Tauri/reqwest TLS stack can boot;
- a `$HOME` redirect to the app sandbox so `store::vaults::root_dir()`'s XDG fallback resolves to a writable path;
- Keyfount-branded launcher icons (adaptive Android + iOS AppIcon set);
- `tauri.android.conf.json` + `tauri.ios.conf.json` overrides that disable the macOS-only `transparent` + `windowEffects` so the mobile WebView is opaque.

What is **not** done: the UI itself. Right now the WebView loads the desktop layout (fixed 232 px sidebar, hover affordances, `data-tauri-drag-region`) on top of a 393 × 852 pt phone, which is obviously wrong. This spec covers the mobile-specific UI shell, the navigation paradigm, and per-screen behaviour.

## 2. Hard constraint — desktop is untouchable

This refactor MUST NOT alter the desktop UI in any visible or behavioural way. Concretely:

- No edits to `src/App.tsx`, `src/components/AppShell.tsx`, `src/components/Sidebar.tsx`, `src/components/Titlebar.tsx`, `src/components/GeneratorView.tsx`, `src/components/AccountsView.tsx`, `src/components/SettingsScreen.tsx`, `src/components/SyncScreen.tsx`, `src/components/VaultsScreen.tsx`, `src/components/SetupScreen.tsx`, `src/components/UnlockScreen.tsx`, `src/components/QuickSearchScreen.tsx`, `src/components/ProfileEditor.tsx`, `src/DotGrid.tsx`, `src/Titlebar.tsx` — except for the **one** entry-point switch described in §4.1.
- No changes to the `data-tauri-drag-region` behaviour, `windowEffects` HUD material, global hotkey, system tray, or window chrome on macOS/Windows/Linux.
- Shared, non-UI modules (`api.ts`, `state.ts`, `i18n.ts`, `motion.ts`, `icons.tsx`, `Logo.tsx`, `sync/`, `theme.css`, `atoms.css`, `types.ts`) stay shared. Any new behaviour they need lives behind a feature flag (`platform.isMobile`).
- `cargo check --target aarch64-apple-darwin` + `cargo test --all-features --lib` + `npm test` must pass before each PR (they pass today; the desktop is the regression gate).

Practically: every new file lives under `src/mobile/`. The single existing-file edit is the runtime switch in `src/main.tsx` (one `if` block).

## 3. Decided architecture

The four open questions from brainstorm screen 02 were all validated:

1. **Bottom nav with 3 primary tabs.** `Comptes` / `Générateur` / `Paramètres`. No `Sync`, no `Vaults`, no `Lock` row in the bottom nav — those live elsewhere (see below).
2. **`Sync` lives inside `Paramètres`** as a section with the same status dot the desktop sidebar shows next to its `Sync` entry.
3. **Vault switching lives behind the top-right avatar.** Tapping the round vault avatar (first emoji of the active fingerprint, mirroring the extension's `VaultAvatar`) opens a bottom sheet that lists every vault and exposes "New vault" + "Lock now".
4. **Quick Search is a pull-to-search on the `Comptes` tab.** No global hotkey is available on mobile; the gesture replaces it inside the only screen where account search is meaningful.

iOS uses **Liquid Glass** (system `UIVisualEffectView` blur, mimicked in CSS via `backdrop-filter: blur(28px) saturate(1.8)`) on the bottom nav and the vault sheet's drag handle. Android uses an opaque Material 3 surface for the same components (no `backdrop-filter`; Android's WebView is unreliable for live blur).

## 4. File layout

```
src/
  App.tsx                     ← desktop, unchanged
  main.tsx                    ← edited (one switch, §4.1)
  platform.ts                 ← edited (extend Platform with "android"|"ios", §4.2)
  api.ts                      ← shared, unchanged
  state.ts                    ← shared, unchanged
  sync/                       ← shared, unchanged
  components/                 ← desktop only, unchanged
  mobile/
    MobileApp.tsx             ← mobile root, mirrors App.tsx shape
    MobileShell.tsx           ← bottom-nav layout (replaces AppShell)
    BottomNav.tsx             ← 3-tab nav with Liquid Glass / Material variants
    TopBar.tsx                ← logo + name + fingerprint + VaultAvatar
    VaultAvatar.tsx           ← ported from extension/src/popup/components/
    VaultSheet.tsx            ← bottom sheet: list of vaults + Lock + New
    screens/
      MobileAccountsScreen.tsx
      MobileGeneratorScreen.tsx
      MobileSettingsScreen.tsx
      MobileSetupScreen.tsx
      MobileUnlockScreen.tsx
    motion.ts                 ← mobile-specific timings (sheets, pull-to-refresh)
    style.css                 ← mobile-only utilities (Liquid Glass, safe-area)
```

`mobile/screens/Mobile*` files own their layout and reuse logic from `api.ts` / `state.ts` / the shared `sync/` modules. They do not import anything from `src/components/` — that boundary is what guarantees the desktop never breaks.

### 4.1 The one shared-code edit

`src/main.tsx` becomes:

```ts
import { render } from "preact";
import { App } from "./App.js";
import { isMobile } from "./platform.js";
import "./theme.css";

const root = document.getElementById("root")!;
if (isMobile()) {
  void (async () => {
    const { MobileApp } = await import("./mobile/MobileApp.js");
    render(<MobileApp />, root);
  })();
} else {
  render(<App />, root);
}
```

The dynamic import keeps the mobile bundle out of the desktop tree-shake.

### 4.2 Platform detection

`src/platform.ts` gains two entries:

```ts
export type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "other";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return "android";
  // iPad on iPadOS 13+ identifies as "Macintosh" but has touch support.
  if (/iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document)) return "ios";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}

export const isMobile = () => {
  const p = detectPlatform();
  return p === "android" || p === "ios";
};
```

`isMobile()` is the single check the rest of the app uses to gate mobile-specific behaviour. Existing calls to `detectPlatform()` (label switches inside biometric/autofill copy) keep working because we only added members to the union.

## 5. Screens

### 5.1 `MobileShell` — bottom nav + top bar

A vertical `div` with three regions:

```
┌─────────────────────────────┐
│ TopBar (safe-area-top + 56) │   ← logo · "Keyfount" · fp chip · VaultAvatar
├─────────────────────────────┤
│                             │
│   active screen content     │
│   (scrollable, 100% h)      │
│                             │
├─────────────────────────────┤
│ BottomNav (56 + safe-bot)   │   ← Comptes · Générateur · Paramètres
└─────────────────────────────┘
```

`MobileShell` reads `view.value` from `src/state.ts` to know which screen to render. Allowed values reuse the desktop union (`"generator" | "accounts" | "settings"`) plus a new `"setup" | "unlock"` for the full-bleed flows. `sync` and `vaults` from the desktop union are no longer routed to dedicated screens — `sync` is a section of `MobileSettingsScreen`, `vaults` opens `VaultSheet`.

### 5.2 `TopBar`

Mirrors the extension's `Header`:

- left: Keyfount logo glyph (`Logo` component, 24 px), the word "Keyfount", and the fingerprint emoji-chip (small, monospaced like the desktop sidebar);
- right: `VaultAvatar` — a 34 × 34 round button showing the first emoji of the active fingerprint. Tap opens `VaultSheet`.

Hidden on `MobileSetupScreen` and `MobileUnlockScreen` (no vault context yet).

### 5.3 `BottomNav`

Three buttons. Active tab uses `--color-ink` for the label + icon stroke; inactive uses `--color-ink-muted`. A spring underlines the active tab via `layoutId="mobile-bottomnav-active"` (Framer Motion, same trick as the desktop sidebar).

- **iOS** (`platform === "ios"`): the nav surface is `rgba(255,255,255,0.62)` plus `backdrop-filter: blur(28px) saturate(1.8)`. A 0.5 px top border at `rgba(255,255,255,0.5)`. The nav floats over scrolling content (content padding-bottom = nav height + safe-area-bottom).
- **Android**: opaque `--color-surface-elev` with a 1 px `--color-line` top border. Content scrolls behind it via the safe-area inset.

Icons reuse `src/icons.tsx` (the same SVGs the desktop sidebar uses for `Accounts`, `Generator`, `Settings`).

### 5.4 `MobileAccountsScreen`

Same data as the desktop `AccountsView` (paginated `api.list_accounts`), but:

- the long list collapses to a single column of touch-sized rows (56 px, avatar + domain + last-used time);
- the desktop's hover affordances become trailing icons (a tap on the row generates; long-press opens a context sheet with "Rename", "Edit profile", "Delete");
- a **pull-to-search** gesture exposes a search input above the list (translateY animation, opacity ramp, native iOS feel). Releasing past a threshold pins the search bar; pulling further triggers a refresh of the list. This replaces the desktop `QuickSearchScreen` overlay;
- empty state matches the desktop's: "Aucun compte encore" + a `New account` CTA.

### 5.5 `MobileGeneratorScreen`

Layout from brainstorm screen 02:

- `Site` section: a single labelled card with `Domaine` (text input). The favicon-fallback preview lives here too (same `defaultProfile` logic).
- `Identifiant` section: the email field.
- `Mot de passe` card: dark surface, monospaced password, length + version meta, large primary "Copier" button below. Long-press the password reveals the same `ProfileEditor` content in a modal sheet (length, mode, separator, version, counter — the entire desktop editor).
- Tapping a value copies it with the existing `copyWithAutoClear` flow (the toast/feedback stays the same as desktop).

### 5.6 `MobileSettingsScreen`

Native-feel grouped list (iOS plain insetted style; Android with section dividers). Sections in order:

1. **Lock now** — single tappable row, leading lock icon. Calls `api.lock()` + routes to `screen = "unlock"` (mirrors `Sidebar`'s `onLock`).
2. **Compte** — Auto-lock timer (minutes picker), PIN setup / clear, Biometric toggle, History toggle, Favicon fallback toggle. Each maps 1-to-1 to a `commands::*` API.
3. **Sync** — server URL, status dot (`syncServerStatus.value` from `sync/status.ts`), Test connection, Push/Pull, Session load/save/clear. Reuses the same HTTP wiring as the desktop `SyncScreen`; only the layout changes.
4. **Export / Import** — `export_vault` and `import_vault` commands, with the same file-picker plumbing (`@tauri-apps/plugin-dialog` works the same on mobile).
5. **Wipe** — confirmation flow identical to desktop.
6. **About** — version, fingerprint, link to the privacy doc.

No keyboard shortcuts row (none exist on mobile).

### 5.7 `VaultSheet`

A bottom sheet (rounded corners, drag handle on top, iOS Liquid Glass background / Android solid). Content:

- one row per vault: emoji avatar, name, last-used timestamp. Active vault has a check icon. Tapping a non-active row calls `api.switch_vault()` and dismisses.
- divider.
- `Nouveau coffre` row — leading `+` icon, opens `MobileSetupScreen` in `additionalVault` mode.
- `Verrouiller maintenant` row — leading lock icon, same as Settings.1 (kept here too because muscle memory: "I tapped the vault avatar, I want to lock").

Dismiss via drag-down or backdrop tap. Same `api.list_vaults()` data the desktop uses.

### 5.8 `MobileSetupScreen`

Full-bleed, no `MobileShell`. Two flows:

- **First-run** (no vault on device): the master-password fields + the fingerprint preview the user sees today, but spaced for thumb reach (single column, 16 px gutters, 56 px input height, primary button pinned just above the keyboard).
- **Additional vault** (entered from `VaultSheet`): same form + a "Cancel" affordance top-left that goes back to `MobileShell`.

### 5.9 `MobileUnlockScreen`

Full-bleed. Master password input, biometric prompt button if `biometric_available` returns true, PIN keypad if `hasPin` is true. Layout adapted for one-handed use (input near vertical centre, not at top).

## 6. Localisation (i18n)

Every visible string the mobile UI shows MUST go through `t(...)` from [`src/i18n.ts`](../../../src/i18n.ts). No literal `"Comptes"`, `"Lock now"`, `"Configurer…"` strings in JSX. The i18n module already carries 362 EN+FR keys for the desktop; the mobile UI reuses everything it can and adds new keys only when the surface is genuinely mobile-specific.

### 6.1 Keys to reuse as-is

The bottom nav labels and most form/setup/unlock copy already exist:

| Mobile surface                                                                                             | Existing key                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bottom nav · Comptes                                                                                       | `sidebar_accounts`                                                                                                                                                                                                   |
| Bottom nav · Générateur                                                                                    | `sidebar_generator`                                                                                                                                                                                                  |
| Bottom nav · Paramètres                                                                                    | `sidebar_settings`                                                                                                                                                                                                   |
| Lock affordance (Settings + vault sheet)                                                                   | `sidebar_lock`                                                                                                                                                                                                       |
| Setup screen                                                                                               | `setup_welcome`, `setup_intro`, `setup_master_label`, `setup_confirm_label`, `setup_create_button`, `setup_fingerprint_hint`, `setup_min_length`, `setup_min_length_error`, `setup_mismatch_error`, `setup_creating` |
| Unlock screen                                                                                              | `unlock_*` (whole namespace)                                                                                                                                                                                         |
| Generator screen                                                                                           | `main_*` (whole namespace), `common_copy`, `common_generate`                                                                                                                                                         |
| Settings rows (auto-lock, PIN, biometric, history, favicon, clipboard timeout, sync, export, import, wipe) | the existing `settings_*` and `sync_*` namespaces                                                                                                                                                                    |
| Empty states / loading                                                                                     | `common_loading`, `common_no_matches`                                                                                                                                                                                |

### 6.2 Keys to add

A new `mobile_*` namespace covers the surfaces with no desktop equivalent. The mobile work introduces these (EN + FR side by side):

```ts
// in EN block
mobile_vault_sheet_title: "Coffres",
mobile_vault_sheet_new: "Nouveau coffre",
mobile_vault_sheet_lock: "Verrouiller maintenant",
mobile_vault_sheet_active: "Actif",
mobile_accounts_search_placeholder: "Rechercher un compte",
mobile_accounts_search_hint: "Tire vers le bas pour rechercher",
mobile_accounts_empty_title: "Aucun compte encore",
mobile_accounts_empty_cta: "Nouveau compte",
mobile_accounts_row_actions_rename: "Renommer",
mobile_accounts_row_actions_edit_profile: "Modifier le profil",
mobile_accounts_row_actions_delete: "Supprimer",
mobile_settings_section_lock: "Sécurité",
mobile_settings_section_account: "Compte",
mobile_settings_section_sync: "Synchronisation",
mobile_settings_section_data: "Données",
mobile_settings_section_about: "À propos",
mobile_setup_additional_vault_title: "Nouveau coffre",
mobile_setup_additional_vault_cancel: "Annuler",
```

(English values come straight from a translation pass — e.g. `mobile_vault_sheet_title: "Vaults"`, `mobile_accounts_search_placeholder: "Search accounts"`, …). Translations go in the same file, in both the `EN` and `FR` blocks, in the same order, so reviewers can scan for parity.

### 6.3 Conventions

- New keys follow the existing `<screen>_<element>_<subelement>` shape used by `setup_*`, `unlock_*`, `sidebar_*`. No camelCase keys, no nested objects.
- Pluralisation uses the existing function-key pattern (`setup_min_length_error: (n: string) => …`). Mobile has no pluralisation today; if it shows up, follow the same recipe.
- Right-to-left languages are out of scope (Keyfount only ships EN + FR for now).
- Locale fallback stays `en → en`, `fr → fr`, missing key surfaces as the key string. That behaviour comes from `i18n.ts` and isn't touched.

## 7. Style system

`src/mobile/style.css` adds:

- `.glass-surface` utility: `backdrop-filter: blur(28px) saturate(1.8); background: rgba(255,255,255,0.62);` for iOS Liquid Glass elements. On Android the same class falls back to an opaque colour via a `@media (hover: none) and (pointer: coarse) and (display-mode: standalone)` check — the simpler route is just two utility classes, `.glass-ios` and `.surface-android`, picked by `platform.ts` at render time.
- safe-area utilities mapping to `env(safe-area-top|right|bottom|left)`.
- sheet/modal animation tokens (drag distance, snap thresholds).

`theme.css` is **not** edited. The mobile-only utilities live in `style.css` and are imported by `MobileApp.tsx` only.

## 8. iOS dev quirk to keep documented

Tauri 2.11.2 has a fuzzy-matching bug in `tauri ios dev <device>` — when a physical iPhone is paired (even offline) and its name is close to the simulator name (e.g. "iPhone 17 Pro Max" physical vs "iPhone 17 Pro" simulator), Tauri picks the physical device and silently falls through to "Opening Xcode" because the bail message templates `{t}` literally instead of substituting the target string. Pass a simulator name that doesn't fuzzy-match any paired device (e.g. `tauri ios dev "iPhone 17e"`). Documented in commit `e9fe656`'s message; nothing to do here.

Also: Xcode's build PATH on a hybrid Intel/Apple-Silicon Homebrew install picks up `/usr/local/bin/node` (x64) first, which `npm` doesn't fill `@tauri-apps/cli-darwin-x64` for. Install once with `npm install --no-save --no-package-lock --force "@tauri-apps/cli-darwin-x64@2.11.2"`. Long-term fix is to either commit a `postinstall` script or migrate the Intel Homebrew off Node — out of scope for this UI work.

## 9. Out of scope

- The credential provider extensions for iOS and Android — that's M10.2 in `docs/MOBILE.md`.
- App Store / Play Store listings, store screenshots, release tooling.
- iPad-specific layouts (a single phone-form layout is enough; iPad shows the same UI scaled).
- Landscape support (locked to portrait via the existing `UISupportedInterfaceOrientations` config).
- Push notifications, deep links, share extensions.
- Theming beyond what `theme.css` already provides (no separate "mobile theme"). Dark mode is automatic via `prefers-color-scheme`, same as desktop.

## 10. Validation criteria

For this design to be considered shipped:

1. `npm test`, `cargo test --all-features --lib`, `cargo clippy -- -D warnings` all pass.
2. `cargo check --target aarch64-apple-darwin` succeeds (desktop hasn't broken).
3. `tauri dev` on macOS still shows the existing app with HUD-material window, tray, hotkey — pixel-identical to today's `main`.
4. `tauri android dev` boots on the Pixel 9 Pro emulator (AVD `Pixel_9_Pro`) and shows the new shell: Comptes / Générateur / Paramètres at the bottom, vault avatar top-right.
5. `tauri ios dev "iPhone 17e"` boots on the iOS 26.5 simulator and shows the same shell with a Liquid Glass bottom nav.
6. Every desktop feature surfaced in `docs/MOBILE.md`'s deviation table has a mobile path: generator works, accounts list + search works, vault switching works, sync works (test connection succeeds against a known server), settings toggles all hit the right `commands::*` endpoints, lock works.
7. No `src/components/*.tsx` file shows up in the PR diff.
8. No literal user-facing string ships in `src/mobile/**/*.tsx`: every label, placeholder, empty-state, and action goes through `t(...)`. The PR diff should not contain a JSX text node that isn't a function call or a variable holding a `t(...)` result. Both `EN` and `FR` blocks of `src/i18n.ts` carry the new `mobile_*` keys, in the same order, with no untranslated leftover.

## 11. Open questions

(None as of writing — to be re-opened during code review if surface area shifts.)
