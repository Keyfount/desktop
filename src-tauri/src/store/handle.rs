//! Per-vault SQLite handle.
//!
//! The vault DB is encrypted at rest with SQLCipher; opening requires
//! the user's master password to derive the 32-byte page key (see
//! `store::db_key`). Three states model the lifecycle:
//!
//! - `Uninitialised`: no active vault. First-run state, or after the
//!   user explicitly clears the active vault.
//! - `LockedKnown { vault_id, dir }`: we know which vault is active
//!   from `vaults.json` but the master isn't available yet. Status
//!   queries can read display data (fingerprint) from the registry
//!   without touching the encrypted DB.
//! - `Open { vault_id, path, conn }`: SQLCipher connection open, the
//!   `PRAGMA key` has been verified by a read against `sqlite_master`,
//!   and schema migrations have run.
//!
//! The state machine is one-way: `set_active` flips Uninitialised → Locked,
//! `open_encrypted` flips Locked → Open, and `close` drops back to
//! whichever locked state we last knew. This means commands that only
//! need to identify the active vault (registry edits, vault deletion)
//! work without prompting for the master, while every read/write of
//! account data goes through `require_mut`/`require` which both demand
//! the Open state.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

use super::db_key::{self, DB_KEY_LEN};

#[derive(Debug)]
pub struct StoreHandle {
    inner: HandleState,
}

#[derive(Debug)]
enum HandleState {
    Uninitialised,
    Locked {
        vault_id: String,
        dir: PathBuf,
    },
    Open(OpenStore),
}

#[derive(Debug)]
pub struct OpenStore {
    pub vault_id: String,
    pub path: PathBuf,
    pub conn: Connection,
}

impl StoreHandle {
    pub fn uninitialised() -> Self {
        Self {
            inner: HandleState::Uninitialised,
        }
    }

    /// Mark an active vault without opening its (encrypted) DB. Used at
    /// startup and after `switch_vault` so `status()` reports
    /// `isFirstRun: false` even while the master is still locked.
    pub fn set_active<P: AsRef<Path>>(&mut self, vault_id: String, dir: P) -> AppResult<()> {
        let dir = dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&dir)?;
        self.inner = HandleState::Locked { vault_id, dir };
        Ok(())
    }

    /// Open the encrypted DB for the currently-active vault using the
    /// master password. Idempotent: re-calling with a different master
    /// closes the previous connection first. Returns `AppError::Locked`
    /// on `PRAGMA key` failure (wrong master) so the UI can route to
    /// the unlock-retry path.
    pub fn open_encrypted(&mut self, master: &str) -> AppResult<()> {
        let (vault_id, dir) = match &self.inner {
            HandleState::Uninitialised => {
                return Err(AppError::NoActiveVault);
            }
            HandleState::Locked { vault_id, dir } => (vault_id.clone(), dir.clone()),
            HandleState::Open(open) => (open.vault_id.clone(), open.path.parent().map(|p| p.to_path_buf()).unwrap_or_default()),
        };

        // Drop the previous connection (if any) before we open the new
        // one. SQLCipher uses an exclusive file lock for some pages, so
        // overlapping opens would race.
        self.inner = HandleState::Locked {
            vault_id: vault_id.clone(),
            dir: dir.clone(),
        };

        let path = dir.join("vault.db");

        // If a plaintext v1 DB exists, migrate it in-place before we
        // attempt the encrypted open. Migration requires the master to
        // derive the new page key, which is why it lives here (the
        // unlock-time helper) rather than at app startup.
        if path.exists() && is_plaintext_sqlite(&path)? {
            tracing::info!(?path, "migrating plaintext v1 vault.db to SQLCipher");
            migrate_plaintext_v1_to_encrypted(&path, &dir, master)?;
        }

        let salt = db_key::ensure_salt(&dir)?;
        let key = db_key::derive_key(master, &salt)?;
        let conn = open_with_key(&path, &key)?;
        super::schema::ensure_schema(&conn)?;

        self.inner = HandleState::Open(OpenStore {
            vault_id,
            path,
            conn,
        });
        Ok(())
    }

    /// Drop the SQL connection (flushes WAL) but retain the
    /// active-vault identity. The next `open_encrypted` reopens the
    /// same DB without going through the registry.
    pub fn close(&mut self) {
        let prev = std::mem::replace(&mut self.inner, HandleState::Uninitialised);
        match prev {
            HandleState::Open(open) => {
                let dir = open.path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
                self.inner = HandleState::Locked {
                    vault_id: open.vault_id,
                    dir,
                };
            }
            other => {
                self.inner = other;
            }
        }
    }

    /// Drop back to the "no active vault" state. Used by
    /// `start_new_vault` and `delete_vault`.
    pub fn clear(&mut self) {
        self.inner = HandleState::Uninitialised;
    }

    /// Identity of the active vault, or `None` if uninitialised. Available
    /// whether the DB is open or locked.
    pub fn active_id(&self) -> Option<&str> {
        match &self.inner {
            HandleState::Uninitialised => None,
            HandleState::Locked { vault_id, .. } => Some(vault_id),
            HandleState::Open(open) => Some(&open.vault_id),
        }
    }

    pub fn active_dir(&self) -> Option<PathBuf> {
        match &self.inner {
            HandleState::Uninitialised => None,
            HandleState::Locked { dir, .. } => Some(dir.clone()),
            HandleState::Open(open) => open.path.parent().map(|p| p.to_path_buf()),
        }
    }

    pub fn require(&self) -> AppResult<&OpenStore> {
        match &self.inner {
            HandleState::Open(open) => Ok(open),
            HandleState::Uninitialised => Err(AppError::NoActiveVault),
            HandleState::Locked { .. } => Err(AppError::Locked),
        }
    }

    pub fn require_mut(&mut self) -> AppResult<&mut OpenStore> {
        match &mut self.inner {
            HandleState::Open(open) => Ok(open),
            HandleState::Uninitialised => Err(AppError::NoActiveVault),
            HandleState::Locked { .. } => Err(AppError::Locked),
        }
    }
}

