//! Sync client — Rust port of `extension/src/shared/sync/`.
//!
//! Wraps the OPAQUE-based authentication exchange and the AES-GCM payload
//! protection used to push and pull the account index against a
//! self-hostable Keyfount server. The complete protocol is fleshed out in
//! M6; this module currently exposes the data shapes consumed by the IPC
//! layer so the command surface stays stable across milestones.

pub mod client;
pub mod payload;
pub mod session;

pub use client::SyncClient;
pub use session::{ApprovalStatus, SyncSession, SyncSessionView};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SyncDirection {
    Push,
    Pull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStamp {
    pub ts: i64,
    #[serde(skip_serializing_if = "Option::is_none", rename = "dir")]
    pub direction: Option<SyncDirection>,
}
