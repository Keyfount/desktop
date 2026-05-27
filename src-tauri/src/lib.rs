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

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(desktop)]
    let builder = builder.plugin({
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
    });

    builder
        .manage(AppState::new())
        .setup(|app| {
            // Android has no `HOME` and no equivalent of an App Group;
            // point it at Tauri's per-app data dir so the macOS-style
            // `$HOME/Library/Application Support/Keyfount` lookup in
            // `store::vaults` still lands inside the sandbox.
            //
            // iOS is deliberately excluded: `Sources/keyfount/main.mm`
            // sets HOME to the `group.io.keyfount.app` container so the
            // AutoFill extension can read the same vault directory.
            // Overwriting it here with `app_data_dir()` would redirect
            // writes back into the app-private sandbox, which the
            // extension can't see.
            #[cfg(target_os = "android")]
            {
                if let Ok(data_dir) = app.path().app_data_dir() {
                    std::fs::create_dir_all(&data_dir).ok();
                    unsafe { std::env::set_var("HOME", &data_dir); }
                }
            }

            #[cfg(target_os = "ios")]
            {
                if let Some(home) = std::env::var_os("HOME") {
                    let data_dir =
                        std::path::PathBuf::from(home).join("Library/Application Support/Keyfount");
                    std::fs::create_dir_all(&data_dir).ok();
                }
            }

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

            #[cfg(desktop)]
            {
                native::tray::install(app.handle())?;
                native::hotkey::register_default(app.handle())?;
            }

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
            commands::list_pending_sync_accounts,
            commands::record_account,
            commands::update_account_profile,
            commands::rename_account,
            commands::delete_account,
            commands::get_account_sync_info,
            commands::account_stamp_synced,
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

use std::os::raw::c_char;
use std::ffi::{CStr, CString};

#[unsafe(no_mangle)]
pub unsafe extern "C" fn derive_password_ffi(
    master: *const c_char,
    domain: *const c_char,
    email: *const c_char,
    profile_json: *const c_char,
) -> *mut c_char {
    if master.is_null() || domain.is_null() || email.is_null() || profile_json.is_null() {
        return std::ptr::null_mut();
    }
    let master = unsafe { CStr::from_ptr(master) }.to_string_lossy().into_owned();
    let domain = unsafe { CStr::from_ptr(domain) }.to_string_lossy().into_owned();
    let email = unsafe { CStr::from_ptr(email) }.to_string_lossy().into_owned();
    let profile_json = unsafe { CStr::from_ptr(profile_json) }.to_string_lossy().into_owned();

    let resolved_profile: types::Profile = match serde_json::from_str(&profile_json) {
        Ok(p) => p,
        Err(_) => return std::ptr::null_mut(),
    };

    let inputs = types::DerivationInputs {
        master,
        domain,
        email,
    };

    let password_fut = crypto::derive_password(&inputs, &resolved_profile);
    let password = match tauri::async_runtime::block_on(password_fut) {
        Ok(p) => p,
        Err(_) => return std::ptr::null_mut(),
    };

    let c_str = match CString::new(password) {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    c_str.into_raw()
}

/// Verify a candidate master against the fingerprint stored in the
/// vault's `settings` row. The extension reads `expected_fp_hex` from
/// SQLite directly and passes both strings here so we can run the same
/// Argon2id derivation as the IPC `unlock` command without exposing
/// the full session state across the C boundary.
///
/// Returns 1 on match, 0 on mismatch, -1 on argument/derivation error.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn verify_master_ffi(
    master: *const c_char,
    expected_fp_hex: *const c_char,
) -> i32 {
    if master.is_null() || expected_fp_hex.is_null() {
        return -1;
    }
    let master = unsafe { CStr::from_ptr(master) }.to_string_lossy().into_owned();
    let expected_hex = unsafe { CStr::from_ptr(expected_fp_hex) }
        .to_string_lossy()
        .into_owned();

    let computed = match crypto::fingerprint_master(&master) {
        Ok(fp) => fp,
        Err(_) => return -1,
    };

    let expected = match hex::decode(expected_hex.trim()) {
        Ok(bytes) if bytes.len() == 3 => bytes,
        _ => return -1,
    };

    let eq: bool = subtle::ConstantTimeEq::ct_eq(&expected[..], &computed[..]).into();
    if eq { 1 } else { 0 }
}

/// Persist a new (or existing) account in the active vault from the
/// AutoFill extension. The extension cannot call the regular Tauri IPC
/// `record_account` command — it runs in a separate process with no
/// app handle — so we resolve the vault path ourselves and reuse the
/// same SQL upsert as `store::accounts::record`.
///
/// `last_synced_at` is left NULL so `try_push_pending_ffi` (and the
/// app's post-unlock drain) can find the entry and push it later.
///
/// Returns 1 on success, 0 on bad input / JSON, -1 on storage error.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn record_account_ffi(
    domain: *const c_char,
    username: *const c_char,
    profile_json: *const c_char,
) -> i32 {
    if domain.is_null() || username.is_null() || profile_json.is_null() {
        return 0;
    }
    let domain = unsafe { CStr::from_ptr(domain) }
        .to_string_lossy()
        .trim()
        .to_lowercase();
    let username = unsafe { CStr::from_ptr(username) }
        .to_string_lossy()
        .into_owned();
    let profile_json = unsafe { CStr::from_ptr(profile_json) }
        .to_string_lossy()
        .into_owned();

    if domain.is_empty() || username.trim().is_empty() {
        return 0;
    }
    let profile: types::Profile = match serde_json::from_str(&profile_json) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Autofill FFI: failed to parse profile JSON: {:?}", e);
            return 0;
        }
    };

    match open_active_vault_db() {
        Ok(conn) => {
            let now = store::vaults::now_ms();
            let entry = types::AccountEntry {
                domain,
                username,
                profile,
                created_at: now,
                last_used_at: now,
            };
            match store::accounts::record(&conn, &entry) {
                Ok(_) => {
                    eprintln!("Autofill FFI: successfully recorded account");
                    1
                }
                Err(e) => {
                    eprintln!("Autofill FFI: failed to record account in DB: {:?}", e);
                    -1
                }
            }
        }
        Err(e) => {
            eprintln!("Autofill FFI: failed to open vault DB: {:?}", e);
            -1
        }
    }
}

