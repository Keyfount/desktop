//! Global hotkey registration façade.
//!
//! Default combo: `Cmd+Shift+K` on macOS, `Ctrl+Shift+K` elsewhere. Pressing
//! it brings the main window to the front and routes the frontend to the
//! Quick Search overlay. The actual press handler is wired up in `lib.rs`
//! where the global-shortcut plugin is configured.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[derive(Debug, Default)]
pub struct HotkeyState {
    pub combo: Option<String>,
}

pub fn default_combo() -> &'static str {
    if cfg!(target_os = "macos") {
        "CommandOrControl+Shift+K"
    } else {
        "Control+Shift+K"
    }
}

/// Register the default Quick Search combo. Soft-fails on platforms where
/// global shortcuts are not available (sandboxed mobile, headless CI).
pub fn register_default(app: &AppHandle) -> tauri::Result<()> {
    let combo = default_combo();
    let parsed: Shortcut = combo
        .parse()
        .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!("invalid shortcut {combo}: {e}")))?;
    if let Err(e) = app.global_shortcut().register(parsed) {
        tracing::warn!("could not register default global shortcut {combo}: {e}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_combo_is_non_empty() {
        assert!(!default_combo().is_empty());
    }
}
