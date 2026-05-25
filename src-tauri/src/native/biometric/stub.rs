//! Fallback biometric backend: always unsupported.

use super::Availability;

#[derive(Debug, Default)]
pub struct Backend;

impl Backend {
    pub fn availability(&self) -> Availability {
        Availability::Unsupported
    }

    pub fn prompt(&self, _reason: &str) -> Result<bool, String> {
        Err("biometric not supported on this platform".into())
    }
}
