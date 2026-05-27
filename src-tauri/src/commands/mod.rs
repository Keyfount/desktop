//! Tauri command surface.
//!
//! Each `#[tauri::command]` function lives in a focused submodule but is
//! re-exported here so `tauri::generate_handler!` in `lib.rs` only refers
//! to one path per command. The request/response types are the same as
//! those in `extension/src/shared/messages.ts`, lower-cased and converted
//! to snake_case where appropriate.

mod accounts;
mod biometric;
mod clipboard;
mod export;
mod generation;
mod native;
mod pending_ops;
mod session;
mod settings;
mod sync;
mod vaults;

pub use accounts::*;
pub use biometric::*;
pub use clipboard::*;
pub use export::*;
pub use generation::*;
pub use native::*;
pub use pending_ops::*;
pub use session::*;
pub use settings::*;
pub use sync::*;
pub use vaults::*;
