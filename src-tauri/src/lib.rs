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

/// Reopen whichever vault `vaults.json` lists as active. Called once at
/// boot so subsequent `status()` calls reflect "locked, existing vault"
/// instead of "first run", which prevents the setup screen from creating
/// a duplicate entry over the one already on disk.
async fn restore_active_vault(
    store: &Arc<Mutex<store::StoreHandle>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let registry_path = store::vaults::registry_path();
    let registry = store::vaults::VaultRegistry::load(&registry_path)?;
    let Some(active_id) = registry.active_id.clone() else {
        return Ok(());
    };
    if !registry.vaults.iter().any(|v| v.id == active_id) {
        return Ok(());
    }
    let dir = store::vaults::vault_dir(&active_id);
    let handle = store::StoreHandle::open(active_id, &dir)?;
    let mut guard = store.lock().await;
    *guard = handle;
    Ok(())
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
                // Always start in Regular — we want the main window to
                // come up on the first `open`, get a dock icon, and
                // show up in the app switcher just like a regular Mac
                // app. The previous release default of `Accessory`
                // (menu-bar only) had two UX problems: users had to
                // run `open` twice for the window to appear (the first
                // launch put the process in tray-only mode and the
                // window stayed unfocused under other apps), and the
                // Cmd-Tab switcher couldn't surface Keyfount at all.
                // The tray icon (installed below) is still available
                // for quick-search; we just no longer hide the dock
                // icon to enable it.
                app.set_activation_policy(ActivationPolicy::Regular);
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

            // Reopen the active vault from the registry. Without this we
            // start with an empty `StoreHandle` every run, the UI sees
            // "first run", and `setup` happily mints a brand-new vault —
            // duplicating the entry already on disk.
            let state: tauri::State<'_, AppState> = app.state();
            let store_handle = state.store.clone();
            tauri::async_runtime::block_on(async move {
                if let Err(err) = restore_active_vault(&store_handle).await {
                    tracing::warn!(?err, "could not restore active vault at startup");
                }
            });

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
            commands::session_master,
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
            commands::sync_http,
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
        .build(tauri::generate_context!())
        .expect("error while building keyfount")
        .run(|app_handle, event| {
            // macOS fires `Reopen` when the user clicks the dock icon
            // while every window is hidden/closed (the default Cocoa
            // "click app icon to bring it back" behaviour). Without
            // this handler the app would stay invisible and the user
            // would think it's dead.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
            let _ = event;
            let _ = app_handle;
        });
}
