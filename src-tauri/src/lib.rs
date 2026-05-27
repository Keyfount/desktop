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

/// Mark whichever vault `vaults.json` lists as active so subsequent
/// `status()` calls reflect "locked, existing vault" instead of "first
/// run". With SQLCipher we can't open the DB here — the master isn't
/// available yet — so we only record the active-vault identity.
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
    let mut guard = store.lock().await;
    guard.set_active(active_id, &dir)?;
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
            commands::list_tombstones,
            commands::merge_tombstones,
            // pending ops (retry queue)
            commands::pending_ops_enqueue,
            commands::pending_ops_list,
            commands::pending_ops_delete,
            commands::pending_ops_record_failure,
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

// ===========================================================================
// iOS AutoFill FFI surface.
//
// The AutoFill extension lives in a separate process and cannot use the
// Tauri IPC. Instead it links `libapp.a` and calls the C ABI surface
// declared here. Every entry point that touches the vault DB now takes
// the master password so we can derive the SQLCipher page key on the
// fly — there's no shared in-memory session between the extension and
// the main app. The master only lives in extension memory for the
// duration of the autofill presentation (the Swift caller zeros it on
// dismiss).
//
// Safety contract (shared by every `unsafe extern "C" fn` below):
// - Pointers must either be null OR point to NUL-terminated valid
//   UTF-8 strings with the standard C-string lifetime.
// - `*mut c_char` returns are heap-allocated by Rust (`CString::into_raw`)
//   and MUST be released via `free_password_ffi` to avoid leaks.
// - Calls are NOT thread-safe with respect to each other on the same
//   vault directory — the Swift caller serialises them inside the
//   extension presentation lifecycle.
//
// clippy::missing_safety_doc fires per-function and demands a # Safety
// section on each — but the contract is identical across the surface
// and documented once above. Suppress globally for the FFI block.
// ===========================================================================

/// Helper: read a C string from a pointer or return `None` on null.
unsafe fn c_str_to_string(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    Some(unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned())
}

/// Convert a Rust string into a `CString` raw pointer or null on error.
/// Caller MUST release with `free_password_ffi`.
fn rust_string_to_c(s: String) -> *mut c_char {
    match CString::new(s) {
        Ok(c) => c.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

#[unsafe(no_mangle)]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn derive_password_ffi(
    master: *const c_char,
    domain: *const c_char,
    email: *const c_char,
    profile_json: *const c_char,
) -> *mut c_char {
    let Some(master) = (unsafe { c_str_to_string(master) }) else {
        return std::ptr::null_mut();
    };
    let Some(domain) = (unsafe { c_str_to_string(domain) }) else {
        return std::ptr::null_mut();
    };
    let Some(email) = (unsafe { c_str_to_string(email) }) else {
        return std::ptr::null_mut();
    };
    let Some(profile_json) = (unsafe { c_str_to_string(profile_json) }) else {
        return std::ptr::null_mut();
    };

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

    rust_string_to_c(password)
}

/// Verify a candidate master by attempting to open the active vault's
/// SQLCipher database with it. With the SQLite-3 plaintext format
/// retired we can no longer pre-read the fingerprint from disk — the
/// canonical "did this master decrypt the DB" check is now the open
/// itself.
///
/// Returns 1 if the master decrypted the DB, 0 if it didn't, -1 on
/// argument / IO error (no active vault, missing salt file, etc.).
#[unsafe(no_mangle)]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn verify_master_ffi(master: *const c_char) -> i32 {
    let Some(master) = (unsafe { c_str_to_string(master) }) else {
        return -1;
    };
    match open_active_vault_db(&master) {
        Ok(_) => 1,
        Err(error::AppError::Locked) => 0,
        Err(e) => {
            tracing::warn!(?e, "Autofill FFI: verify_master_ffi error");
            -1
        }
    }
}

/// Persist a new (or existing) account in the active vault from the
/// AutoFill extension. Reuses the same SQL upsert as
/// `store::accounts::record`.
///
/// Returns 1 on success, 0 on bad input / JSON, -1 on storage error
/// (including wrong master, which surfaces as a SQLCipher open error).
#[unsafe(no_mangle)]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn record_account_ffi(
    master: *const c_char,
    domain: *const c_char,
    username: *const c_char,
    profile_json: *const c_char,
) -> i32 {
    let Some(master) = (unsafe { c_str_to_string(master) }) else {
        return 0;
    };
    let Some(domain_raw) = (unsafe { c_str_to_string(domain) }) else {
        return 0;
    };
    let Some(username) = (unsafe { c_str_to_string(username) }) else {
        return 0;
    };
    let Some(profile_json) = (unsafe { c_str_to_string(profile_json) }) else {
        return 0;
    };
    let domain = domain_raw.trim().to_lowercase();

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

    match open_active_vault_db(&master) {
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
                Ok(_) => 1,
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

/// Read the master fingerprint hex from `settings.fingerprint`. The
/// Swift caller used to read this directly from SQLite; now it has to
/// go through the SQLCipher-aware code path. Returns the fingerprint
/// as a 6-character hex string (caller must `free_password_ffi`), or
/// null on any error.
#[unsafe(no_mangle)]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn vault_load_fingerprint_ffi(master: *const c_char) -> *mut c_char {
    let Some(master) = (unsafe { c_str_to_string(master) }) else {
        return std::ptr::null_mut();
    };
    let conn = match open_active_vault_db(&master) {
        Ok(c) => c,
        Err(_) => return std::ptr::null_mut(),
    };
    let row: Result<Option<String>, _> = conn.query_row(
        "SELECT fingerprint FROM settings WHERE id = 1",
        [],
        |r| r.get(0),
    );
    match row {
        Ok(Some(hex)) => rust_string_to_c(hex),
        _ => std::ptr::null_mut(),
    }
}

/// Read the `favicon_fallback_enabled` boolean from settings. Defaults
/// to 1 (enabled) when the column is missing or the DB read fails.
/// Returns 1 / 0; -1 on master/IO error.
#[unsafe(no_mangle)]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn vault_load_favicon_fallback_ffi(master: *const c_char) -> i32 {
    let Some(master) = (unsafe { c_str_to_string(master) }) else {
        return -1;
    };
    let conn = match open_active_vault_db(&master) {
        Ok(c) => c,
        Err(_) => return -1,
    };
    let row: Result<Option<i64>, _> = conn.query_row(
        "SELECT favicon_fallback_enabled FROM settings WHERE id = 1",
        [],
        |r| r.get(0),
    );
    match row {
        Ok(Some(v)) => {
            if v != 0 {
                1
            } else {
                0
            }
        }
        _ => 1,
    }
}

