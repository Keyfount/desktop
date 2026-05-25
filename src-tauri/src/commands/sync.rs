//! Sync commands — the surface mirrors the extension's IPC contract.
//!
//! The full OPAQUE flow is implemented in M6. The current placeholders
//! return well-typed "not connected" payloads so the UI can render its
//! settings page even before the wire protocol is online.

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::sync::SyncSessionView;
use crate::sync::client::SyncClient;

#[derive(Debug, Serialize)]
pub struct SyncStatusResponse {
    pub connected: bool,
    pub session: Option<SyncSessionView>,
}

#[tauri::command]
pub async fn sync_status(_state: State<'_, AppState>) -> AppResult<SyncStatusResponse> {
    Ok(SyncStatusResponse {
        connected: false,
        session: None,
    })
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

#[derive(Debug, Serialize)]
pub struct SyncConnectResponse {
    pub session: SyncSessionView,
    #[serde(rename = "loggedIn")]
    pub logged_in: bool,
}

#[tauri::command]
pub async fn sync_connect(
    _base_url: String,
    _email: String,
    _device_label: Option<String>,
) -> AppResult<SyncConnectResponse> {
    Err(crate::error::AppError::Unsupported)
}

#[derive(Debug, Serialize)]
#[serde(tag = "status")]
pub enum SyncPollApprovalResponse {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "approved")]
    Approved { session: SyncSessionView },
    #[serde(rename = "rejected")]
    Rejected {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    #[serde(rename = "no_session")]
    NoSession,
}

#[tauri::command]
pub async fn sync_poll_approval() -> AppResult<SyncPollApprovalResponse> {
    Ok(SyncPollApprovalResponse::NoSession)
}

#[tauri::command]
pub async fn sync_disconnect() -> AppResult<()> {
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct SyncPullResponse {
    pub applied: Option<u32>,
    pub skipped: Option<u32>,
    pub cursor: Option<i64>,
}

#[tauri::command]
pub async fn sync_pull() -> AppResult<SyncPullResponse> {
    Ok(SyncPullResponse {
        applied: None,
        skipped: None,
        cursor: None,
    })
}

#[derive(Debug, Serialize)]
pub struct SyncPushAllResponse {
    pub pushed: Option<u32>,
    pub failed: Option<u32>,
}

#[tauri::command]
pub async fn sync_push_all() -> AppResult<SyncPushAllResponse> {
    Ok(SyncPushAllResponse {
        pushed: None,
        failed: None,
    })
}

#[derive(Debug, Serialize)]
pub struct GetAccountSyncInfoResponse {
    #[serde(rename = "lastSyncedAt")]
    pub last_synced_at: Option<crate::sync::SyncStamp>,
}

#[tauri::command]
pub async fn get_account_sync_info(
    _domain: String,
    _username: String,
) -> AppResult<GetAccountSyncInfoResponse> {
    Ok(GetAccountSyncInfoResponse {
        last_synced_at: None,
    })
}

#[derive(Debug, Serialize)]
pub struct GetSyncMapResponse {
    pub map: std::collections::HashMap<String, crate::sync::SyncStamp>,
}

#[tauri::command]
pub async fn get_sync_map() -> AppResult<GetSyncMapResponse> {
    Ok(GetSyncMapResponse {
        map: Default::default(),
    })
}
