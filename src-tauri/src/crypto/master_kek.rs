// `Nonce::from_slice` is marked as deprecated in aes-gcm 0.10 in favour of
// generic-array 1.x APIs, but the released aes-gcm 0.10 still ships
// generic-array 0.14 so the new API is not actually available yet.
#![allow(deprecated)]

//! Master-derived KEK for encrypting at-rest blobs that the app needs
//! to read back after the user has unlocked the vault.
//!
//! Use cases (today: the sync session file; tomorrow: anything else
//! we don't want sitting on disk in cleartext). The key is derived
//! from the in-memory master via Argon2id with a per-blob random
//! salt — slow on purpose, so even with the encrypted file in hand
//! an attacker can't brute-force the master at speed.
//!
//! All cipher state (salt, nonce, ciphertext) is in the same JSON
//! envelope so the on-disk format is self-describing.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

// Argon2id params — same costs we use everywhere else (~200 ms on a
// modern laptop, 64 MiB working memory). Comfortable safety margin
// while still feeling instant in the UI.
const ARGON2_MEM_KIB: u32 = 65536;
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;

/// Self-describing envelope written on disk. `v` lets us migrate the
/// format if we change KDF params or cipher later.
#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptedBlob {
    pub v: u32,
    pub salt: Vec<u8>,
    pub nonce: Vec<u8>,
    pub ct: Vec<u8>,
}

/// Encrypt `plaintext` under a key derived from `master`. Generates a
/// fresh salt + nonce on every call so the same plaintext never
/// produces the same ciphertext (and tag/IV reuse with AES-GCM is
/// catastrophic).
pub fn encrypt_with_master(master: &str, plaintext: &[u8]) -> AppResult<EncryptedBlob> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key = derive_key(master, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(format!("aes-gcm key: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Crypto(format!("aes-gcm encrypt: {e}")))?;

    Ok(EncryptedBlob {
        v: 1,
        salt: salt.to_vec(),
        nonce: nonce_bytes.to_vec(),
        ct,
    })
}

/// Decrypt a blob with the user's master. Wrong master surfaces as
/// `AppError::Crypto` (AES-GCM tag mismatch) — never panics, never
/// leaks which step failed.
pub fn decrypt_with_master(master: &str, blob: &EncryptedBlob) -> AppResult<Vec<u8>> {
    if blob.v != 1 {
        return Err(AppError::Storage(format!(
            "unsupported encrypted-blob version: {}",
            blob.v
        )));
    }
    if blob.salt.len() != SALT_LEN || blob.nonce.len() != NONCE_LEN {
        return Err(AppError::Storage("malformed encrypted-blob header".into()));
    }
    let key = derive_key(master, &blob.salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(format!("aes-gcm key: {e}")))?;
    let nonce = Nonce::from_slice(&blob.nonce);
    cipher
        .decrypt(nonce, blob.ct.as_slice())
        .map_err(|e| AppError::Crypto(format!("aes-gcm decrypt: {e}")))
}

fn derive_key(master: &str, salt: &[u8]) -> AppResult<[u8; KEY_LEN]> {
    let params = Params::new(ARGON2_MEM_KIB, ARGON2_TIME_COST, ARGON2_PARALLELISM, None)
        .map_err(|e| AppError::Crypto(format!("argon2 params: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; KEY_LEN];
    argon
        .hash_password_into(master.as_bytes(), salt, &mut out)
        .map_err(|e| AppError::Crypto(format!("argon2 derive: {e}")))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let plain = b"the bearer token nobody else should ever see";
        let blob = encrypt_with_master("hunter2hunter2", plain).unwrap();
        let back = decrypt_with_master("hunter2hunter2", &blob).unwrap();
        assert_eq!(back, plain);
    }

    #[test]
    fn wrong_master_fails() {
        let blob = encrypt_with_master("real-master-pw", b"secret").unwrap();
        let res = decrypt_with_master("wrong-master-pw", &blob);
        assert!(res.is_err());
    }

    #[test]
    fn fresh_salt_and_nonce_each_call() {
        let a = encrypt_with_master("hunter2hunter2", b"same plaintext").unwrap();
        let b = encrypt_with_master("hunter2hunter2", b"same plaintext").unwrap();
        assert_ne!(a.salt, b.salt);
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ct, b.ct);
    }

    #[test]
    fn rejects_future_version() {
        let blob = EncryptedBlob {
            v: 99,
            salt: vec![0; SALT_LEN],
            nonce: vec![0; NONCE_LEN],
            ct: vec![1, 2, 3],
        };
        assert!(decrypt_with_master("m", &blob).is_err());
    }
}
