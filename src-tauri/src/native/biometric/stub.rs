//! Fallback biometric backend: always unsupported. Mirrors the macOS
//! signature so the command layer compiles on every platform.

use super::Availability;

#[derive(Debug, Default)]
pub struct Backend;

impl Backend {
    pub fn availability(&self) -> Availability {
        Availability::Unsupported
    }

    pub fn seal(&self, _account: &str, _plaintext: &[u8]) -> Result<(), String> {
        Err("biometric not supported on this platform".into())
    }

    pub fn unseal(&self, _account: &str, _reason: &str) -> Result<Vec<u8>, String> {
        Err("biometric not supported on this platform".into())
    }

    pub fn clear(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }

    pub fn is_enrolled(&self, _account: &str) -> bool {
        false
    }

    pub fn prompt(&self, _reason: &str) -> Result<bool, String> {
        Err("biometric not supported on this platform".into())
    }
}
