import { invoke } from "@tauri-apps/api/core";

/**
 * Strongly-typed wrapper around `invoke`. Every Tauri command exposed by
 * `src-tauri/src/commands/*` is mirrored here as a single typed function,
 * so the rest of the frontend never has to know about the IPC bridge.
 */
import type {
  Profile,
  StatusResponse,
  UnlockResponse,
  FingerprintResponse,
  GenerateResponse,
  GetProfileResponse,
  GetStateResponse,
  ListAccountsResponse,
  RecordAccountResponse,
  ListVaultsResponse,
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

export const api = {
  status: () => call<StatusResponse>("status"),
  setup: (master: string) => call<UnlockResponse>("setup", { master }),
  unlock: (master: string) => call<UnlockResponse>("unlock", { master }),
  unlockWithPin: (pin: string) => call<UnlockResponse>("unlock_with_pin", { pin }),
  lock: () => call<void>("lock"),
  fingerprint: (master: string) => call<FingerprintResponse>("fingerprint", { master }),

  generate: (domain: string, email: string, profile?: Profile) =>
    call<GenerateResponse>("generate", { domain, email, profile }),
  getProfile: (domain: string) => call<GetProfileResponse>("get_profile", { domain }),
  setProfile: (domain: string, profile: Profile) => call<void>("set_profile", { domain, profile }),
  deleteProfile: (domain: string) => call<void>("delete_profile", { domain }),
  setDefaultProfile: (profile: Profile) => call<void>("set_default_profile", { profile }),

  getState: () => call<GetStateResponse>("get_state"),
  setAutoLockMinutes: (minutes: number) => call<void>("set_auto_lock_minutes", { minutes }),
  setHistoryEnabled: (enabled: boolean) => call<void>("set_history_enabled", { enabled }),
  setFaviconFallbackEnabled: (enabled: boolean) =>
    call<void>("set_favicon_fallback_enabled", { enabled }),
  setClipboardClearSeconds: (seconds: number) =>
    call<void>("set_clipboard_clear_seconds", { seconds }),
  setPin: (pin: string) => call<void>("set_pin", { pin }),
  removePin: () => call<void>("remove_pin"),
  wipe: () => call<void>("wipe"),

  listAccounts: () => call<ListAccountsResponse>("list_accounts"),
  recordAccount: (domain: string, username: string, profile: Profile) =>
    call<RecordAccountResponse>("record_account", { domain, username, profile }),
  updateAccountProfile: (domain: string, username: string, profile: Profile) =>
    call<RecordAccountResponse>("update_account_profile", { domain, username, profile }),
  renameAccount: (domain: string, oldUsername: string, newUsername: string) =>
    call<RecordAccountResponse>("rename_account", { domain, oldUsername, newUsername }),
  deleteAccount: (domain: string, username: string) =>
    call<void>("delete_account", { domain, username }),

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

  exportVault: (passphrase: string) => call<ExportResponse>("export_vault", { passphrase }),
  importVault: (envelopeJson: string, passphrase: string) =>
    call<ImportResponse>("import_vault", { envelopeJson, passphrase }),

  showQuickSearch: () => call<void>("show_quick_search"),
  openPreferences: () => call<void>("open_preferences"),
  registerHotkey: (combo?: string) => call<{ combo: string }>("register_hotkey", { combo }),
  unregisterHotkey: () => call<void>("unregister_hotkey"),

  biometricAvailable: () => call<BiometricAvailableResponse>("biometric_available"),
  unlockBiometric: () => call<void>("unlock_biometric"),
  enableBiometric: () => call<void>("enable_biometric"),
  disableBiometric: () => call<void>("disable_biometric"),

  autofillStatus: () => call<AutofillStatusResponse>("autofill_status"),
  enableAutofill: () => call<void>("enable_autofill"),
  disableAutofill: () => call<void>("disable_autofill"),
};

export type Api = typeof api;