/// Read the vault's default-profile JSON. Returns the JSON string the
/// app stored at last save (caller must free) or null on error / when
/// the row is missing.
#[unsafe(no_mangle)]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn vault_load_default_profile_ffi(master: *const c_char) -> *mut c_char {
    let Some(master) = (unsafe { c_str_to_string(master) }) else {
        return std::ptr::null_mut();
    };
    let conn = match open_active_vault_db(&master) {
        Ok(c) => c,
        Err(_) => return std::ptr::null_mut(),
    };
    let row: Result<Option<String>, _> = conn.query_row(
        "SELECT default_profile_json FROM settings WHERE id = 1",
        [],
        |r| r.get(0),
    );
    match row {
        Ok(Some(json)) => rust_string_to_c(json),
        _ => std::ptr::null_mut(),
    }
}

/// List every account in the vault as a JSON array of
/// `{domain, username, profile_json}` objects, ordered by
/// `last_used_at DESC`. Returns a freshly-allocated C string the
/// caller must free, or null on error.
#[unsafe(no_mangle)]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn vault_load_accounts_ffi(master: *const c_char) -> *mut c_char {
    let Some(master) = (unsafe { c_str_to_string(master) }) else {
        return std::ptr::null_mut();
    };
    let conn = match open_active_vault_db(&master) {
        Ok(c) => c,
        Err(_) => return std::ptr::null_mut(),
    };
    let mut stmt = match conn.prepare(
        "SELECT domain, username, profile_json
         FROM accounts
         ORDER BY last_used_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return std::ptr::null_mut(),
    };
    let rows = match stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    }) {
        Ok(it) => it,
        Err(_) => return std::ptr::null_mut(),
    };
    let mut out: Vec<serde_json::Value> = Vec::new();
    for row in rows {
        let Ok((domain, username, profile_json)) = row else {
            continue;
        };
        out.push(serde_json::json!({
            "domain": domain,
            "username": username,
            "profile_json": profile_json,
        }));
    }
    match serde_json::to_string(&out) {
        Ok(json) => rust_string_to_c(json),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Resolve the active vault's SQLite file and return an open SQLCipher
/// connection with the per-vault page key set and the schema applied.
/// Shared by every FFI entry point that needs to read or write account
/// data. Returns `AppError::Locked` on wrong-master / encrypted-without-key.
fn open_active_vault_db(master: &str) -> Result<rusqlite::Connection, error::AppError> {
    let reg_path = store::vaults::registry_path();
    let registry = store::vaults::VaultRegistry::load(&reg_path)?;
    let active_id = match registry.active_id.clone() {
        Some(id) => id,
        None => return Err(error::AppError::invalid("no active vault")),
    };
    let dir = store::vaults::vault_dir(&active_id);
    let db_path = dir.join("vault.db");

    // Ensure the parent directory exists.
    std::fs::create_dir_all(&dir)?;

    // If the file is a plaintext v1 SQLite DB on disk, migrate it in
    // place using the supplied master. This makes the FFI tolerant of
    // installs that upgraded from a pre-encryption build but never
    // opened the main app afterwards.
    if db_path.exists() && store::handle::is_plaintext_sqlite(&db_path)? {
        tracing::info!(?db_path, "Autofill FFI: migrating plaintext vault.db");
        store::handle::migrate_plaintext_v1_to_encrypted(&db_path, &dir, master)?;
    }

    let salt = store::db_key::ensure_salt(&dir)?;
    let key = store::db_key::derive_key(master, &salt)?;
    let conn = rusqlite::Connection::open(&db_path)?;
    let literal = store::db_key::pragma_key_literal(&key);
    conn.execute_batch(&format!("PRAGMA key = \"{literal}\";"))
        .map_err(|e| error::AppError::Storage(format!("PRAGMA key: {e}")))?;
    // Touch page 1 — wrong key surfaces here as SQLITE_NOTADB.
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(e, _))
            if matches!(
                e.code,
                rusqlite::ffi::ErrorCode::NotADatabase | rusqlite::ffi::ErrorCode::DatabaseCorrupt
            ) =>
        {
            return Err(error::AppError::Locked);
        }
        Err(e) => return Err(e.into()),
    }
    conn.pragma_update(None, "journal_mode", "WAL").ok();
    conn.pragma_update(None, "synchronous", "NORMAL").ok();
    store::schema::ensure_schema(&conn)?;
    Ok(conn)
}

#[unsafe(no_mangle)]
#[allow(clippy::missing_safety_doc)]
pub unsafe extern "C" fn free_password_ffi(s: *mut c_char) {
    if !s.is_null() {
        unsafe {
            let _ = CString::from_raw(s);
        }
    }
}

