//! Per-vault database encryption key.
//!
//! Each encrypted vault DB carries a stable 16-byte salt on disk
//! (`db-salt` next to `vault.db`). The 32-byte SQLCipher page key is
//! `Argon2id(master, vault_salt)`. The salt is generated once at vault
//! creation and never rotates, so the same master + same vault always
//! unlocks with the same key — required because `PRAGMA key` is set on
//! every connection open, including from the iOS AutoFill extension
//! which has no access to in-memory state.
//!
//! The salt itself is not a secret. Its purpose is to make every
//! vault's page key independent so that a leaked DB from vault A
//! gives an attacker zero help cracking vault B even when both share
//! the same master. The Argon2id work factor (matching the rest of
//! the codebase: m=64 MiB, t=3, p=1) means brute-forcing the master
//! against a stolen DB is just as expensive as brute-forcing the
//! sync-session envelope.
//!
//! Failure modes:
//! - Missing salt file on an existing encrypted DB → DB is unreadable
//!   (we treat this as corruption; deleting the vault directory or
//!   restoring from sync is the only recovery path).
//! - Salt file present but DB is plaintext v1 → caller migrates via
//!   `store::handle::migrate_plaintext_v1_to_encrypted`.
//!
//! This module is intentionally small so the FFI path (which can't
//! share in-process state with the main app) can derive the same key
//! deterministically from `master + salt-on-disk`.
//!
//! Why not the PIN-blob salt or the sync-session salt? Those rotate
//! on every save (fresh randoms per encryption). A page key must stay
//! stable across opens. So we keep a vault-specific salt purpose-built
//! for this.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;

use crate::error::{AppError, AppResult};

pub const DB_KEY_LEN: usize = 32;
pub const DB_SALT_LEN: usize = 16;
pub const DB_SALT_FILENAME: &str = "db-salt";

// Argon2id parameters — same costs the rest of the codebase uses.
// Roughly 200 ms on a modern laptop; comfortable safety margin while
// still feeling instant after the user types the master.
const ARGON2_MEM_KIB: u32 = 65536;
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;

/// Path to the salt file for the given vault directory.
pub fn salt_path(vault_dir: &Path) -> PathBuf {
    vault_dir.join(DB_SALT_FILENAME)
}

/// Load the existing salt, or create-and-persist a fresh one if missing.
/// The vault directory is created if it doesn't exist.
pub fn ensure_salt(vault_dir: &Path) -> AppResult<[u8; DB_SALT_LEN]> {
    fs::create_dir_all(vault_dir)?;
    let path = salt_path(vault_dir);
    match fs::read(&path) {
        Ok(bytes) => {
            if bytes.len() != DB_SALT_LEN {
                return Err(AppError::storage(format!(
                    "db-salt at {} has unexpected length {}, expected {DB_SALT_LEN}",
                    path.display(),
                    bytes.len()
                )));
            }
            let mut out = [0u8; DB_SALT_LEN];
            out.copy_from_slice(&bytes);
            Ok(out)
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {
            let mut salt = [0u8; DB_SALT_LEN];
            rand::thread_rng().fill_bytes(&mut salt);
            // Write atomically so a crash between `write` and `rename`
            // never leaves us with a half-written salt that would brick
            // an existing DB.
            let tmp = path.with_extension("tmp");
            fs::write(&tmp, salt)?;
            fs::rename(&tmp, &path)?;
            Ok(salt)
        }
        Err(err) => Err(err.into()),
    }
}

/// Load the existing salt; returns `None` if the file does not exist.
/// Used by the v1 plaintext detector — the absence of a salt is a
/// strong signal that the DB has never been opened encrypted.
pub fn try_load_salt(vault_dir: &Path) -> AppResult<Option<[u8; DB_SALT_LEN]>> {
    let path = salt_path(vault_dir);
    match fs::read(&path) {
        Ok(bytes) => {
            if bytes.len() != DB_SALT_LEN {
                return Err(AppError::storage(format!(
                    "db-salt at {} has unexpected length {}, expected {DB_SALT_LEN}",
                    path.display(),
                    bytes.len()
                )));
            }
            let mut out = [0u8; DB_SALT_LEN];
            out.copy_from_slice(&bytes);
            Ok(Some(out))
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// Derive the 32-byte SQLCipher page key from the master and the
/// vault-specific salt. Deterministic for fixed inputs — required so
/// the same master always unlocks the same DB.
pub fn derive_key(master: &str, salt: &[u8; DB_SALT_LEN]) -> AppResult<[u8; DB_KEY_LEN]> {
    let params = Params::new(ARGON2_MEM_KIB, ARGON2_TIME_COST, ARGON2_PARALLELISM, None)
        .map_err(|e| AppError::Crypto(format!("argon2 params: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; DB_KEY_LEN];
    argon
        .hash_password_into(master.as_bytes(), salt, &mut out)
        .map_err(|e| AppError::Crypto(format!("argon2 derive: {e}")))?;
    Ok(out)
}

/// Format a 32-byte key as the SQLCipher `PRAGMA key = "x'<hex>'"`
/// literal. Wrapping in `x'...'` tells SQLCipher to treat the value
/// as a raw hex key (skipping the built-in PBKDF2 derivation from a
/// passphrase) — important because we've already done the slow KDF
/// in `derive_key`.
pub fn pragma_key_literal(key: &[u8; DB_KEY_LEN]) -> String {
    format!("x'{}'", hex::encode(key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn tmp_dir() -> PathBuf {
        let p = env::temp_dir().join(format!(
            "keyfount-db-key-test-{}",
            uuid::Uuid::now_v7().simple()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn ensure_salt_creates_and_reloads_the_same_value() {
        let dir = tmp_dir();
        let a = ensure_salt(&dir).unwrap();
        let b = ensure_salt(&dir).unwrap();
        assert_eq!(a, b);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn try_load_salt_is_none_when_missing() {
        let dir = tmp_dir();
        assert!(try_load_salt(&dir).unwrap().is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn derive_key_is_deterministic() {
        let salt = [42u8; DB_SALT_LEN];
        let a = derive_key("hunter2hunter2", &salt).unwrap();
        let b = derive_key("hunter2hunter2", &salt).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn derive_key_changes_with_master() {
        let salt = [42u8; DB_SALT_LEN];
        let a = derive_key("master-a-some-words", &salt).unwrap();
        let b = derive_key("master-b-some-words", &salt).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn derive_key_changes_with_salt() {
        let a = derive_key("hunter2hunter2", &[1u8; DB_SALT_LEN]).unwrap();
        let b = derive_key("hunter2hunter2", &[2u8; DB_SALT_LEN]).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn pragma_key_literal_is_hex_in_x_quotes() {
        let key = [0xab; DB_KEY_LEN];
        let s = pragma_key_literal(&key);
        assert!(s.starts_with("x'"));
        assert!(s.ends_with('\''));
        assert_eq!(s.len(), 2 + DB_KEY_LEN * 2 + 1);
    }

    #[test]
    fn ensure_salt_rejects_corrupt_salt_file() {
        let dir = tmp_dir();
        // Write a salt of the wrong length manually.
        fs::write(salt_path(&dir), b"too-short").unwrap();
        let err = ensure_salt(&dir).expect_err("should reject");
        assert!(matches!(err, AppError::Storage(_)));
        fs::remove_dir_all(&dir).ok();
    }
}
