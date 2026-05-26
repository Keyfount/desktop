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
import { EMPTY_STATE, type SyncableState, type SyncOp } from "./payload.js";

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
 * Hybrid sync.
 *
 * - **Pull**: try `/snapshots/latest` first (cheap O(1) replay); if the
 *   server has no snapshot, replay `/events` from cursor 0. Either path
 *   ends up with the same local state.
 * - **Push**: emit one `upsert_account` event per local account through
 *   `/events`, then take a fresh snapshot at the highest server seq the
 *   server just gave back. That keeps `snapshot.upToSeq` always ≤ the
 *   committed event log, so the server's guard
 *   (`snapshot_ahead_of_log`) is satisfied — that was the source of the
 *   400 we used to hit on a brand-new account where `latestSeq = 0` and
 *   we naively posted `upToSeq = 1`.
 *
 * The events carry the same `SyncOp` payload the browser extension
 * uses, so a desktop push is interchangeable with an extension push for
 * cross-device users.
 */
export async function pull(master: string): Promise<SyncStats> {
  const session = await requireApprovedSession();
  const key = await deriveEncryptionKey(session, master);

  const client = new SyncClient({
    baseUrl: session.baseUrl,
    sessionToken: session.sessionToken,
  });

  // Snapshot first (cheap O(1) replay) — but ALWAYS follow up with an
  // event pull starting at `upToSeq`. The snapshot is just the state
  // up to that seq; any event the server has accepted since (other
  // device pushes, our own deferred pushes) lives in /events past it.
  // Returning early after the snapshot is the bug we just fixed —
  // cross-device mutations posted after the last snapshot were
  // silently ignored.
  let cursor = 0;
  let applied = 0;
  const snapshot = await client.latestSnapshot();
  if (snapshot) {
    const state = await decryptState(key, snapshot.ciphertext, snapshot.nonce);
    await applyStateLocally(state);
    applied += state.accounts.length;
    cursor = snapshot.upToSeq;
  }

  // Replay events past the snapshot cursor. Same logic as the
  // extension's pullEvents.
  let hasMore = true;
  while (hasMore) {
    const page = await client.pullEvents(cursor, 200);
    for (const ev of page.events) {
      if (ev.deviceId === session.deviceId) {
        // Our own push echoed back — already applied locally.
        cursor = ev.serverSeq;
        continue;
      }
      try {
        const op = (await decryptOp(key, ev.ciphertext, ev.nonce)) as SyncOp;
        await applyOpLocally(op);
        applied++;
      } catch {
        // poison-pill: skip, advance cursor anyway so we don't loop
      }
      cursor = ev.serverSeq;
    }
    hasMore = page.hasMore;
    if (!hasMore && page.nextCursor > cursor) cursor = page.nextCursor;
  }
  const refreshed = await api.listAccounts();
  allAccounts.value = refreshed.entries;
  return { pulled: applied, pushed: 0, cursor };
}

export async function push(master: string): Promise<SyncStats> {
  const session = await requireApprovedSession();
  const key = await deriveEncryptionKey(session, master);

  const client = new SyncClient({
    baseUrl: session.baseUrl,
    sessionToken: session.sessionToken,
  });

  const localAccounts = await api.listAccounts();
  const localState = await api.getState();

  // Phase 1: push one event per account so the log grows server-side.
  // Lamport timestamps need to be monotonic per-device; ms-since-epoch
  // is plenty unique within a single push and matches the extension's
  // bumpLamport behaviour at the granularity we care about.
  let lamport = Date.now();
  let lastSeq = 0;
  let pushedCount = 0;
  for (const entry of localAccounts.entries) {
    const op: SyncOp = { t: "upsert_account", entry };
    const { ciphertext, nonce } = await encryptOp(key, op);
    const ack = await client.pushEvent({
      lamport: lamport++,
      ciphertext: Array.from(ciphertext),
      nonce: Array.from(nonce),
    });
    lastSeq = Math.max(lastSeq, ack.serverSeq);
    pushedCount++;
  }

  // Phase 2: snapshot for fast subsequent pulls. `upToSeq` is the
  // highest seq the server just acknowledged — never ahead of the log.
  // For an empty account list we skip the snapshot entirely.
  if (lastSeq > 0) {
    const state: SyncableState = {
      ...EMPTY_STATE,
      defaultProfile: localState.defaultProfile,
      sites: localState.sites,
      historyEnabled: localState.historyEnabled,
      faviconFallbackEnabled: localState.faviconFallbackEnabled,
      accounts: localAccounts.entries,
    };
    const { ciphertext, nonce } = await encryptState(key, state);
    await client.putSnapshot({
      upToSeq: lastSeq,
      ciphertext: Array.from(ciphertext),
      nonce: Array.from(nonce),
    });
  }

  return { pulled: 0, pushed: pushedCount, cursor: lastSeq };
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

export async function decryptState(
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

async function encryptOp(
  key: CryptoKey,
  op: SyncOp,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(op));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { ciphertext: new Uint8Array(ct), nonce };
}

async function decryptOp(key: CryptoKey, ciphertext: number[], nonce: number[]): Promise<SyncOp> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce) as BufferSource },
    key,
    new Uint8Array(ciphertext) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as SyncOp;
}

