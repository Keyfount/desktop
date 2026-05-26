//! Session lifecycle commands: setup, unlock, lock, fingerprint.

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::crypto::{fingerprint_master, format_fingerprint};
use crate::error::{AppError, AppResult};
use crate::store::{settings as settings_store, vaults as vault_store};

#[derive(Debug, Serialize)]
pub struct StatusResponse {
    pub locked: bool,
    #[serde(rename = "isFirstRun")]
    pub is_first_run: bool,
    pub fingerprint: Option<String>,
    #[serde(rename = "hasPin")]
    pub has_pin: bool,
}

#[tauri::command]
pub async fn status(state: State<'_, AppState>) -> AppResult<StatusResponse> {
    let session = state.session.lock().await;
    let mut store = state.store.lock().await;

    // Lazily reopen the active vault from the on-disk registry. Without
    // this, the very first `status()` after launch sees an empty
    // StoreHandle (because nothing initialised it) and reports
    // `isFirstRun: true` — so the UI runs the setup wizard again and
    // mints a duplicate vault next to the original. Doing it here makes
    // the restoration self-healing regardless of startup-hook timing.
    if store.require().is_err() {
        if let Ok(registry) = vault_store::VaultRegistry::load(vault_store::registry_path()) {
            if let Some(active_id) = registry.active_id.clone() {
                if registry.vaults.iter().any(|v| v.id == active_id) {
                    let dir = vault_store::vault_dir(&active_id);
                    match crate::store::StoreHandle::open(active_id, &dir) {
                        Ok(handle) => *store = handle,
                        Err(err) => {
                            tracing::warn!(?err, "could not reopen active vault");
                        }
                    }
                }
            }
        }
    }

    let (fingerprint, has_pin, has_state) = match store.require() {
        Ok(open) => {
            let st = settings_store::load(&open.conn)?;
            let fp = st
                .fingerprint
                .as_deref()
                .and_then(|hex| hex_to_3_bytes(hex).ok())
                .and_then(|b| format_fingerprint(&b).ok());
            (fp, st.pin.is_some(), st.fingerprint.is_some())
        }
        Err(_) => (None, false, false),
    };
    Ok(StatusResponse {
        locked: !session.is_unlocked(),
        is_first_run: !has_state,
        fingerprint,
        has_pin,
    })
}

#[derive(Debug, Serialize)]
pub struct UnlockResponse {
    pub fingerprint: String,
}

#[tauri::command]
pub async fn setup(master: String, state: State<'_, AppState>) -> AppResult<UnlockResponse> {
    if master.len() < 12 {
        return Err(AppError::invalid(
            "master password must be at least 12 characters",
        ));
    }
    let fp_bytes = fingerprint_master(&master)?;
    let mut store = state.store.lock().await;
    if store.require().is_err() {
        // Last-ditch: if a registry already exists with an active vault,
        // reopen it instead of minting a fresh one. Belt-and-braces so a
        // failed lazy-restore in status() doesn't end up creating a
        // duplicate vault the user can't easily delete.
        let mut registry = vault_store::VaultRegistry::load(vault_store::registry_path())?;
        if let Some(active_id) = registry.active_id.clone() {
            if registry.vaults.iter().any(|v| v.id == active_id) {
                let dir = vault_store::vault_dir(&active_id);
                *store = crate::store::StoreHandle::open(active_id, &dir)?;
            }
        }

        if store.require().is_err() {
            let vault_id = uuid::Uuid::now_v7().to_string();
            let dir = vault_store::vault_dir(&vault_id);
            *store = crate::store::StoreHandle::open(vault_id.clone(), &dir)?;
            registry.upsert(crate::types::VaultMeta {
                id: vault_id.clone(),
                fingerprint: hex::encode(fp_bytes),
                created_at: vault_store::now_ms(),
                last_used_at: vault_store::now_ms(),
            });
            registry.active_id = Some(vault_id);
            registry.save(vault_store::registry_path())?;
        }
    }
    let open = store.require_mut()?;
    settings_store::set_fingerprint(&open.conn, &hex::encode(fp_bytes))?;

    let mut session = state.session.lock().await;
    session.unlock(master, fp_bytes);
    Ok(UnlockResponse {
        fingerprint: format_fingerprint(&fp_bytes)?,
    })
}

#[tauri::command]
pub async fn unlock(master: String, state: State<'_, AppState>) -> AppResult<UnlockResponse> {
    let fp = fingerprint_master(&master)?;
    let store = state.store.lock().await;
    let open = store.require()?;
    let st = settings_store::load(&open.conn)?;
    let Some(expected) = st.fingerprint else {
        return Err(AppError::invalid("no fingerprint set — run setup first"));
    };
    let expected_bytes = hex_to_3_bytes(&expected)?;
    let eq: bool = subtle::ConstantTimeEq::ct_eq(&expected_bytes[..], &fp[..]).into();
    if !eq {
        return Err(AppError::invalid(
            "master password does not match the stored fingerprint",
        ));
    }
    let mut session = state.session.lock().await;
    session.unlock(master, fp);
    Ok(UnlockResponse {
        fingerprint: format_fingerprint(&fp)?,
    })
}

#[tauri::command]
pub async fn unlock_with_pin(pin: String, state: State<'_, AppState>) -> AppResult<UnlockResponse> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let st = settings_store::load(&open.conn)?;
    let Some(blob) = st.pin else {
        return Err(AppError::invalid("PIN mode is not enabled"));
    };
    let Some(master) = crate::crypto::decrypt_master(&blob, &pin)? else {
        return Err(AppError::invalid("incorrect PIN"));
    };
    let fp = fingerprint_master(&master)?;
    let mut session = state.session.lock().await;
    session.unlock(master, fp);
    Ok(UnlockResponse {
        fingerprint: format_fingerprint(&fp)?,
    })
}

#[tauri::command]
pub async fn lock(state: State<'_, AppState>) -> AppResult<()> {
    let mut session = state.session.lock().await;
    session.lock();
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct FingerprintResponse {
    pub fingerprint: String,
}

#[tauri::command]
pub async fn fingerprint(master: String) -> AppResult<FingerprintResponse> {
    let bytes = fingerprint_master(&master)?;
    Ok(FingerprintResponse {
        fingerprint: format_fingerprint(&bytes)?,
    })
}

#[derive(Debug, Serialize)]
pub struct SessionMasterResponse {
    pub master: String,
}

/// Returns the master held in the unlocked session. Sync flows need it
/// to run the OPAQUE handshake and derive EK; mirroring the extension's
/// `readMaster()` lets the UI avoid prompting twice while the vault is
/// already open. Errors out when locked so the caller can route the user
/// back to the unlock screen.
#[tauri::command]
pub async fn session_master(state: State<'_, AppState>) -> AppResult<SessionMasterResponse> {
    let session = state.session.lock().await;
    match session.master() {
        Some(master) => Ok(SessionMasterResponse {
            master: master.to_string(),
        }),
        None => Err(AppError::invalid("vault is locked")),
    }
}

fn hex_to_3_bytes(s: &str) -> AppResult<[u8; 3]> {
    let bytes =
        hex::decode(s).map_err(|e| AppError::Storage(format!("invalid fingerprint hex: {e}")))?;
    if bytes.len() < 3 {
        return Err(AppError::Storage("fingerprint hex too short".into()));
    }
    Ok([bytes[0], bytes[1], bytes[2]])
}
