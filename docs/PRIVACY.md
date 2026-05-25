# Privacy

Keyfount Desktop is a deterministic password manager. It does not store generated passwords; it recomputes them on demand from three inputs that never leave the device:

1. The user's master password (typed in the app).
2. The site domain (typed in the app or selected from history).
3. The associated email or username (typed or selected from history).

The application stores the following on the local device:

- The 3-byte master fingerprint (a one-way hash of the master, used to detect typos).
- The per-site generation profile (length, character classes, counter, mode).
- The optional account history (`(domain, username)` pairs the user has chosen to save).
- The optional PIN blob (master encrypted under a user-chosen PIN; sealed in the OS keychain).
- The optional sync session (OPAQUE export key; sealed in the OS keychain).
- Application preferences (auto-lock timeout, clipboard timer, favicon fallback toggle, history toggle).

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
