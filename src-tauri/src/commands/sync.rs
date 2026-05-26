//! Sync commands — session storage on disk under the vault dir.
//!
//! The full OPAQUE handshake runs in the frontend with
//! `@cloudflare/opaque-ts`, identical to what the browser extension
//! does. That keeps the wire format bit-compatible with the existing
//! Keyfount server (which uses the same library) and means we only
//! need a small native surface here: a probe for the `/health`
//! endpoint, an HTTP proxy (see `sync_http`), and the three session
//! primitives below.
//!
//! Why a file instead of the OS Keychain? `keyring` on macOS binds
//! the item ACL to the calling binary's code signature. Unsigned
//! builds (our case until we have an Apple Developer ID) can write
//! the item but later reads after a relaunch fail with `errSecAuth`
//! — silently in the keyring crate — so the sync session "disappears"
//! across restarts even though it's technically still in the
//! Keychain. Storing in the vault directory with `0600` permissions
//! is reliable, survives reinstalls, and the SecAttr* protection is
//! the OS user account anyway (same protection class as a Keychain
//! item gated by user login).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;
use crate::error::{AppError, AppResult};
use crate::store::vaults as vault_store;
use crate::sync::client::SyncClient;

#[derive(Debug, Serialize)]
pub struct SyncStatusResponse {
    pub connected: bool,
    pub session: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> AppResult<SyncStatusResponse> {
    let vault_id = active_vault_id(&state).await?;
    match load_session_from_disk(&vault_id) {
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

async fn active_vault_id(state: &State<'_, AppState>) -> AppResult<String> {
    let store = state.store.lock().await;
    let open = store.require()?;
    Ok(open.vault_id.clone())
}

fn session_path(vault_id: &str) -> PathBuf {
    vault_store::vault_dir(vault_id).join("sync-session.json")
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

/// Persist the sync session to the per-vault directory. File mode is
/// set to `0600` so other users on the same machine cannot read it.
#[tauri::command]
pub async fn sync_session_save(
    session: serde_json::Value,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let vault_id = active_vault_id(&state).await?;
    let path = session_path(&vault_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string(&session)?;
    fs::write(&path, json)?;
    restrict_to_owner(&path);
    Ok(())
}

/// Load the sync session for the active vault. Returns `null` when no
/// session has been saved yet.
#[tauri::command]
pub async fn sync_session_load(state: State<'_, AppState>) -> AppResult<Option<serde_json::Value>> {
    let vault_id = active_vault_id(&state).await?;
    load_session_from_disk(&vault_id)
}

/// Forget the persisted sync session for the active vault.
#[tauri::command]
pub async fn sync_session_clear(state: State<'_, AppState>) -> AppResult<()> {
    let vault_id = active_vault_id(&state).await?;
    let path = session_path(&vault_id);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn load_session_from_disk(vault_id: &str) -> AppResult<Option<serde_json::Value>> {
    let path = session_path(vault_id);
    match fs::read_to_string(&path) {
        Ok(json) => {
            let value: serde_json::Value = serde_json::from_str(&json)?;
            Ok(Some(value))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Storage(format!("session read: {e}"))),
    }
}

#[cfg(unix)]
fn restrict_to_owner(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        perms.set_mode(0o600);
        let _ = fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn restrict_to_owner(_path: &std::path::Path) {
    // Windows already inherits owner-only ACLs from the parent dir
    // (Application Data is per-user). No additional hardening needed.
}

#[derive(Debug, Deserialize)]
pub struct SyncHttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncHttpResponse {
    pub status: u16,
    pub body: String,
}

/// HTTP proxy for the sync server. The WebKit `fetch` API does a CORS
/// preflight for cross-origin POSTs (the webview's origin is
/// `tauri://localhost`, the sync server is `http://localhost:8088`),
/// and Keyfount servers only enable CORS when `CORS_ORIGINS` is set —
/// otherwise the OPTIONS 404s and the POST is blocked with "Load
/// failed". Routing through Rust skips the preflight entirely: `ureq`
/// is a vanilla HTTP client, no Origin headers, no CORS contract.
#[tauri::command]
pub async fn sync_http(req: SyncHttpRequest) -> AppResult<SyncHttpResponse> {
    tauri::async_runtime::spawn_blocking(move || perform_http(req))
        .await
        .map_err(|e| AppError::internal(format!("sync_http join: {e}")))?
}

fn perform_http(req: SyncHttpRequest) -> AppResult<SyncHttpResponse> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(5))
        .timeout_read(std::time::Duration::from_secs(30))
        .timeout_write(std::time::Duration::from_secs(30))
        .user_agent(concat!("keyfount-desktop/", env!("CARGO_PKG_VERSION")))
        .build();

    let mut builder = match req.method.to_ascii_uppercase().as_str() {
        "GET" => agent.get(&req.url),
        "POST" => agent.post(&req.url),
        "PUT" => agent.put(&req.url),
        "DELETE" => agent.delete(&req.url),
        "PATCH" => agent.request("PATCH", &req.url),
        other => {
            return Err(AppError::invalid(format!(
                "unsupported HTTP method: {other}"
            )));
        }
    };
    for (k, v) in &req.headers {
        builder = builder.set(k, v);
    }

    let result = if let Some(body) = req.body.as_deref() {
        builder.send_string(body)
    } else {
        builder.call()
    };

    // ureq treats non-2xx as `Status` errors; we want to surface them
    // to the JS layer just like a real response so the existing
    // `SyncApiError` flow on the frontend keeps working.
    match result {
        Ok(resp) => {
            let status = resp.status();
            let body = resp
                .into_string()
                .map_err(|e| AppError::Network(format!("read body: {e}")))?;
            Ok(SyncHttpResponse { status, body })
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            Ok(SyncHttpResponse { status: code, body })
        }
        Err(ureq::Error::Transport(t)) => Err(AppError::Network(t.to_string())),
    }
}
