// `Nonce::from_slice` is marked as deprecated in aes-gcm 0.10 in favour of
// generic-array 1.x APIs, but the released aes-gcm 0.10 still ships
// generic-array 0.14 so the new API is not actually available yet. The
// `#[allow(deprecated)]` is a temporary shim until aes-gcm 0.11 ships.
#![allow(deprecated)]

//! PIN-protected at-rest storage of the master password.
//!
//! Opt-in only — when the user activates PIN mode, the master is encrypted
//! with AES-GCM using a key derived from the PIN via PBKDF2-SHA256
//! (600 000 iterations, OWASP 2023). The ciphertext, IV and salt are then
//! stored in the OS keychain (preferred) or, on platforms without keychain
//! support, in the SQLite metadata table.
//!
//! The PIN itself is *low-entropy* (4 to 6 digits) so the threshold of
//! defence is the PBKDF2 work factor.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

use crate::error::{AppError, AppResult};
use crate::types::PinBlob;

pub const PIN_PBKDF2_ITERATIONS: u32 = 600_000;
const KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const IV_LEN: usize = 12;

/// Encrypt the master with a key derived from the PIN.
pub fn encrypt_master(master: &str, pin: &str) -> AppResult<PinBlob> {
    assert_pin(pin)?;
    let mut salt = [0u8; SALT_LEN];
    let mut iv = [0u8; IV_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut iv);

    let key = derive_key(pin, &salt, PIN_PBKDF2_ITERATIONS);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(format!("aes-gcm key: {e}")))?;
    let nonce = Nonce::from_slice(&iv);
    let ciphertext = cipher
        .encrypt(nonce, master.as_bytes())
        .map_err(|e| AppError::Crypto(format!("aes-gcm encrypt: {e}")))?;

    Ok(PinBlob {
        ciphertext: BASE64.encode(&ciphertext),
        iv: BASE64.encode(iv),
        salt: BASE64.encode(salt),
        iterations: PIN_PBKDF2_ITERATIONS,
    })
}

/// Decrypt the master using a candidate PIN. Returns `Ok(None)` when the
/// PIN is wrong (AES-GCM tag mismatch) — never returns the actual cause
/// to avoid leaking timing or content information.
pub fn decrypt_master(blob: &PinBlob, pin: &str) -> AppResult<Option<String>> {
    assert_pin(pin)?;
    let salt = BASE64
        .decode(&blob.salt)
        .map_err(|e| AppError::Storage(format!("invalid PIN salt: {e}")))?;
    let iv = BASE64
        .decode(&blob.iv)
        .map_err(|e| AppError::Storage(format!("invalid PIN iv: {e}")))?;
    let ciphertext = BASE64
        .decode(&blob.ciphertext)
        .map_err(|e| AppError::Storage(format!("invalid PIN ciphertext: {e}")))?;

    let key = derive_key(pin, &salt, blob.iterations);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(format!("aes-gcm key: {e}")))?;
    let nonce = Nonce::from_slice(&iv);
    match cipher.decrypt(nonce, ciphertext.as_slice()) {
        Ok(plain) => {
            let s = String::from_utf8(plain)
                .map_err(|e| AppError::Crypto(format!("decrypted master is not utf-8: {e}")))?;
            Ok(Some(s))
        }
        Err(_) => Ok(None),
    }
}

fn assert_pin(pin: &str) -> AppResult<()> {
    if pin.is_empty() || pin.len() < 4 || pin.len() > 6 {
        return Err(AppError::invalid("PIN must be 4 to 6 digits"));
    }
    if !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::invalid("PIN must be 4 to 6 digits"));
    }
    Ok(())
}

fn derive_key(secret: &str, salt: &[u8], iterations: u32) -> [u8; KEY_LEN] {
    let mut out = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(secret.as_bytes(), salt, iterations, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_then_decrypt_round_trips() {
        let master = "correct horse battery staple";
        let pin = "0420";
        let blob = encrypt_master(master, pin).unwrap();
        let back = decrypt_master(&blob, pin).unwrap();
        assert_eq!(back.as_deref(), Some(master));
    }

    #[test]
    fn wrong_pin_returns_none() {
        let master = "correct horse battery staple";
        let blob = encrypt_master(master, "0420").unwrap();
        let back = decrypt_master(&blob, "9999").unwrap();
        assert_eq!(back, None);
    }

    #[test]
    fn rejects_short_pin() {
        assert!(encrypt_master("m", "12").is_err());
    }

    #[test]
    fn rejects_long_pin() {
        assert!(encrypt_master("m", "1234567").is_err());
    }

    #[test]
    fn rejects_non_digit_pin() {
        assert!(encrypt_master("m", "12ab").is_err());
    }

    #[test]
    fn blob_iterations_match_default() {
        let blob = encrypt_master("m", "1234").unwrap();
        assert_eq!(blob.iterations, PIN_PBKDF2_ITERATIONS);
    }
}
