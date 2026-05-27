# Mobile UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the mobile (iOS + Android) UI for Keyfount as described in [`docs/superpowers/specs/2026-05-26-mobile-ui-design.md`](../specs/2026-05-26-mobile-ui-design.md), keeping the existing desktop UI byte-identical.

**Architecture:** A new `src/mobile/` tree owns every visible piece of the mobile UI (bottom-nav shell, top bar, vault sheet, five screens). One runtime switch in `src/main.tsx` lazy-loads `MobileApp` when `platform.isMobile()` is true; otherwise the existing `App` renders unchanged. All visible strings flow through `t()` from `src/i18n.ts`. No file under `src/components/` is touched.

**Tech Stack:** Preact 10 + `@preact/signals`, Tailwind 4, framer-motion, vitest + happy-dom, Tauri 2 (`@tauri-apps/api` + plugins-os/dialog/fs/clipboard/store).

---

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `src/main.tsx` | **modify** | Replace the single `render(<App/>)` line with an `isMobile()` switch that dynamic-imports `MobileApp` on Android/iOS. |
| `src/platform.ts` | **modify** | Add `"android"` and `"ios"` to the `Platform` union; add `isMobile()` helper. |
| `src/platform.test.ts` | **create** | Unit tests for UA parsing on the new branches. |
| `src/i18n.ts` | **modify** | Add the `mobile_*` namespace (17 keys × 2 locales) listed in spec §6.2. |
| `src/i18n.test.ts` | **create** | Parity check between the EN and FR blocks. |
| `src/mobile/MobileApp.tsx` | **create** | Mobile root; mirrors `App.tsx`: bootstrap, hashchange routing, auto-sync lifecycle, top-level screen switch. |
| `src/mobile/MobileShell.tsx` | **create** | Bottom-nav layout (`TopBar` + content + `BottomNav`). |
| `src/mobile/TopBar.tsx` | **create** | Logo · name · fingerprint chip · `VaultAvatar`. Hidden on Setup/Unlock. |
| `src/mobile/BottomNav.tsx` | **create** | 3-tab nav, iOS Liquid Glass vs Android opaque variants. |
| `src/mobile/VaultAvatar.tsx` | **create** | Round button showing the first emoji of `fingerprint.value`; tap opens `VaultSheet`. |
| `src/mobile/VaultSheet.tsx` | **create** | Bottom sheet listing vaults + `Nouveau coffre` + `Verrouiller maintenant`. |
| `src/mobile/screens/MobileGeneratorScreen.tsx` | **create** | Mobile generator layout (site card + identifiant card + password card + copy CTA). |
| `src/mobile/screens/MobileAccountsScreen.tsx` | **create** | Accounts list + pull-to-search gesture. |
| `src/mobile/screens/MobileSettingsScreen.tsx` | **create** | Grouped-list settings (Lock now → Account → Sync → Data → About). |
| `src/mobile/screens/MobileSetupScreen.tsx` | **create** | Master password creation (first-run + additional-vault). |
| `src/mobile/screens/MobileUnlockScreen.tsx` | **create** | Unlock flow (master / PIN / biometric). |
| `src/mobile/state.ts` | **create** | Mobile-only signals: `vaultSheetOpen`, `searchQuery`, `additionalVaultMode`. |
| `src/mobile/motion.ts` | **create** | Sheet snap thresholds + pull-to-search animation tokens. |
| `src/mobile/style.css` | **create** | `.glass-ios`, `.surface-android`, safe-area helpers, sheet animation utilities. |

