//! Desktop-only native commands: open preferences, show Quick Search,
//! global hotkey registration, autofill toggles.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::AppResult;
use crate::native::hotkey;

#[tauri::command]
pub async fn show_quick_search(app: AppHandle) -> AppResult<()> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| crate::error::AppError::internal("main window not available"))?;
    win.show().ok();
    win.set_focus().ok();
    win.eval("window.location.hash = '#/quick-search';").ok();
    Ok(())
}

#[tauri::command]
pub async fn open_preferences(app: AppHandle) -> AppResult<()> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| crate::error::AppError::internal("main window not available"))?;
    win.show().ok();
    win.set_focus().ok();
    win.eval("window.location.hash = '#/settings';").ok();
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct HotkeyResponse {
    pub combo: String,
}

#[tauri::command]
pub async fn register_hotkey(combo: Option<String>) -> AppResult<HotkeyResponse> {
    // Actual registration is wired up by the global-shortcut plugin in M5.
    Ok(HotkeyResponse {
        combo: combo.unwrap_or_else(|| hotkey::default_combo().into()),
    })
}

#[tauri::command]
pub async fn unregister_hotkey() -> AppResult<()> {
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct AutofillStatusResponse {
    pub enabled: bool,
    #[serde(rename = "permissionGranted")]
    pub permission_granted: bool,
}

#[tauri::command]
pub async fn autofill_status() -> AppResult<AutofillStatusResponse> {
    Ok(AutofillStatusResponse {
        enabled: false,
        permission_granted: false,
    })
}

#[tauri::command]
pub async fn enable_autofill() -> AppResult<()> {
    Err(crate::error::AppError::Unsupported)
}

#[tauri::command]
pub async fn disable_autofill() -> AppResult<()> {
    Ok(())
}
