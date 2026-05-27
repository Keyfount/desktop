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
verify_master_ffi(master) -> bool          // fingerprint check
record_account_ffi(domain, username, profile_json) -> *mut c_char (entry JSON or null)
try_push_pending_ffi(timeout_ms: u32) -> i32  // -1 no session, -2 net KO, ≥0 pushed
```

All three read the vault DB via the existing `store::` modules and
respect the same locks as the IPC commands.

## Sync semantics

- New accounts written with `last_synced_at = NULL`.
- Extension attempts immediate push (5s timeout). Silent failure
  acceptable — the record is already local.
- Main app drains `WHERE last_synced_at IS NULL` after every unlock
  (new helper called from `restore_active_vault` and from the unlock
  command handler).

## Keychain assumption

The sync session's `export_key` must live in the `io.keyfount.shared`
access group for the extension to push. If today it sits in the
default group, that migration is its own commit before
`try_push_pending_ffi` lands.

## Commit plan

Small commits, in order:

1. `docs(ios): spec extension create-account flow` (this file).
2. `fix(ios): robustify domain extraction from serviceIdentifiers`.
3. `feat(rust): verify_master_ffi for the AutoFill extension`.
4. `feat(ios): gate AutoFill behind biometric / master unlock`.
5. `feat(ios): show all accounts with search + suggestions section`.
6. `feat(rust): record_account_ffi for extension-driven creation`.
7. `feat(ios): create-account form (ProfileEditor parity)`.
8. `feat(rust): try_push_pending_ffi best-effort push from extension`.
9. `feat(rust): drain pending pushes after unlock`.
10. (if needed) `chore(ios): move sync export_key to shared keychain group`.

Each commit must keep the previous step's behaviour working — no
"big bang" merge.
