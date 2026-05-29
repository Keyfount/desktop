/**
 * In-browser mock of the Tauri IPC bridge.
 *
 * The real desktop/mobile shells talk to the Rust backend through
 * `window.__TAURI_INTERNALS__.invoke(cmd, args)` (see
 * `@tauri-apps/api/core`). The native runtime can't run in a plain browser
 * — and certainly not cross-platform / on iOS without a device — so these
 * e2e tests drive the *real* Preact UI with real clicks against a stateful
 * fake of that bridge. The Rust layer itself is covered by the 99 `cargo
 * test` unit tests; this harness covers everything above the IPC boundary:
 * routing, state, validation, multi-step journeys, going back, etc.
 *
 * `installMock` is injected via `page.addInitScript`, so it runs in the
 * page context before any app code. It MUST be fully self-contained — it
 * cannot close over anything in this module — because Playwright serialises
 * the function source and re-evaluates it in the browser.
 */

export type Scenario = "first-run" | "locked" | "unlocked";

export interface SeedAccount {
  domain: string;
  username: string;
}

export interface Seed {
  /** Initial app state. `first-run` = no vault; `locked` = a vault exists
   *  but the session is locked; `unlocked` = straight into the shell. */
  scenario?: Scenario;
  /** Master for the seeded vault (locked/unlocked scenarios). */
  master?: string;
  /** Seed a PIN on the vault so the unlock screen offers the PIN tab. */
  pin?: string;
  /** Pre-populate account history. */
  accounts?: SeedAccount[];
  /** Enable account history on the seeded vault. */
  historyEnabled?: boolean;
  /** Auto-lock timeout in minutes (0 disables). */
  autoLockMinutes?: number;
  /** Add extra registered vaults so "switch / cancel to existing" paths light up. */
  extraVaults?: number;
}

/**
 * Runs in the browser. Defines `window.__TAURI_INTERNALS__` (the bridge the
 * app calls) plus `window.__MOCK__` (test-only helpers for emitting events
 * and inspecting state).
 */
