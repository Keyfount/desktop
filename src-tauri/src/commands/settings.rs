//! Settings commands: read, update, PIN management, wipe.

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::crypto;
use crate::error::{AppError, AppResult};
use crate::store::{StoredState, settings as settings_store};
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
    Ok(GetStateResponse {
        default_profile: st.default_profile,
        auto_lock_minutes: st.auto_lock_minutes,
        has_pin: st.pin.is_some(),
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
    let session = state.session.lock().await;
    let Some(master) = session.master() else {
        return Err(AppError::Locked);
    };
    let blob = crypto::encrypt_master(master, &pin)?;
    let store = state.store.lock().await;
    let open = store.require()?;
    let mut st = settings_store::load(&open.conn)?;
    st.pin = Some(blob);
    settings_store::save_defaults(&open.conn, &st)
}

#[tauri::command]
pub async fn remove_pin(state: State<'_, AppState>) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let mut st = settings_store::load(&open.conn)?;
    st.pin = None;
    settings_store::save_defaults(&open.conn, &st)
}

#[tauri::command]
pub async fn wipe(state: State<'_, AppState>) -> AppResult<()> {
    let mut session = state.session.lock().await;
    session.lock();
    let mut store = state.store.lock().await;
    if let Ok(open) = store.require() {
        let path = open.path.clone();
        let vault_id = open.vault_id.clone();
        store.close();
        let _ = std::fs::remove_file(&path);
        let mut registry =
            crate::store::vaults::VaultRegistry::load(crate::store::vaults::registry_path())?;
        registry.remove(&vault_id);
        registry.save(crate::store::vaults::registry_path())?;
    }
    Ok(())
}
