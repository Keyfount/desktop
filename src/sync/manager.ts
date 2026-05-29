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
import {
  EMPTY_STATE,
  SYNCABLE_STATE_VERSION,
  type SyncableState,
  type Tombstone,
  type SyncOp,
} from "./payload.js";

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

export interface PollResult {
  status: "pending" | "approved" | "rejected" | "no_session";
  session: SyncSession | null;
  /** Admin-provided rejection reason when `status === "rejected"`. */
  reason?: string;
}

/**
 * Probe the server for the current device's approval status.
 *
 * The shape mirrors the extension's `syncPollApproval` so the UI can
 * branch on `"pending" | "approved" | "rejected" | "no_session"` and
 * surface a rejection reason — the previous `SyncSession | null`
 * shape forced callers to confuse "still pending" with "rejected".
 */
export async function pollApproval(): Promise<PollResult> {
  const session = await loadStoredSession();
  if (!session) return { status: "no_session", session: null };
  if (session.status === "approved") return { status: "approved", session };

  const client = new SyncClient({ baseUrl: session.baseUrl });
  const result = await client.approvalStatus(session.userId);
  if (result.status === "rejected") {
    const reason = result.reason;
    return reason !== undefined
      ? { status: "rejected", session, reason }
      : { status: "rejected", session };
  }
  if (result.status !== "approved") return { status: "pending", session };
  if (!result.sessionToken || !result.expiresAt) return { status: "pending", session };
  const upgraded: SyncSession = {
    ...session,
    status: "approved",
    sessionToken: result.sessionToken,
    expiresAt: result.expiresAt,
  };
  await saveSession(upgraded);
  return { status: "approved", session: upgraded };
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
  const tombstones = await api.listTombstones();
  const tombstoneKeys = new Set(tombstones.map((t) => entryKey(t.domain, t.username)));

  // Phase 1: push one event per LIVE local account so the log grows
  // server-side. Tombstoned (domain, username) pairs are skipped here —
  // they ride the snapshot's `tombstones` field instead. Lamport
  // timestamps need to be monotonic per-device; ms-since-epoch is
  // plenty unique within a single push and matches the extension's
  // bumpLamport behaviour at the granularity we care about.
  let lamport = Date.now();
  let lastSeq = 0;
  let pushedCount = 0;
  for (const entry of localAccounts.entries) {
    if (tombstoneKeys.has(entryKey(entry.domain, entry.username))) continue;
    const op: SyncOp = { t: "upsert_account", entry };
    const { ciphertext, nonce } = await encryptOp(key, op);
    const ack = await client.pushEvent({
      lamport: lamport++,
      ciphertext: Array.from(ciphertext),
      nonce: Array.from(nonce),
    });
    lastSeq = Math.max(lastSeq, ack.serverSeq);
    pushedCount++;
    await stampOrSwallow(entry.domain, entry.username, "push");
  }

  // Phase 2: snapshot for fast subsequent pulls. `upToSeq` is the
  // highest seq the server just acknowledged — never ahead of the log.
  // The snapshot carries the live account list AND the tombstone log
  // so receiving devices can converge on the deletes even when the
  // originating delete_account events have been compacted away.
  //
  // Push the snapshot even on an empty live account list when we
  // have tombstones to broadcast — without it, peers that pulled the
  // server's last (pre-deletion) snapshot would never learn about
  // those deletes.
  if (lastSeq > 0 || tombstones.length > 0) {
    const state: SyncableState = {
      ...EMPTY_STATE,
      defaultProfile: localState.defaultProfile,
      sites: localState.sites,
      historyEnabled: localState.historyEnabled,
      faviconFallbackEnabled: localState.faviconFallbackEnabled,
      accounts: localAccounts.entries.filter(
        (e) => !tombstoneKeys.has(entryKey(e.domain, e.username)),
      ),
      tombstones,
    };
    const { ciphertext, nonce } = await encryptState(key, state);
    // `upToSeq` must never exceed the server's log. When we only
    // have tombstones to flush (no upserts), pull the server's
    // latest seq via a no-op events page so the snapshot stays in
    // the safe range.
    const upToSeq = lastSeq > 0 ? lastSeq : await highestServerSeq(client);
    if (upToSeq > 0) {
      await client.putSnapshot({
        upToSeq,
        ciphertext: Array.from(ciphertext),
        nonce: Array.from(nonce),
      });
    }
  }

  return { pulled: 0, pushed: pushedCount, cursor: lastSeq };
}

/**
 * Best-effort lookup of the server's highest event seq. Used by
 * `push()` when the only thing to ship is a tombstone-only snapshot:
 * `putSnapshot` requires `upToSeq <= server_seq`, so we ask the
 * server for the current tip. A failure returns 0 — the caller skips
 * the snapshot push and waits for the next opportunity.
 */
async function highestServerSeq(client: SyncClient): Promise<number> {
  try {
    const page = await client.pullEvents(0, 1);
    if (page.events.length > 0) {
      return page.events[page.events.length - 1]!.serverSeq;
    }
    return page.nextCursor;
  } catch {
    return 0;
  }
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

/**
 * Decrypt a sync snapshot payload to a fully-populated `SyncableState`.
 *
 * Accepts both v1 (no `tombstones` field) and v2 envelopes — a v1
 * payload from a peer that has not yet upgraded simply yields
 * `tombstones: []`. The returned shape is always v2 so callers don't
 * need to branch on the version.
 */
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
  return normaliseDecodedState(JSON.parse(text));
}

