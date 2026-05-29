# Subdomains & linked domains — Keyfount (server · extension · desktop · mobile)

**Date:** 2026-05-28
**Branch:** `feat/subdomains-and-linked-domains` (per repo)
**Status:** design, awaiting implementation
**Owner:** Loule
**Scope:** cross-repo (`extension`, `desktop`, `server`). This single document is authoritative for all three repos; each repo's PR links its own issue and references this spec.

## 1. Context

Keyfount is a **deterministic** password manager (LessPass-style), **not** a vault that stores passwords. A password is recomputed on demand:

```
password = render( Argon2id(master, salt) , profile )
salt      = buildSalt(domain, email, counter)
```

The `domain` is therefore three things at once:

1. **the derivation salt** — change it and the derived password changes;
2. **the matching key** — which stored accounts to offer on a given site;
3. **the sync identity** — `(domain, username)` is the primary key used by the
   encrypted sync log and its tombstones.

Today `domain` is always the **registrable domain** (eTLD+1), extracted with
`tldts` (Mozilla Public Suffix List). Consequences of the status quo:

- `mail.google.com` and `google.com` derive the **same** password — by design.
- A stored account `(google.com, alice)` is offered on every `*.google.com`.
- There is **no** way to (a) give a subdomain its own password, or (b) reuse one
  account across two unrelated domains.

A stored account is:

```ts
interface AccountEntry {
  domain: string;     // registrable domain today
  username: string;
  profile: Profile;   // generation parameters frozen at creation
  createdAt: number;
  lastUsedAt: number;
}
```

The **server is zero-knowledge**: `migrations/002_sync.sql` stores only AES-GCM
ciphertexts (`events` append-only log + `snapshots`). It never sees a domain and
performs no matching. All domain logic lives in three clients that **must derive
byte-identically**:

- **extension** (Chrome/Firefox) — TypeScript + WASM Argon2, `tldts`;
- **desktop + mobile** — one Tauri 2 repo: Rust core (source-of-truth types &
  derivation in `src-tauri/`) + Preact UI; `tldts` on the JS side.
- **iOS AutoFill** — a separate Swift extension process
  (`gen/apple/AutofillExtension/`) that calls the Rust core over FFI
  (`src-tauri/src/lib.rs`).

## 2. Goals

1. **Subdomain support.** A subdomain can optionally become a first-class entry
   with its **own** derived password (e.g. `x.y.com` ≠ `w.y.com`).
2. **Linked domains.** One account can be reused across several domains. The
   account keeps **one** canonical derivation domain; every linked domain replays
   that same password. Example (user-confirmed):
   `w.y.com` is the canonical account; linking `z.y.com` to it makes `z.y.com`
   yield **`w.y.com`'s** password.
3. **Parity across all surfaces:** extension, desktop, mobile app, iOS AutoFill.
4. **Comprehensive tests**, including e2e.

## 3. Decisions (from brainstorming)

| # | Question | Decision |
|---|----------|----------|
| D1 | Default granularity for a **new** account saved on a subdomain page | **Registrable domain by default**, with a per-account opt-in to the full host. |
| D2 | Must existing accounts keep their exact current password? | **Not critical** — no production users yet. We may freely change the data model / sync wire format. We still keep the registrable default (D1), so existing entries are unaffected anyway. |
| D3 | Server work | **No server code.** Only add sync non-regression tests. |
| D4 | Native autofill | **Included** — see §6.4 for the iOS/Android reality. |
| D5 | Linking granularity | A linked domain may itself be a full host (e.g. link `z.y.com`, not all of `y.com`). |

## 4. Data model — Approach A (additive)

`domain` stays the **canonical** value = derivation salt **and** primary match
domain. It may now hold either a registrable domain (`google.com`) **or** a full
host (`mail.google.com`). A new optional field carries the extra match domains:

```ts
interface AccountEntry {
  domain: string;            // canonical: salt + primary match (registrable OR full host)
  username: string;
  profile: Profile;
  linkedDomains?: string[];  // NEW — additional match-only domains; never affects derivation
  createdAt: number;
  lastUsedAt: number;
}
```

Rust mirror (`src-tauri/src/types.rs`), serde camelCase to match the JS wire:

```rust
#[serde(rename = "linkedDomains", default, skip_serializing_if = "Vec::is_empty")]
pub linked_domains: Vec<String>,
```

**Identity stays `(domain, username)`.** `linkedDomains` is pure match metadata,
so sync, tombstones, rename and delete keep their current keying untouched.

**Rejected alternatives.** *B — explicit split* (`saltDomain` + `domains[]`):
cleaner semantics but changes the identity key and forces a large Rust+TS+sync
churn for no functional gain. *C — separate alias table*: over-engineered, needs
a join at match time (YAGNI).

