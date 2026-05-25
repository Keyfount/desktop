//! Global hotkey registration façade.
//!
//! The actual wiring goes through `tauri-plugin-global-shortcut`; this
//! module owns the keymap parsing and the in-process state so we can
//! expose typed register/unregister commands to the UI.

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_combo_is_non_empty() {
        assert!(!default_combo().is_empty());
    }
}
