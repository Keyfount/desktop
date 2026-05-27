import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetPendingState, drainPendingOps, enqueueOp, pendingOpsCount } from "./pending.js";
import type { SyncOp } from "./payload.js";

// In-memory stand-in for the SQLite-backed queue. The mocked `api`
// below proxies every call to this store so tests can observe queue
// contents directly.
interface FakeRow {
  id: number;
  opJson: string;
  createdAt: number;
  attempts: number;
  lastError: string | null;
}
const store: { rows: FakeRow[]; nextId: number } = { rows: [], nextId: 1 };

vi.mock("../api.js", () => ({
  api: {
    pendingOpsEnqueue: vi.fn(async (opJson: string) => {
      const id = store.nextId++;
      store.rows.push({ id, opJson, createdAt: Date.now(), attempts: 0, lastError: null });
      return id;
    }),
    pendingOpsList: vi.fn(async () => store.rows.map((r) => ({ ...r }))),
    pendingOpsDelete: vi.fn(async (id: number) => {
      const i = store.rows.findIndex((r) => r.id === id);
      if (i >= 0) store.rows.splice(i, 1);
    }),
    pendingOpsRecordFailure: vi.fn(async (id: number, error: string) => {
      const row = store.rows.find((r) => r.id === id);
      if (row !== undefined) {
        row.attempts += 1;
        row.lastError = error;
      }
    }),
  },
}));

beforeEach(() => {
  store.rows = [];
  store.nextId = 1;
  _resetPendingState();
});

afterEach(() => {
  vi.clearAllMocks();
});

const DEL_OP: SyncOp = { t: "delete_account", domain: "ex.com", username: "u" };
const UPSERT_OP: SyncOp = {
  t: "upsert_account",
  entry: {
    domain: "ex.com",
    username: "u",
    profile: { mode: "random", length: 16, lower: true, upper: true, digits: true, symbols: true, counter: 1 },
    createdAt: 0,
    lastUsedAt: 0,
  },
};

describe("pending queue", () => {
  it("enqueueOp persists the serialized op in the store", async () => {
    await enqueueOp(DEL_OP);
    expect(store.rows).toHaveLength(1);
    expect(JSON.parse(store.rows[0].opJson)).toEqual(DEL_OP);
  });

  it("drainPendingOps consumes every queued op via pushSingle in FIFO order", async () => {
    await enqueueOp(DEL_OP);
    await enqueueOp(UPSERT_OP);

    const pushed: SyncOp[] = [];
    await drainPendingOps(async (op) => {
      pushed.push(op);
    });

    expect(pushed).toEqual([DEL_OP, UPSERT_OP]);
    expect(store.rows).toHaveLength(0);
  });

  it("a push failure halts the drain and bumps attempts on that row", async () => {
    await enqueueOp(DEL_OP);
    await enqueueOp(UPSERT_OP);

    await drainPendingOps(async () => {
      throw new Error("network down");
    });

    expect(store.rows).toHaveLength(2);
    expect(store.rows[0].attempts).toBe(1);
    expect(store.rows[0].lastError).toBe("network down");
    // The second row was never tried, must stay pristine.
    expect(store.rows[1].attempts).toBe(0);
    expect(store.rows[1].lastError).toBeNull();
  });

  it("a transient failure followed by a successful drain leaves attempts > 0 only on the in-flight row", async () => {
    await enqueueOp(DEL_OP);

    let attempt = 0;
    await drainPendingOps(async () => {
      attempt += 1;
      throw new Error("transient");
    });
    expect(store.rows[0].attempts).toBe(1);

    // Recover and re-drain.
    await drainPendingOps(async () => {
      // success this time
    });
    expect(attempt).toBe(1);
    expect(store.rows).toHaveLength(0);
  });

  it("malformed op_json (poison pill) is dropped and the drain continues", async () => {
    // Manually inject a poison-pill row.
    store.rows.push({
      id: store.nextId++,
      opJson: "{not valid json",
      createdAt: Date.now(),
      attempts: 0,
      lastError: null,
    });
    await enqueueOp(DEL_OP);

    const pushed: SyncOp[] = [];
    await drainPendingOps(async (op) => {
      pushed.push(op);
    });

    expect(pushed).toEqual([DEL_OP]);
    expect(store.rows).toHaveLength(0);
  });

  it("a concurrent drainPendingOps call returns immediately and the first call completes the queue", async () => {
    await enqueueOp(DEL_OP);
    await enqueueOp(UPSERT_OP);

    const pushed: SyncOp[] = [];
    const slow = vi.fn(async (op: SyncOp) => {
      await new Promise((r) => setTimeout(r, 10));
      pushed.push(op);
    });

    const firstDrain = drainPendingOps(slow);
    const secondDrain = drainPendingOps(slow);
    await Promise.all([firstDrain, secondDrain]);

    expect(slow).toHaveBeenCalledTimes(2);
    expect(pushed).toEqual([DEL_OP, UPSERT_OP]);
    expect(store.rows).toHaveLength(0);
  });

  it("pendingOpsCount reflects the live queue size", async () => {
    expect(await pendingOpsCount()).toBe(0);
    await enqueueOp(DEL_OP);
    await enqueueOp(UPSERT_OP);
    expect(await pendingOpsCount()).toBe(2);
  });

  it("ordering: delete_account queued before upsert_account drains in that exact order", async () => {
    // The whole reason the drain halts on first failure: a queued
    // delete must never be re-ordered behind a later upsert.
    await enqueueOp(DEL_OP);
    await enqueueOp(UPSERT_OP);

    const ordered: string[] = [];
    await drainPendingOps(async (op) => {
      ordered.push(op.t);
    });
    expect(ordered).toEqual(["delete_account", "upsert_account"]);
  });
});
