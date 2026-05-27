# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in Keyfount Desktop, please report it **privately**.

- **Preferred:** open a [GitHub Security Advisory](https://github.com/Keyfount/desktop/security/advisories/new).
- Do **not** open a public issue or pull request that discloses the vulnerability.

You will receive an acknowledgement within 72 hours. We will work with you to understand the issue and ship a fix as quickly as is reasonable.

## Scope

In scope:

- The Rust crypto module in this repository (`src-tauri/src/crypto/`).
- The native storage layer, OS keychain integration, and biometric unlock flows.
- The Tauri IPC surface between the Rust backend and the Preact frontend.
- The OPAQUE sync client (`src-tauri/src/sync/`).
- The autofill bridge (`src-tauri/src/native/autofill.rs`).
- The signed release / auto-update pipeline.

Out of scope:

- Vulnerabilities in upstream dependencies (please report them upstream; we will track and patch).
- OS or browser engine vulnerabilities outside Tauri's control.
- Loss of access caused by a forgotten master password — this is by design (Keyfount is deterministic; there is no recovery path).
- Side-channel attacks on the host OS that already imply attacker-level access.

## Threat model

Keyfount Desktop inherits the threat model of the deterministic password manager design. Its security guarantees rely on:

1. The user's master password remaining secret and high-entropy.
2. The Argon2id work factor (`m=64 MiB, t=3, p=1`) being high enough to slow down brute-force attempts on a leaked site password.
3. The application never transmitting the master password, a domain, or a derived password over the network.
4. The OS keychain (Keychain Services on macOS, Credential Manager on Windows) being trustworthy when used to seal the PIN blob or biometric-protected master.
5. The OPAQUE authentication exchange guaranteeing that a complete server-side database dump leaks nothing usable to crack the master offline.

If you find a deviation from any of these, please report it.

## At-rest encryption boundary

The vault SQLite database (`vault.db`, plus its `vault.db-wal` and `vault.db-shm` sidecars) is encrypted at rest with **SQLCipher AES-256** at the page level. The page key is derived from the master password and a per-vault random salt via Argon2id (same parameters as #2 above). The salt sidecar (`db-salt`) is not a secret — it exists only to make every vault's page key independent.

**Inside the boundary (master-encrypted on disk):**

- Every saved account: domain, username, generation profile, created/last-used/last-synced timestamps.
- Every per-site override profile.
- The vault's default profile and user preferences (auto-lock timeout, clipboard timer, history toggle, favicon-fallback toggle).
- The 3-byte master fingerprint stored in the `settings` row (a duplicate of the registry-level copy used for the quick wrong-password pre-check).

**Outside the boundary (intentionally plaintext):**

- `vaults.json` — the registry of vault IDs and 3-byte public fingerprints. Contains no domains, usernames, or profile parameters. The fingerprint is one-way and is meant to be visible (the user displays it to confirm they typed the right master).
- `db-salt` — per-vault random salt for the page-key KDF. Not secret.
- `sync-session.json` — already encrypted under its own master-derived envelope (AES-256-GCM, see `crypto::master_kek`).

An attacker who exfiltrates the entire per-vault directory still needs to crack the master at the Argon2id work factor to learn anything beyond the vault ID and the 3-byte fingerprint.

## Disclosure

We aim for a 90-day coordinated disclosure window from the date of first contact. We will credit reporters in release notes unless they prefer to remain anonymous.
