/**
 * Background sync engine.
 *
 * Two halves:
 *   - **push**: every local mutation (recorded on `syncBus`) is
 *     encrypted under EK and POSTed to `/events`. Fire-and-forget,
 *     never blocks the UI thread, never surfaces errors. Mirrors the
 *     Chrome extension's `syncAccountChange` behaviour so the wire
 *     format is interchangeable across devices.
 *   - **pull**: an initial pull runs as soon as the shell opens, and
 *     a polling timer pulls every `POLL_INTERVAL_MS` while the vault
 *     is unlocked. The local cursor is kept in module state so the
 *     server only sends events we have not seen yet.
 *
 * Both halves apply the same `SyncOp` taxonomy as the snapshot-based
 * path in `manager.ts`, so a user with the extension on one device
 * and the desktop on another sees mutations propagate without any
 * manual "send" / "receive" button click.
 */
import { api } from "../api.js";
import { allAccounts, historyEnabled, faviconFallbackEnabled } from "../state.js";
import { deriveEncryptionKey, type ApprovedSyncSession } from "./auth.js";
import { syncBus } from "./bus.js";
import { SyncClient } from "./client.js";
import { applyStateLocally, decryptState, loadStoredSession } from "./manager.js";
import type { SyncOp } from "./payload.js";
import { drainPendingOps, enqueueOp } from "./pending.js";

const POLL_INTERVAL_MS = 60_000;
const PULL_PAGE = 200;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;
let pulling = false;
let pushing = 0;
let lastCursor = 0;
let lamportClock = 0;

/**
 * Return the approved session if one exists. Pending or absent
 * sessions cause every operation here to no-op silently — auto-sync
 * never asks the user to do anything.
 */
async function approvedSession(): Promise<ApprovedSyncSession | null> {
  try {
    const s = await loadStoredSession();
    if (s !== null && s.status === "approved") return s;
    return null;
  } catch {
    return null;
  }
}

async function encryptOp(
  key: CryptoKey,
  op: SyncOp,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(op));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    key,
    plain as BufferSource,
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
 * Apply a decrypted op to the local store. Mirrors `manager.ts`'s
 * snapshot replay but works one op at a time — that lets us thread
 * events from `pullEvents` without rebuilding a full SyncableState.
 *
 * Failures are swallowed: a poison-pill event (e.g. encrypted with a
 * different master after a rotation) should not block subsequent
 * events. The pull cursor advances either way.
 */
async function applyOp(op: SyncOp): Promise<void> {
  // `skipBus: true` on every mutation here: applying a remote op must
  // never re-emit it as a local push, otherwise the two devices would
  // ping-pong the same op forever.
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
        faviconFallbackEnabled.value = op.value;
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
      break;
    }
    case "delete_account":
      await api.deleteAccount(op.domain, op.username, silent);
      break;
    case "rename_account":
      await api.renameAccount(op.domain, op.oldUsername, op.newUsername, silent);
      break;
    case "set_fingerprint":
      /* no-op locally: fingerprint is derived at unlock time. */
      break;
  }
}

/**
 * Persist the op in the local retry queue, then try to drain it
 * (and anything else queued ahead of it) against the server.
 *
 * Enqueueing always happens first so a mutation made under
 * unfavourable conditions (locked vault, pending session, network
 * down) still survives in SQLite until the next drain opportunity.
 *
 * A failure to drain — including the trivial "no approved session
 * yet" path — never aborts the local mutation that produced the op.
 * The op stays in the queue and will be picked up by the next push
 * path, pull, or polling tick.
 */
async function pushOpInBackground(op: SyncOp): Promise<void> {
  try {
    await enqueueOp(op);
  } catch (err) {
    console.warn("[keyfount-sync] enqueue op failed:", op.t, err);
    return;
  }
  pushing++;
  try {
    await drainNow();
  } catch (err) {
    console.warn("[keyfount-sync] drain after enqueue failed:", err);
  } finally {
    pushing--;
  }
}

