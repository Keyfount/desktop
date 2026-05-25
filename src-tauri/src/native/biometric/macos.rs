//! macOS implementation: Touch ID + Local Authentication.
//!
//! The actual `LocalAuthentication.framework` bridge lands in M7; this
//! file currently exposes the same interface as the other backends so
//! the command layer can compile and behave consistently.

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
