//! Clipboard auto-clear commands.
//!
//! The actual platform-write goes through `tauri-plugin-clipboard-manager`
//! on the frontend side; here we own the timer state.

use std::time::Duration;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::AppState;
use crate::error::AppResult;

#[tauri::command]
pub async fn copy_with_auto_clear(
    text: String,
    seconds: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> AppResult<()> {
    app.clipboard()
        .write_text(text.clone())
        .map_err(|e| crate::error::AppError::internal(e.to_string()))?;
    let seconds = seconds.unwrap_or(30);
    if seconds == 0 {
        return Ok(());
    }
    let mut clip = state.clipboard.lock().await;
    clip.arm(text.clone(), seconds);

    let app_handle = app.clone();
    let armed_text = text;
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(seconds as u64)).await;
        let state = app_handle.state::<AppState>();
        let mut clip = state.clipboard.lock().await;
        if clip.last_written.as_deref() == Some(armed_text.as_str()) {
            let _ = app_handle.clipboard().write_text(String::new());
            clip.cancel();
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn arm_clipboard_clear(
    seconds: Option<u32>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let seconds = seconds.unwrap_or(30);
    let mut clip = state.clipboard.lock().await;
    clip.arm(String::new(), seconds);
    Ok(())
}

#[tauri::command]
pub async fn cancel_clipboard_clear(state: State<'_, AppState>) -> AppResult<()> {
    let mut clip = state.clipboard.lock().await;
    clip.cancel();
    Ok(())
}