/**
 * Attempt to drain the persistent queue against the server right now.
 * Returns silently if any prerequisite is missing (no approved
 * session, locked vault, key derivation failure). Each queued op is
 * encrypted under the freshly-derived EK and POSTed to /events.
 */
async function drainNow(): Promise<void> {
  const session = await approvedSession();
  if (session === null) return;
  let master: string;
  try {
    master = (await api.sessionMaster()).master;
  } catch {
    return;
  }
  const key = await deriveEncryptionKey(session, master);
  const client = new SyncClient({
    baseUrl: session.baseUrl,
    sessionToken: session.sessionToken,
  });
  await drainPendingOps(async (op) => {
    const { ciphertext, nonce } = await encryptOp(key, op);
    lamportClock = Math.max(lamportClock, Date.now()) + 1;
    await client.pushEvent({
      lamport: lamportClock,
      ciphertext: Array.from(ciphertext),
      nonce: Array.from(nonce),
    });
  });
}

/**
 * Pull the events that other devices pushed since `lastCursor` and
 * apply them locally. Refreshes the visible account list when at
 * least one op was applied.
 *
 * Re-entrant safe: a second call while a pull is in flight returns
 * immediately to avoid duplicate event application.
 *
 * On the very first call (lastCursor still 0), we pull the snapshot
 * too so a fresh app install converges on the latest state without
 * waiting for the next polling tick. Subsequent calls just chase
 * events past `lastCursor`.
 */
export async function pullInBackground(): Promise<void> {
  if (pulling) return;
  pulling = true;
  let applied = 0;
  try {
    // Drain any queued local ops before chasing remote events. If a
    // local delete is queued behind a fresh remote upsert for the
    // same account, server-side ordering would put the upsert ahead
    // of the delete and the account would resurrect — drain first
    // closes that race.
    try {
      await drainNow();
    } catch (err) {
      console.warn("[keyfount-sync] drain before pull failed:", err);
    }

    const session = await approvedSession();
    if (session === null) return;
    const { master } = await api.sessionMaster();
    const key = await deriveEncryptionKey(session, master);
    const client = new SyncClient({
      baseUrl: session.baseUrl,
      sessionToken: session.sessionToken,
    });

    // First call after launch: apply the snapshot so we don't have
    // to replay every historical event. Subsequent calls skip this
    // since `lastCursor > 0` means we already caught up.
    if (lastCursor === 0) {
      try {
        const snapshot = await client.latestSnapshot();
        if (snapshot) {
          const state = await decryptState(key, snapshot.ciphertext, snapshot.nonce);
          await applyStateLocally(state);
          applied += state.accounts.length;
          lastCursor = snapshot.upToSeq;
        }
      } catch (err) {
        console.warn("[keyfount-sync] snapshot fetch/apply failed:", err);
      }
    }

    let hasMore = true;
    while (hasMore) {
      const page = await client.pullEvents(lastCursor, PULL_PAGE);
      for (const ev of page.events) {
        if (ev.deviceId === session.deviceId) {
          // Our own push echoed back — already applied locally.
          lastCursor = ev.serverSeq;
          continue;
        }
        try {
          const op = await decryptOp(key, ev.ciphertext, ev.nonce);
          await applyOp(op);
          applied++;
        } catch (err) {
          console.warn("[keyfount-sync] decrypt/apply op failed (seq", ev.serverSeq + "):", err);
        }
        lastCursor = ev.serverSeq;
      }
      hasMore = page.hasMore;
      if (!hasMore && page.nextCursor > lastCursor) {
        lastCursor = page.nextCursor;
      }
    }
    if (applied > 0) {
      const refreshed = await api.listAccounts();
      allAccounts.value = refreshed.entries;
    }
  } catch (err) {
    console.warn("[keyfount-sync] pull failed:", err);
  } finally {
    pulling = false;
  }
}

