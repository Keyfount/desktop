/**
 * In-process bus for "I just mutated something locally" notifications.
 *
 * `api.ts` is the only call site for IPC mutations (record / update /
 * delete / rename account, set profile, toggle preference). Each
 * mutation method calls `syncBus.notify(op)` after the IPC succeeds —
 * `auto.ts` subscribes to that stream and pushes the op to the
 * server fire-and-forget. Decoupling the two avoids the import cycle
 * `api.ts` ⇄ `sync/auto.ts` would create if `api.ts` reached into the
 * sync engine directly.
 */
import type { SyncOp } from "./payload.js";

export type MutationListener = (op: SyncOp) => void;

class SyncBus {
  private readonly listeners = new Set<MutationListener>();

  /** Fire each subscriber; swallow listener errors so a faulty one
   * never blocks the local mutation that triggered us. */
  notify(op: SyncOp): void {
    for (const fn of this.listeners) {
      try {
        fn(op);
      } catch {
        /* never throw out of a notify */
      }
    }
  }

  subscribe(fn: MutationListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const syncBus = new SyncBus();
