//! Local persistent storage for the active vault.
//!
//! Each vault gets its own SQLite database under the OS app-data directory.
//! The schema and migrations are defined in `schema.rs`; CRUD helpers per
//! domain live next to their respective concerns (settings, sites,
//! accounts).

pub mod accounts;
pub mod handle;
pub mod schema;
pub mod settings;
pub mod sites;
pub mod vaults;

pub use handle::StoreHandle;

use serde::{Deserialize, Serialize};

use crate::types::{PinBlob, Profile};

pub const SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_CLIPBOARD_CLEAR_SECONDS: u32 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredState {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "defaultProfile")]
    pub default_profile: Profile,
    #[serde(rename = "autoLockMinutes")]
    pub auto_lock_minutes: u32,
    #[serde(rename = "historyEnabled")]
    pub history_enabled: bool,
    #[serde(rename = "faviconFallbackEnabled")]
    pub favicon_fallback_enabled: bool,
    #[serde(rename = "clipboardClearSeconds")]
    pub clipboard_clear_seconds: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin: Option<PinBlob>,
    pub sites: std::collections::BTreeMap<String, Profile>,
}

impl Default for StoredState {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            default_profile: Profile::default_random(),
            auto_lock_minutes: 15,
            history_enabled: false,
            favicon_fallback_enabled: true,
            clipboard_clear_seconds: DEFAULT_CLIPBOARD_CLEAR_SECONDS,
            fingerprint: None,
            pin: None,
            sites: std::collections::BTreeMap::new(),
        }
    }
}
