# iOS AutoFill — Create-Account Flow + Cross-Domain Search

Status: approved 2026-05-26. Branch: `feat/mobile-support`.

## Goals

1. From the AutoFill extension, let the user **create an account** for the
   site they're on (with full profile parameter parity vs. the main app).
2. Let the user **fill any existing account** even if it doesn't match
   the current domain (use-case: same password across two sites).
3. **Never expose anything before authentication** — Face ID if enabled,
   otherwise master-password prompt with fingerprint check.
4. **Sync new accounts back to the server** with a hybrid strategy: best
   effort push from the extension, deferred drain by the main app.

## Threat model boundary

Same as the desktop build, no stronger:

- Master password never lands on disk in cleartext. Held only in the
  extension's process memory after unlock, zeroed on dismiss.
- Sync payloads are AES-GCM encrypted under a key derived from the
  OPAQUE export_key; server sees opaque ciphertexts.
- SQLite local file (account/domain/profile metadata) remains in the
  shared App Group container — same exposure as the desktop's
  `~/Library/Application Support/Keyfount/<vault>/vault.db`. Out of
  scope to ship SQLCipher in this iteration (refactor too large).

## UI flow

```
┌─ Lock screen ───────────────────────┐
│   Face ID prompt (if enrolled)      │
│   ↓ failure / not enrolled          │
│   Master password field             │
└─────────────────────────────────────┘
            ↓ unlocked
┌─ Account list ──────────────────────┐
│  [🔍 Rechercher]                    │
│  SUGGESTIONS POUR apple.com         │  ← only if domain present + match
│   user@apple.com  apple.com    ›    │
│  TOUS LES COMPTES                   │
│   …                                 │
│  [+] in nav bar (only if domain)    │
└─────────────────────────────────────┘
            ↓ tap [+]
┌─ Create account ────────────────────┐
│  Domaine (prefilled, editable)      │
│  Identifiant                        │
│  Random ⇄ Memorable                 │
│  …ProfileEditor parity…             │
│  Preview password (debounced 250ms) │
└─────────────────────────────────────┘
            ↓ Créer
   record_account_ffi → completeRequest
            └─ fire-and-forget: try_push_pending_ffi
```

## Robustness fixes baked in

1. `serviceIdentifiers` extraction handles both `.domain` and `.URL`
   (host extraction) — current code shows "Aucun compte pour ." when
   iOS hands us a URL identifier.
2. Empty `requestedDomain` → no "Suggestions" section, no `+` button,
   but full account list still visible.

## Rust FFI surface (new)

```rust
// lib.rs
verify_master_ffi(master, expected_fp_hex) -> i32   // 1 OK / 0 KO / -1 err
record_account_ffi(domain, username, profile_json) -> i32  // 1 OK / 0 bad / -1 store
```

Both read the active vault via `open_active_vault_db()` (registry
→ active id → SQLite). `last_synced_at` is left NULL on insert so
the deferred drain can pick it up.

## Sync semantics — revised: defer-only

Original plan called for an immediate `try_push_pending_ffi`. Dropped
after measuring: porting the push pipeline (HKDF over the OPAQUE
export_key, AES-GCM nonce, lamport-clocked `SyncOp` framing, retries,
cursor logic) to pure Rust would duplicate ~200 lines of carefully
tested TypeScript in `src/sync/auto.ts`. Two implementations of the
crypto envelope is a real footgun for E2E confidentiality — one
diverges, ciphertexts decrypt fine but pull-applied state silently
drifts. Not worth the convenience.

So:

1. Extension writes the account with `last_synced_at = NULL`.
2. **No immediate push from the extension.** The created account is
   already complete locally, the user gets their filled credential
   instantly, and iOS dismisses the chooser.
3. **Main app drains on unlock.** A new IPC command
   `list_pending_sync_accounts` returns rows with `last_synced_at
IS NULL`. `sync/auto.ts` (or whatever starts auto-sync) iterates
   them and re-emits `syncBus.notify({ t: "upsert_account", entry })`
   for each. The existing push pipeline handles the rest, and the
   server side is already idempotent on (domain, username) so replays
   are cheap.
4. **No `last_synced_at` update yet.** First iteration trusts the
   replay-on-boot to be idempotent and cheap. If users accumulate
   thousands of pending entries because the main app is never
   opened, we'll revisit by updating `last_synced_at` after a
   confirmed push.

User-visible consequence: an account created in the AutoFill extension
becomes visible on other devices only after the user next opens the
desktop / mobile app and an auto-sync round trip completes. Acceptable
for v1 — every other manager with a Credential Provider extension
behaves the same way.

## Commit plan

Small commits, in order:

1. `docs(ios): spec extension create-account flow` (this file).
2. `fix(ios): robustify domain extraction from serviceIdentifiers`.
3. `feat(rust): verify_master_ffi for the AutoFill extension`.
4. `feat(ios): gate AutoFill behind biometric / master unlock`.
5. `feat(ios): show all accounts with search + suggestions section`.
6. `feat(rust): record_account_ffi for extension-driven creation`.
7. `feat(ios): create-account form (ProfileEditor parity)`.
8. `feat(rust): list_pending_sync_accounts IPC for drain on boot`.
9. `feat(sync): replay pending accounts via syncBus when auto-sync starts`.

Each commit must keep the previous step's behaviour working — no
"big bang" merge.
