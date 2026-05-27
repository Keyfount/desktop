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

    // Lazily mark the active vault from the on-disk registry. Without
    // this, the very first `status()` after launch sees an empty
    // StoreHandle (because nothing initialised it) and reports
    // `isFirstRun: true` — so the UI runs the setup wizard again and
    // mints a duplicate vault next to the original. We DO NOT open the
    // encrypted DB here: the master isn't available yet at this point.
    if store.active_id().is_none() {
        if let Ok(registry) = vault_store::VaultRegistry::load(vault_store::registry_path()) {
            if let Some(active_id) = registry.active_id.clone() {
                if registry.vaults.iter().any(|v| v.id == active_id) {
                    let dir = vault_store::vault_dir(&active_id);
                    if let Err(err) = store.set_active(active_id, &dir) {
                        tracing::warn!(?err, "could not mark active vault");
                    }
                }
            }
        }
    }

    // Try the DB first (it's the source of truth when unlocked); fall
    // back to the registry record (visible while locked). The registry
    // stores the fingerprint as a hex string captured at setup time.
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
        Err(_) => {
            // Locked or uninitialised. Recover fingerprint + existence
            // from the registry so the UI can show the unlock prompt.
            let active_id = store.active_id().map(str::to_string);
            let mut fp = None;
            let mut has_state = false;
            if let Some(id) = active_id {
                if let Ok(registry) =
                    vault_store::VaultRegistry::load(vault_store::registry_path())
                {
                    if let Some(meta) = registry.vaults.iter().find(|v| v.id == id) {
                        has_state = true;
                        fp = hex_to_3_bytes(&meta.fingerprint)
                            .ok()
                            .and_then(|b| format_fingerprint(&b).ok());
                    }
                }
            }
            (fp, false, has_state)
        }
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

    // First try to reopen an existing active vault from the registry —
    // setup is otherwise destructive (would mint a duplicate vault).
    if store.active_id().is_none() {
        let registry = vault_store::VaultRegistry::load(vault_store::registry_path())?;
        if let Some(active_id) = registry.active_id.clone() {
            if registry.vaults.iter().any(|v| v.id == active_id) {
                let dir = vault_store::vault_dir(&active_id);
                store.set_active(active_id, &dir)?;
            }
        }
    }

    if store.active_id().is_none() {
        // First run: mint a fresh vault id, create the directory, and
        // register it before we open the encrypted DB. The page key is
        // derived from `master + <dir>/db-salt`, so the salt has to be
        // on disk before `open_encrypted` runs (it auto-creates one if
        // missing).
        let vault_id = uuid::Uuid::now_v7().to_string();
        let dir = vault_store::vault_dir(&vault_id);
        store.set_active(vault_id.clone(), &dir)?;
        let mut registry = vault_store::VaultRegistry::load(vault_store::registry_path())?;
        registry.upsert(crate::types::VaultMeta {
            id: vault_id.clone(),
            fingerprint: hex::encode(fp_bytes),
            created_at: vault_store::now_ms(),
            last_used_at: vault_store::now_ms(),
        });
        registry.active_id = Some(vault_id);
        registry.save(vault_store::registry_path())?;
    }

    store.open_encrypted(&master)?;
    let open = store.require_mut()?;
    settings_store::set_fingerprint(&open.conn, &hex::encode(fp_bytes))?;

    // Make sure the registry record's fingerprint matches the just-set
    // master. Setup-after-reopen reuses an existing vault id, so the
    // registry value might be a different (or empty) fingerprint.
    let active_id = open.vault_id.clone();
    let mut registry = vault_store::VaultRegistry::load(vault_store::registry_path())?;
    if let Some(meta) = registry.vaults.iter_mut().find(|v| v.id == active_id) {
        meta.fingerprint = hex::encode(fp_bytes);
    }
    registry.save(vault_store::registry_path())?;

    let mut session = state.session.lock().await;
    session.unlock(master, fp_bytes);
    Ok(UnlockResponse {
        fingerprint: format_fingerprint(&fp_bytes)?,
    })
}

#[tauri::command]
pub async fn unlock(master: String, state: State<'_, AppState>) -> AppResult<UnlockResponse> {
    let fp = fingerprint_master(&master)?;
    let mut store = state.store.lock().await;

    // Pre-check the master against the registry's stored fingerprint —
    // gives the user a fast "wrong password" without paying the full
    // SQLCipher KDF cost. The registry fingerprint is the same hex
    // string that lives in `settings.fingerprint` inside the encrypted
    // DB, but it's available while the DB is still locked.
    let Some(active_id) = store.active_id().map(str::to_string) else {
        return Err(AppError::invalid("no active vault"));
    };
    let registry = vault_store::VaultRegistry::load(vault_store::registry_path())?;
    let meta = registry
        .vaults
        .iter()
        .find(|v| v.id == active_id)
        .ok_or_else(|| AppError::invalid("active vault not in registry"))?;
    let expected_bytes = hex_to_3_bytes(&meta.fingerprint).map_err(|_| {
        AppError::invalid("no fingerprint set — run setup first")
    })?;
    let eq: bool = subtle::ConstantTimeEq::ct_eq(&expected_bytes[..], &fp[..]).into();
    if !eq {
        // Pre-check fingerprint mismatch — keep the user-friendly
        // message so the UI shows "wrong master" rather than the
        // generic "locked" toast. The downstream SQLCipher open is
        // the canonical wrong-master signal (returns AppError::Locked).
        return Err(AppError::invalid(
            "master password does not match the stored fingerprint",
        ));
    }

    // Opens the SQLCipher DB. Returns `AppError::Locked` if the
    // derived key doesn't decrypt the file (shouldn't happen given the
    // fingerprint match above, but treated as the canonical "wrong
    // master" signal regardless).
    store.open_encrypted(&master)?;

    let mut session = state.session.lock().await;
    session.unlock(master, fp);
    Ok(UnlockResponse {
        fingerprint: format_fingerprint(&fp)?,
    })
}

#[tauri::command]
pub async fn unlock_with_pin(pin: String, state: State<'_, AppState>) -> AppResult<UnlockResponse> {
    // PIN persistence (#25) is not yet implemented — the schema slot
    // exists but nothing reads/writes it. Once it is, the PIN blob has
    // to live OUTSIDE the encrypted vault (e.g. in a sidecar file or
    // the OS keychain) because we need to recover the master before
    // the DB can be opened. For now we just return the standard "PIN
    // mode is not enabled" error so the UI falls back to the master
    // prompt.
    let _ = pin;
    let _ = state;
    Err(AppError::invalid("PIN mode is not enabled"))
}

#[tauri::command]
pub async fn lock(state: State<'_, AppState>) -> AppResult<()> {
    // Zero the in-memory master AND close the SQLCipher connection.
    // Closing the connection forces a WAL checkpoint and lets the OS
    // free the cached page-key material that the SQLCipher
    // implementation keeps alongside the SQLite handle. The vault
    // identity is preserved so the next `unlock` reopens the same DB.
    let mut session = state.session.lock().await;
    session.lock();
    let mut store = state.store.lock().await;
    store.close();
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
