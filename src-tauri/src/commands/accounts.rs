//! Account-history commands (opt-in).

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::store::accounts as accounts_store;
use crate::store::vaults::now_ms;
use crate::types::{AccountEntry, Profile};

#[derive(Debug, Serialize)]
pub struct ListAccountsResponse {
    pub entries: Vec<AccountEntry>,
}

#[tauri::command]
pub async fn list_accounts(state: State<'_, AppState>) -> AppResult<ListAccountsResponse> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let entries = accounts_store::list(&open.conn)?;
    Ok(ListAccountsResponse { entries })
}

/// Return every account whose `last_synced_at` is NULL. The AutoFill
/// extension inserts rows directly via `record_account_ffi` without
/// the IPC layer (which is where `syncBus.notify` normally fires), so
/// the auto-sync loop has no way to learn about them. On every app
/// boot / unlock the frontend calls this and re-emits an
/// `upsert_account` op for each entry, letting the existing push
/// pipeline carry them to the server.
#[tauri::command]
pub async fn list_pending_sync_accounts(
    state: State<'_, AppState>,
) -> AppResult<ListAccountsResponse> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let entries = accounts_store::list_unsynced(&open.conn)?;
    Ok(ListAccountsResponse { entries })
}

#[derive(Debug, Serialize)]
pub struct RecordAccountResponse {
    pub entry: AccountEntry,
}

#[tauri::command]
pub async fn record_account(
    domain: String,
    username: String,
    profile: Profile,
    state: State<'_, AppState>,
) -> AppResult<RecordAccountResponse> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let domain = domain.trim().to_lowercase();
    let now = now_ms();
    let entry = AccountEntry {
        domain,
        username,
        profile,
        created_at: now,
        last_used_at: now,
    };
    let saved = accounts_store::record(&open.conn, &entry)?;
    Ok(RecordAccountResponse { entry: saved })
}

#[tauri::command]
pub async fn update_account_profile(
    domain: String,
    username: String,
    profile: Profile,
    state: State<'_, AppState>,
) -> AppResult<RecordAccountResponse> {
    let store = state.store.lock().await;
    let open = store.require()?;
    accounts_store::update_profile(&open.conn, &domain, &username, &profile)?;
    let entry = AccountEntry {
        domain,
        username,
        profile,
        created_at: now_ms(),
        last_used_at: now_ms(),
    };
    Ok(RecordAccountResponse { entry })
}

#[tauri::command]
pub async fn rename_account(
    domain: String,
    old_username: String,
    new_username: String,
    state: State<'_, AppState>,
) -> AppResult<RecordAccountResponse> {
    let store = state.store.lock().await;
    let open = store.require()?;
    accounts_store::rename(&open.conn, &domain, &old_username, &new_username)?;
    Ok(RecordAccountResponse {
        entry: AccountEntry {
            domain,
            username: new_username,
            profile: Profile::default_random(),
            created_at: now_ms(),
            last_used_at: now_ms(),
        },
    })
}

#[tauri::command]
pub async fn delete_account(
    domain: String,
    username: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    accounts_store::delete(&open.conn, &domain, &username)
}
