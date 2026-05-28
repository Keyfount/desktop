//! Local persistent storage for the active vault.
//!
//! Each vault gets its own SQLite database under the OS app-data directory.
//! The schema and migrations are defined in `schema.rs`; CRUD helpers per
//! domain live next to their respective concerns (settings, sites,
//! accounts).

pub mod accounts;
pub mod db_key;
pub mod handle;
pub mod pending_ops;
pub mod pin_sidecar;
pub mod schema;
pub mod settings;
pub mod sites;
pub mod vaults;

pub use handle::StoreHandle;

use serde::{Deserialize, Serialize};

use crate::types::Profile;

pub const SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_CLIPBOARD_CLEAR_SECONDS: u32 = 30;

// `pin` intentionally omitted: the PIN blob lives in a sidecar file
// (`store::pin_sidecar`) because it must be readable BEFORE the encrypted
// vault DB can be opened. Anything that needs to know whether PIN mode is
// enabled goes through `pin_sidecar::exists`/`pin_sidecar::read`.
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
            sites: std::collections::BTreeMap::new(),
        }
    }
}