export function installMock(seed: Seed): void {
  // ---- tiny deterministic helpers (no external deps) -------------------
  const hash = (s: string): number => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };
  const fingerprintOf = (master: string): string => {
    const h = hash("fp:" + master);
    const b = [(h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff];
    return b.map((x) => x.toString(16).padStart(2, "0").toUpperCase()).join(" ");
  };
  const fakePassword = (domain: string, email: string, profile: any): string => {
    const counter = profile && typeof profile.counter === "number" ? profile.counter : 1;
    const seedStr = `${domain}|${email}|${counter}|${JSON.stringify(profile ?? {})}`;
    let h = hash(seedStr);
    const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*";
    const len = profile && profile.mode === "random" && profile.length ? profile.length : 16;
    let out = "";
    for (let i = 0; i < len; i++) {
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
      out += alphabet[h % alphabet.length];
    }
    return out;
  };
  const uuid = (): string =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  const now = (): number => Date.now();
  const DEFAULT_PROFILE = {
    mode: "random",
    length: 16,
    lower: true,
    upper: true,
    digits: true,
    symbols: true,
    counter: 1,
  };
  const fail = (kind: string, message: string) => Promise.reject({ kind, message });

  // ---- state -----------------------------------------------------------
  interface VaultData {
    id: string;
    master: string;
    fingerprint: string;
    createdAt: number;
    lastUsedAt: number;
    pin: string | null;
    autoLockMinutes: number;
    historyEnabled: boolean;
    faviconFallbackEnabled: boolean;
    clipboardClearSeconds: number;
    defaultProfile: any;
    sites: Record<string, any>;
    accounts: Array<{
      domain: string;
      username: string;
      profile: any;
      linkedDomains?: string[];
      createdAt: number;
      lastUsedAt: number;
    }>;
  }

  const vaults: VaultData[] = [];
  const makeVault = (master: string, opts?: Partial<VaultData>): VaultData => ({
    id: uuid(),
    master,
    fingerprint: fingerprintOf(master),
    createdAt: now(),
    lastUsedAt: now(),
    pin: null,
    autoLockMinutes: 15,
    historyEnabled: false,
    faviconFallbackEnabled: true,
    clipboardClearSeconds: 30,
    defaultProfile: { ...DEFAULT_PROFILE },
    sites: {},
    accounts: [],
    ...opts,
  });

  const s = seed || {};
  const scenario: Scenario = s.scenario ?? "first-run";
  let activeId: string | null = null;
  let unlocked = false;

  for (let i = 0; i < (s.extraVaults ?? 0); i++) {
    vaults.push(makeVault(`extra-vault-master-${i}-aaaaaa`));
  }

  if (scenario !== "first-run") {
    const v = makeVault(s.master ?? "correct-horse-battery", {
      pin: s.pin ?? null,
      historyEnabled: s.historyEnabled ?? (s.accounts ? true : false),
      autoLockMinutes: s.autoLockMinutes ?? 15,
      accounts: (s.accounts ?? []).map((a) => ({
        domain: a.domain,
        username: a.username,
        profile: { ...DEFAULT_PROFILE },
        createdAt: now(),
        lastUsedAt: now(),
      })),
    });
    vaults.push(v);
    activeId = v.id;
    unlocked = scenario === "unlocked";
  }

  const active = (): VaultData | null => vaults.find((v) => v.id === activeId) ?? null;
  const requireUnlocked = (): VaultData | null => (unlocked ? active() : null);

  // ---- event bus (for plugin:event|listen + test emit) -----------------
  let callbackSeq = 0;
  const callbacks: Record<number, (arg: any) => void> = {};
  let eventSeq = 0;
  const listeners: Array<{ eventId: number; event: string; handlerId: number }> = [];

  // ---- command router --------------------------------------------------
  const router = (cmd: string, args: any): Promise<any> => {
    const a = args || {};
    switch (cmd) {
      case "status": {
        if (activeId === null) {
          return Promise.resolve({
            locked: true,
            isFirstRun: true,
            fingerprint: null,
            hasPin: false,
          });
        }
        const v = active()!;
        return Promise.resolve({
          locked: !unlocked,
          isFirstRun: false,
          fingerprint: v.fingerprint,
          hasPin: v.pin !== null,
        });
      }
      case "setup": {
        const master: string = a.master ?? "";
        if (master.length < 12) {
          return fail("invalid", "master password must be at least 12 characters");
        }
        const existing = active();
        if (existing && !unlocked && existing.master !== master) {
          // reopening an existing locked vault via setup is not how the
          // UI uses it, but keep it consistent: create fresh if none active
        }
        if (activeId === null) {
          const v = makeVault(master);
          vaults.push(v);
          activeId = v.id;
        }
        unlocked = true;
        return Promise.resolve({ fingerprint: active()!.fingerprint });
      }
      case "unlock": {
        const v = active();
        if (!v) return fail("invalid", "no active vault");
        if (a.master !== v.master) {
          return fail("invalid", "master password does not match the stored fingerprint");
        }
        unlocked = true;
        v.lastUsedAt = now();
        return Promise.resolve({ fingerprint: v.fingerprint });
      }
      case "unlock_with_pin": {
        const v = active();
        if (!v) return fail("invalid", "no active vault");
        if (v.pin === null) return fail("invalid", "PIN mode is not enabled");
        if (a.pin !== v.pin) return fail("invalid", "incorrect PIN");
        unlocked = true;
        v.lastUsedAt = now();
        return Promise.resolve({ fingerprint: v.fingerprint });
      }
      case "lock": {
        unlocked = false;
        return Promise.resolve(null);
      }
      case "fingerprint": {
        return Promise.resolve({ fingerprint: fingerprintOf(a.master ?? "") });
      }
      case "session_master": {
        const v = requireUnlocked();
        if (!v) return fail("invalid", "vault is locked");
        return Promise.resolve({ master: v.master });
      }
      case "generate": {
        const v = requireUnlocked();
        if (!v) return fail("locked", "locked");
        const profile = a.profile ?? v.sites[(a.domain ?? "").toLowerCase()] ?? v.defaultProfile;
        return Promise.resolve({ password: fakePassword(a.domain ?? "", a.email ?? "", profile) });
      }
      case "get_profile": {
        const v = active();
        const key = (a.domain ?? "").toLowerCase();
        if (v && v.sites[key]) return Promise.resolve({ profile: v.sites[key], isOverride: true });
        return Promise.resolve({
          profile: v ? v.defaultProfile : { ...DEFAULT_PROFILE },
          isOverride: false,
        });
      }
      case "set_profile": {
        const v = active();
        if (v) v.sites[(a.domain ?? "").toLowerCase()] = a.profile;
        return Promise.resolve(null);
      }
      case "delete_profile": {
        const v = active();
        if (v) delete v.sites[(a.domain ?? "").toLowerCase()];
        return Promise.resolve(null);
      }
      case "set_default_profile": {
        const v = active();
        if (v) v.defaultProfile = a.profile;
        return Promise.resolve(null);
      }
      case "get_state": {
        const v = active();
        if (!v) {
          return Promise.resolve({
            defaultProfile: { ...DEFAULT_PROFILE },
            autoLockMinutes: 15,
            hasPin: false,
            historyEnabled: false,
            faviconFallbackEnabled: true,
            clipboardClearSeconds: 30,
            sites: {},
          });
        }
        return Promise.resolve({
          defaultProfile: v.defaultProfile,
          autoLockMinutes: v.autoLockMinutes,
          hasPin: v.pin !== null,
          historyEnabled: v.historyEnabled,
          faviconFallbackEnabled: v.faviconFallbackEnabled,
          clipboardClearSeconds: v.clipboardClearSeconds,
          sites: v.sites,
        });
      }
      case "set_auto_lock_minutes": {
        const v = active();
        if (v) v.autoLockMinutes = Math.max(0, Math.min(240, a.minutes ?? 15));
        return Promise.resolve(null);
      }
      case "set_history_enabled": {
        const v = active();
        if (v) {
          v.historyEnabled = !!a.enabled;
          if (!v.historyEnabled) v.accounts = [];
        }
        return Promise.resolve(null);
      }
      case "set_favicon_fallback_enabled": {
        const v = active();
        if (v) v.faviconFallbackEnabled = !!a.enabled;
        return Promise.resolve(null);
      }
      case "set_clipboard_clear_seconds": {
        const v = active();
        if (v) v.clipboardClearSeconds = Math.max(0, Math.min(600, a.seconds ?? 30));
        return Promise.resolve(null);
      }
      case "set_pin": {
        const v = requireUnlocked();
        if (!v) return fail("locked", "locked");
        v.pin = String(a.pin ?? "");
        return Promise.resolve(null);
      }
      case "remove_pin": {
        const v = active();
        if (v) v.pin = null;
        return Promise.resolve(null);
      }
      case "wipe": {
        const idx = vaults.findIndex((v) => v.id === activeId);
        if (idx >= 0) vaults.splice(idx, 1);
        activeId = vaults.length ? vaults[0]!.id : null;
        unlocked = false;
        return Promise.resolve(null);
      }
      case "list_accounts": {
        const v = active();
        const entries = v ? [...v.accounts].sort((x, y) => y.lastUsedAt - x.lastUsedAt) : [];
        return Promise.resolve({ entries });
      }
      case "list_pending_sync_accounts":
        return Promise.resolve({ entries: [] });
      case "record_account": {
        const v = active();
        if (!v) return fail("locked", "locked");
        const domain = (a.domain ?? "").trim().toLowerCase();
        const existing = v.accounts.find((e) => e.domain === domain && e.username === a.username);
        const entry = existing ?? {
          domain,
          username: a.username,
          profile: a.profile,
          createdAt: now(),
          lastUsedAt: now(),
        };
        entry.profile = a.profile;
        entry.lastUsedAt = now();
        if (!existing) v.accounts.push(entry);
        return Promise.resolve({ entry });
      }
      case "update_account_profile": {
        const v = active();
        if (!v) return fail("locked", "locked");
        const entry = v.accounts.find(
          (e) => e.domain === (a.domain ?? "").toLowerCase() && e.username === a.username,
        );
        if (entry) {
          entry.profile = a.profile;
          entry.lastUsedAt = now();
        }
        return Promise.resolve({ entry: entry ?? null });
      }
      case "rename_account": {
        const v = active();
        if (!v) return fail("locked", "locked");
        const entry = v.accounts.find(
          (e) => e.domain === (a.domain ?? "").toLowerCase() && e.username === a.oldUsername,
        );
        if (entry) entry.username = a.newUsername;
        return Promise.resolve({ entry: entry ?? null });
      }
      case "delete_account": {
        const v = active();
        if (v) {
          v.accounts = v.accounts.filter(
            (e) => !(e.domain === (a.domain ?? "").toLowerCase() && e.username === a.username),
          );
        }
        return Promise.resolve(null);
      }
      case "link_account_domain": {
        const v = active();
        if (!v) return fail("locked", "locked");
        const entry = v.accounts.find(
          (e) => e.domain === (a.domain ?? "").toLowerCase() && e.username === a.username,
        );
        if (entry) {
          const norm = (a.linked ?? "").trim().toLowerCase();
          const set = new Set([...(entry.linkedDomains ?? [])]);
          if (norm && norm !== entry.domain) set.add(norm);
          entry.linkedDomains = [...set];
        }
        return Promise.resolve({ entry: entry ?? null });
      }
      case "unlink_account_domain": {
        const v = active();
        if (!v) return fail("locked", "locked");
        const entry = v.accounts.find(
          (e) => e.domain === (a.domain ?? "").toLowerCase() && e.username === a.username,
        );
        if (entry) {
          const norm = (a.linked ?? "").trim().toLowerCase();
          entry.linkedDomains = (entry.linkedDomains ?? []).filter((d) => d !== norm);
          if (entry.linkedDomains.length === 0) delete entry.linkedDomains;
        }
        return Promise.resolve({ entry: entry ?? null });
      }
      case "set_account_linked_domains": {
        const v = active();
        if (!v) return fail("locked", "locked");
        const entry = v.accounts.find(
          (e) => e.domain === (a.domain ?? "").toLowerCase() && e.username === a.username,
        );
        if (entry) {
          const linked = (a.linked ?? []) as string[];
          if (linked.length > 0) entry.linkedDomains = linked;
          else delete entry.linkedDomains;
        }
        return Promise.resolve({ entry: entry ?? null });
      }
      case "get_account_sync_info":
        return Promise.resolve({ lastSyncedAt: null });
      case "account_stamp_synced":
        return Promise.resolve(null);
      case "list_tombstones":
        return Promise.resolve([]);
      case "merge_tombstones":
        return Promise.resolve(null);
      case "pending_ops_enqueue":
        return Promise.resolve(1);
      case "pending_ops_list":
        return Promise.resolve([]);
      case "pending_ops_delete":
      case "pending_ops_record_failure":
        return Promise.resolve(null);
      case "list_vaults":
        return Promise.resolve({
          activeId,
          vaults: vaults.map((v) => ({
            id: v.id,
            fingerprint: v.fingerprint,
            createdAt: v.createdAt,
            lastUsedAt: v.lastUsedAt,
          })),
        });
      case "switch_vault": {
        if (vaults.some((v) => v.id === a.id)) {
          activeId = a.id;
          unlocked = false;
        }
        return Promise.resolve(null);
      }
      case "delete_vault": {
        const idx = vaults.findIndex((v) => v.id === a.id);
        if (idx >= 0) vaults.splice(idx, 1);
        if (activeId === a.id) {
          activeId = vaults.length ? vaults[0]!.id : null;
          unlocked = false;
        }
        return Promise.resolve(null);
      }
      case "start_new_vault": {
        activeId = null;
        unlocked = false;
        return Promise.resolve(null);
      }
      case "copy_with_auto_clear":
      case "cancel_clipboard_clear":
      case "arm_clipboard_clear":
        return Promise.resolve(null);
      case "sync_status":
        return Promise.resolve({ connected: false, session: null });
      case "sync_test_connection":
        return Promise.resolve({ reachable: false, reason: "mock: offline" });
      case "sync_session_load":
        return Promise.resolve(null);
      case "sync_session_save":
      case "sync_session_clear":
        return Promise.resolve(null);
      case "sync_http":
        return fail("network", "mock: sync disabled");
      case "export_vault":
        return Promise.resolve({ envelope: JSON.stringify({ schemaVersion: 1, mock: true }) });
      case "import_vault":
        return Promise.resolve({ accountsImported: 0, sitesImported: 0 });
      case "show_quick_search":
      case "open_preferences":
      case "unregister_hotkey":
        return Promise.resolve(null);
      case "register_hotkey":
        return Promise.resolve({ combo: a.combo ?? "CmdOrCtrl+Shift+K" });
      case "biometric_available":
        return Promise.resolve({ supported: false, enrolled: false, vaultEnrolled: false });
      case "unlock_biometric":
        return fail("invalid", "biometrics unavailable in mock");
      case "enable_biometric":
      case "disable_biometric":
        return Promise.resolve(null);
      case "autofill_status":
        return Promise.resolve({ enabled: false, permissionGranted: false });
      case "enable_autofill":
      case "disable_autofill":
        return Promise.resolve(null);

      // ---- Tauri event plugin ----
      case "plugin:event|listen": {
        const eventId = ++eventSeq;
        listeners.push({ eventId, event: a.event, handlerId: a.handler });
        return Promise.resolve(eventId);
      }
      case "plugin:event|unlisten": {
        const i = listeners.findIndex((l) => l.eventId === a.eventId && l.event === a.event);
        if (i >= 0) listeners.splice(i, 1);
        return Promise.resolve(null);
      }
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        return Promise.resolve(null);

      default: {
        // Tolerate unknown plugin / native calls so the UI doesn't crash;
        // record them so a test can assert on unexpected traffic.
        (window as any).__MOCK__.unhandled.push(cmd);
        return Promise.resolve(null);
      }
    }
  };

  // ---- bridge ----------------------------------------------------------
  (window as any).__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: any) => router(cmd, args),
    transformCallback: (cb: (arg: any) => void) => {
      const id = ++callbackSeq;
      callbacks[id] = cb;
      return id;
    },
    unregisterCallback: (id: number) => {
      delete callbacks[id];
    },
    convertFileSrc: (p: string) => p,
  };

  // ---- test helpers ----------------------------------------------------
  (window as any).__MOCK__ = {
    unhandled: [] as string[],
    /** Fire a backend → frontend event (e.g. "vault:locked"). Returns the
     *  number of registered handlers that were invoked. */
    emit(event: string, payload: any = null): number {
      const matched = listeners.filter((x) => x.event === event);
      for (const l of matched) {
        const cb = callbacks[l.handlerId];
        if (cb) cb({ event, id: l.eventId, payload });
      }
      return matched.length;
    },
    /** Names of every currently-registered event listener (debug aid). */
    listenerEvents(): string[] {
      return listeners.map((l) => l.event);
    },
    /** Inspect mock state from a test. */
    snapshot() {
      const v = active();
      return {
        activeId,
        unlocked,
        vaultCount: vaults.length,
        accounts: v ? v.accounts.map((x) => ({ ...x })) : [],
        hasPin: v ? v.pin !== null : false,
        autoLockMinutes: v ? v.autoLockMinutes : null,
        historyEnabled: v ? v.historyEnabled : false,
        faviconFallbackEnabled: v ? v.faviconFallbackEnabled : true,
        clipboardClearSeconds: v ? v.clipboardClearSeconds : null,
      };
    },
  };
}