**Invariants.**

- `linkedDomains` never contains `domain` (canonical is implicit).
- Entries are normalised lowercased/trimmed; deduplicated.
- A domain string is classified at match time (no stored flag): it is a **full
  host** if it has a label below its registrable domain, else **registrable**.

## 5. Matching rule (the semantic core)

Each match domain `m` (the canonical `domain` or any `linkedDomains[i]`) is either
a registrable domain or a full host. Given a site host `h` with
`r = registrable(h)`:

| `m` is… | matches the site when | scope |
|---------|----------------------|-------|
| registrable (`google.com`) | `r === m` | **broad** — every subdomain (current behaviour) |
| full host (`mail.google.com`) | `h === m` | **narrow** — exact host only |

- **Match set of an account** = `{domain} ∪ linkedDomains`. The account matches
  the site if **any** member matches.
- **Ranking** of the offered candidates: exact-host match > registrable match;
  ties broken by `lastUsedAt` desc. All matches are offered, not just the best.
- **Derivation always uses `account.domain`** (the canonical). Linked domains and
  the site host never change the derived password.

### 5.1 Worked examples

Accounts: `A = {domain:"x.y.com"}`, `B = {domain:"w.y.com", linkedDomains:["z.y.com"]}`,
`C = {domain:"y.com"}` (registrable).

| On site | Offered (ranked) | Password derived from |
|---------|------------------|-----------------------|
| `x.y.com` | A (exact), C (broad) | A→`x.y.com`, C→`y.com` |
| `w.y.com` | B (exact), C (broad) | B→`w.y.com`, C→`y.com` |
| `z.y.com` | B (exact via link), C (broad) | B→`w.y.com` ✅, C→`y.com` |
| `y.com` | C (exact) | C→`y.com` |
| `other.y.com` | C (broad) only | C→`y.com` |

This is precisely the user's scenario: distinct passwords for `x.y.com` and
`w.y.com`, and `z.y.com` replaying `w.y.com`'s password via a link.

## 6. Per-platform work

### 6.1 Shared domain module (each client owns a copy)

A single, table-tested function per codebase so every call site agrees:

- **`fullHost(input): string | null`** — extract the lowercased host (URL or bare
  host), `null` for `chrome://`, `file://`, IPs, `localhost` (mirrors the
  existing `registrableDomain` fallback contract).
- **`domainMatches(m, siteHost): boolean`** — the §5 broad/narrow predicate.
- **`matchAccounts(siteUrl, accounts): RankedMatch[]`** — compute the match set
  per account, apply `domainMatches`, rank per §5.

`registrableDomain` stays as-is (still used for the broad case and the save UI's
default).

### 6.2 Extension (`extension/`)

- `src/shared/types.ts` — add `linkedDomains?` to `AccountEntry`.
- `src/shared/domain.ts` — add `fullHost`, `domainMatches`, `matchAccounts`.
- Replace the registrable-only lookups at the **4 call sites** with `matchAccounts`:
  - `src/popup/vault.ts:37`
  - `src/content/Badge.tsx:476`
  - `src/entrypoints/content.ts:73` and `:128`
  - `src/background/context-menus.ts:41`
- `src/background/accounts.ts` — `listAccounts` filter must use the match rule
  (not `e.domain === domain`); add link/unlink helpers that mutate
  `linkedDomains`; `recordAccount` accepts the chosen canonical domain.
- **Save flow** — when saving on a subdomain page, the prompt offers a
  granularity toggle: **"All of y.com" (default)** vs **"Only sub.y.com"**. This
  sets the canonical `domain`.
- **Account editor** (`src/popup/components/AccountDetailScreen.tsx`) — a
  "Linked domains" section (add/remove) + a "Use an existing account here" action
  shown on an unmatched site.
- **Sync** (`src/background/sync/*`) — carry `linkedDomains` in the op payload and
  in snapshot entries; identity unchanged. Tombstones unchanged.

### 6.3 Desktop + mobile app (`desktop/`, Rust + Preact)

- `src-tauri/src/types.rs` — add `linked_domains` (serde as §4) + update the
  shape-parity tests (`*_json_matches_extension_shape`).
- **Rust matching** — add the §5 predicate + `match_accounts` in the Rust core so
  it is shared by the app commands **and** the iOS AutoFill FFI. Add Tauri
  commands `link_domain` / `unlink_domain` (or extend `record_account`).
  Derivation (`lib.rs` FFI + commands) is **unchanged** — it already takes the
  canonical `domain` verbatim.
