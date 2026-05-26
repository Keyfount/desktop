/**
 * Lightweight sync-server health monitor.
 *
 * Exposes a `syncServerStatus` signal the rest of the UI can read to
 * paint a dot next to the "Synchronisation" entry in the sidebar:
 *
 *   - "disconnected" → no sync session configured yet
 *   - "checking"     → mid-probe (≈ first ping, or in between ticks
 *                       while the previous attempt is still in flight)
 *   - "online"       → last `/health` returned 200
 *   - "offline"      → last `/health` failed (timeout / network /
 *                       non-2xx)
 *
 * Probes use the existing `sync_test_connection` Tauri command, which
 * goes through Rust `ureq` and so doesn't trigger a CORS preflight
 * (unlike a webview `fetch`). Polling cadence is 30 s — short enough
 * to feel responsive, long enough not to wake a sleeping server with
 * a needless ping every second.
 */
import { signal } from "@preact/signals";

import { api } from "../api.js";
import { loadStoredSession } from "./manager.js";

export type SyncServerStatus = "disconnected" | "checking" | "online" | "offline";

export const syncServerStatus = signal<SyncServerStatus>("disconnected");

const PROBE_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let probing = false;

async function probeOnce(): Promise<void> {
  if (probing) return;
  probing = true;
  try {
    const session = await loadStoredSession();
    if (session === null || session.status !== "approved") {
      syncServerStatus.value = "disconnected";
      return;
    }
    syncServerStatus.value = "checking";
    const res = await api.syncTestConnection(session.baseUrl);
    syncServerStatus.value = res.reachable ? "online" : "offline";
  } catch {
    syncServerStatus.value = "offline";
  } finally {
    probing = false;
  }
}

/**
 * Start probing the sync server. Idempotent — calling twice swaps
 * out the previous interval. App.tsx wires it to the shell mount
 * lifecycle alongside `startAutoSync`.
 */
export function startSyncStatusMonitor(): void {
  stopSyncStatusMonitor();
  void probeOnce();
  pollTimer = setInterval(() => {
    void probeOnce();
  }, PROBE_INTERVAL_MS);
}

export function stopSyncStatusMonitor(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  syncServerStatus.value = "disconnected";
}

/**
 * Force a probe right now. Used by the manual "Pull from server"
 * button so the user sees the dot reflect the fresh state without
 * waiting for the next interval tick.
 */
export function pingNow(): Promise<void> {
  return probeOnce();
}
