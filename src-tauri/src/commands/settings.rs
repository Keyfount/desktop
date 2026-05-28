//! Settings commands: read, update, PIN management, wipe.

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::crypto;
use crate::error::{AppError, AppResult};
use crate::store::{StoredState, pin_sidecar, settings as settings_store};
use crate::types::Profile;

#[derive(Debug, Serialize)]
pub struct GetStateResponse {
    #[serde(rename = "defaultProfile")]
    pub default_profile: Profile,
    #[serde(rename = "autoLockMinutes")]
    pub auto_lock_minutes: u32,
    #[serde(rename = "hasPin")]
    pub has_pin: bool,
    #[serde(rename = "historyEnabled")]
    pub history_enabled: bool,
    #[serde(rename = "faviconFallbackEnabled")]
    pub favicon_fallback_enabled: bool,
    #[serde(rename = "clipboardClearSeconds")]
    pub clipboard_clear_seconds: u32,
    pub sites: std::collections::BTreeMap<String, Profile>,
}

#[tauri::command]
pub async fn get_state(state: State<'_, AppState>) -> AppResult<GetStateResponse> {
    let store = state.store.lock().await;
    let st = match store.require() {
        Ok(open) => settings_store::load(&open.conn)?,
        Err(_) => StoredState::default(),
    };
    let has_pin = store
        .active_dir()
        .map(|dir| pin_sidecar::exists(&dir))
        .unwrap_or(false);
    Ok(GetStateResponse {
        default_profile: st.default_profile,
        auto_lock_minutes: st.auto_lock_minutes,
        has_pin,
        history_enabled: st.history_enabled,
        favicon_fallback_enabled: st.favicon_fallback_enabled,
        clipboard_clear_seconds: st.clipboard_clear_seconds,
        sites: st.sites,
    })
}

#[tauri::command]
pub async fn set_auto_lock_minutes(minutes: u32, state: State<'_, AppState>) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let mut st = settings_store::load(&open.conn)?;
    st.auto_lock_minutes = minutes.clamp(0, 240);
    settings_store::save_defaults(&open.conn, &st)
}

#[tauri::command]
pub async fn set_history_enabled(enabled: bool, state: State<'_, AppState>) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let mut st = settings_store::load(&open.conn)?;
    st.history_enabled = enabled;
    settings_store::save_defaults(&open.conn, &st)
}

#[tauri::command]
pub async fn set_favicon_fallback_enabled(
    enabled: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let mut st = settings_store::load(&open.conn)?;
    st.favicon_fallback_enabled = enabled;
    settings_store::save_defaults(&open.conn, &st)
}

#[tauri::command]
pub async fn set_clipboard_clear_seconds(
    seconds: u32,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let mut st = settings_store::load(&open.conn)?;
    st.clipboard_clear_seconds = seconds.clamp(0, 600);
    settings_store::save_defaults(&open.conn, &st)
}

#[tauri::command]
pub async fn set_pin(pin: String, state: State<'_, AppState>) -> AppResult<()> {
    // Encrypt while we hold the session lock so the unlocked master cannot
    // disappear between the read and the wrap, then drop it before touching
    // the store lock.
    let blob = {
        let session = state.session.lock().await;
        let Some(master) = session.master() else {
            return Err(AppError::Locked);
        };
        crypto::encrypt_master(master, &pin)?
    };
    let store = state.store.lock().await;
    let dir = store.active_dir().ok_or(AppError::NoActiveVault)?;
    pin_sidecar::write(&dir, &blob)
}

#[tauri::command]
pub async fn remove_pin(state: State<'_, AppState>) -> AppResult<()> {
    let store = state.store.lock().await;
    let dir = store.active_dir().ok_or(AppError::NoActiveVault)?;
    pin_sidecar::remove(&dir)
}

#[tauri::command]
pub async fn wipe(state: State<'_, AppState>) -> AppResult<()> {
    let mut session = state.session.lock().await;
    session.lock();
    let mut store = state.store.lock().await;
    // Wipe should work whether the vault is currently open or just
    // registered-but-locked. Pull the identity from whichever state
    // we're in, then nuke the whole vault directory (DB + WAL/SHM +
    // db-salt sidecar + sync-session file) in one go.
    let vault_id = store.active_id().map(str::to_string);
    let dir = store.active_dir();
    store.clear();
    if let (Some(vault_id), Some(dir)) = (vault_id, dir) {
        let _ = std::fs::remove_dir_all(&dir);
        let mut registry =
            crate::store::vaults::VaultRegistry::load(crate::store::vaults::registry_path())?;
        registry.remove(&vault_id);
        registry.save(crate::store::vaults::registry_path())?;
    }
    Ok(())
}
