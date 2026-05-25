/**
 * Frontend sync orchestrator.
 *
 * Stores the session in the OS keychain via the Tauri backend, runs the
 * OPAQUE register/login flow against the server (using
 * `@cloudflare/opaque-ts` exactly the same way the extension does), and
 * exposes a small snapshot-based pull/push surface for the desktop UI.
 *
 * Payload scheme:
 *   plaintext  = JSON-encoded `SyncableState`
 *   ciphertext = AES-GCM(EK, nonce=12 random bytes, plaintext)
 * The encryption key (`EK`) is re-derived from the master every time we
 * sync — it is never persisted on disk and never seen by the server.
 */
import { api } from "../api.js";
import { allAccounts, historyEnabled } from "../state.js";
import type { AccountEntry, Profile } from "../types.js";
import { deriveEncryptionKey, syncLogin, syncRegister, type SyncSession } from "./auth.js";
import { SyncApiError, SyncClient } from "./client.js";
import { EMPTY_STATE, type SyncableState } from "./payload.js";

const SNAPSHOT_LAMPORT = 1;

let cachedSession: SyncSession | null = null;

export async function loadStoredSession(): Promise<SyncSession | null> {
  if (cachedSession) return cachedSession;
  const raw = (await api.syncSessionLoad()) as SyncSession | null;
  cachedSession = raw;
  return raw;
}

export async function saveSession(session: SyncSession): Promise<void> {
  cachedSession = session;
  await api.syncSessionSave(session as unknown as object);
}

export async function clearSession(): Promise<void> {
  cachedSession = null;
  await api.syncSessionClear();
}

export interface ConnectInput {
  baseUrl: string;
  email: string;
  master: string;
  deviceLabel?: string;
}

/**
 * Try to log in first (covers the case where the user already
 * registered this account from another device), and fall back to
 * registration on a 401 ("invalid_master" — actually means
 * "no such account").
 */
export async function connect(args: ConnectInput): Promise<SyncSession> {
  try {
    const session = await syncLogin(args);
    await saveSession(session);
    return session;
  } catch (err) {
    if (err instanceof SyncApiError && (err.status === 401 || err.status === 404)) {
      const session = await syncRegister(args);
      await saveSession(session);
      return session;
    }
    throw err;
  }
}

export async function pollApproval(): Promise<SyncSession | null> {
  const session = await loadStoredSession();
  if (!session) return null;
  if (session.status === "approved") return session;

  const client = new SyncClient({ baseUrl: session.baseUrl });
  const result = await client.approvalStatus(session.userId);
  if (result.status !== "approved") return session;
  if (!result.sessionToken || !result.expiresAt) return session;
  const upgraded: SyncSession = {
    ...session,
    status: "approved",
    sessionToken: result.sessionToken,
    expiresAt: result.expiresAt,
  };
  await saveSession(upgraded);
  return upgraded;
}

export async function disconnect(): Promise<void> {
  const session = await loadStoredSession();
  if (session?.status === "approved") {
    try {
      const client = new SyncClient({
        baseUrl: session.baseUrl,
        sessionToken: session.sessionToken,
      });
      await client.logout();
    } catch {
      /* swallow — the user wants the local session gone either way */
    }
  }
  await clearSession();
}

export interface SyncStats {
  /** Number of accounts pulled from the server. */
  pulled: number;
  /** Number of accounts in the local push. */
  pushed: number;
  /** Server-side seq we caught up to. */
  cursor: number;
}

/**
 * Snapshot-based sync.
 *
 * - **Pull**: fetch /snapshots/latest, decrypt, and replace the local
 *   `accounts` list (the source of truth for syncing).
 * - **Push**: serialise the local accounts into a fresh snapshot,
 *   encrypt, and POST.
 *
 * Conflict resolution is intentionally last-write-wins on the server's
 * `serverSeq`: simple, correct for a single-user multi-device setup,
 * and matches the "snapshot only" path the extension takes when no
 * incremental events are pending.
 */
export async function pull(master: string): Promise<SyncStats> {
  const session = await requireApprovedSession();
  const key = await deriveEncryptionKey(session, master);

  const client = new SyncClient({
    baseUrl: session.baseUrl,
    sessionToken: session.sessionToken,
  });

  const snapshot = await client.latestSnapshot();
  if (!snapshot) {
    return { pulled: 0, pushed: 0, cursor: 0 };
  }
  const state = await decryptState(key, snapshot.ciphertext, snapshot.nonce);
  await applyStateLocally(state);
  return { pulled: state.accounts.length, pushed: 0, cursor: snapshot.upToSeq };
}

export async function push(master: string): Promise<SyncStats> {
  const session = await requireApprovedSession();
  const key = await deriveEncryptionKey(session, master);

  const client = new SyncClient({
    baseUrl: session.baseUrl,
    sessionToken: session.sessionToken,
  });

  // Snapshot the current local state. We rely on the existing IPC layer
  // for the source-of-truth — the SQLite tables.
  const localAccounts = await api.listAccounts();
  const localState = await api.getState();
  const state: SyncableState = {
    ...EMPTY_STATE,
    defaultProfile: localState.defaultProfile,
    sites: localState.sites,
    historyEnabled: localState.historyEnabled,
    faviconFallbackEnabled: localState.faviconFallbackEnabled,
    accounts: localAccounts.entries,
  };
  const { ciphertext, nonce } = await encryptState(key, state);

  // No events are pending in the snapshot-only mode; use `upToSeq = 1`
  // as a stable, monotonically-non-decreasing placeholder so the
  // server accepts subsequent snapshots from this device.
  const result = await client.putSnapshot({
    upToSeq: SNAPSHOT_LAMPORT,
    ciphertext: Array.from(ciphertext),
    nonce: Array.from(nonce),
  });

  return { pulled: 0, pushed: state.accounts.length, cursor: result.compactedEvents };
}

async function requireApprovedSession(): Promise<Extract<SyncSession, { status: "approved" }>> {
  const session = await loadStoredSession();
  if (!session) throw new Error("no sync session");
  if (session.status !== "approved") throw new Error("sync session is pending");
  return session;
}

async function encryptState(
  key: CryptoKey,
  state: SyncableState,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { ciphertext: new Uint8Array(ct), nonce };
}

async function decryptState(
  key: CryptoKey,
  ciphertext: number[],
  nonce: number[],
): Promise<SyncableState> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce) as BufferSource },
    key,
    new Uint8Array(ciphertext) as BufferSource,
  );
  const text = new TextDecoder().decode(plain);
  return JSON.parse(text) as SyncableState;
}

async function applyStateLocally(state: SyncableState): Promise<void> {
  // Default profile and sites
  await api.setDefaultProfile(state.defaultProfile);
  for (const [domain, profile] of Object.entries(state.sites)) {
    await api.setProfile(domain, profile as Profile);
  }
  // History toggle (push it down — needed for AccountList to surface)
  await api.setHistoryEnabled(state.historyEnabled);
  historyEnabled.value = state.historyEnabled;

  // Replace local accounts with the snapshot contents. We do not
  // delete accounts the server hasn't heard about — the user can
  // explicitly delete them locally.
  const existing = await api.listAccounts();
  const existingKeys = new Set(existing.entries.map((e) => key(e)));
  for (const entry of state.accounts) {
    if (!existingKeys.has(key(entry))) {
      await api.recordAccount(entry.domain, entry.username, entry.profile);
    }
  }
  // Refresh the signal-backed list so the UI updates.
  const refreshed = await api.listAccounts();
  allAccounts.value = refreshed.entries;
}

function key(entry: AccountEntry): string {
  return `${entry.domain}|${entry.username}`;
}
