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
      /* no-op locally: fingerprint is derived at unlock time. */
      break;
  }
}

/**
 * Push a single op fire-and-forget. Catches every error — a failed
 * push must never abort the local mutation that produced the op.
 *
 * The bus listener (registered by `startAutoSync`) invokes this; it
 * is also exported so tests / future "retry" buttons can call it.
 */
async function pushOpInBackground(op: SyncOp): Promise<void> {
  const session = await approvedSession();
  if (session === null) return;
  pushing++;
  try {
    const { master } = await api.sessionMaster();
    const key = await deriveEncryptionKey(session, master);
    const { ciphertext, nonce } = await encryptOp(key, op);
    const client = new SyncClient({
      baseUrl: session.baseUrl,
      sessionToken: session.sessionToken,
    });
    lamportClock = Math.max(lamportClock, Date.now()) + 1;
    await client.pushEvent({
      lamport: lamportClock,
      ciphertext: Array.from(ciphertext),
      nonce: Array.from(nonce),
    });
  } catch (err) {
    // Log so the diagnostic story makes sense — sync failures used to
    // be swallowed and look like "the engine does nothing". Still
    // best-effort: we never throw out of a mutation just because the
    // server is unreachable.
    console.warn("[keyfount-sync] push op failed:", op.t, err);
  } finally {
    pushing--;
  }
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
  const session = await approvedSession();
  if (session === null) return;
  pulling = true;
  let applied = 0;
  try {
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
 * Push every local account through the same event pipe. Idempotent
 * on the receiving side because `applyOp` checks `(domain, username)`
 * presence — duplicates land as no-op updates. Called once per
 * unlock so accounts that were created before auto-sync existed
 * (or while the network was down) finally make it to the server.
 */
async function bootstrapPushAll(): Promise<void> {
  try {
    const session = await approvedSession();
    if (session === null) return;
    const { entries } = await api.listAccounts();
    for (const entry of entries) {
      await pushOpInBackground({ t: "upsert_account", entry });
    }
  } catch (err) {
    console.warn("[keyfount-sync] bootstrap push failed:", err);
  }
}

/**
 * Subscribe to the mutation bus and start the polling timer. Idempotent —
 * calling twice in a row replaces the previous subscription / timer so the
 * App `useEffect` can call it on every shell mount without leaking.
 */
export function startAutoSync(): void {
  stopAutoSync();
  unsubscribe = syncBus.subscribe((op) => {
    void pushOpInBackground(op);
  });
  // Bootstrap: push everything we have locally, then pull whatever
  // other devices have. Order matters slightly — pushing first means
  // the subsequent pull won't think our locally-known events came
  // "from another device" (deviceId guard in pullInBackground).
  void (async () => {
    await bootstrapPushAll();
    await pullInBackground();
  })();
  pollTimer = setInterval(() => {
    void pullInBackground();
  }, POLL_INTERVAL_MS);
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
