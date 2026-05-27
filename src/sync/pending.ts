/**
 * Persistent retry queue for sync ops.
 *
 * Every local mutation goes through `enqueueOp` before any live push,
 * so a mutation made under unfavourable conditions (vault locked,
 * session pending, network down) still survives in SQLite until the
 * next drain.
 *
 * Drainage is delegated: the caller supplies `pushSingle`, an async
 * function that knows how to encrypt + POST one op against the
 * current session. Decoupling the transport keeps this module
 * trivially testable — the production caller (sync/auto.ts) wires it
 * to `SyncClient.pushEvent`; tests pass a `vi.fn()`.
 *
 * Order discipline: rows are consumed oldest-first by id. On any
 * push failure the drain stops (does not skip ahead) so that a queued
 * `delete_account` ahead of an `upsert_account` for the same key
 * cannot be re-ordered server-side.
 */
import { api } from "../api.js";
import type { SyncOp } from "./payload.js";

let draining = false;

/** Reset module-level state. Test-only. */
export function _resetPendingState(): void {
  draining = false;
}

/** Serialize and persist an op for later drain. */
export async function enqueueOp(op: SyncOp): Promise<void> {
  await api.pendingOpsEnqueue(JSON.stringify(op));
}

/**
 * Drain the queue oldest-first by repeatedly calling `pushSingle` on
 * the next queued op.
 *
 * - On success, the row is removed from the queue.
 * - On `pushSingle` throwing, the row's `attempts` is bumped, its
 *   `last_error` is recorded, and the drain stops (subsequent rows
 *   are NOT processed — preserves ordering).
 * - On malformed JSON (poison pill), the row is dropped and the drain
 *   continues. This can only happen if a previous version of the app
 *   enqueued an op the current parser cannot handle.
 *
 * Re-entrant safe: a concurrent call returns immediately. The first
 * call's loop will pick up any rows the second caller would have
 * processed.
 */
export async function drainPendingOps(pushSingle: (op: SyncOp) => Promise<void>): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (true) {
      const rows = await api.pendingOpsList();
      const row = rows[0];
      if (row === undefined) return;

      let op: SyncOp;
      try {
        op = JSON.parse(row.opJson) as SyncOp;
      } catch {
        await api.pendingOpsDelete(row.id);
        continue;
      }

      try {
        await pushSingle(op);
        await api.pendingOpsDelete(row.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await api.pendingOpsRecordFailure(row.id, message);
        return;
      }
    }
  } finally {
    draining = false;
  }
}

/** Diagnostic helper for the future "N pending" UI indicator. */
export async function pendingOpsCount(): Promise<number> {
  const rows = await api.pendingOpsList();
  return rows.length;
}
