// See note in `crate::crypto::pin` — temporary shim until aes-gcm 0.11.
#![allow(deprecated)]

//! Payload envelope used to push and pull account-index entries.
//!
//! Account names and per-site profiles are encrypted under a key derived
//! from the OPAQUE `export_key` via HKDF-SHA256 before they leave the
//! device, so the server only sees opaque ciphertexts.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

use crate::error::{AppError, AppResult};

const KEY_LEN: usize = 32;
const IV_LEN: usize = 12;

/// Derive a 32-byte AES-GCM key from the OPAQUE export key using a
/// stable HKDF salt and `info` string. The `info` argument provides
/// domain separation so the same export key can produce many
/// independent sub-keys (payload, audit log, lookup index, …).
pub fn derive_payload_key(export_key: &[u8], info: &[u8]) -> [u8; KEY_LEN] {
    let hk = Hkdf::<Sha256>::new(Some(b"keyfount:sync:v1"), export_key);
    let mut out = [0u8; KEY_LEN];
    hk.expand(info, &mut out)
        .expect("HKDF output length is constant");
    out
}

#[derive(Debug, Clone)]
pub struct EncryptedPayload {
    /// AES-GCM ciphertext, base64.
    pub ciphertext: String,
    /// IV, base64.
    pub iv: String,
}

pub fn encrypt(key: &[u8], plaintext: &[u8]) -> AppResult<EncryptedPayload> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Crypto(format!("aes-gcm key: {e}")))?;
    let mut iv = [0u8; IV_LEN];
    rand::thread_rng().fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Crypto(format!("aes-gcm encrypt: {e}")))?;
    Ok(EncryptedPayload {
        ciphertext: BASE64.encode(ct),
        iv: BASE64.encode(iv),
    })
}

pub fn decrypt(key: &[u8], payload: &EncryptedPayload) -> AppResult<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Crypto(format!("aes-gcm key: {e}")))?;
    let iv = BASE64
        .decode(&payload.iv)
        .map_err(|e| AppError::Storage(format!("invalid payload iv: {e}")))?;
    let ct = BASE64
        .decode(&payload.ciphertext)
        .map_err(|e| AppError::Storage(format!("invalid payload ciphertext: {e}")))?;
    let nonce = Nonce::from_slice(&iv);
    cipher
        .decrypt(nonce, ct.as_slice())
        .map_err(|e| AppError::Crypto(format!("aes-gcm decrypt: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_encrypts_and_decrypts() {
        let export_key = [42u8; 32];
        let key = derive_payload_key(&export_key, b"payload");
        let payload = encrypt(&key, b"hello world").unwrap();
        let plain = decrypt(&key, &payload).unwrap();
        assert_eq!(plain, b"hello world");
    }

    #[test]
    fn different_info_yields_different_key() {
        let export_key = [42u8; 32];
        let a = derive_payload_key(&export_key, b"a");
        let b = derive_payload_key(&export_key, b"b");
        assert_ne!(a, b);
    }
}
