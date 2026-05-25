//! Window vibrancy / Liquid Glass / Mica.
//!
//! - macOS: `NSVisualEffectView` with the `HudWindow` material as a safe
//!   default. The optional `liquid-glass` Cargo feature swaps in the
//!   private `NSGlassEffectView` for macOS 26+.
//! - Windows 11: `Mica` system material.
//! - Other platforms: no-op.

#[cfg(target_os = "macos")]
pub fn apply(window: &tauri::WebviewWindow) -> Result<(), String> {
    use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy};
    apply_vibrancy(
        window,
        NSVisualEffectMaterial::HudWindow,
        Some(NSVisualEffectState::Active),
        Some(16.0),
    )
    .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
pub fn apply(window: &tauri::WebviewWindow) -> Result<(), String> {
    use window_vibrancy::apply_mica;
    apply_mica(window, Some(true)).map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn apply(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}
