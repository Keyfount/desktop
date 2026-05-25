//! Biometric unlock — Touch ID on macOS, Windows Hello on Windows.
//!
//! Each platform module exposes the same three operations: probe support,
//! prompt the user, and seal/unseal a small blob in the Secure Enclave or
//! TPM. The frontend never sees the blob — it only knows whether
//! biometric is available, enrolled, and whether a prompt was approved.
//!
//! The blob protected by biometric is the same `PinBlob` produced by
//! `crypto::encrypt_master`; we layer the OS keychain on top so the AES
//! key is gated behind Touch ID / Hello rather than a numeric PIN.
//! The current `Backend` implementations return `Unsupported` everywhere
//! — the platform bridges are implemented in M7.2 alongside an end-to-end
//! integration test on real hardware.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::Backend;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::Backend;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod stub;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use stub::Backend;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Availability {
    /// Supported and at least one biometric is enrolled.
    Available,
    /// Hardware supported but nothing is enrolled.
    NotEnrolled,
    /// Hardware not present on this device.
    Unsupported,
}

/// Stable keychain entry name for a vault's biometric-protected blob.
pub fn keychain_entry(vault_id: &str) -> String {
    format!("keyfount.vault.{vault_id}.biometric")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_entry_namespaces_by_vault() {
        let a = keychain_entry("vault-a");
        let b = keychain_entry("vault-b");
        assert_ne!(a, b);
        assert!(a.starts_with("keyfount.vault."));
    }
}
