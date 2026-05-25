//! Keyfount Desktop — Rust backend.
//!
//! The Tauri shell exposes a typed IPC surface to the Preact frontend.
//! All cryptographic operations, persistent storage, and OS integrations
//! live here; the frontend is intentionally kept free of secrets.

#![deny(unsafe_op_in_unsafe_fn)]
#![warn(missing_debug_implementations, rust_2018_idioms)]

pub mod commands;
pub mod crypto;
pub mod error;
pub mod native;
pub mod session;
pub mod store;
pub mod sync;
pub mod types;

use std::sync::Arc;

use tauri::Manager;
use tokio::sync::Mutex;

pub use error::AppError;

/// Shared state held by every command handler.
#[derive(Debug)]
pub struct AppState {
    /// In-memory unlocked session — `None` while locked.
    pub session: Arc<Mutex<session::SessionState>>,
    /// Open SQLite connection pool for the active vault, if any.
    pub store: Arc<Mutex<store::StoreHandle>>,
    /// Clipboard auto-clear timer state.
    pub clipboard: Arc<Mutex<native::clipboard::ClipboardState>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            session: Arc::new(Mutex::new(session::SessionState::default())),
            store: Arc::new(Mutex::new(store::StoreHandle::uninitialised())),
            clipboard: Arc::new(Mutex::new(native::clipboard::ClipboardState::default())),
        }
    }
}

/// Application entry point invoked by `main.rs`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin({
            use tauri_plugin_global_shortcut::{Builder, ShortcutState};
            Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                            let _ = win.eval("window.location.hash = '#/quick-search';");
                        }
                    }
                })
                .build()
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                // In dev we want a Dock icon and a window in the app
                // switcher so iterating on the UI is straightforward.
                // The release build defaults to `Accessory` (menu-bar
                // only) — see the `not(debug_assertions)` branch.
                #[cfg(debug_assertions)]
                app.set_activation_policy(ActivationPolicy::Regular);
                #[cfg(not(debug_assertions))]
                app.set_activation_policy(ActivationPolicy::Accessory);
            }

            // On macOS the visual effect is configured by
            // tauri.conf.json's `windowEffects` (HUD material), and on
            // Windows 11 Mica is wired the same way. The Rust-side
            // `native::vibrancy::apply` was a belt-and-braces call that
            // ended up registering the NSVisualEffectViewTagged ObjC
            // class a second time and aborted the process at startup —
            // window-vibrancy already registers it when Tauri applies
            // the configured `windowEffects`. We keep the module around
            // for future runtime-driven material changes.

            native::tray::install(app.handle())?;
            native::hotkey::register_default(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // session
            commands::status,
            commands::setup,
            commands::unlock,
            commands::unlock_with_pin,
            commands::lock,
            commands::fingerprint,
            // generation
            commands::generate,
            commands::get_profile,
            commands::set_profile,
            commands::delete_profile,
            commands::set_default_profile,
            // settings
            commands::get_state,
            commands::set_auto_lock_minutes,
            commands::set_history_enabled,
            commands::set_favicon_fallback_enabled,
            commands::set_clipboard_clear_seconds,
            commands::set_pin,
            commands::remove_pin,
            commands::wipe,
            // accounts
            commands::list_accounts,
            commands::record_account,
            commands::update_account_profile,
            commands::rename_account,
            commands::delete_account,
            // vaults
            commands::list_vaults,
            commands::switch_vault,
            commands::delete_vault,
            commands::start_new_vault,
            // clipboard
            commands::copy_with_auto_clear,
            commands::arm_clipboard_clear,
            commands::cancel_clipboard_clear,
            // sync
            commands::sync_status,
            commands::sync_test_connection,
            commands::sync_session_save,
            commands::sync_session_load,
            commands::sync_session_clear,
            // native
            commands::show_quick_search,
            commands::open_preferences,
            commands::register_hotkey,
            commands::unregister_hotkey,
            // biometric
            commands::biometric_available,
            commands::unlock_biometric,
            commands::enable_biometric,
            commands::disable_biometric,
            // autofill
            commands::autofill_status,
            commands::enable_autofill,
            commands::disable_autofill,
            // export
            commands::export_vault,
            commands::import_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running keyfount");
}