- **Frontend `src/types.ts`** — mirror `linkedDomains`.
- **App UI** — desktop has no "current tab", so matching is not used for browsing;
  the app work is **management + search**:
  - `src/components/AccountsView.tsx` + `src/mobile/screens/MobileAccountsScreen.tsx`
    — linked-domains editor + granularity choice on create.
  - `src/components/QuickSearchScreen.tsx` — search also matches `linkedDomains`.
  - `src/components/RotationPanel.tsx` — confirm rotation keys off the canonical.

### 6.4 Native autofill

- **iOS AutoFill (in scope).** `gen/apple/AutofillExtension/CredentialProviderViewController.swift`
  receives the service domain from iOS and asks the Rust core for credentials.
  Add a Rust FFI `keyfount_match_accounts(site_host) -> json` that applies §5
  (broad/narrow + `linkedDomains`) and have the Swift controller use it instead of
  any registrable-only filter. Derivation FFI is unchanged.
- **Android autofill (out of scope — does not exist).** `gen/android/` contains
  only the Tauri scaffold; there is **no** `AutofillService`. Building one is a
  large, separate feature. This spec makes the Rust `match_accounts` ready for it
  but does **not** create the Android autofill service. *(Flagged for the user; if
  Android native autofill is wanted now, it becomes its own spec.)*

### 6.5 Server (`server/`) — no code

The relay is oblivious to payload contents. The only change is **tests**: a
non-regression test asserting that `events`/`snapshots` round-trip unchanged when
the (opaque, now slightly larger) payload carries `linkedDomains`. No schema, no
route, no validation changes.

## 7. Sync wire format & cross-client agreement

The extension (TS) and desktop (Rust) sync through the same server and **must
interoperate**: the encrypted op/snapshot JSON for an account entry must encode
`linkedDomains` with the **same field name** on both sides.

- Field name: **`linkedDomains`** (camelCase), `omitempty`/`skip_serializing_if`
  when empty so an account without links serialises exactly as today.
- Because D2 makes backward-compat non-critical and the field is **optional with
  an empty-array default**, **no migration shim is required**: an old payload
  without the field decodes to `linkedDomains: []`; a new payload read by code
  that ignores the field is harmless.
- **Action for the plan:** read both `extension/src/background/sync/*` and
  `desktop/src/sync/payload.ts` + the Rust serialisation to pin the exact op
  shape and add a cross-client fixture test (encode in TS shape, decode in Rust
  shape, and vice-versa).

## 8. Testing strategy

**Golden / parity (highest priority).**

- Derivation golden vectors: assert the registrable case is **byte-identical** to
  today (extension TS vs Rust), plus a **new** full-host vector
  (`mail.google.com` ≠ `google.com`), shared across extension and Rust.
- Cross-client sync fixture: an account with `linkedDomains` encodes/decodes
  identically in the extension and Rust shapes (§7).

**Extension.**

- vitest, table-driven `matchAccounts`: broad, narrow, linked, precedence,
  `localhost`/`chrome://` → no match.
- vitest sync round-trip incl. `linkedDomains`; tombstone identity unchanged.
- Playwright e2e: badge offered on a **linked** domain; offered on a **subdomain**
  for a broad entry; a **narrow** (full-host) entry is **not** offered on the root.

**Desktop + mobile.**

- Rust unit: `domain_matches` / `match_accounts` table; serde round-trip;
  derivation-unchanged assertion.
- vitest: AccountsView/Mobile linked-domains editor; QuickSearch matches links.
- Playwright `desktop` **and** `mobile` projects: create an account, add a linked
  domain, verify it surfaces; verify granularity choice on create.

**iOS AutoFill.** Rust-level test for the `match_accounts` FFI output; manual
verification of the Swift controller (not CI-e2e).

**Server.** vitest non-regression: relay of events/snapshots unaffected by the
added field.

## 9. Non-goals / out of scope

- Android native autofill service (§6.4) — separate feature.
- Wildcard / pattern linking (`*.partner.com`) — only explicit registrable-or-host
  entries; the broad rule already covers "all subdomains of X" via a registrable
  entry.
- Any server-side domain knowledge (would break zero-knowledge).
- Importing link relationships from other password managers.

## 10. Risks

- **Derivation drift** between extension (TS/WASM) and Rust if salt construction
  diverges. Mitigated by shared golden vectors (§8) gating every PR.
- **Sync wire mismatch** between TS and Rust field encoding. Mitigated by the
  cross-client fixture test (§7).
- **Match precedence surprises** (a broad entry shadowing a narrow one). Mitigated
  by the explicit ranking + e2e (§5, §8).

## 11. Rollout

One `feat/subdomains-and-linked-domains` branch per repo, one PR per repo, each
closing its tracking issue (check existing issues in all three repos first).
Suggested order: **desktop Rust core + shared rule** → **extension** → **iOS
AutoFill** → **server tests**, so the derivation/matching source-of-truth and
golden vectors land before the consumers.
