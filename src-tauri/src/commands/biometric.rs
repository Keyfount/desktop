//! Biometric unlock commands.
//!
//! The actual Touch ID / Windows Hello integration lands in M7. Until
//! then the commands report "unsupported" so the UI gracefully degrades.

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::error::AppResult;

#[derive(Debug, Serialize)]
pub struct BiometricAvailableResponse {
    pub supported: bool,
    pub enrolled: bool,
}

#[tauri::command]
pub async fn biometric_available() -> AppResult<BiometricAvailableResponse> {
    use crate::native::biometric::{Availability, Backend};
    let backend = Backend;
    let avail = backend.availability();
    Ok(BiometricAvailableResponse {
        supported: !matches!(avail, Availability::Unsupported),
        enrolled: matches!(avail, Availability::Available),
    })
}

#[tauri::command]
pub async fn unlock_biometric(_state: State<'_, AppState>) -> AppResult<()> {
    Err(crate::error::AppError::Unsupported)
}

#[tauri::command]
pub async fn enable_biometric(_state: State<'_, AppState>) -> AppResult<()> {
    Err(crate::error::AppError::Unsupported)
}

#[tauri::command]
pub async fn disable_biometric(_state: State<'_, AppState>) -> AppResult<()> {
    Ok(())
}