/**
 * Apply a single decrypted SyncOp to the local stores. Mirrors the
 * extension's `applyOp`, except we go through the Tauri IPC layer
 * (`api.*`) rather than direct chrome.storage writes. `skipBus: true`
 * is critical — applying a remote op must not re-emit it as a local
 * push, otherwise the two devices ping-pong forever.
 */
async function applyOpLocally(op: SyncOp): Promise<void> {
  const silent = { skipBus: true } as const;
  switch (op.t) {
    case "set_default_profile":
      await api.setDefaultProfile(op.profile, silent);
      break;
    case "set_site_profile":
      await api.setProfile(op.domain, op.profile, silent);
      break;
    case "delete_site_profile":
      await api.deleteProfile(op.domain, silent);
      break;
    case "set_pref":
      if (op.key === "historyEnabled") {
        await api.setHistoryEnabled(op.value, silent);
        historyEnabled.value = op.value;
      } else if (op.key === "faviconFallbackEnabled") {
        await api.setFaviconFallbackEnabled(op.value, silent);
      }
      break;
    case "upsert_account": {
      const existing = await api.listAccounts();
      const present = existing.entries.some(
        (e) => e.domain === op.entry.domain && e.username === op.entry.username,
      );
      if (present) {
        await api.updateAccountProfile(
          op.entry.domain,
          op.entry.username,
          op.entry.profile,
          silent,
        );
      } else {
        await api.recordAccount(op.entry.domain, op.entry.username, op.entry.profile, silent);
      }
      break;
    }
    case "delete_account":
      await api.deleteAccount(op.domain, op.username, silent);
      break;
    case "rename_account":
      await api.renameAccount(op.domain, op.oldUsername, op.newUsername, silent);
      break;
    case "set_fingerprint":
      // No-op locally: the fingerprint is derived at unlock, not stored.
      break;
  }
}

export async function applyStateLocally(state: SyncableState): Promise<void> {
  // Same `skipBus` discipline as `applyOpLocally`: replaying a remote
  // snapshot must not re-push every applied entry as a local event.
  const silent = { skipBus: true } as const;

  // Default profile and sites
  await api.setDefaultProfile(state.defaultProfile, silent);
  for (const [domain, profile] of Object.entries(state.sites)) {
    await api.setProfile(domain, profile as Profile, silent);
  }
  // History toggle (push it down — needed for AccountList to surface)
  await api.setHistoryEnabled(state.historyEnabled, silent);
  historyEnabled.value = state.historyEnabled;

  // Replace local accounts with the snapshot contents. We do not
  // delete accounts the server hasn't heard about — the user can
  // explicitly delete them locally.
  const existing = await api.listAccounts();
  const existingKeys = new Set(existing.entries.map((e) => key(e)));
  for (const entry of state.accounts) {
    if (!existingKeys.has(key(entry))) {
      await api.recordAccount(entry.domain, entry.username, entry.profile, silent);
    }
  }
  // Refresh the signal-backed list so the UI updates.
  const refreshed = await api.listAccounts();
  allAccounts.value = refreshed.entries;
}

function key(entry: AccountEntry): string {
  return `${entry.domain}|${entry.username}`;
}