function normaliseDecodedState(raw: unknown): SyncableState {
  const parsed = (raw ?? {}) as Partial<SyncableState> & Record<string, unknown>;
  const tombstonesRaw = (parsed as { tombstones?: unknown }).tombstones;
  const tombstones: Tombstone[] = Array.isArray(tombstonesRaw)
    ? (tombstonesRaw.filter(
        (t): t is Tombstone =>
          t !== null &&
          typeof t === "object" &&
          typeof (t as Tombstone).domain === "string" &&
          typeof (t as Tombstone).username === "string" &&
          typeof (t as Tombstone).deletedAt === "number",
      ) as Tombstone[])
    : [];
  return {
    v: SYNCABLE_STATE_VERSION,
    defaultProfile: parsed.defaultProfile as SyncableState["defaultProfile"],
    sites:
      typeof parsed.sites === "object" && parsed.sites !== null
        ? (parsed.sites as Record<string, SyncableState["defaultProfile"]>)
        : {},
    ...(typeof parsed.fingerprint === "string" ? { fingerprint: parsed.fingerprint } : {}),
    historyEnabled: Boolean(parsed.historyEnabled),
    faviconFallbackEnabled: parsed.faviconFallbackEnabled !== false,
    accounts: Array.isArray(parsed.accounts) ? (parsed.accounts as AccountEntry[]) : [],
    tombstones,
  };
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
        // `updateAccountProfile` doesn't touch links, so adopt the peer's
        // authoritative set explicitly (carries adds AND removes).
        await api.setAccountLinkedDomains(
          op.entry.domain,
          op.entry.username,
          op.entry.linkedDomains ?? [],
          silent,
        );
      } else {
        await api.recordAccount(
          op.entry.domain,
          op.entry.username,
          op.entry.profile,
          op.entry.linkedDomains,
          silent,
        );
      }
      await stampOrSwallow(op.entry.domain, op.entry.username, "pull");
      break;
    }
    case "delete_account":
      await api.deleteAccount(op.domain, op.username, silent);
      break;
    case "rename_account":
      await api.renameAccount(op.domain, op.oldUsername, op.newUsername, silent);
      await stampOrSwallow(op.domain, op.newUsername, "pull");
      break;
    case "set_fingerprint":
      // No-op locally: the fingerprint is derived at unlock, not stored.
      break;
  }
}

/**
 * Apply a decrypted snapshot to the local stores. With `SyncableState`
 * v2 this is authoritative for deletes: any local account named in
 * `state.tombstones` is removed, and the incoming tombstones are
 * merged into the local store so this device carries them forward
 * into its own future snapshots.
 *
 * Add semantics for new accounts stay the same — accounts the
 * snapshot's originating device never saw (typically a row created
 * on another device that has not yet pushed) are NOT removed.
 *
 * `skipBus: true` discipline is preserved on every mutation: applying
 * a remote snapshot must not re-emit any of its rows as local push
 * events.
 */
export async function applyStateLocally(state: SyncableState): Promise<void> {
  const silent = { skipBus: true } as const;

  // 1) Default profile, sites, and prefs.
  await api.setDefaultProfile(state.defaultProfile, silent);
  for (const [domain, profile] of Object.entries(state.sites)) {
    await api.setProfile(domain, profile as Profile, silent);
  }
  await api.setHistoryEnabled(state.historyEnabled, silent);
  historyEnabled.value = state.historyEnabled;

  // 2) Apply tombstones BEFORE accounts so a delete here can never be
  //    silently undone by a later upsert in the same snapshot.
  const tombstoneKeys = new Set(state.tombstones.map((t) => entryKey(t.domain, t.username)));
  if (state.tombstones.length > 0) {
    const existing = await api.listAccounts();
    for (const entry of existing.entries) {
      if (tombstoneKeys.has(entryKey(entry.domain, entry.username))) {
        await api.deleteAccount(entry.domain, entry.username, silent);
      }
    }
    await api.mergeTombstones(state.tombstones);
  }

  // 3) Add accounts present in the snapshot that the local device
  //    doesn't have yet. Skip any pair the snapshot itself tombstoned
  //    (defence in depth — the snapshot's originating device should
  //    have filtered those before encoding, but ignore them here too).
  const existingAfter = await api.listAccounts();
  const existingKeys = new Set(existingAfter.entries.map((e) => key(e)));
  for (const entry of state.accounts) {
    const k = entryKey(entry.domain, entry.username);
    if (tombstoneKeys.has(k)) continue;
    if (!existingKeys.has(k)) {
      await api.recordAccount(
        entry.domain,
        entry.username,
        entry.profile,
        entry.linkedDomains,
        silent,
      );
    } else if (entry.linkedDomains !== undefined && entry.linkedDomains.length > 0) {
      // Already present locally — converge its link set to the snapshot's.
      await api.setAccountLinkedDomains(entry.domain, entry.username, entry.linkedDomains, silent);
    }
    // Stamp every entry the snapshot covered, whether we just
    // inserted it or it already existed — the latest snapshot proves
    // the server holds the row at this moment.
    await stampOrSwallow(entry.domain, entry.username, "pull");
  }

  // Refresh the signal-backed list so the UI updates.
  const refreshed = await api.listAccounts();
  allAccounts.value = refreshed.entries;
}

function entryKey(domain: string, username: string): string {
  return `${domain}|${username}`;
}

function key(entry: AccountEntry): string {
  return entryKey(entry.domain, entry.username);
}

/**
 * Best-effort per-account sync stamp. The actual sync push/pull
 * already committed by the time we get here, so a failure to stamp
 * (e.g. the row was deleted by the user between push and stamp)
 * should not bubble up — it's only display metadata.
 */
async function stampOrSwallow(
  domain: string,
  username: string,
  dir: "push" | "pull",
): Promise<void> {
  try {
    await api.accountStampSynced(domain, username, dir);
  } catch {
    /* swallow — the stamp is best-effort display metadata */
  }
}
