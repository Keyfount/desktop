//! PIN blob persistence as a sidecar file next to the encrypted vault DB.
//!
//! The PIN-protected master needs to be readable BEFORE the SQLCipher
//! database is open (the whole point of PIN mode is to recover the master
//! without retyping it), so it cannot live inside the vault DB. We keep it
//! on disk as `<vault_dir>/pin.json` — the same directory already holds
//! `db-salt`, so the trust boundary is identical: anyone who can read the
//! vault directory can attempt offline PBKDF2 brute force, and the 600k
//! iteration count is the actual defence (see `crypto/pin.rs`).
//!
//! Writes are atomic via `tmp + rename` so a crash mid-write cannot leave
//! a half-truncated blob that would brick PIN unlock.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::types::PinBlob;

const FILE_NAME: &str = "pin.json";

fn path(vault_dir: &Path) -> PathBuf {
    vault_dir.join(FILE_NAME)
}

/// Returns the PIN blob stored next to the vault DB, or `None` if PIN
/// mode is not enabled for this vault.
pub fn read(vault_dir: &Path) -> AppResult<Option<PinBlob>> {
    let p = path(vault_dir);
    match fs::read(&p) {
        Ok(bytes) => {
            let blob: PinBlob = serde_json::from_slice(&bytes).map_err(|e| {
                AppError::Storage(format!("invalid pin sidecar JSON at {}: {e}", p.display()))
            })?;
            Ok(Some(blob))
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// Writes the PIN blob to the sidecar file, replacing any previous one.
pub fn write(vault_dir: &Path, blob: &PinBlob) -> AppResult<()> {
    fs::create_dir_all(vault_dir)?;
    let final_path = path(vault_dir);
    let tmp_path = final_path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(blob)?;
    {
        let mut f = fs::File::create(&tmp_path)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp_path, &final_path)?;
    Ok(())
}

/// Removes the PIN sidecar. No-op if the file is already absent.
pub fn remove(vault_dir: &Path) -> AppResult<()> {
    let p = path(vault_dir);
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

/// Cheap presence check that the unlock screen can call without parsing
/// the file. Used by `status` so the UI can show the PIN tab while the
/// vault is still locked.
pub fn exists(vault_dir: &Path) -> bool {
    path(vault_dir).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn tmp_dir(label: &str) -> PathBuf {
        let p = env::temp_dir().join(format!(
            "keyfount-pin-sidecar-{label}-{}",
            uuid::Uuid::now_v7().simple()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn sample_blob() -> PinBlob {
        PinBlob {
            ciphertext: "Y2lwaGVydGV4dA==".to_string(),
            iv: "aXZpdml2aXY=".to_string(),
            salt: "c2FsdHNhbHRzYWx0c2E=".to_string(),
            iterations: 600_000,
        }
    }

    #[test]
    fn read_returns_none_when_absent() {
        let dir = tmp_dir("absent");
        assert!(read(&dir).unwrap().is_none());
        assert!(!exists(&dir));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tmp_dir("round-trip");
        let blob = sample_blob();
        write(&dir, &blob).unwrap();
        assert!(exists(&dir));

        let back = read(&dir).unwrap().expect("blob must be present after write");
        assert_eq!(back.ciphertext, blob.ciphertext);
        assert_eq!(back.iv, blob.iv);
        assert_eq!(back.salt, blob.salt);
        assert_eq!(back.iterations, blob.iterations);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_replaces_previous_blob() {
        let dir = tmp_dir("replace");
        let mut blob = sample_blob();
        write(&dir, &blob).unwrap();
        blob.iterations = 1_200_000;
        blob.ciphertext = "bmV3LWNpcGhlcg==".to_string();
        write(&dir, &blob).unwrap();
        let back = read(&dir).unwrap().unwrap();
        assert_eq!(back.iterations, 1_200_000);
        assert_eq!(back.ciphertext, "bmV3LWNpcGhlcg==");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_is_idempotent_when_file_missing() {
        let dir = tmp_dir("remove-missing");
        remove(&dir).unwrap();
        remove(&dir).unwrap();
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_clears_the_sidecar() {
        let dir = tmp_dir("remove");
        write(&dir, &sample_blob()).unwrap();
        assert!(exists(&dir));
        remove(&dir).unwrap();
        assert!(!exists(&dir));
        assert!(read(&dir).unwrap().is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn corrupt_sidecar_surfaces_a_storage_error() {
        let dir = tmp_dir("corrupt");
        fs::write(dir.join(FILE_NAME), b"not-json").unwrap();
        let err = read(&dir).expect_err("garbage payload must error");
        assert!(matches!(err, AppError::Storage(_)));
        fs::remove_dir_all(&dir).ok();
    }

    /// End-to-end round-trip for the issue #25 acceptance criterion:
    /// open an encrypted vault with master M, persist PIN(M), close the
    /// DB, recover M via the PIN, reopen the DB with the recovered M
    /// and prove a row written before the close is still readable.
    #[test]
    fn pin_round_trip_survives_db_close_and_reopen() {
        use crate::crypto;
        use crate::store::{StoreHandle, schema};

        let dir = tmp_dir("pin-round-trip");
        let master = "real-master-passphrase-with-entropy";
        let pin = "13579";

        // 1. Open encrypted DB with the master, write a sentinel row.
        let mut handle = StoreHandle::uninitialised();
        handle.set_active("vault-1".into(), &dir).unwrap();
        handle.open_encrypted(master).unwrap();
        schema::ensure_schema(&handle.require().unwrap().conn).unwrap();
        handle
            .require()
            .unwrap()
            .conn
            .execute(
                "INSERT INTO meta(key, value) VALUES (?1, ?2)",
                rusqlite::params!["pin-test", "before-pin"],
            )
            .unwrap();

        // 2. Persist the PIN sidecar — this is what `set_pin` does.
        let blob = crypto::encrypt_master(master, pin).unwrap();
        write(&dir, &blob).unwrap();
        assert!(exists(&dir));

        // 3. Close the DB connection — simulates the user quitting.
        handle.close();

        // 4. Recover the master from the sidecar + PIN — this is what
        //    `unlock_with_pin` does.
        let on_disk = read(&dir).unwrap().expect("sidecar must persist after close");
        let recovered = crypto::decrypt_master(&on_disk, pin)
            .unwrap()
            .expect("correct PIN must decrypt the master");
        assert_eq!(recovered, master);

        // 5. Reopen the encrypted DB with the recovered master — proves
        //    the page key derivation still works end-to-end.
        let mut handle2 = StoreHandle::uninitialised();
        handle2.set_active("vault-1".into(), &dir).unwrap();
        handle2.open_encrypted(&recovered).unwrap();
        let value: String = handle2
            .require()
            .unwrap()
            .conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'pin-test'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(value, "before-pin");

        // Wrong PIN must not decrypt, and must not surface the master.
        let wrong = crypto::decrypt_master(&on_disk, "98765").unwrap();
        assert!(wrong.is_none(), "wrong PIN must return None, got {wrong:?}");

        fs::remove_dir_all(&dir).ok();
    }
}
