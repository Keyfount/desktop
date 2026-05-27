//! Biometric unlock commands.
//!
//! `enable_biometric` seals the unlocked-session master in the platform
//! Keychain behind a Touch ID / Windows Hello ACL. `unlock_biometric`
//! retrieves it (triggering the prompt) and feeds it back into the
//! unlock pipeline so the rest of the app sees a regular unlocked
//! session. `disable_biometric` wipes the Keychain entry.

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::crypto::{fingerprint_master, format_fingerprint};
use crate::error::{AppError, AppResult};
use crate::native::biometric::{Availability, Backend, keychain_entry};

#[derive(Debug, Serialize)]
pub struct BiometricAvailableResponse {
    pub supported: bool,
    pub enrolled: bool,
    /// True when the Keychain holds a sealed master for the active
    /// vault. Distinct from `enrolled`, which means "the OS has a
    /// biometric registered".
    #[serde(rename = "vaultEnrolled")]
    pub vault_enrolled: bool,
}

#[tauri::command]
pub async fn biometric_available(
    state: State<'_, AppState>,
) -> AppResult<BiometricAvailableResponse> {
    let backend = Backend;
    let avail = backend.availability();
    let vault_enrolled = match active_vault_id(&state).await {
        Ok(id) => backend.is_enrolled(&keychain_entry(&id)),
        Err(_) => false,
    };
    Ok(BiometricAvailableResponse {
        supported: !matches!(avail, Availability::Unsupported),
        enrolled: matches!(avail, Availability::Available),
        vault_enrolled,
    })
}

#[tauri::command]
pub async fn unlock_biometric(
    state: State<'_, AppState>,
) -> AppResult<crate::commands::session::UnlockResponse> {
    let backend = Backend;
    let vault_id = active_vault_id(&state).await?;
    let entry = keychain_entry(&vault_id);
    let bytes = backend
        .unseal(&entry, "Déverrouiller Keyfount")
        .map_err(AppError::invalid)?;
    let master = String::from_utf8(bytes)
        .map_err(|_| AppError::invalid("sealed master is not valid UTF-8"))?;
    let fp = fingerprint_master(&master)?;
    // Sanity check: the unsealed master should still match the stored
    // fingerprint. If not, the keychain blob is stale (e.g. the user
    // changed their master after enrolling) and we treat it as a hard
    // failure rather than silently unlocking with a wrong password.
    //
    // We read the fingerprint from the registry (available pre-unlock)
    // rather than from the DB; the DB now requires the SQLCipher key
    // before any read, which is exactly what we're about to do.
    let registry = crate::store::vaults::VaultRegistry::load(
        crate::store::vaults::registry_path(),
    )?;
    if let Some(meta) = registry.vaults.iter().find(|v| v.id == vault_id) {
        if !meta.fingerprint.is_empty() {
            let expected_bytes = hex_to_3(&meta.fingerprint)?;
            let eq: bool = subtle::ConstantTimeEq::ct_eq(&expected_bytes[..], &fp[..]).into();
            if !eq {
                return Err(AppError::invalid(
                    "sealed master no longer matches the vault — disable and re-enable Touch ID",
                ));
            }
        }
    }

    // Open the encrypted DB with the unsealed master. If somehow the
    // page key doesn't decrypt, we surface as Locked (the canonical
    // wrong-master signal).
    {
        let mut store = state.store.lock().await;
        store.open_encrypted(&master)?;
    }

    let mut session = state.session.lock().await;
    session.unlock(master, fp);
    Ok(crate::commands::session::UnlockResponse {
        fingerprint: format_fingerprint(&fp)?,
    })
}

#[tauri::command]
pub async fn enable_biometric(state: State<'_, AppState>) -> AppResult<()> {
    let backend = Backend;
    if matches!(backend.availability(), Availability::Unsupported) {
        return Err(AppError::Unsupported);
    }
    let master = {
        let session = state.session.lock().await;
        session
            .master()
            .ok_or_else(|| AppError::invalid("vault is locked"))?
            .to_string()
    };
    let vault_id = active_vault_id(&state).await?;
    let entry = keychain_entry(&vault_id);
    backend
        .seal(&entry, master.as_bytes())
        .map_err(AppError::invalid)?;
    Ok(())
}

#[tauri::command]
pub async fn disable_biometric(state: State<'_, AppState>) -> AppResult<()> {
    let backend = Backend;
    let vault_id = active_vault_id(&state).await?;
    let entry = keychain_entry(&vault_id);
    backend.clear(&entry).map_err(AppError::invalid)?;
    Ok(())
}

async fn active_vault_id(state: &State<'_, AppState>) -> AppResult<String> {
    let store = state.store.lock().await;
    // Biometric flows run BOTH pre- and post-unlock:
    //  - `biometric_available` and `unlock_biometric` run on the lock
    //    screen (vault is locked → DB is not open).
    //  - `enable_biometric` and `disable_biometric` run from settings
    //    while the vault is unlocked.
    // We only need the active-vault identity, available in both states.
    store
        .active_id()
        .map(|s| s.to_string())
        .ok_or(AppError::NoActiveVault)
}

fn hex_to_3(s: &str) -> AppResult<[u8; 3]> {
    let bytes =
        hex::decode(s).map_err(|e| AppError::Storage(format!("invalid fingerprint hex: {e}")))?;
    if bytes.len() < 3 {
        return Err(AppError::Storage("fingerprint hex too short".into()));
    }
    Ok([bytes[0], bytes[1], bytes[2]])
}
