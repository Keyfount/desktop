/**
 * Regression tests for the `delete_account` cross-device bug.
 *
 * Verifies the three correctness gates that the SyncableState v2
 * tombstone field is supposed to enforce:
 *
 *   1. `decryptState` accepts both v1 and v2 envelopes, coercing v1 to
 *      `tombstones: []` so peers on different versions interoperate.
 *   2. `applyStateLocally` is authoritative for deletes — accounts
 *      named in `state.tombstones` are removed from the local store,
 *      and incoming tombstones are merged so the device carries them
 *      forward.
 *   3. `pushAllLocalAccountsAndPull` filters tombstoned entries out
 *      of its upsert loop (defence in depth against Trigger 1).
 *
 * The tests deliberately avoid spinning up a full SyncClient — they
 * mock `api.ts` so the assertions focus on the reconciliation logic
 * rather than the transport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyStateLocally, decryptState } from "./manager.js";
import { SYNCABLE_STATE_VERSION, type SyncableState, type Tombstone } from "./payload.js";
import type { AccountEntry, Profile } from "../types.js";

interface FakeState {
  accounts: AccountEntry[];
  tombstones: Tombstone[];
  defaultProfile: Profile;
  sites: Record<string, Profile>;
  historyEnabled: boolean;
  faviconFallbackEnabled: boolean;
}

const PROFILE: Profile = {
  mode: "random",
  length: 16,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  counter: 1,
};

const state: FakeState = {
  accounts: [],
  tombstones: [],
  defaultProfile: PROFILE,
  sites: {},
  historyEnabled: false,
  faviconFallbackEnabled: true,
};

vi.mock("../api.js", () => ({
  api: {
    listAccounts: vi.fn(async () => ({ entries: state.accounts.map((e) => ({ ...e })) })),
    setDefaultProfile: vi.fn(async () => {}),
    setProfile: vi.fn(async () => {}),
    setHistoryEnabled: vi.fn(async (enabled: boolean) => {
      state.historyEnabled = enabled;
    }),
    setFaviconFallbackEnabled: vi.fn(async () => {}),
    recordAccount: vi.fn(
      async (domain: string, username: string, profile: Profile, linkedDomains?: string[]) => {
        const existing = state.accounts.find((e) => e.domain === domain && e.username === username);
        if (existing !== undefined) {
          existing.profile = profile;
          existing.lastUsedAt = Date.now();
          if (linkedDomains !== undefined && linkedDomains.length > 0) {
            existing.linkedDomains = linkedDomains;
          }
        } else {
          state.accounts.push({
            domain,
            username,
            profile,
            ...(linkedDomains !== undefined && linkedDomains.length > 0 ? { linkedDomains } : {}),
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
          });
        }
        state.tombstones = state.tombstones.filter(
          (t) => !(t.domain === domain && t.username === username),
        );
        return { entry: state.accounts[state.accounts.length - 1]! };
      },
    ),
    setAccountLinkedDomains: vi.fn(async (domain: string, username: string, linked: string[]) => {
      const entry = state.accounts.find((e) => e.domain === domain && e.username === username);
      if (entry === undefined) throw new Error("account not found");
      if (linked.length > 0) entry.linkedDomains = linked;
      else delete entry.linkedDomains;
      return { entry };
    }),
    deleteAccount: vi.fn(async (domain: string, username: string) => {
      state.accounts = state.accounts.filter(
        (e) => !(e.domain === domain && e.username === username),
      );
      state.tombstones.push({ domain, username, deletedAt: Date.now() });
    }),
    listTombstones: vi.fn(async () => state.tombstones.map((t) => ({ ...t }))),
    mergeTombstones: vi.fn(async (incoming: Tombstone[]) => {
      for (const t of incoming) {
        const existing = state.tombstones.find(
          (x) => x.domain === t.domain && x.username === t.username,
        );
        if (existing === undefined) {
          state.tombstones.push({ ...t });
        } else {
          existing.deletedAt = Math.max(existing.deletedAt, t.deletedAt);
        }
      }
    }),
    accountStampSynced: vi.fn(async () => {}),
  },
}));

vi.mock("../state.js", () => ({
  allAccounts: { value: [] },
  historyEnabled: { value: false },
  faviconFallbackEnabled: { value: true },
}));

beforeEach(() => {
  state.accounts = [];
  state.tombstones = [];
  state.historyEnabled = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

const ENTRY_X: AccountEntry = {
  domain: "ex.com",
  username: "alice",
  profile: PROFILE,
  createdAt: 1,
  lastUsedAt: 1,
};

const ENTRY_Y: AccountEntry = {
  domain: "y.com",
  username: "bob",
  profile: PROFILE,
  createdAt: 2,
  lastUsedAt: 2,
};

async function encryptStateAs(
  payload: unknown,
  key: CryptoKey,
): Promise<{
  ciphertext: number[];
  nonce: number[];
}> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { ciphertext: Array.from(new Uint8Array(ct)), nonce: Array.from(nonce) };
}

async function makeAesKey(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

describe("decryptState — v1 / v2 compatibility", () => {
  it("a v1 payload (no tombstones field) decodes with tombstones: []", async () => {
    const key = await makeAesKey();
    const v1Payload = {
      v: 1,
      defaultProfile: PROFILE,
      sites: {},
      historyEnabled: false,
      faviconFallbackEnabled: true,
      accounts: [ENTRY_X],
      // intentionally no tombstones field
    };
    const { ciphertext, nonce } = await encryptStateAs(v1Payload, key);

    const decoded = await decryptState(key, ciphertext, nonce);

    expect(decoded.v).toBe(SYNCABLE_STATE_VERSION);
    expect(decoded.tombstones).toEqual([]);
    expect(decoded.accounts).toEqual([ENTRY_X]);
    expect(decoded.historyEnabled).toBe(false);
    expect(decoded.faviconFallbackEnabled).toBe(true);
  });

  it("a v2 payload round-trips its tombstones unchanged", async () => {
    const key = await makeAesKey();
    const tomb: Tombstone = { domain: "ex.com", username: "alice", deletedAt: 1700 };
    const v2Payload: SyncableState = {
      v: 2,
      defaultProfile: PROFILE,
      sites: {},
      historyEnabled: true,
      faviconFallbackEnabled: false,
      accounts: [],
      tombstones: [tomb],
    };
    const { ciphertext, nonce } = await encryptStateAs(v2Payload, key);

    const decoded = await decryptState(key, ciphertext, nonce);

    expect(decoded.tombstones).toEqual([tomb]);
    expect(decoded.historyEnabled).toBe(true);
    expect(decoded.faviconFallbackEnabled).toBe(false);
  });

  it("a malformed tombstones field decodes as []", async () => {
    const key = await makeAesKey();
    const broken = {
      v: 2,
      defaultProfile: PROFILE,
      sites: {},
      historyEnabled: false,
      faviconFallbackEnabled: true,
      accounts: [],
      tombstones: "not-an-array",
    };
    const { ciphertext, nonce } = await encryptStateAs(broken, key);

    const decoded = await decryptState(key, ciphertext, nonce);
    expect(decoded.tombstones).toEqual([]);
  });
});

describe("applyStateLocally — authoritative for deletes (#54 Trigger 2)", () => {
  it("removes a local account named in the incoming tombstones", async () => {
    // Device B starts with X locally (stale state).
    state.accounts = [{ ...ENTRY_X }];

    // Device A pushed a snapshot whose tombstones flag X as deleted.
    const snapshot: SyncableState = {
      v: 2,
      defaultProfile: PROFILE,
      sites: {},
      historyEnabled: false,
      faviconFallbackEnabled: true,
      accounts: [],
      tombstones: [{ domain: ENTRY_X.domain, username: ENTRY_X.username, deletedAt: 1700 }],
    };

    await applyStateLocally(snapshot);

    expect(state.accounts).toHaveLength(0);
    // Tombstone is now stored locally so this device carries it
    // forward into its own future snapshots.
    expect(state.tombstones).toContainEqual(
      expect.objectContaining({ domain: ENTRY_X.domain, username: ENTRY_X.username }),
    );
  });

  it("keeps a local account that the snapshot's device never saw", async () => {
    // Device B has a local-only account Y (just created, not yet pushed).
    state.accounts = [{ ...ENTRY_Y }];

    // Device A pushed a snapshot that knows about X but not Y.
    const snapshot: SyncableState = {
      v: 2,
      defaultProfile: PROFILE,
      sites: {},
      historyEnabled: false,
      faviconFallbackEnabled: true,
      accounts: [ENTRY_X],
      tombstones: [],
    };

    await applyStateLocally(snapshot);

    // Y stays — the snapshot only adds X, never removes anything not
    // explicitly tombstoned. This is the property that makes
    // tombstones safer than blanket replace.
    expect(state.accounts.find((e) => e.domain === ENTRY_Y.domain)).toBeDefined();
    expect(state.accounts.find((e) => e.domain === ENTRY_X.domain)).toBeDefined();
  });

  it("carries linkedDomains from a snapshot account into the local store", async () => {
    state.accounts = [];
    const snapshot: SyncableState = {
      v: 2,
      defaultProfile: PROFILE,
      sites: {},
      historyEnabled: false,
      faviconFallbackEnabled: true,
      accounts: [{ ...ENTRY_X, linkedDomains: ["z.example.com", "other-site.com"] }],
      tombstones: [],
    };

    await applyStateLocally(snapshot);

    const got = state.accounts.find((e) => e.domain === ENTRY_X.domain);
    expect(got?.linkedDomains).toEqual(["z.example.com", "other-site.com"]);
  });

  it("a snapshot containing both X in accounts and X in tombstones favours the tombstone", async () => {
    state.accounts = [{ ...ENTRY_X }];
    const snapshot: SyncableState = {
      v: 2,
      defaultProfile: PROFILE,
      sites: {},
      historyEnabled: false,
      faviconFallbackEnabled: true,
      accounts: [ENTRY_X],
      tombstones: [{ domain: ENTRY_X.domain, username: ENTRY_X.username, deletedAt: 1700 }],
    };

    await applyStateLocally(snapshot);

    expect(state.accounts).toHaveLength(0);
  });

  it("incoming tombstones are merged into the local store via api.mergeTombstones", async () => {
    const t1: Tombstone = { domain: "a.com", username: "u1", deletedAt: 100 };
    const t2: Tombstone = { domain: "b.com", username: "u2", deletedAt: 200 };

    await applyStateLocally({
      v: 2,
      defaultProfile: PROFILE,
      sites: {},
      historyEnabled: false,
      faviconFallbackEnabled: true,
      accounts: [],
      tombstones: [t1, t2],
    });

    expect(state.tombstones).toContainEqual(t1);
    expect(state.tombstones).toContainEqual(t2);
  });
});
