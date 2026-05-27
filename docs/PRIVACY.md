# Privacy

Keyfount Desktop is a deterministic password manager. It does not store generated passwords; it recomputes them on demand from three inputs that never leave the device:

1. The user's master password (typed in the app).
2. The site domain (typed in the app or selected from history).
3. The associated email or username (typed or selected from history).

The application stores the following on the local device, **all encrypted at rest by the master password** (SQLCipher AES-256, page-level, including the WAL/SHM sidecars):

- The 3-byte master fingerprint (a one-way hash of the master, used to detect typos).
- The per-site generation profile (length, character classes, counter, mode).
- The optional account history (`(domain, username)` pairs the user has chosen to save).
- The optional PIN blob (master encrypted under a user-chosen PIN; sealed in the OS keychain).
- The optional sync session (OPAQUE export key; sealed in the OS keychain).
- Application preferences (auto-lock timeout, clipboard timer, favicon fallback toggle, history toggle).

**At-rest boundary.** The master password protects the entire vault SQLite database — not just the derived passwords (which are never stored), but also every domain, username, profile parameter, and timestamp the app keeps. The page key is derived via Argon2id (m=64 MiB, t=3, p=1) from the master plus a per-vault random salt stored alongside the DB file. An attacker who copies the on-disk `vault.db` (and its `vault.db-wal` / `vault.db-shm` sidecars) gets nothing usable without first cracking the master against the same Argon2id work factor used for password derivation. The only file in the per-vault directory that is NOT master-encrypted is the `db-salt` sidecar — it is not a secret, its only purpose is to give every vault an independent page key so leaking one vault gives an attacker zero help cracking another. The top-level `vaults.json` registry sits one layer outside the vault and is intentionally outside the master-encryption boundary; it contains only vault IDs and 3-byte public fingerprints (no domains, no usernames, no profile data).

The application transmits the following over the network, **only if the user explicitly connects to a sync server**:

- OPAQUE authentication messages (no plaintext password, no email).
- AES-GCM-encrypted account-index payloads (no plaintext domain, no plaintext username).

The application does **not** transmit:

- The master password (ever, anywhere).
- Generated site passwords (ever, anywhere).
- Plaintext domain or username (ever, anywhere — even to the sync server).
- Telemetry, analytics, crash reports, or any other diagnostic data.

There is no embedded analytics SDK, no error reporter, no auto-loaded font CDN, no CDN-hosted dependency. The bundle is auditable end-to-end.

For a vulnerability report, see [SECURITY.md](../SECURITY.md).
