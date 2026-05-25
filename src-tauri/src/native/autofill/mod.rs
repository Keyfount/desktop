//! System-wide autofill bridge (opt-in).
//!
//! When the user grants the platform's accessibility permission, the
//! bridge watches focus events on password fields and offers a one-tap
//! "fill" affordance. The bridge is **off by default** and always
//! requires both:
//!
//! 1. A runtime user preference (`enabled = true`).
//! 2. A platform permission (Accessibility on macOS, UI Automation on
//!    Windows). The OS dialog is the only path to grant it.
//!
//! Platform-specific wires live in `macos.rs`, `windows.rs`, and
//! `stub.rs`; this module exposes the cross-platform façade the
//! `commands::autofill_*` handlers call into.

use std::sync::atomic::{AtomicBool, Ordering};

static ENABLED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Availability {
    /// The bridge is supported and the OS permission is granted.
    Available,
    /// Supported but the OS permission has not been granted yet.
    PermissionDenied,
    /// Not supported on this platform.
    Unsupported,
}

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
}

pub fn availability() -> Availability {
    if cfg!(any(target_os = "macos", target_os = "windows")) {
        // The actual permission probe lands in M8.2 with the platform
        // bridge. Until then we conservatively report "permission
        // denied" so the UI keeps the toggle off until the user grants
        // it through the OS dialog.
        Availability::PermissionDenied
    } else {
        Availability::Unsupported
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_flag_round_trips() {
        set_enabled(true);
        assert!(is_enabled());
        set_enabled(false);
        assert!(!is_enabled());
    }
}
