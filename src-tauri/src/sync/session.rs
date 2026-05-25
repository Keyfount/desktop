//! Sync session — a `(server, account, device)` triple negotiated via
//! OPAQUE. The session's `export_key` is sealed in the OS keychain; this
//! struct only carries non-secret metadata that the IPC layer is allowed
//! to expose to the UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
}

/// Public view of the session safe to expose to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSessionView {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub email: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "approvalStatus")]
    pub approval_status: ApprovalStatus,
    #[serde(rename = "connectedAt")]
    pub connected_at: i64,
    #[serde(rename = "lastSyncAt")]
    pub last_sync_at: Option<i64>,
}

/// Full session, including secrets — never serialised to the IPC layer.
#[derive(Debug, Clone)]
pub struct SyncSession {
    pub view: SyncSessionView,
    /// OPAQUE export_key — sealed in the keychain by the time it leaves
    /// memory, never written to disk in cleartext.
    pub export_key: zeroize::Zeroizing<Vec<u8>>,
}
