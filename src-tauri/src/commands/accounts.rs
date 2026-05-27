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

#[derive(Debug, Serialize)]
pub struct SyncStampView {
    pub ts: i64,
    pub dir: String,
}

#[derive(Debug, Serialize)]
pub struct GetAccountSyncInfoResponse {
    #[serde(rename = "lastSyncedAt")]
    pub last_synced_at: Option<SyncStampView>,
}

/// Read the (last_synced_at, last_synced_dir) stamp for a single
/// account. Powers the "Synced 12 min ago" footer on the account
/// detail screens. Returns `lastSyncedAt: null` when the row has
/// never been observed by the sync pipeline (local-only or
/// freshly-created).
#[tauri::command]
pub async fn get_account_sync_info(
    domain: String,
    username: String,
    state: State<'_, AppState>,
) -> AppResult<GetAccountSyncInfoResponse> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let stamp = accounts_store::get_sync_stamp(&open.conn, &domain, &username)?;
    Ok(GetAccountSyncInfoResponse {
        last_synced_at: stamp.map(|s| SyncStampView {
            ts: s.ts_ms,
            dir: match s.dir {
                accounts_store::SyncDir::Push => "push".into(),
                accounts_store::SyncDir::Pull => "pull".into(),
            },
        }),
    })
}

/// Stamp an account row as just-synced. Called by the JS sync engine
/// after a successful push or pull so the UI can show how stale (or
/// fresh) each entry is. `dir` is `"push"` or `"pull"`.
#[tauri::command]
pub async fn account_stamp_synced(
    domain: String,
    username: String,
    dir: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let parsed = match dir.as_str() {
        "push" => accounts_store::SyncDir::Push,
        "pull" => accounts_store::SyncDir::Pull,
        other => {
            return Err(crate::error::AppError::invalid(format!(
                "invalid sync direction `{other}` (expected `push` or `pull`)"
            )));
        }
    };
    let store = state.store.lock().await;
    let open = store.require()?;
    accounts_store::stamp_synced(&open.conn, &domain, &username, now_ms(), parsed)
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct TombstoneDto {
    pub domain: String,
    pub username: String,
    #[serde(rename = "deletedAt")]
    pub deleted_at: i64,
}

impl From<accounts_store::TombstoneRow> for TombstoneDto {
    fn from(row: accounts_store::TombstoneRow) -> Self {
        Self {
            domain: row.domain,
            username: row.username,
            deleted_at: row.deleted_at,
        }
    }
}

/// Snapshot of every locally-known tombstone. Consumed by the sync
/// push path to populate `SyncableState v2`'s `tombstones` field.
#[tauri::command]
pub async fn list_tombstones(state: State<'_, AppState>) -> AppResult<Vec<TombstoneDto>> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let rows = accounts_store::list_tombstones(&open.conn)?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Merge a list of incoming tombstones into the local store. Called
/// by the sync pull path so a device that learns about a delete via
/// `SyncableState.tombstones` carries it forward in its own future
/// snapshots.
#[tauri::command]
pub async fn merge_tombstones(
    incoming: Vec<TombstoneDto>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let rows: Vec<accounts_store::TombstoneRow> = incoming
        .into_iter()
        .map(|t| accounts_store::TombstoneRow {
            domain: t.domain,
            username: t.username,
            deleted_at: t.deleted_at,
        })
        .collect();
    accounts_store::merge_tombstones(&open.conn, &rows)
}
