//! Native OS integrations.
//!
//! Modules that touch platform-specific APIs (window vibrancy, biometric,
//! menu bar / tray, autofill bridge, clipboard auto-clear). Each
//! submodule exposes a small platform-agnostic facade and pushes the
//! `#[cfg(target_os = …)]` gating below the API line.

pub mod biometric;
pub mod clipboard;
pub mod hotkey;
pub mod tray;
pub mod vibrancy;