/// Open `path` as a SQLCipher database with the supplied 32-byte key.
/// The PRAGMA key must succeed AND a subsequent read against
/// `sqlite_master` must succeed for the connection to be considered
/// valid — `PRAGMA key` itself never errors with a bad key, it just
/// configures the cipher and waits for the first page read to fail.
///
/// On wrong-key returns `AppError::Locked` so callers route to the
/// unlock retry path.
fn open_with_key(path: &Path, key: &[u8; DB_KEY_LEN]) -> AppResult<Connection> {
    let conn = Connection::open(path).map_err(AppError::from)?;
    let literal = db_key::pragma_key_literal(key);
    // We deliberately use `execute_batch` with an inline literal here —
    // `pragma_update` doesn't quote the value the way SQLCipher expects
    // for `x'...'` hex-key syntax.
    conn.execute_batch(&format!("PRAGMA key = \"{literal}\";"))
        .map_err(|e| AppError::Storage(format!("PRAGMA key: {e}")))?;
    // Force SQLCipher to attempt page 1 — this is where a wrong key
    // surfaces as `SQLITE_NOTADB`.
    if let Err(err) = conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)) {
        if is_wrong_key_error(&err) {
            return Err(AppError::Locked);
        }
        return Err(AppError::from(err));
    }
    // WAL + NORMAL synchronous matches the previous plaintext config.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(AppError::from)?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(AppError::from)?;
    Ok(conn)
}

fn is_wrong_key_error(err: &rusqlite::Error) -> bool {
    use rusqlite::ffi::ErrorCode;
    match err {
        rusqlite::Error::SqliteFailure(e, _) => matches!(
            e.code,
            ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt
        ),
        // SQLCipher sometimes surfaces "file is not a database" as a
        // `SqliteSingleThreadedMode`-flavoured error too; check the
        // stringified message as a fallback.
        _ => err.to_string().to_lowercase().contains("not a database"),
    }
}

/// Returns `true` if `path` is a plaintext (unencrypted) SQLite file.
/// We sniff the magic header rather than trying to open it — opening
/// with SQLCipher would either succeed (if it's already encrypted) or
/// surface as a `NotADatabase` error, neither of which distinguishes
/// "plaintext v1" from "encrypted with the wrong key".
pub fn is_plaintext_sqlite(path: &Path) -> AppResult<bool> {
    use std::fs::File;
    use std::io::Read;
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(err.into()),
    };
    let mut header = [0u8; 16];
    let n = file.read(&mut header)?;
    Ok(n >= 16 && &header[0..15] == b"SQLite format 3")
}

