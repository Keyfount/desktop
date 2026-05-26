/**
 * Frontend mirror of the Rust types exposed by `src-tauri/src/types.rs`.
 *
 * Kept in sync manually until `ts-rs`-driven codegen lands. Each shape
 * here is the deserialised payload of one Tauri command.
 */

export type Profile = RandomProfile | MemorableProfile;

export interface RandomProfile {
  mode: "random";
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  counter: number;
}

export interface MemorableProfile {
  mode: "memorable";
  wordCount: number;
  separator: "-" | "." | "_";
  capitalise: boolean;
  suffix: boolean;
  counter: number;
}

export const DEFAULT_RANDOM_PROFILE: RandomProfile = {
  mode: "random",
  length: 16,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  counter: 1,
};

export const DEFAULT_MEMORABLE_PROFILE: MemorableProfile = {
  mode: "memorable",
  wordCount: 6,
  separator: ".",
  capitalise: true,
  suffix: true,
  counter: 1,
};

export interface AccountEntry {
  domain: string;
  username: string;
  profile: Profile;
  createdAt: number;
  lastUsedAt: number;
}

export interface VaultMeta {
  id: string;
  fingerprint: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface StatusResponse {
  locked: boolean;
  isFirstRun: boolean;
  fingerprint: string | null;
  hasPin: boolean;
}

export interface UnlockResponse {
  fingerprint: string;
}

export interface FingerprintResponse {
  fingerprint: string;
}

export interface GenerateResponse {
  password: string;
}

export interface GetProfileResponse {
  profile: Profile;
  isOverride: boolean;
}

export interface GetStateResponse {
  defaultProfile: Profile;
  autoLockMinutes: number;
  hasPin: boolean;
  historyEnabled: boolean;
  faviconFallbackEnabled: boolean;
  clipboardClearSeconds: number;
  sites: Record<string, Profile>;
}

export interface ListAccountsResponse {
  entries: AccountEntry[];
}

export interface RecordAccountResponse {
  entry: AccountEntry;
}

export interface ListVaultsResponse {
  activeId: string | null;
  vaults: VaultMeta[];
}

export interface SyncSessionView {
  baseUrl: string;
  email: string;
  deviceId: string;
  userId: string;
  approvalStatus: "pending" | "approved";
  connectedAt: number;
  lastSyncAt: number | null;
}

export interface SyncStatusResponse {
  connected: boolean;
  session: SyncSessionView | null;
}

export interface SyncTestConnectionResponse {
  reachable: boolean;
  reason?: string;
}

export interface BiometricAvailableResponse {
  supported: boolean;
  enrolled: boolean;
  vaultEnrolled: boolean;
}

export interface AutofillStatusResponse {
  enabled: boolean;
  permissionGranted: boolean;
}

export interface ExportResponse {
  envelope: string;
}

export interface ImportResponse {
  accountsImported: number;
  sitesImported: number;
}
