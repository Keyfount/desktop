import { invoke } from "@tauri-apps/api/core";

/**
 * Strongly-typed wrapper around `invoke`. Every Tauri command exposed by
 * `src-tauri/src/commands/*` is mirrored here as a single typed function,
 * so the rest of the frontend never has to know about the IPC bridge.
 *
 * Mutation methods (record/update/delete/rename account, set profile,
 * toggle pref) emit a `SyncOp` on `syncBus` after the IPC call
 * succeeds. The background sync engine subscribes to that bus and
 * pushes the op fire-and-forget — see `sync/auto.ts`. This is the
 * single integration point: components keep calling `api.foo()` and
 * cross-device sync just happens.
 */
import { syncBus } from "./sync/bus.js";
import type {
  Profile,
  StatusResponse,
  UnlockResponse,
  FingerprintResponse,
  GenerateResponse,
  GetProfileResponse,
  GetStateResponse,
  GetAccountSyncInfoResponse,
  ListAccountsResponse,
  RecordAccountResponse,
  ListVaultsResponse,
  SyncStampDir,
  SyncStatusResponse,
  SyncTestConnectionResponse,
  AutofillStatusResponse,
  BiometricAvailableResponse,
  ExportResponse,
  ImportResponse,
} from "./types.js";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

/**
 * Per-call escape hatch for the auto-sync engine. Setting `skipBus`
 * tells the mutation helper NOT to dispatch a `syncBus.notify(...)` —
 * critical when applying an event we just received from the server,
 * otherwise we'd loop (push → other device pulls → re-pushes → we
 * pull → re-push → …). UI callers leave it unset.
 */
export interface MutationOpts {
  skipBus?: boolean;
}

/**
 * Tauri serialises our Rust `AppError` as `{ kind, message }` rather than a
 * JS `Error` instance, so the usual `err instanceof Error ? err.message :
 * String(err)` pattern produces `[object Object]`. This helper handles all
 * three shapes: real Errors, AppError-shaped objects, and bare strings.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err !== null && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Stable error-kind tag from a serialised AppError, or null. */
export function errorKind(err: unknown): string | null {
  if (err !== null && typeof err === "object" && "kind" in err) {
    const k = (err as { kind: unknown }).kind;
    if (typeof k === "string") return k;
  }
  return null;
}

