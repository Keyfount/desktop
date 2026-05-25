// See note in `crate::crypto::pin` — temporary shim until aes-gcm 0.11.
#![allow(deprecated)]

//! Encrypted local export / import of the active vault.
//!
//! Format: `.keyfountvault` — a JSON envelope with the SQLite contents
//! serialised and encrypted with AES-GCM using a key derived (via PBKDF2)
//! from a user-chosen passphrase. The passphrase is *not* the master
//! password; it is a separate per-export secret.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::store::{accounts as accounts_store, settings as settings_store, sites as sites_store};

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportEnvelope {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    pub salt: String,
    pub iv: String,
    pub iterations: u32,
    pub ciphertext: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ExportPayload {
    settings: crate::store::StoredState,
    accounts: Vec<crate::types::AccountEntry>,
}

#[derive(Debug, Serialize)]
pub struct ExportResponse {
    pub envelope: String,
}

#[tauri::command]
pub async fn export_vault(
    passphrase: String,
    state: State<'_, AppState>,
) -> AppResult<ExportResponse> {
    if passphrase.len() < 12 {
        return Err(AppError::invalid(
            "export passphrase must be at least 12 characters",
        ));
    }
    let store = state.store.lock().await;
    let open = store.require()?;
    let mut settings = settings_store::load(&open.conn)?;
    settings.pin = None; // never include the PIN blob in a portable export
    let payload = ExportPayload {
        settings,
        accounts: accounts_store::list(&open.conn)?,
    };
    let plaintext = serde_json::to_vec(&payload)?;

    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};
    use pbkdf2::pbkdf2_hmac;
    use rand::RngCore;
    use sha2::Sha256;

    const SALT_LEN: usize = 16;
    const IV_LEN: usize = 12;
    const ITERATIONS: u32 = 600_000;

    let mut salt = [0u8; SALT_LEN];
    let mut iv = [0u8; IV_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut iv);

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), &salt, ITERATIONS, &mut key);

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(format!("aes-gcm key: {e}")))?;
    let nonce = Nonce::from_slice(&iv);
    let ct = cipher
        .encrypt(nonce, plaintext.as_slice())
        .map_err(|e| AppError::Crypto(format!("aes-gcm encrypt: {e}")))?;

    let envelope = ExportEnvelope {
        schema_version: 1,
        salt: BASE64.encode(salt),
        iv: BASE64.encode(iv),
        iterations: ITERATIONS,
        ciphertext: BASE64.encode(ct),
    };
    Ok(ExportResponse {
        envelope: serde_json::to_string(&envelope)?,
    })
}

#[derive(Debug, Serialize)]
pub struct ImportResponse {
    #[serde(rename = "accountsImported")]
    pub accounts_imported: u32,
    #[serde(rename = "sitesImported")]
    pub sites_imported: u32,
}

#[tauri::command]
pub async fn import_vault(
    envelope_json: String,
    passphrase: String,
    state: State<'_, AppState>,
) -> AppResult<ImportResponse> {
    let envelope: ExportEnvelope = serde_json::from_str(&envelope_json)?;
    if envelope.schema_version != 1 {
        return Err(AppError::invalid(format!(
            "unsupported export schema version {}",
            envelope.schema_version
        )));
    }

    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};
    use pbkdf2::pbkdf2_hmac;
    use sha2::Sha256;

    let salt = BASE64
        .decode(&envelope.salt)
        .map_err(|e| AppError::Storage(format!("invalid export salt: {e}")))?;
    let iv = BASE64
        .decode(&envelope.iv)
        .map_err(|e| AppError::Storage(format!("invalid export iv: {e}")))?;
    let ct = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|e| AppError::Storage(format!("invalid export ciphertext: {e}")))?;

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), &salt, envelope.iterations, &mut key);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(format!("aes-gcm key: {e}")))?;
    let nonce = Nonce::from_slice(&iv);
    let plain = cipher
        .decrypt(nonce, ct.as_slice())
        .map_err(|_| AppError::invalid("invalid passphrase or corrupted export"))?;

    let payload: ExportPayload = serde_json::from_slice(&plain)?;

    let store = state.store.lock().await;
    let open = store.require()?;
    settings_store::save_defaults(&open.conn, &payload.settings)?;
    let now = crate::store::vaults::now_ms();
    let mut sites_imported = 0;
    for (domain, profile) in payload.settings.sites.iter() {
        sites_store::upsert(&open.conn, domain, profile, now)?;
        sites_imported += 1;
    }
    let mut accounts_imported = 0;
    for entry in payload.accounts.iter() {
        accounts_store::record(&open.conn, entry)?;
        accounts_imported += 1;
    }
    Ok(ImportResponse {
        accounts_imported,
        sites_imported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Profile;

    #[test]
    fn export_payload_serdes_round_trip() {
        let p = ExportPayload {
            settings: crate::store::StoredState::default(),
            accounts: vec![],
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: ExportPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.accounts.len(), 0);
        assert!(matches!(back.settings.default_profile, Profile::Random(_)));
    }
}