/// Resolve the active vault's SQLite file and return an open
/// connection with the schema migrations applied. Shared by every FFI
/// entrypoint that needs to read or write account data.
fn open_active_vault_db() -> Result<rusqlite::Connection, error::AppError> {
    let reg_path = store::vaults::registry_path();
    eprintln!("Autofill FFI: registry path resolved to {:?}", reg_path);
    let registry = match store::vaults::VaultRegistry::load(&reg_path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Autofill FFI: failed to load vault registry: {:?}", e);
            return Err(e);
        }
    };
    let active_id = match registry.active_id.clone() {
        Some(id) => id,
        None => {
            eprintln!("Autofill FFI: no active vault ID found in registry");
            return Err(error::AppError::invalid("no active vault"));
        }
    };
    let db_path = store::vaults::vault_dir(&active_id).join("vault.db");
    eprintln!("Autofill FFI: database path resolved to {:?}", db_path);
    
    // Ensure the parent directory exists
    if let Some(parent) = db_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("Autofill FFI: failed to create vault dir: {:?}", e);
        }
    }

    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Autofill FFI: failed to open SQLite connection: {:?}", e);
            return Err(e.into());
        }
    };
    if let Err(e) = store::schema::ensure_schema(&conn) {
        eprintln!("Autofill FFI: failed to ensure schema: {:?}", e);
        return Err(e);
    }
    Ok(conn)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn free_password_ffi(s: *mut c_char) {
    if !s.is_null() {
        unsafe {
            let _ = CString::from_raw(s);
        }
    }
}

