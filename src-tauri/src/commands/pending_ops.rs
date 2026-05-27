//! Tauri commands for the pending sync-op queue.
//!
//! The TypeScript sync engine is the only consumer: it enqueues
//! every local mutation before pushing, and drains the queue on
//! every sync entry point (push, pull, polling tick, post-connect).

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::error::AppResult;
use crate::store::pending_ops;

#[derive(Debug, Serialize)]
pub struct PendingOpDto {
    pub id: i64,
    #[serde(rename = "opJson")]
    pub op_json: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    pub attempts: i64,
    #[serde(rename = "lastError")]
    pub last_error: Option<String>,
}

impl From<pending_ops::PendingOpRow> for PendingOpDto {
    fn from(row: pending_ops::PendingOpRow) -> Self {
        Self {
            id: row.id,
            op_json: row.op_json,
            created_at: row.created_at,
            attempts: row.attempts,
            last_error: row.last_error,
        }
    }
}

#[tauri::command]
pub async fn pending_ops_enqueue(
    op_json: String,
    state: State<'_, AppState>,
) -> AppResult<i64> {
    let store = state.store.lock().await;
    let open = store.require()?;
    pending_ops::enqueue(&open.conn, &op_json)
}

#[tauri::command]
pub async fn pending_ops_list(state: State<'_, AppState>) -> AppResult<Vec<PendingOpDto>> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let rows = pending_ops::list_oldest_first(&open.conn, 200)?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn pending_ops_delete(id: i64, state: State<'_, AppState>) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    pending_ops::delete_by_id(&open.conn, id)
}

#[tauri::command]
pub async fn pending_ops_record_failure(
    id: i64,
    error: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    pending_ops::record_failure(&open.conn, id, &error)
}