export const api = {
  status: () => call<StatusResponse>("status"),
  setup: (master: string) => call<UnlockResponse>("setup", { master }),
  unlock: (master: string) => call<UnlockResponse>("unlock", { master }),
  unlockWithPin: (pin: string) => call<UnlockResponse>("unlock_with_pin", { pin }),
  lock: () => call<void>("lock"),
  fingerprint: (master: string) => call<FingerprintResponse>("fingerprint", { master }),
  sessionMaster: () => call<{ master: string }>("session_master"),

  generate: (domain: string, email: string, profile?: Profile) =>
    call<GenerateResponse>("generate", { domain, email, profile }),
  getProfile: (domain: string) => call<GetProfileResponse>("get_profile", { domain }),
  setProfile: async (domain: string, profile: Profile, opts?: MutationOpts) => {
    await call<void>("set_profile", { domain, profile });
    if (opts?.skipBus !== true) syncBus.notify({ t: "set_site_profile", domain, profile });
  },
  deleteProfile: async (domain: string, opts?: MutationOpts) => {
    await call<void>("delete_profile", { domain });
    if (opts?.skipBus !== true) syncBus.notify({ t: "delete_site_profile", domain });
  },
  setDefaultProfile: async (profile: Profile, opts?: MutationOpts) => {
    await call<void>("set_default_profile", { profile });
    if (opts?.skipBus !== true) syncBus.notify({ t: "set_default_profile", profile });
  },

  getState: () => call<GetStateResponse>("get_state"),
  setAutoLockMinutes: (minutes: number) => call<void>("set_auto_lock_minutes", { minutes }),
  setHistoryEnabled: async (enabled: boolean, opts?: MutationOpts) => {
    await call<void>("set_history_enabled", { enabled });
    if (opts?.skipBus !== true) {
      syncBus.notify({ t: "set_pref", key: "historyEnabled", value: enabled });
    }
  },
  setFaviconFallbackEnabled: async (enabled: boolean, opts?: MutationOpts) => {
    await call<void>("set_favicon_fallback_enabled", { enabled });
    if (opts?.skipBus !== true) {
      syncBus.notify({ t: "set_pref", key: "faviconFallbackEnabled", value: enabled });
    }
  },
  setClipboardClearSeconds: (seconds: number) =>
    call<void>("set_clipboard_clear_seconds", { seconds }),
  setPin: (pin: string) => call<void>("set_pin", { pin }),
  removePin: () => call<void>("remove_pin"),
  wipe: () => call<void>("wipe"),

  listAccounts: () => call<ListAccountsResponse>("list_accounts"),
  /**
   * Accounts the AutoFill extension wrote directly to SQLite (without
   * passing through the IPC mutation helpers that fire `syncBus`).
   * `sync/auto.ts` drains this on startup so those entries get
   * replayed through the regular push pipeline.
   */
  listPendingSyncAccounts: () => call<ListAccountsResponse>("list_pending_sync_accounts"),
  recordAccount: async (
    domain: string,
    username: string,
    profile: Profile,
    linkedDomains?: string[],
    opts?: MutationOpts,
  ) => {
    const r = await call<RecordAccountResponse>("record_account", {
      domain,
      username,
      profile,
      linkedDomains,
    });
    if (opts?.skipBus !== true) syncBus.notify({ t: "upsert_account", entry: r.entry });
    return r;
  },
  updateAccountProfile: async (
    domain: string,
    username: string,
    profile: Profile,
    opts?: MutationOpts,
  ) => {
    const r = await call<RecordAccountResponse>("update_account_profile", {
      domain,
      username,
      profile,
    });
    if (opts?.skipBus !== true) syncBus.notify({ t: "upsert_account", entry: r.entry });
    return r;
  },
  renameAccount: async (
    domain: string,
    oldUsername: string,
    newUsername: string,
    opts?: MutationOpts,
  ) => {
    const r = await call<RecordAccountResponse>("rename_account", {
      domain,
      oldUsername,
      newUsername,
    });
    if (opts?.skipBus !== true) {
      syncBus.notify({ t: "rename_account", domain, oldUsername, newUsername });
    }
    return r;
  },
  deleteAccount: async (domain: string, username: string, opts?: MutationOpts) => {
    await call<void>("delete_account", { domain, username });
    if (opts?.skipBus !== true) syncBus.notify({ t: "delete_account", domain, username });
  },
  /**
   * Parse a pasted value into `{ host, registrable }` (via the Rust PSL
   * rule) so the linked-domains UI can offer "this subdomain" vs "the whole
   * site" when they differ.
   */
  parseLinkTarget: (input: string) =>
    call<{ host: string | null; registrable: string | null }>("parse_link_target", { input }),
  /**
   * Add a match-only linked domain to an account. The account is then
   * offered on that host too (registrable → broad, full host → narrow),
   * while still deriving from its own canonical `domain`.
   */
  linkAccountDomain: async (
    domain: string,
    username: string,
    linked: string,
    opts?: MutationOpts,
  ) => {
    const r = await call<RecordAccountResponse>("link_account_domain", {
      domain,
      username,
      linked,
    });
    if (opts?.skipBus !== true) syncBus.notify({ t: "upsert_account", entry: r.entry });
    return r;
  },
  unlinkAccountDomain: async (
    domain: string,
    username: string,
    linked: string,
    opts?: MutationOpts,
  ) => {
    const r = await call<RecordAccountResponse>("unlink_account_domain", {
      domain,
      username,
      linked,
    });
    if (opts?.skipBus !== true) syncBus.notify({ t: "upsert_account", entry: r.entry });
    return r;
  },
  /**
   * Replace an account's entire linked-domain set. Used by the sync apply
   * path to adopt a peer's authoritative set on an account that already
   * exists locally (where `updateAccountProfile` alone wouldn't touch links).
   */
  setAccountLinkedDomains: async (
    domain: string,
    username: string,
    linked: string[],
    opts?: MutationOpts,
  ) => {
    const r = await call<RecordAccountResponse>("set_account_linked_domains", {
      domain,
      username,
      linked,
    });
    if (opts?.skipBus !== true) syncBus.notify({ t: "upsert_account", entry: r.entry });
    return r;
  },
  /**
   * Read the per-account sync stamp (`{ ts, dir }`) so the account
   * detail screen can show "Synced 12 min ago". Returns
   * `lastSyncedAt: null` for rows the sync pipeline has never touched.
   */
  getAccountSyncInfo: (domain: string, username: string) =>
    call<GetAccountSyncInfoResponse>("get_account_sync_info", { domain, username }),
  /**
   * Internal: stamp an account as just-pushed-or-pulled. Called by
   * `sync/manager.ts` after a successful event push or after a remote
   * event is applied locally during a pull. UI code shouldn't call
   * this directly.
   */
  accountStampSynced: (domain: string, username: string, dir: SyncStampDir) =>
    call<void>("account_stamp_synced", { domain, username, dir }),

  /**
   * Tombstones for accounts the user has explicitly deleted. Travels
   * in the encrypted SyncableState v2 snapshot so peers can converge
   * on the delete even when the originating delete_account event was
   * compacted server-side.
   */
  listTombstones: () =>
    call<{ domain: string; username: string; deletedAt: number }[]>("list_tombstones"),
  mergeTombstones: (incoming: { domain: string; username: string; deletedAt: number }[]) =>
    call<void>("merge_tombstones", { incoming }),

  /**
   * Persistent retry queue for sync ops. Mutations that can't reach
   * the server right now (vault locked, session pending, offline) are
   * enqueued here and drained by `sync/pending.ts` on every push path
   * once conditions are favourable again.
   */
  pendingOpsEnqueue: (opJson: string) => call<number>("pending_ops_enqueue", { opJson }),
  pendingOpsList: () =>
    call<
      {
        id: number;
        opJson: string;
        createdAt: number;
        attempts: number;
        lastError: string | null;
      }[]
    >("pending_ops_list"),
  pendingOpsDelete: (id: number) => call<void>("pending_ops_delete", { id }),
  pendingOpsRecordFailure: (id: number, error: string) =>
    call<void>("pending_ops_record_failure", { id, error }),

  listVaults: () => call<ListVaultsResponse>("list_vaults"),
  switchVault: (id: string) => call<void>("switch_vault", { id }),
  deleteVault: (id: string) => call<void>("delete_vault", { id }),
  startNewVault: () => call<void>("start_new_vault"),

  copyWithAutoClear: (text: string, seconds?: number) =>
    call<void>("copy_with_auto_clear", { text, seconds }),
  cancelClipboardClear: () => call<void>("cancel_clipboard_clear"),

  syncStatus: () => call<SyncStatusResponse>("sync_status"),
  syncTestConnection: (baseUrl: string) =>
    call<SyncTestConnectionResponse>("sync_test_connection", { baseUrl }),
  syncSessionSave: (session: unknown) => call<void>("sync_session_save", { session }),
  syncSessionLoad: () => call<unknown | null>("sync_session_load"),
  syncSessionClear: () => call<void>("sync_session_clear"),
  syncHttp: (req: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }) => call<{ status: number; body: string }>("sync_http", { req }),

  exportVault: (passphrase: string) => call<ExportResponse>("export_vault", { passphrase }),
  importVault: (envelopeJson: string, passphrase: string) =>
    call<ImportResponse>("import_vault", { envelopeJson, passphrase }),

  showQuickSearch: () => call<void>("show_quick_search"),
  openPreferences: () => call<void>("open_preferences"),
  registerHotkey: (combo?: string) => call<{ combo: string }>("register_hotkey", { combo }),
  unregisterHotkey: () => call<void>("unregister_hotkey"),

  biometricAvailable: () => call<BiometricAvailableResponse>("biometric_available"),
  unlockBiometric: () => call<UnlockResponse>("unlock_biometric"),
  enableBiometric: () => call<void>("enable_biometric"),
  disableBiometric: () => call<void>("disable_biometric"),

  autofillStatus: () => call<AutofillStatusResponse>("autofill_status"),
  enableAutofill: () => call<void>("enable_autofill"),
  disableAutofill: () => call<void>("disable_autofill"),
};

export type Api = typeof api;
