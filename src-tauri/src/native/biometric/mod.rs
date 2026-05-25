//! Biometric unlock — Touch ID on macOS, Windows Hello on Windows.
//!
//! Each platform module exposes the same three operations: probe support,
//! prompt the user, and seal/unseal a small blob in the Secure Enclave or
//! TPM. The frontend never sees the blob — it only knows whether
//! biometric is available, enrolled, and whether a prompt was approved.

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
