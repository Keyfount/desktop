//! Multi-vault management. Each vault has its own SQLite file and its
//! own master fingerprint.

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::store::vaults::{self as vault_store, VaultRegistry};
use crate::types::VaultMeta;

#[derive(Debug, Serialize)]
pub struct ListVaultsResponse {
    #[serde(rename = "activeId")]
    pub active_id: Option<String>,
    pub vaults: Vec<VaultMeta>,
}

#[tauri::command]
pub async fn list_vaults(_state: State<'_, AppState>) -> AppResult<ListVaultsResponse> {
    let registry = VaultRegistry::load(vault_store::registry_path())?;
    Ok(ListVaultsResponse {
        active_id: registry.active_id,
        vaults: registry.vaults,
    })
}

#[tauri::command]
pub async fn switch_vault(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let mut registry = VaultRegistry::load(vault_store::registry_path())?;
    if registry.vaults.iter().all(|v| v.id != id) {
        return Err(crate::error::AppError::invalid(format!(
            "unknown vault id: {id}"
        )));
    }
    registry.active_id = Some(id.clone());
    registry.touch_active();
    registry.save(vault_store::registry_path())?;

    let mut session = state.session.lock().await;
    session.lock();
    let mut store = state.store.lock().await;
    store.close();
    *store = crate::store::StoreHandle::open(id.clone(), vault_store::vault_dir(&id))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_vault(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let mut session = state.session.lock().await;
    session.lock();
    let mut store = state.store.lock().await;
    if store.require().is_ok_and(|o| o.vault_id == id) {
        store.close();
    }
    let dir = vault_store::vault_dir(&id);
    let _ = std::fs::remove_dir_all(&dir);
    let mut registry = VaultRegistry::load(vault_store::registry_path())?;
    registry.remove(&id);
    registry.save(vault_store::registry_path())?;
    Ok(())
}

#[tauri::command]
pub async fn start_new_vault(state: State<'_, AppState>) -> AppResult<()> {
    let mut session = state.session.lock().await;
    session.lock();
    let mut store = state.store.lock().await;
    store.close();
    let mut registry = VaultRegistry::load(vault_store::registry_path())?;
    registry.active_id = None;
    registry.save(vault_store::registry_path())?;
    Ok(())
}
