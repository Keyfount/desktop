//! Sync commands — session storage backed by the OS keychain.
//!
//! The full OPAQUE handshake runs in the frontend with
//! `@cloudflare/opaque-ts`, identical to what the browser extension
//! does. That keeps the wire format bit-compatible with the existing
//! Keyfount server (which uses the same library) and means we only
//! need a tiny native surface here: a probe for the `/health` endpoint
//! plus the three keychain primitives below.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::sync::client::SyncClient;

const KEYCHAIN_SERVICE: &str = "io.keyfount.desktop.sync";

#[derive(Debug, Serialize)]
pub struct SyncStatusResponse {
    pub connected: bool,
    pub session: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn sync_status(_state: State<'_, AppState>) -> AppResult<SyncStatusResponse> {
    match load_session_from_keychain() {
        Ok(Some(session)) => Ok(SyncStatusResponse {
            connected: true,
            session: Some(session),
        }),
        _ => Ok(SyncStatusResponse {
            connected: false,
            session: None,
        }),
    }
}

#[derive(Debug, Serialize)]
pub struct SyncTestConnectionResponse {
    pub reachable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn sync_test_connection(base_url: String) -> AppResult<SyncTestConnectionResponse> {
    match SyncClient::new(&base_url) {
        Err(e) => Ok(SyncTestConnectionResponse {
            reachable: false,
            reason: Some(e.to_string()),
        }),
        Ok(client) => match client.probe() {
            Ok(true) => Ok(SyncTestConnectionResponse {
                reachable: true,
                reason: None,
            }),
            Ok(false) => Ok(SyncTestConnectionResponse {
                reachable: false,
                reason: Some("server did not return 200 on /health".into()),
            }),
            Err(reason) => Ok(SyncTestConnectionResponse {
                reachable: false,
                reason: Some(reason),
            }),
        },
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredSyncSession {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub email: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "saltSync")]
    pub salt_sync: String,
    #[serde(rename = "devicePubkey")]
    pub device_pubkey: String,
    #[serde(rename = "devicePrivkey")]
    pub device_privkey: String,
    #[serde(rename = "ekFingerprint")]
    pub ek_fingerprint: String,
    pub status: String,
    #[serde(rename = "sessionToken", skip_serializing_if = "Option::is_none")]
    pub session_token: Option<String>,
    #[serde(rename = "expiresAt", skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

/// Persist the sync session to the OS keychain. The session contains a
/// bearer token + per-device private key, so plaintext disk storage is
/// off the table.
#[tauri::command]
pub async fn sync_session_save(session: serde_json::Value) -> AppResult<()> {
    let json = serde_json::to_string(&session)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, "active")
        .map_err(|e| AppError::Storage(format!("keyring: {e}")))?;
    entry
        .set_password(&json)
        .map_err(|e| AppError::Storage(format!("keyring write: {e}")))?;
    Ok(())
}

/// Load the sync session from the OS keychain. Returns `null` when no
/// session is configured.
#[tauri::command]
pub async fn sync_session_load() -> AppResult<Option<serde_json::Value>> {
    load_session_from_keychain()
}

/// Forget the persisted sync session.
#[tauri::command]
pub async fn sync_session_clear() -> AppResult<()> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, "active")
        .map_err(|e| AppError::Storage(format!("keyring: {e}")))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Storage(format!("keyring delete: {e}"))),
    }
}

fn load_session_from_keychain() -> AppResult<Option<serde_json::Value>> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, "active")
        .map_err(|e| AppError::Storage(format!("keyring: {e}")))?;
    match entry.get_password() {
        Ok(json) => {
            let value: serde_json::Value = serde_json::from_str(&json)?;
            Ok(Some(value))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Storage(format!("keyring read: {e}"))),
    }
}