Plus `*.test.tsx` next to each component / screen, in the same folder. Tests live alongside the code they cover (matches the project's existing `vitest.config.ts` glob).

---

## Task 1 — Platform detection on Android and iOS

**Files:**
- Modify: `src/platform.ts`
- Test: `src/platform.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/platform.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { detectPlatform, isMobile } from "./platform.js";

const ORIGINAL_UA = Object.getOwnPropertyDescriptor(navigator, "userAgent");

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

describe("detectPlatform", () => {
  afterEach(() => {
    if (ORIGINAL_UA) Object.defineProperty(navigator, "userAgent", ORIGINAL_UA);
  });

  it("detects Android from the UA", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro) AppleWebKit/537.36");
    expect(detectPlatform()).toBe("android");
  });

  it("detects iOS iPhone from the UA", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15");
    expect(detectPlatform()).toBe("ios");
  });

  it("detects iPadOS 13+ Safari (UA pretends to be Macintosh, has touch)", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
    Object.defineProperty(document, "ontouchend", { value: () => {}, configurable: true });
    try {
      expect(detectPlatform()).toBe("ios");
    } finally {
      Reflect.deleteProperty(document, "ontouchend");
    }
  });

  it("returns macos for desktop Safari", () => {
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15");
    expect(detectPlatform()).toBe("macos");
  });
});

describe("isMobile", () => {
  afterEach(() => {
    if (ORIGINAL_UA) Object.defineProperty(navigator, "userAgent", ORIGINAL_UA);
  });

  it("is true on Android", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14)");
    expect(isMobile()).toBe(true);
  });

  it("is false on Linux desktop", () => {
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64)");
    expect(isMobile()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/platform.test.ts`
Expected: `isMobile is not a function` (the helper doesn't exist yet) and the Android/iOS branches return `"linux"`/`"macos"`.

- [ ] **Step 3: Implement the new branches**

Replace the body of `src/platform.ts` with:

```ts
/**
 * Lightweight host-platform detection for UI labels (Touch ID vs.
 * Windows Hello, "Mac" vs. "Desktop" device-label default, etc.) and
 * for the mobile/desktop shell switch in `main.tsx`.
 */

export type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "other";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Android/.test(ua)) return "android";
  // iPadOS 13+ Safari pretends to be Macintosh; touch support is the giveaway.
  if (/iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== "undefined" && "ontouchend" in document)) {
    return "ios";
  }
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}

export function isMobile(): boolean {
  const p = detectPlatform();
  return p === "android" || p === "ios";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/platform.test.ts`
Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/platform.ts src/platform.test.ts
git commit -m "feat(mobile): detect Android and iOS hosts in platform.ts"
```

---

## Task 2 — i18n: add the `mobile_*` namespace

**Files:**
- Modify: `src/i18n.ts`
- Test: `src/i18n.test.ts`

- [ ] **Step 1: Write the failing parity test**

Create `src/i18n.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { t } from "./i18n.js";

const MOBILE_KEYS = [
  "mobile_vault_sheet_title",
  "mobile_vault_sheet_new",
  "mobile_vault_sheet_lock",
  "mobile_vault_sheet_active",
  "mobile_accounts_search_placeholder",
  "mobile_accounts_search_hint",
  "mobile_accounts_empty_title",
  "mobile_accounts_empty_cta",
  "mobile_accounts_row_actions_rename",
  "mobile_accounts_row_actions_edit_profile",
  "mobile_accounts_row_actions_delete",
  "mobile_settings_section_lock",
  "mobile_settings_section_account",
  "mobile_settings_section_sync",
  "mobile_settings_section_data",
  "mobile_settings_section_about",
  "mobile_setup_additional_vault_title",
  "mobile_setup_additional_vault_cancel",
] as const;

describe("mobile_* i18n keys", () => {
  it("every mobile_* key resolves to a non-empty string", () => {
    for (const key of MOBILE_KEYS) {
      const value = t(key as never);
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
      // A missing key surfaces as the key string — that means parity broke.
      expect(value).not.toBe(key);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/i18n.test.ts`
Expected: TypeScript error on `key as never` because the keys don't exist in the `EN` / `FR` records yet.

- [ ] **Step 3: Add the keys**

Open `src/i18n.ts`. Locate the closing `}` of the `EN` record. Just before it, add (preserve trailing commas as the rest of the file does):

```ts
  mobile_vault_sheet_title: "Vaults",
  mobile_vault_sheet_new: "New vault",
  mobile_vault_sheet_lock: "Lock now",
  mobile_vault_sheet_active: "Active",
  mobile_accounts_search_placeholder: "Search accounts",
  mobile_accounts_search_hint: "Pull down to search",
  mobile_accounts_empty_title: "No accounts yet",
  mobile_accounts_empty_cta: "New account",
  mobile_accounts_row_actions_rename: "Rename",
  mobile_accounts_row_actions_edit_profile: "Edit profile",
  mobile_accounts_row_actions_delete: "Delete",
  mobile_settings_section_lock: "Security",
  mobile_settings_section_account: "Account",
  mobile_settings_section_sync: "Sync",
  mobile_settings_section_data: "Data",
  mobile_settings_section_about: "About",
  mobile_setup_additional_vault_title: "New vault",
  mobile_setup_additional_vault_cancel: "Cancel",
```

Locate the closing `}` of the `FR` record (same convention). Just before it, add:

```ts
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/i18n.test.ts`
Expected: 1 passing test.

- [ ] **Step 5: Run typecheck to verify no regression**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/i18n.ts src/i18n.test.ts
git commit -m "i18n(mobile): add mobile_* keys in EN and FR"
```

---

## Task 3 — Mobile-only style utilities

**Files:**
- Create: `src/mobile/style.css`

This task only adds CSS. No tests; visual validation happens in later screen tasks.

- [ ] **Step 1: Create the file**

Create `src/mobile/style.css`:

```css
/**
 * Mobile-only utilities. Imported only by src/mobile/MobileApp.tsx so
 * the desktop bundle never pulls them in. Tailwind utilities stay the
 * source of truth for layout; this file only provides the
 * platform-conditional surfaces and safe-area helpers Tailwind doesn't
 * cover idiomatically.
 */

.safe-top { padding-top: max(env(safe-area-inset-top), 12px); }
.safe-bottom { padding-bottom: max(env(safe-area-inset-bottom), 12px); }

/* iOS Liquid Glass surface — backdrop blur over scrolling content. */
.glass-ios {
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(28px) saturate(1.8);
  -webkit-backdrop-filter: blur(28px) saturate(1.8);
  border-top: 0.5px solid rgba(255, 255, 255, 0.5);
}

@media (prefers-color-scheme: dark) {
  .glass-ios {
    background: rgba(20, 20, 24, 0.62);
    border-top-color: rgba(255, 255, 255, 0.08);
  }
}

/* Android Material 3 — opaque surface. */
.surface-android {
  background: var(--color-surface-elev);
  border-top: 1px solid var(--color-line);
}

/* Bottom-sheet snap container. */
.mobile-sheet {
  position: fixed;
  inset: auto 0 0 0;
  border-top-left-radius: 18px;
  border-top-right-radius: 18px;
  z-index: 60;
}

.mobile-sheet__handle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-line-strong);
  margin: 8px auto 4px;
}

/* Pull-to-search affordance on the accounts list. */
.pull-search-track {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms var(--ease-out-quint, ease);
  overflow: hidden;
}

.pull-search-track[data-open="true"] {
  grid-template-rows: 1fr;
}

.pull-search-track > * { min-height: 0; }
```

- [ ] **Step 2: Run the existing test suite to make sure CSS doesn't break it**

Run: `npm test`
Expected: green (the new file isn't imported anywhere yet, so the bundle is unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/mobile/style.css
git commit -m "feat(mobile): add mobile-only CSS utilities (glass, safe-area, sheet)"
```

---

## Task 4 — Mobile signals

**Files:**
- Create: `src/mobile/state.ts`
- Test: `src/mobile/state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/mobile/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { vaultSheetOpen, searchQuery, additionalVaultMode } from "./state.js";

describe("mobile state signals", () => {
  it("vaultSheetOpen defaults to false", () => {
    expect(vaultSheetOpen.value).toBe(false);
  });
  it("searchQuery defaults to empty string", () => {
    expect(searchQuery.value).toBe("");
  });
  it("additionalVaultMode defaults to false", () => {
    expect(additionalVaultMode.value).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/mobile/state.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement the signals**

Create `src/mobile/state.ts`:

```ts
import { signal } from "@preact/signals";

/** Bottom sheet over the mobile shell that lists the vaults. */
export const vaultSheetOpen = signal(false);

/** Text typed in the pull-to-search bar on MobileAccountsScreen. */
export const searchQuery = signal("");

/**
 * Setup screen is reused for two flows: first-run (no vault yet) and
 * "create an additional vault from VaultSheet". This flag picks the
 * cancel-back affordance in the latter case.
 */
export const additionalVaultMode = signal(false);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/mobile/state.test.ts`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/state.ts src/mobile/state.test.ts
git commit -m "feat(mobile): add mobile-only signals (vault sheet, search, setup mode)"
```

---

## Task 5 — `VaultAvatar` component

**Files:**
- Create: `src/mobile/VaultAvatar.tsx`
- Test: `src/mobile/VaultAvatar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/mobile/VaultAvatar.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { VaultAvatar, firstEmoji } from "./VaultAvatar.js";

describe("firstEmoji", () => {
  it("returns the first space-separated chunk", () => {
    expect(firstEmoji("🐉 🐱 🦊")).toBe("🐉");
  });
  it("returns ? on empty input", () => {
    expect(firstEmoji("")).toBe("?");
  });
});

describe("<VaultAvatar />", () => {
  it("renders the first emoji of the fingerprint", () => {
    const root = document.createElement("div");
    render(<VaultAvatar fingerprint="🐉 🐱 🦊" />, root);
    expect(root.textContent).toContain("🐉");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/mobile/VaultAvatar.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `src/mobile/VaultAvatar.tsx`:

```tsx
import { motion } from "framer-motion";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { vaultSheetOpen } from "./state.js";

export function firstEmoji(fingerprint: string): string {
  const parts = fingerprint.trim().split(/\s+/u);
  return parts[0] && parts[0].length > 0 ? parts[0] : "?";
}

interface Props {
  fingerprint: string;
}

export function VaultAvatar({ fingerprint }: Props) {
  return (
    <motion.button
      type="button"
      class="grid place-items-center w-9 h-9 rounded-full bg-(--color-surface-elev) border border-(--color-line) text-base"
      whileTap={TAP_SCALE}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={SOFT_SPRING}
      onClick={() => {
        vaultSheetOpen.value = true;
      }}
      aria-label="Vaults"
    >
      <span aria-hidden="true">{firstEmoji(fingerprint)}</span>
    </motion.button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/mobile/VaultAvatar.test.tsx`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/VaultAvatar.tsx src/mobile/VaultAvatar.test.tsx
git commit -m "feat(mobile): add VaultAvatar — tap opens vault sheet"
```

---

## Task 6 — `TopBar` component

**Files:**
- Create: `src/mobile/TopBar.tsx`
- Test: `src/mobile/TopBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/mobile/TopBar.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { TopBar } from "./TopBar.js";

describe("<TopBar />", () => {
  it("renders the brand name and fingerprint chip", () => {
    const root = document.createElement("div");
    render(<TopBar fingerprint="🐉 🐱 🦊" />, root);
    expect(root.textContent).toContain("Keyfount");
    expect(root.textContent).toContain("🐉");
  });

  it("hides the avatar when fingerprint is null", () => {
    const root = document.createElement("div");
    render(<TopBar fingerprint={null} />, root);
    expect(root.querySelector("[aria-label='Vaults']")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/mobile/TopBar.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `src/mobile/TopBar.tsx`:

```tsx
import { Logo } from "../Logo.js";
import { t } from "../i18n.js";
import { VaultAvatar } from "./VaultAvatar.js";

interface Props {
  fingerprint: string | null;
}

export function TopBar({ fingerprint }: Props) {
  return (
    <header class="safe-top px-4 pb-3 flex items-center gap-3">
      <Logo class="w-7 h-7 shrink-0" />
      <span class="font-medium tracking-[-0.01em] text-[15px] text-(--color-ink)">
        {t("extName")}
      </span>
      {fingerprint ? (
        <span class="fingerprint-sm shrink-0" title={t("unlock_expected_label")}>
          {fingerprint.split(/\s+/u)[0] ?? ""}
        </span>
      ) : null}
      <span class="flex-1" />
      {fingerprint ? <VaultAvatar fingerprint={fingerprint} /> : null}
    </header>
  );
}
```

Note: the project may not have an `extName` key. If `npm test` flags it later, use `"Keyfount"` literal — but only after confirming there is no existing key. Search `src/i18n.ts` for `extName` before deciding.

- [ ] **Step 4: Verify `extName` exists**

Run: `grep -n "extName" src/i18n.ts`
Expected: one match per locale, value `"Keyfount"`. If it doesn't exist, replace `{t("extName")}` with `Keyfount` (string literal — the brand name doesn't translate).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/mobile/TopBar.test.tsx`
Expected: 2 passing tests.

- [ ] **Step 6: Commit**

```bash
git add src/mobile/TopBar.tsx src/mobile/TopBar.test.tsx
git commit -m "feat(mobile): add TopBar — logo, name, fingerprint chip, vault avatar"
```

---

## Task 7 — `BottomNav` component

**Files:**
- Create: `src/mobile/BottomNav.tsx`
- Test: `src/mobile/BottomNav.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/mobile/BottomNav.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { BottomNav } from "./BottomNav.js";

describe("<BottomNav />", () => {
  it("renders three tabs labelled Accounts / Generator / Settings (FR)", () => {
    const root = document.createElement("div");
    render(<BottomNav active="generator" platform="ios" onChange={() => {}} />, root);
    expect(root.textContent).toContain("Comptes");
    expect(root.textContent).toContain("Générateur");
    expect(root.textContent).toContain("Paramètres");
  });

  it("uses the iOS glass class on iOS", () => {
    const root = document.createElement("div");
    render(<BottomNav active="generator" platform="ios" onChange={() => {}} />, root);
    expect(root.querySelector(".glass-ios")).not.toBeNull();
    expect(root.querySelector(".surface-android")).toBeNull();
  });

  it("uses the Android surface class on Android", () => {
    const root = document.createElement("div");
    render(<BottomNav active="generator" platform="android" onChange={() => {}} />, root);
    expect(root.querySelector(".surface-android")).not.toBeNull();
    expect(root.querySelector(".glass-ios")).toBeNull();
  });

  it("calls onChange with the tapped tab id", () => {
    const root = document.createElement("div");
    let last: string | null = null;
    render(<BottomNav active="generator" platform="ios" onChange={(id) => (last = id)} />, root);
    const buttons = root.querySelectorAll("button");
    // 0=accounts, 1=generator, 2=settings (order matters)
    (buttons[2] as HTMLButtonElement).click();
    expect(last).toBe("settings");
  });
});
```

Note: the FR test depends on the runtime locale. If the project's `i18n.ts` chooses FR by default in the test env, the snippet above is correct. If it falls back to EN, swap the strings to `Accounts` / `Generator` / `Settings`. Verify with `grep "const ACTIVE_LOCALE\|getLocale" src/i18n.ts` before running.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/mobile/BottomNav.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `src/mobile/BottomNav.tsx`:

```tsx
import { motion } from "framer-motion";
import { t } from "../i18n.js";
import { IconKey, IconSettings, IconUnlock } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";

export type MobileTab = "accounts" | "generator" | "settings";

interface Props {
  active: MobileTab;
  platform: "ios" | "android";
  onChange: (tab: MobileTab) => void;
}

const TABS: Array<{ id: MobileTab; labelKey: "sidebar_accounts" | "sidebar_generator" | "sidebar_settings"; icon: (size: number) => preact.ComponentChild }> = [
  { id: "accounts", labelKey: "sidebar_accounts", icon: (s) => <IconUnlock size={s} /> },
  { id: "generator", labelKey: "sidebar_generator", icon: (s) => <IconKey size={s} /> },
  { id: "settings", labelKey: "sidebar_settings", icon: (s) => <IconSettings size={s} /> },
];

export function BottomNav({ active, platform, onChange }: Props) {
  const surfaceClass = platform === "ios" ? "glass-ios" : "surface-android";
  return (
    <nav class={`safe-bottom px-3 pt-2 flex items-stretch justify-around ${surfaceClass}`}>
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <motion.button
            key={tab.id}
            type="button"
            whileTap={TAP_SCALE}
            onClick={() => onChange(tab.id)}
            class={
              "relative flex-1 flex flex-col items-center gap-1 py-2 rounded-xl bg-transparent border-0 cursor-pointer " +
              (isActive ? "text-(--color-ink)" : "text-(--color-ink-muted)")
            }
            aria-current={isActive ? "page" : undefined}
            aria-label={t(tab.labelKey)}
          >
            {isActive ? (
              <motion.span
                layoutId="mobile-bottomnav-active"
                transition={SOFT_SPRING}
                class="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-(--color-accent-500)"
              />
            ) : null}
            {tab.icon(20)}
            <span class="text-[11px] font-medium tracking-tight">{t(tab.labelKey)}</span>
          </motion.button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/mobile/BottomNav.test.tsx`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/BottomNav.tsx src/mobile/BottomNav.test.tsx
git commit -m "feat(mobile): add BottomNav with iOS Liquid Glass / Android opaque variants"
```

---

## Task 8 — `MobileShell` layout

**Files:**
- Create: `src/mobile/MobileShell.tsx`
- Test: `src/mobile/MobileShell.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/mobile/MobileShell.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileShell } from "./MobileShell.js";

describe("<MobileShell />", () => {
  it("renders the top bar, the children, and the bottom nav", () => {
    const root = document.createElement("div");
    render(
      <MobileShell active="generator" platform="ios" fingerprint="🐉 🐱" onChange={() => {}}>
        <p>screen content</p>
      </MobileShell>,
      root,
    );
    expect(root.textContent).toContain("Keyfount");
    expect(root.textContent).toContain("screen content");
    expect(root.textContent).toContain("Générateur");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/mobile/MobileShell.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `src/mobile/MobileShell.tsx`:

```tsx
import type { ComponentChildren } from "preact";
import { TopBar } from "./TopBar.js";
import { BottomNav, type MobileTab } from "./BottomNav.js";

interface Props {
  active: MobileTab;
  platform: "ios" | "android";
  fingerprint: string | null;
  onChange: (tab: MobileTab) => void;
  children: ComponentChildren;
}

export function MobileShell({ active, platform, fingerprint, onChange, children }: Props) {
  return (
    <div class="relative h-screen w-screen flex flex-col bg-(--color-surface) text-(--color-ink)">
      <TopBar fingerprint={fingerprint} />
      <main class="flex-1 min-h-0 overflow-y-auto px-4 pb-24">{children}</main>
      <div class="absolute left-0 right-0 bottom-0">
        <BottomNav active={active} platform={platform} onChange={onChange} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/mobile/MobileShell.test.tsx`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/MobileShell.tsx src/mobile/MobileShell.test.tsx
git commit -m "feat(mobile): add MobileShell — TopBar + scrollable content + BottomNav"
```

---

## Task 9 — `MobileGeneratorScreen`

**Files:**
- Create: `src/mobile/screens/MobileGeneratorScreen.tsx`
- Test: `src/mobile/screens/MobileGeneratorScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/mobile/screens/MobileGeneratorScreen.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileGeneratorScreen } from "./MobileGeneratorScreen.js";

describe("<MobileGeneratorScreen />", () => {
  it("renders the domain and identifier fields and a Copy button", () => {
    const root = document.createElement("div");
    render(<MobileGeneratorScreen />, root);
    expect(root.textContent).toMatch(/Site|Domain/);
    expect(root.textContent).toMatch(/Copier|Copy/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/mobile/screens/MobileGeneratorScreen.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `src/mobile/screens/MobileGeneratorScreen.tsx`. The implementation reuses the same `api` / `state` plumbing the desktop `GeneratorView` uses — read `src/components/GeneratorView.tsx` for reference (don't import from it). Minimum viable version:

```tsx
import { useCallback } from "preact/hooks";
import { motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { copyWithAutoClear } from "../../api.js";
import {
  domain,
  identifier,
  generated,
  errorMessage,
  defaultProfile,
} from "../../state.js";

export function MobileGeneratorScreen() {
  const onGenerate = useCallback(async () => {
    try {
      const result = await api.generate({
        domain: domain.value,
        identifier: identifier.value,
        profile: defaultProfile.value,
      });
      generated.value = result.password;
    } catch (err) {
      errorMessage.value = describeError(err);
    }
  }, []);

  const onCopy = useCallback(async () => {
    if (!generated.value) return;
    try {
      await copyWithAutoClear(generated.value);
    } catch (err) {
      errorMessage.value = describeError(err);
    }
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="flex flex-col gap-4 pt-2"
    >
      <label class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) p-3 flex flex-col gap-1">
        <span class="text-[10px] font-medium uppercase tracking-wider text-(--color-ink-muted)">
          {t("main_domain_label")}
        </span>
        <input
          type="text"
          inputMode="url"
          autocomplete="off"
          spellcheck={false}
          placeholder={t("main_domain_placeholder")}
          value={domain.value}
          onInput={(e) => { domain.value = (e.target as HTMLInputElement).value; void onGenerate(); }}
          class="bg-transparent outline-none text-[15px] text-(--color-ink)"
        />
      </label>

      <label class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) p-3 flex flex-col gap-1">
        <span class="text-[10px] font-medium uppercase tracking-wider text-(--color-ink-muted)">
          {t("main_username_label")}
        </span>
        <input
          type="text"
          inputMode="email"
          autocomplete="off"
          spellcheck={false}
          value={identifier.value}
          onInput={(e) => { identifier.value = (e.target as HTMLInputElement).value; void onGenerate(); }}
          class="bg-transparent outline-none text-[15px] text-(--color-ink)"
        />
      </label>

      {generated.value ? (
        <div class="rounded-2xl bg-(--color-ink) text-(--color-surface) p-4 flex flex-col gap-2">
          <span class="font-mono text-[15px] leading-tight break-all">{generated.value}</span>
          <span class="text-[10px] uppercase tracking-wider text-white/60">
            {generated.value.length} {t("main_chars")}
          </span>
        </div>
      ) : null}

      <motion.button
        type="button"
        whileTap={TAP_SCALE}
        disabled={!generated.value}
        onClick={() => void onCopy()}
        class="rounded-full bg-(--color-ink) text-(--color-surface) py-3 font-medium text-[15px] disabled:opacity-40"
      >
        {t("common_copy")}
      </motion.button>

      {errorMessage.value ? (
        <p class="text-(--color-danger) text-[13px]">{errorMessage.value}</p>
      ) : null}
    </motion.section>
  );
}
```

If `state.ts` exposes different names than `domain` / `identifier` / `generated`, fall back to what's actually exported. Run `grep "^export const " src/state.ts` to confirm before writing the imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/mobile/screens/MobileGeneratorScreen.test.tsx`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/screens/MobileGeneratorScreen.tsx src/mobile/screens/MobileGeneratorScreen.test.tsx
git commit -m "feat(mobile): add MobileGeneratorScreen — domain/identifier/password/copy"
```

---

## Task 10 — `MobileAccountsScreen` with pull-to-search

**Files:**
- Create: `src/mobile/screens/MobileAccountsScreen.tsx`
- Test: `src/mobile/screens/MobileAccountsScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileAccountsScreen } from "./MobileAccountsScreen.js";
import { searchQuery } from "../state.js";

describe("<MobileAccountsScreen />", () => {
  it("renders the empty state when no accounts exist", () => {
    const root = document.createElement("div");
    render(<MobileAccountsScreen accounts={[]} />, root);
    expect(root.textContent).toMatch(/Aucun compte encore|No accounts yet/);
  });

  it("filters accounts when searchQuery is set", () => {
    const root = document.createElement("div");
    searchQuery.value = "github";
    render(
      <MobileAccountsScreen
        accounts={[
          { id: "1", domain: "github.com", identifier: "u", lastUsed: 0 },
          { id: "2", domain: "twitter.com", identifier: "v", lastUsed: 0 },
        ]}
      />,
      root,
    );
    expect(root.textContent).toContain("github.com");
    expect(root.textContent).not.toContain("twitter.com");
    searchQuery.value = "";
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/mobile/screens/MobileAccountsScreen.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `src/mobile/screens/MobileAccountsScreen.tsx`:

```tsx
import { useEffect, useRef, useState } from "preact/hooks";
import { motion } from "framer-motion";
import { t } from "../../i18n.js";
import { SOFT_SPRING } from "../../motion.js";
import { searchQuery } from "../state.js";

export interface MobileAccountRow {
  id: string;
  domain: string;
  identifier: string;
  lastUsed: number;
}

interface Props {
  accounts: MobileAccountRow[];
}

const PULL_OPEN_THRESHOLD = 60;

export function MobileAccountsScreen({ accounts }: Props) {
  const [pullOpen, setPullOpen] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (pullOpen) {
      const i = document.getElementById("mobile-search-input") as HTMLInputElement | null;
      i?.focus();
    }
  }, [pullOpen]);

  const filtered = accounts.filter((a) =>
    searchQuery.value === ""
      ? true
      : a.domain.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        a.identifier.toLowerCase().includes(searchQuery.value.toLowerCase()),
  );

  return (
    <section
      class="flex flex-col gap-2 pt-2 select-none"
      onTouchStart={(e) => { startY.current = e.touches[0]?.clientY ?? null; }}
      onTouchMove={(e) => {
        if (startY.current === null) return;
        const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
        if (dy > PULL_OPEN_THRESHOLD && !pullOpen) setPullOpen(true);
      }}
      onTouchEnd={() => { startY.current = null; }}
    >
      <div class="pull-search-track" data-open={pullOpen}>
        <input
          id="mobile-search-input"
          type="search"
          inputMode="search"
          placeholder={t("mobile_accounts_search_placeholder")}
          value={searchQuery.value}
          onInput={(e) => { searchQuery.value = (e.target as HTMLInputElement).value; }}
          onBlur={() => { if (!searchQuery.value) setPullOpen(false); }}
          class="w-full mb-3 px-4 py-3 rounded-2xl bg-(--color-surface-elev) border border-(--color-line) text-[15px] text-(--color-ink) outline-none"
        />
      </div>

      {!pullOpen ? (
        <p class="text-center text-[11px] text-(--color-ink-subtle) py-1">
          {t("mobile_accounts_search_hint")}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <div class="flex flex-col items-center justify-center py-16 text-center gap-3">
          <p class="text-[15px] text-(--color-ink-muted)">{t("mobile_accounts_empty_title")}</p>
          <button
            type="button"
            class="rounded-full bg-(--color-ink) text-(--color-surface) px-5 py-2 text-[14px] font-medium"
          >
            {t("mobile_accounts_empty_cta")}
          </button>
        </div>
      ) : (
        <ul class="flex flex-col gap-1">
          {filtered.map((account) => (
            <motion.li
              key={account.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SOFT_SPRING}
              class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-3 py-3 flex items-center gap-3"
            >
              <div class="w-9 h-9 rounded-full bg-(--color-surface-sunken) grid place-items-center text-[14px] font-semibold text-(--color-ink-muted)">
                {account.domain[0]?.toUpperCase() ?? "?"}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-[14px] text-(--color-ink) truncate">{account.domain}</p>
                <p class="text-[11px] text-(--color-ink-muted) truncate">{account.identifier}</p>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/mobile/screens/MobileAccountsScreen.test.tsx`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/screens/MobileAccountsScreen.tsx src/mobile/screens/MobileAccountsScreen.test.tsx
git commit -m "feat(mobile): add MobileAccountsScreen with pull-to-search"
```

---

## Task 11 — `MobileSettingsScreen`

**Files:**
- Create: `src/mobile/screens/MobileSettingsScreen.tsx`
- Test: `src/mobile/screens/MobileSettingsScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/mobile/screens/MobileSettingsScreen.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileSettingsScreen } from "./MobileSettingsScreen.js";

describe("<MobileSettingsScreen />", () => {
  it("renders all five section headers", () => {
    const root = document.createElement("div");
    render(<MobileSettingsScreen />, root);
    expect(root.textContent).toMatch(/Sécurité|Security/);
    expect(root.textContent).toMatch(/Compte|Account/);
    expect(root.textContent).toMatch(/Synchronisation|Sync/);
    expect(root.textContent).toMatch(/Données|Data/);
    expect(root.textContent).toMatch(/À propos|About/);
  });

  it("renders a Lock row that calls api.lock when tapped", async () => {
    const calls: string[] = [];
    const root = document.createElement("div");
    // Mock api.lock by stubbing the global if needed.
    render(<MobileSettingsScreen onLock={() => calls.push("lock")} />, root);
    const lockButton = root.querySelector("[data-action='lock']") as HTMLButtonElement | null;
    expect(lockButton).not.toBeNull();
    lockButton!.click();
    expect(calls).toEqual(["lock"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/mobile/screens/MobileSettingsScreen.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `src/mobile/screens/MobileSettingsScreen.tsx`:

```tsx
import { motion } from "framer-motion";
import { t } from "../../i18n.js";
import { IconLock } from "../../icons.js";
import { SOFT_SPRING } from "../../motion.js";
import { syncServerStatus } from "../../sync/status.js";

interface Props {
  onLock?: () => void;
}

const SECTION_CLASSES = "rounded-2xl bg-(--color-surface-elev) border border-(--color-line) overflow-hidden";
const ROW_CLASSES = "w-full flex items-center gap-3 px-4 py-3 text-left bg-transparent border-0 cursor-pointer text-[15px] text-(--color-ink)";

function SectionHeader({ children }: { children: preact.ComponentChildren }) {
  return (
    <h2 class="text-[10px] uppercase tracking-wider text-(--color-ink-muted) px-4 pt-5 pb-2 font-medium">
      {children}
    </h2>
  );
}

export function MobileSettingsScreen({ onLock }: Props) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="flex flex-col pt-2 pb-6"
    >
      <SectionHeader>{t("mobile_settings_section_lock")}</SectionHeader>
      <div class={SECTION_CLASSES}>
        <button
          type="button"
          data-action="lock"
          class={ROW_CLASSES}
          onClick={() => onLock?.()}
        >
          <IconLock size={18} />
          <span>{t("sidebar_lock")}</span>
        </button>
      </div>

      <SectionHeader>{t("mobile_settings_section_account")}</SectionHeader>
      <div class={SECTION_CLASSES}>
        <p class="px-4 py-3 text-[13px] text-(--color-ink-muted)">
          {t("settings_intro") ?? ""}
        </p>
      </div>

      <SectionHeader>{t("mobile_settings_section_sync")}</SectionHeader>
      <div class={SECTION_CLASSES}>
        <div class="px-4 py-3 flex items-center gap-2 text-[13px]">
          <span
            class={
              "inline-block h-2 w-2 rounded-full " +
              (syncServerStatus.value === "online" ? "bg-emerald-500"
                : syncServerStatus.value === "offline" ? "bg-red-500"
                : "bg-amber-400")
            }
          />
          <span class="text-(--color-ink-muted)">{syncServerStatus.value}</span>
        </div>
      </div>

      <SectionHeader>{t("mobile_settings_section_data")}</SectionHeader>
      <div class={SECTION_CLASSES} />

      <SectionHeader>{t("mobile_settings_section_about")}</SectionHeader>
      <div class={SECTION_CLASSES}>
        <p class="px-4 py-3 text-[13px] text-(--color-ink-muted)">Keyfount</p>
      </div>
    </motion.section>
  );
}
```

This is a minimal-viable settings layout — it surfaces every section so we can see them on the simulator, but only the Lock row is wired. Account/Sync/Data sub-rows (auto-lock minutes, PIN, biometric, history toggle, favicon toggle, sync URL, Test connection, Push/Pull, Export/Import, Wipe) come in follow-up commits. Each future row should reuse the same `ROW_CLASSES` pattern.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/mobile/screens/MobileSettingsScreen.test.tsx`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/screens/MobileSettingsScreen.tsx src/mobile/screens/MobileSettingsScreen.test.tsx
git commit -m "feat(mobile): add MobileSettingsScreen scaffold with Lock row and section list"
```

---

## Task 12 — `VaultSheet`

**Files:**
- Create: `src/mobile/VaultSheet.tsx`
- Test: `src/mobile/VaultSheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/mobile/VaultSheet.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { VaultSheet } from "./VaultSheet.js";
import { vaultSheetOpen } from "./state.js";

describe("<VaultSheet />", () => {
  it("renders nothing when closed", () => {
    vaultSheetOpen.value = false;
    const root = document.createElement("div");
    render(<VaultSheet platform="ios" vaults={[]} onSwitch={() => {}} onLock={() => {}} onNew={() => {}} />, root);
    expect(root.textContent?.trim()).toBe("");
  });

  it("renders the vault list and the new/lock rows when open", () => {
    vaultSheetOpen.value = true;
    const root = document.createElement("div");
    render(
      <VaultSheet
        platform="ios"
        vaults={[{ id: "v1", name: "Personnel", fingerprint: "🐉 🐱", active: true }]}
        onSwitch={() => {}}
        onLock={() => {}}
        onNew={() => {}}
      />,
      root,
    );
    expect(root.textContent).toContain("Personnel");
    expect(root.textContent).toMatch(/Nouveau coffre|New vault/);
    expect(root.textContent).toMatch(/Verrouiller maintenant|Lock now/);
    vaultSheetOpen.value = false;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/mobile/VaultSheet.test.tsx`
Expected: module not found.

- [ ] **Step 3: Implement the component**

Create `src/mobile/VaultSheet.tsx`:

```tsx
import { AnimatePresence, motion } from "framer-motion";
import { t } from "../i18n.js";
import { IconLock } from "../icons.js";
import { SOFT_SPRING, TAP_SCALE } from "../motion.js";
import { vaultSheetOpen } from "./state.js";
import { firstEmoji } from "./VaultAvatar.js";

export interface VaultRow {
  id: string;
  name: string;
  fingerprint: string;
  active: boolean;
}

interface Props {
  platform: "ios" | "android";
  vaults: VaultRow[];
  onSwitch: (vaultId: string) => void;
  onLock: () => void;
  onNew: () => void;
}

export function VaultSheet({ platform, vaults, onSwitch, onLock, onNew }: Props) {
  const surfaceClass = platform === "ios" ? "glass-ios" : "surface-android";
  return (
    <AnimatePresence>
      {vaultSheetOpen.value ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            class="fixed inset-0 z-50 bg-black/40"
            onClick={() => { vaultSheetOpen.value = false; }}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SOFT_SPRING}
            class={`mobile-sheet ${surfaceClass} safe-bottom`}
          >
            <div class="mobile-sheet__handle" />
            <h3 class="px-4 pt-2 pb-3 text-[10px] uppercase tracking-wider text-(--color-ink-muted)">
              {t("mobile_vault_sheet_title")}
            </h3>
            <ul class="px-2 pb-2 flex flex-col">
              {vaults.map((vault) => (
                <motion.li key={vault.id} whileTap={TAP_SCALE}>
                  <button
                    type="button"
                    class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-transparent border-0 cursor-pointer text-left"
                    onClick={() => { onSwitch(vault.id); vaultSheetOpen.value = false; }}
                  >
                    <span class="w-9 h-9 rounded-full bg-(--color-surface-sunken) grid place-items-center text-[16px]">
                      {firstEmoji(vault.fingerprint)}
                    </span>
                    <span class="flex-1 text-[15px] text-(--color-ink)">{vault.name}</span>
                    {vault.active ? (
                      <span class="text-[11px] text-(--color-accent-500) font-medium">
                        {t("mobile_vault_sheet_active")}
                      </span>
                    ) : null}
                  </button>
                </motion.li>
              ))}
            </ul>
            <div class="border-t border-(--color-line) mx-2" />
            <ul class="px-2 py-2 flex flex-col">
              <li>
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-transparent border-0 cursor-pointer text-[15px] text-(--color-ink)"
                  onClick={() => { onNew(); vaultSheetOpen.value = false; }}
                >
                  <span class="w-9 h-9 rounded-full bg-(--color-surface-sunken) grid place-items-center text-[18px]">＋</span>
                  {t("mobile_vault_sheet_new")}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-transparent border-0 cursor-pointer text-[15px] text-(--color-ink)"
                  onClick={() => { onLock(); vaultSheetOpen.value = false; }}
                >
                  <span class="w-9 h-9 rounded-full bg-(--color-surface-sunken) grid place-items-center">
                    <IconLock size={16} />
                  </span>
                  {t("mobile_vault_sheet_lock")}
                </button>
              </li>
            </ul>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/mobile/VaultSheet.test.tsx`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/VaultSheet.tsx src/mobile/VaultSheet.test.tsx
git commit -m "feat(mobile): add VaultSheet — switch vault, new vault, lock now"
```

---

## Task 13 — `MobileSetupScreen` and `MobileUnlockScreen`

**Files:**
- Create: `src/mobile/screens/MobileSetupScreen.tsx`
- Create: `src/mobile/screens/MobileUnlockScreen.tsx`
- Test: `src/mobile/screens/MobileSetupScreen.test.tsx`
- Test: `src/mobile/screens/MobileUnlockScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/mobile/screens/MobileSetupScreen.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileSetupScreen } from "./MobileSetupScreen.js";

describe("<MobileSetupScreen />", () => {
  it("renders the master + confirm fields and a Create button", () => {
    const root = document.createElement("div");
    render(<MobileSetupScreen mode="first-run" onCancel={() => {}} />, root);
    expect(root.textContent).toMatch(/Master|Mot de passe maître/);
    expect(root.textContent).toMatch(/Create vault|Créer le coffre/);
  });

  it("shows a Cancel affordance in additional-vault mode", () => {
    const root = document.createElement("div");
    render(<MobileSetupScreen mode="additional" onCancel={() => {}} />, root);
    expect(root.textContent).toMatch(/Annuler|Cancel/);
  });
});
```

Create `src/mobile/screens/MobileUnlockScreen.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileUnlockScreen } from "./MobileUnlockScreen.js";

describe("<MobileUnlockScreen />", () => {
  it("renders the master password input by default", () => {
    const root = document.createElement("div");
    render(<MobileUnlockScreen hasPin={false} />, root);
    expect(root.querySelector("input[type='password']")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/mobile/screens/MobileSetupScreen.test.tsx src/mobile/screens/MobileUnlockScreen.test.tsx`
Expected: modules not found.

- [ ] **Step 3: Implement `MobileSetupScreen`**

Create `src/mobile/screens/MobileSetupScreen.tsx`:

```tsx
import { useState } from "preact/hooks";
import { motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { errorMessage, fingerprint } from "../../state.js";

interface Props {
  mode: "first-run" | "additional";
  onCancel: () => void;
}

export function MobileSetupScreen({ mode, onCancel }: Props) {
  const [master, setMaster] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (master.length < 12) {
      errorMessage.value = t("setup_min_length_error")("12");
      return;
    }
    if (master !== confirm) {
      errorMessage.value = t("setup_mismatch_error");
      return;
    }
    setBusy(true);
    try {
      const res = mode === "first-run"
        ? await api.setup({ masterPassword: master })
        : await api.startNewVault({ masterPassword: master });
      fingerprint.value = res.fingerprint;
    } catch (err) {
      errorMessage.value = describeError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="safe-top safe-bottom px-5 pt-6 flex flex-col gap-5 min-h-screen"
    >
      <header class="flex items-center justify-between">
        <h1 class="text-[22px] font-semibold tracking-tight text-(--color-ink)">
          {mode === "first-run" ? t("setup_welcome") : t("mobile_setup_additional_vault_title")}
        </h1>
        {mode === "additional" ? (
          <button
            type="button"
            class="text-[14px] text-(--color-ink-muted) bg-transparent border-0"
            onClick={onCancel}
          >
            {t("mobile_setup_additional_vault_cancel")}
          </button>
        ) : null}
      </header>

      <p class="text-[14px] leading-relaxed text-(--color-ink-muted)">
        {t("setup_intro")}
      </p>

      <form class="flex flex-col gap-4" onSubmit={onSubmit}>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] uppercase tracking-wider text-(--color-ink-muted)">
            {t("setup_master_label")}
          </span>
          <input
            type="password"
            autocomplete="new-password"
            value={master}
            onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
            class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-4 py-3 text-[15px] text-(--color-ink) outline-none"
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-[11px] uppercase tracking-wider text-(--color-ink-muted)">
            {t("setup_confirm_label")}
          </span>
          <input
            type="password"
            autocomplete="new-password"
            value={confirm}
            onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
            class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-4 py-3 text-[15px] text-(--color-ink) outline-none"
          />
        </label>

        {errorMessage.value ? (
          <p class="text-(--color-danger) text-[13px]">{errorMessage.value}</p>
        ) : null}

        <motion.button
          type="submit"
          whileTap={TAP_SCALE}
          disabled={busy}
          class="rounded-full bg-(--color-ink) text-(--color-surface) py-3 text-[15px] font-medium disabled:opacity-40"
        >
          {busy ? t("setup_creating") : t("setup_create_button")}
        </motion.button>
      </form>
    </motion.section>
  );
}
```

If `api.setup` / `api.startNewVault` are spelled differently in `src/api.ts`, use the actual names. Run `grep "^  [a-z]" src/api.ts | head -40` to scan.

- [ ] **Step 4: Implement `MobileUnlockScreen`**

Create `src/mobile/screens/MobileUnlockScreen.tsx`:

```tsx
import { useState } from "preact/hooks";
import { motion } from "framer-motion";
import { api, describeError } from "../../api.js";
import { t } from "../../i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../motion.js";
import { errorMessage } from "../../state.js";

interface Props {
  hasPin: boolean;
}

export function MobileUnlockScreen({ hasPin }: Props) {
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.unlock({ masterPassword: master });
    } catch (err) {
      errorMessage.value = describeError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
      class="safe-top safe-bottom px-5 pt-12 flex flex-col gap-6 min-h-screen"
    >
      <header>
        <h1 class="text-[22px] font-semibold tracking-tight text-(--color-ink)">
          {t("unlock_title")}
        </h1>
        <p class="text-[13px] text-(--color-ink-muted) mt-1">
          {hasPin ? t("unlock_pin_subtitle") : t("unlock_subtitle")}
        </p>
      </header>

      <form class="flex flex-col gap-4" onSubmit={onSubmit}>
        <input
          type="password"
          autocomplete="current-password"
          autofocus
          value={master}
          onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
          class="rounded-2xl bg-(--color-surface-elev) border border-(--color-line) px-4 py-3 text-[15px] text-(--color-ink) outline-none"
        />

        {errorMessage.value ? (
          <p class="text-(--color-danger) text-[13px]">{errorMessage.value}</p>
        ) : null}

        <motion.button
          type="submit"
          whileTap={TAP_SCALE}
          disabled={busy}
          class="rounded-full bg-(--color-ink) text-(--color-surface) py-3 text-[15px] font-medium disabled:opacity-40"
        >
          {t("unlock_button")}
        </motion.button>
      </form>
    </motion.section>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/mobile/screens/MobileSetupScreen.test.tsx src/mobile/screens/MobileUnlockScreen.test.tsx`
Expected: 3 passing tests in total.

- [ ] **Step 6: Commit**

```bash
git add src/mobile/screens/MobileSetupScreen.tsx src/mobile/screens/MobileUnlockScreen.tsx \
        src/mobile/screens/MobileSetupScreen.test.tsx src/mobile/screens/MobileUnlockScreen.test.tsx
git commit -m "feat(mobile): add MobileSetupScreen and MobileUnlockScreen"
```

---

## Task 14 — `MobileApp` root + main.tsx switch

**Files:**
- Create: `src/mobile/MobileApp.tsx`
- Modify: `src/main.tsx`
- Test: `src/mobile/MobileApp.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/mobile/MobileApp.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "preact";
import { MobileApp } from "./MobileApp.js";

describe("<MobileApp />", () => {
  it("mounts and shows either a loader, setup, unlock, or shell", () => {
    const root = document.createElement("div");
    render(<MobileApp />, root);
    expect(root.children.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement `MobileApp.tsx`**

Create `src/mobile/MobileApp.tsx`:

```tsx
import { useCallback, useEffect, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { api, describeError } from "../api.js";
import { detectPlatform } from "../platform.js";
import {
  errorMessage,
  faviconFallbackEnabled,
  fingerprint,
  hasPin,
  historyEnabled,
  defaultProfile,
  screen,
  view,
} from "../state.js";
import { startAutoSync, stopAutoSync } from "../sync/auto.js";
import { startSyncStatusMonitor, stopSyncStatusMonitor } from "../sync/status.js";
import { MobileShell } from "./MobileShell.js";
import { VaultSheet } from "./VaultSheet.js";
import { vaultSheetOpen, additionalVaultMode } from "./state.js";
import { MobileGeneratorScreen } from "./screens/MobileGeneratorScreen.js";
import { MobileAccountsScreen } from "./screens/MobileAccountsScreen.js";
import { MobileSettingsScreen } from "./screens/MobileSettingsScreen.js";
import { MobileSetupScreen } from "./screens/MobileSetupScreen.js";
import { MobileUnlockScreen } from "./screens/MobileUnlockScreen.js";
import "./style.css";

export function MobileApp() {
  const platform = detectPlatform() === "android" ? "android" : "ios";
  const [accounts, setAccounts] = useState<Array<{ id: string; domain: string; identifier: string; lastUsed: number }>>([]);
  const [vaults, setVaults] = useState<Array<{ id: string; name: string; fingerprint: string; active: boolean }>>([]);

  useEffect(() => { void bootstrap(); }, []);

  useEffect(() => {
    if (screen.value === "shell") {
      startAutoSync();
      startSyncStatusMonitor();
      void (async () => {
        try {
          setAccounts(await api.listAccounts());
          setVaults(await api.listVaults());
        } catch (err) {
          errorMessage.value = describeError(err);
        }
      })();
      return () => { stopAutoSync(); stopSyncStatusMonitor(); };
    }
    return undefined;
  }, [screen.value]);

  const onTabChange = useCallback((tab: "accounts" | "generator" | "settings") => {
    view.value = tab;
  }, []);

  const onLock = useCallback(async () => {
    await api.lock();
    screen.value = "unlock";
  }, []);

  const activeTab: "accounts" | "generator" | "settings" =
    view.value === "accounts" || view.value === "generator" || view.value === "settings"
      ? view.value
      : "generator";

  return (
    <AnimatePresence mode="wait" initial={false}>
      {screen.value === "setup" ? (
        <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <MobileSetupScreen
            mode={additionalVaultMode.value ? "additional" : "first-run"}
            onCancel={() => { additionalVaultMode.value = false; screen.value = "shell"; }}
          />
        </motion.div>
      ) : screen.value === "unlock" ? (
        <motion.div key="unlock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <MobileUnlockScreen hasPin={hasPin.value} />
        </motion.div>
      ) : screen.value === "shell" ? (
        <motion.div key="shell" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <MobileShell
            active={activeTab}
            platform={platform}
            fingerprint={fingerprint.value}
            onChange={onTabChange}
          >
            {activeTab === "generator" ? <MobileGeneratorScreen /> : null}
            {activeTab === "accounts" ? <MobileAccountsScreen accounts={accounts} /> : null}
            {activeTab === "settings" ? <MobileSettingsScreen onLock={onLock} /> : null}
          </MobileShell>
          <VaultSheet
            platform={platform}
            vaults={vaults}
            onSwitch={async (id) => { await api.switchVault(id); }}
            onLock={onLock}
            onNew={() => { additionalVaultMode.value = true; screen.value = "setup"; }}
          />
        </motion.div>
      ) : (
        <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <p class="p-6 text-(--color-ink-muted)">…</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

async function bootstrap() {
  try {
    const status = await api.status();
    fingerprint.value = status.fingerprint;
    hasPin.value = status.hasPin;
    if (status.isFirstRun) { screen.value = "setup"; return; }
    if (status.locked) { screen.value = "unlock"; return; }
    const state = await api.getState();
    historyEnabled.value = state.historyEnabled;
    faviconFallbackEnabled.value = state.faviconFallbackEnabled;
    defaultProfile.value = state.defaultProfile;
    screen.value = "shell";
    view.value = "generator";
  } catch (err) {
    errorMessage.value = describeError(err) || "could not initialise";
    screen.value = "unlock";
  }
}
```

If `api.listAccounts`, `api.listVaults`, `api.switchVault`, `api.startNewVault` use different casing/naming, fix the calls here — the surface is whatever `src/api.ts` exports.

- [ ] **Step 3: Modify `src/main.tsx`**

Replace the contents of `src/main.tsx` with:

```tsx
import { render } from "preact";
import { App } from "./App.js";
import { isMobile } from "./platform.js";
import "./theme.css";

const root = document.getElementById("root");
if (root) {
  if (isMobile()) {
    void (async () => {
      const { MobileApp } = await import("./mobile/MobileApp.js");
      render(<MobileApp />, root);
    })();
  } else {
    render(<App />, root);
  }
}
```

Don't remove any other import the existing `main.tsx` has — read it first and preserve everything not strictly the `render(<App/>)` call.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/mobile/MobileApp.test.tsx`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add src/mobile/MobileApp.tsx src/mobile/MobileApp.test.tsx src/main.tsx
git commit -m "feat(mobile): wire MobileApp root and switch in main.tsx"
```

---

## Task 15 — Final validation

**Files:** none changed.

This task is a sequence of verification commands. Each must pass before the branch is ready for review.

- [ ] **Step 1: Desktop typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Desktop Rust tests**

Run: `cd src-tauri && cargo test --target aarch64-apple-darwin --all-features --lib && cd ..`
Expected: 63 passed (the same count we had before this branch).

- [ ] **Step 3: Desktop clippy**

Run: `cd src-tauri && cargo clippy --target aarch64-apple-darwin --all-targets --all-features -- -D warnings && cd ..`
Expected: no warnings.

- [ ] **Step 4: Frontend tests**

Run: `npm test`
Expected: every `src/**/*.test.{ts,tsx}` passes, with the new mobile tests counted in.

- [ ] **Step 5: Desktop visual smoke**

Run: `npm run dev:tauri` (or click the test script if `dev:tauri` is wired). The macOS app should pop up with its existing HUD-material window, the tray icon, and the global hotkey should still work (test by closing the window and pressing `Cmd+Shift+K`). No visible regression vs `main`.

Stop the dev server (`Ctrl+C`) before continuing.

- [ ] **Step 6: Android visual smoke**

Boot the AVD if it's not already running, then:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"
export JAVA_HOME="/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"
export PATH="$HOME/.cargo/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"
nohup npx tauri android dev > /tmp/keyfount-android.log 2>&1 &
```

Wait for `Performing Streamed Install` in the log (~1-2 min on cached builds). Then screenshot:

```bash
adb shell screencap -p /sdcard/k.png && adb pull /sdcard/k.png /tmp/keyfount-android-shell.png
```

Inspect `/tmp/keyfount-android-shell.png`. Expected: the Setup screen (first run) or the Generator screen (returning user) with the new top bar, the three-tab bottom nav (Comptes / Générateur / Paramètres), and the vault avatar top-right. No fragment of the old desktop sidebar.

- [ ] **Step 7: iOS visual smoke**

```bash
xcrun simctl boot "iPhone 17e" 2>/dev/null || true
nohup npx tauri ios dev "iPhone 17e" > /tmp/keyfount-ios.log 2>&1 &
```

Wait for `App reinstalled` (~1-3 min). Then:

```bash
xcrun simctl io "iPhone 17e" screenshot /tmp/keyfount-ios-shell.png
```

Expected: same shell, with the iOS Liquid Glass nav (translucent bottom bar that picks up the colour of the content scrolling behind it).

- [ ] **Step 8: Diff check — no desktop component was touched**

Run: `git diff --name-only main..HEAD -- src/components/`
Expected: empty output. (If anything shows up, revisit the change — it's a constraint violation.)

- [ ] **Step 9: Final commit (only if Steps 1-8 surfaced anything trivial worth fixing)**

If nothing needs fixing, this step is skipped. If a small tweak (typo, missing import) shows up, commit it:

```bash
git add -p
git commit -m "fix(mobile): <one-liner>"
```

- [ ] **Step 10: Push the branch**

```bash
git push -u origin feat/mobile-support
```

The branch is now ready to open a PR. Expected behaviour on the PR: every commit shows a small, focused diff; `gh pr view` lists the test/clippy/cargo-check checks as green.

---

## Out of scope for this plan

- Wiring every Settings sub-row (auto-lock minutes, PIN, biometric, history, favicon, sync push/pull, export/import, wipe). The scaffold in Task 11 surfaces the section structure; the per-row UI is a follow-up.
- Long-press context sheet on accounts rows (Rename / Edit profile / Delete) — listed in §5.4 of the spec but not in the bite-sized tasks above. Add as a follow-up.
- Tauri 2.11 `bail!("…{t}")` upstream fix — that's a Tauri-side patch, not Keyfount work.
- Storage tests on the Android `$HOME` redirect — desktop tests already cover the SQLite layer; mobile re-tests would require a JNI harness.
