//! Windows implementation: Windows Hello via `UserConsentVerifier`.
//!
//! Stub for now — the WinRT bridge lands in M7.

use super::Availability;

#[derive(Debug, Default)]
pub struct Backend;

impl Backend {
    pub fn availability(&self) -> Availability {
        Availability::Unsupported
    }

    pub fn prompt(&self, _reason: &str) -> Result<bool, String> {
        Err("biometric prompt not wired yet".into())
    }
}
