//! Window vibrancy / Liquid Glass / Mica.
//!
//! Tauri picks the initial material up from `tauri.conf.json`'s
//! `windowEffects`. This module is the runtime-driven equivalent: it
//! lets us flip materials live (e.g. a future "high contrast" toggle)
//! without rebuilding the window. The functions are kept `pub` even
//! though they are not invoked at setup so the API stays available.
//!
//! - macOS: `NSVisualEffectView` with the `HudWindow` material as a safe
//!   default. The optional `liquid-glass` Cargo feature swaps in the
//!   private `NSGlassEffectView` for macOS 26+.
//! - Windows 11: `Mica` system material.
//! - Other platforms: no-op.

#[cfg(target_os = "macos")]
#[allow(dead_code)]
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
#[allow(dead_code)]
pub fn apply(window: &tauri::WebviewWindow) -> Result<(), String> {
    use window_vibrancy::apply_mica;
    apply_mica(window, Some(true)).map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[allow(dead_code)]
pub fn apply(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}