/// Migrate a plaintext v1 SQLite DB at `path` to an encrypted SQLCipher
/// DB with the per-vault key derived from `master + dir/db-salt`. The
/// migration runs the SQLCipher `sqlcipher_export` flow:
///
/// 1. Open the plaintext DB (no PRAGMA key).
/// 2. ATTACH a freshly-created encrypted DB at a sibling path.
/// 3. `SELECT sqlcipher_export('encrypted')` to copy every table.
/// 4. DETACH.
/// 5. Atomically rename the encrypted file over the plaintext one.
/// 6. Best-effort `unlink` the leftover -shm/-wal/-journal files that
///    belong to the now-replaced plaintext DB.
///
/// On failure the original plaintext file is left untouched so the
/// caller can retry. The temporary encrypted file is cleaned up.
pub fn migrate_plaintext_v1_to_encrypted(
    path: &Path,
    vault_dir: &Path,
    master: &str,
) -> AppResult<()> {
    let salt = db_key::ensure_salt(vault_dir)?;
    let key = db_key::derive_key(master, &salt)?;
    let key_literal = db_key::pragma_key_literal(&key);

    let plain_conn = Connection::open(path).map_err(AppError::from)?;

    let tmp_path = vault_dir.join("vault.db.encrypting");
    // Make sure no half-migrated tmp file from a previous crashed run
    // sticks around.
    let _ = std::fs::remove_file(&tmp_path);

    let result = (|| -> AppResult<()> {
        let attach_sql = format!(
            "ATTACH DATABASE '{}' AS encrypted KEY \"{}\";",
            tmp_path.display().to_string().replace('\'', "''"),
            key_literal
        );
        plain_conn
            .execute_batch(&attach_sql)
            .map_err(|e| AppError::Storage(format!("ATTACH for migration: {e}")))?;
        plain_conn
            .query_row("SELECT sqlcipher_export('encrypted')", [], |_| Ok(()))
            .map_err(|e| AppError::Storage(format!("sqlcipher_export: {e}")))?;
        plain_conn
            .execute_batch("DETACH DATABASE encrypted;")
            .map_err(|e| AppError::Storage(format!("DETACH: {e}")))?;
        Ok(())
    })();

    // Close the plaintext connection BEFORE we move files around — on
    // Windows the file lock would block the rename otherwise. On Unix
    // it's just good hygiene.
    drop(plain_conn);

    if let Err(err) = result {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(err);
    }

    // Atomically replace the plaintext file. If we crash between this
    // rename and the side-file cleanup, the next launch picks up the
    // encrypted DB and just leaves the orphan -shm/-wal files until the
    // next clean shutdown.
    std::fs::rename(&tmp_path, path)?;

    // Remove the plaintext WAL/SHM sidecars — they're now stale and
    // would just waste disk space.
    for ext in ["-wal", "-shm", "-journal"] {
        let side = path.with_file_name(format!(
            "{}{}",
            path.file_name().and_then(|n| n.to_str()).unwrap_or(""),
            ext
        ));
        let _ = std::fs::remove_file(side);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;

    fn tmp_dir() -> PathBuf {
        let p = env::temp_dir().join(format!(
            "keyfount-handle-test-{}",
            uuid::Uuid::now_v7().simple()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn open_encrypted_writes_a_non_sqlite_header() {
        let dir = tmp_dir();
        let mut h = StoreHandle::uninitialised();
        h.set_active("test".into(), &dir).unwrap();
        h.open_encrypted("hunter2hunter2").unwrap();
        let open = h.require().unwrap();
        // Force a write so the page header is flushed.
        open.conn
            .execute_batch("INSERT INTO meta(key, value) VALUES ('x', 'y');")
            .unwrap();
        h.close();
        let bytes = fs::read(dir.join("vault.db")).unwrap();
        assert!(
            bytes.len() >= 16,
            "vault.db too small to inspect header: {} bytes",
            bytes.len()
        );
        assert_ne!(
            &bytes[0..15],
            b"SQLite format 3",
            "encrypted vault.db must not have the plaintext SQLite magic"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn wrong_master_returns_locked() {
        let dir = tmp_dir();
        let mut h = StoreHandle::uninitialised();
        h.set_active("test".into(), &dir).unwrap();
        h.open_encrypted("real-master-passphrase").unwrap();
        h.close();

        let mut h2 = StoreHandle::uninitialised();
        h2.set_active("test".into(), &dir).unwrap();
        let err = h2
            .open_encrypted("wrong-master-passphrase")
            .expect_err("should fail");
        assert!(
            matches!(err, AppError::Locked),
            "expected AppError::Locked, got {err:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn right_master_reads_back_data() {
        let dir = tmp_dir();
        let mut h = StoreHandle::uninitialised();
        h.set_active("test".into(), &dir).unwrap();
        h.open_encrypted("hunter2hunter2").unwrap();
        h.require()
            .unwrap()
            .conn
            .execute(
                "INSERT INTO meta(key, value) VALUES (?1, ?2)",
                rusqlite::params!["k", "v"],
            )
            .unwrap();
        h.close();

        let mut h2 = StoreHandle::uninitialised();
        h2.set_active("test".into(), &dir).unwrap();
        h2.open_encrypted("hunter2hunter2").unwrap();
        let value: String = h2
            .require()
            .unwrap()
            .conn
            .query_row("SELECT value FROM meta WHERE key = 'k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(value, "v");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn raw_sqlite_cannot_read_encrypted_db() {
        // Open a fresh encrypted DB and write to it.
        let dir = tmp_dir();
        let mut h = StoreHandle::uninitialised();
        h.set_active("test".into(), &dir).unwrap();
        h.open_encrypted("hunter2hunter2").unwrap();
        h.require()
            .unwrap()
            .conn
            .execute_batch("INSERT INTO meta(key, value) VALUES ('x', 'y');")
            .unwrap();
        h.close();

        // Now open the file WITHOUT setting PRAGMA key. SQLCipher will
        // see a fully-encrypted header and surface SQLITE_NOTADB on the
        // first read.
        let raw = Connection::open(dir.join("vault.db")).unwrap();
        let err = raw
            .query_row("SELECT count(*) FROM sqlite_master", [], |r| {
                r.get::<_, i64>(0)
            })
            .expect_err("reading encrypted DB without PRAGMA key must fail");
        assert!(
            is_wrong_key_error(&err),
            "expected NotADatabase / encrypted-file error, got: {err:?}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migrates_plaintext_v1_db_to_encrypted_on_open() {
        let dir = tmp_dir();
        let path = dir.join("vault.db");

        // Build a plaintext SQLite DB with the v1 schema and a
        // recognisable row.
        {
            let conn = Connection::open(&path).unwrap();
            super::super::schema::ensure_schema(&conn).unwrap();
            conn.execute(
                "INSERT INTO meta(key, value) VALUES (?1, ?2)",
                rusqlite::params!["sentinel", "before-migration"],
            )
            .unwrap();
        }
        // Confirm the on-disk file is plaintext SQLite.
        let pre_header = fs::read(&path).unwrap();
        assert_eq!(&pre_header[0..15], b"SQLite format 3");

        // Now open via the encrypted path — migration should kick in.
        let mut h = StoreHandle::uninitialised();
        h.set_active("test".into(), &dir).unwrap();
        h.open_encrypted("hunter2hunter2").unwrap();
        let v: String = h
            .require()
            .unwrap()
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'sentinel'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, "before-migration");
        h.close();

        // After migration the on-disk file should no longer be
        // plaintext.
        let post_header = fs::read(&path).unwrap();
        assert!(post_header.len() >= 16);
        assert_ne!(
            &post_header[0..15],
            b"SQLite format 3",
            "post-migration DB must be encrypted"
        );

        // And the migration must be idempotent — reopening a second
        // time should not try to re-migrate.
        let mut h2 = StoreHandle::uninitialised();
        h2.set_active("test".into(), &dir).unwrap();
        h2.open_encrypted("hunter2hunter2").unwrap();
        let v2: String = h2
            .require()
            .unwrap()
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'sentinel'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v2, "before-migration");

        fs::remove_dir_all(&dir).ok();
    }
}