/**
 * One-shot "I just connected to a server, get me in sync" routine.
 *
 * Distinct from the per-unlock bootstrap we deliberately dropped
 * earlier: this runs only when the SyncScreen sees the session
 * flip to `approved`. At that exact moment we know two things must
 * happen for the user to feel the connection was instant:
 *   1. The accounts they have locally need to land on the server,
 *      otherwise the other device won't see them.
 *   2. Whatever the server already had needs to land here.
 *
 * Order is pull-then-push for the same reason as elsewhere — we
 * don't want to silently resurrect another device's
 * `delete_account`. Errors are swallowed because a freshly
 * connected user does not need to see a stack trace.
 */
export async function pushAllLocalAccountsAndPull(): Promise<void> {
  try {
    await pullInBackground();
    const session = await approvedSession();
    if (session === null) return;
    const [{ entries }, tombstones] = await Promise.all([api.listAccounts(), api.listTombstones()]);
    // Defence in depth: even if applyStateLocally missed a tombstone,
    // skip any (domain, username) the local store knows we've
    // deleted. Otherwise this would re-emit upsert_account for an
    // account the user explicitly removed.
    const tombKeys = new Set(tombstones.map((t) => `${t.domain}|${t.username}`));
    for (const entry of entries) {
      if (tombKeys.has(`${entry.domain}|${entry.username}`)) continue;
      await pushOpInBackground({ t: "upsert_account", entry });
    }
  } catch (err) {
    console.warn("[keyfount-sync] post-connect bootstrap failed:", err);
  }
}

/**
 * Subscribe to the mutation bus and start the polling timer. Idempotent —
 * calling twice in a row replaces the previous subscription / timer so the
 * App `useEffect` can call it on every shell mount without leaking.
 *
 * Pushes go through the bus listener: only events emitted by an
 * actual local mutation (`syncBus.notify`) reach the server. The
 * older "bootstrap push every local account on each unlock" was
 * removed because it silently undid deletes from other devices —
 * a stale local copy would race the inbound `delete_account` and
 * the entry would reappear everywhere. The trade-off: accounts
 * created before auto-sync existed need a manual "Récupérer/Force
 * send" click — OR a fresh server connect, which calls
 * `pushAllLocalAccountsAndPull` once on transition to `approved`.
 */
export function startAutoSync(): void {
  stopAutoSync();
  unsubscribe = syncBus.subscribe((op) => {
    void pushOpInBackground(op);
  });
  // Initial pull, then replay anything the iOS AutoFill extension
  // wrote directly to SQLite (those inserts never crossed the IPC
  // mutation helpers, so `syncBus` never saw them). Order matters:
  // pull first so a remote delete that races a local extension
  // creation can't be silently overwritten by the replay.
  void (async () => {
    await pullInBackground();
    await drainExtensionPendingAccounts();
  })();
  pollTimer = setInterval(() => {
    void pullInBackground();
  }, POLL_INTERVAL_MS);
}

/**
 * Replay accounts that the iOS AutoFill extension wrote with
 * `record_account_ffi` (which inserts into SQLite without going
 * through the IPC `record_account` command, so `syncBus.notify`
 * never fired for them). On every auto-sync start, fetch the rows
 * whose `last_synced_at` is still NULL and re-emit them as
 * `upsert_account` ops — the regular push pipeline picks them up
 * and pushes them server-side. Server-side dedup on
 * `(domain, username)` makes replays idempotent.
 */
async function drainExtensionPendingAccounts(): Promise<void> {
  if ((await approvedSession()) === null) return;
  try {
    const { entries } = await api.listPendingSyncAccounts();
    for (const entry of entries) {
      syncBus.notify({ t: "upsert_account", entry });
    }
  } catch (err) {
    console.warn("[keyfount-sync] drain pending failed:", err);
  }
}

export function stopAutoSync(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (unsubscribe !== null) {
    unsubscribe();
    unsubscribe = null;
  }
}

/** Test-only / diagnostic helper. */
export function _internals(): { pushing: number; pulling: boolean; lastCursor: number } {
  return { pushing, pulling, lastCursor };
}
