//! Password generation and per-site profile management.

use serde::Serialize;
use tauri::State;

use crate::AppState;
use crate::crypto;
use crate::error::{AppError, AppResult};
use crate::store::{settings as settings_store, sites as sites_store};
use crate::types::{DerivationInputs, Profile};

#[derive(Debug, Serialize)]
pub struct GenerateResponse {
    pub password: String,
}

#[tauri::command]
pub async fn generate(
    domain: String,
    email: String,
    profile: Option<Profile>,
    state: State<'_, AppState>,
) -> AppResult<GenerateResponse> {
    let session = state.session.lock().await;
    let Some(master) = session.master() else {
        return Err(AppError::Locked);
    };
    let resolved_profile = match profile {
        Some(p) => p,
        None => {
            let store = state.store.lock().await;
            let open = store.require()?;
            sites_store::get(&open.conn, &domain.trim().to_lowercase())?.unwrap_or_else(|| {
                settings_store::load(&open.conn)
                    .map(|s| s.default_profile)
                    .unwrap_or_else(|_| Profile::default_random())
            })
        }
    };
    let inputs = DerivationInputs {
        master: master.to_string(),
        domain,
        email,
    };
    let password = crypto::derive_password(&inputs, &resolved_profile).await?;
    Ok(GenerateResponse { password })
}

#[derive(Debug, Serialize)]
pub struct GetProfileResponse {
    pub profile: Profile,
    #[serde(rename = "isOverride")]
    pub is_override: bool,
}

#[tauri::command]
pub async fn get_profile(
    domain: String,
    state: State<'_, AppState>,
) -> AppResult<GetProfileResponse> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let key = domain.trim().to_lowercase();
    if let Some(p) = sites_store::get(&open.conn, &key)? {
        return Ok(GetProfileResponse {
            profile: p,
            is_override: true,
        });
    }
    let st = settings_store::load(&open.conn)?;
    Ok(GetProfileResponse {
        profile: st.default_profile,
        is_override: false,
    })
}

#[tauri::command]
pub async fn set_profile(
    domain: String,
    profile: Profile,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    sites_store::upsert(
        &open.conn,
        &domain.trim().to_lowercase(),
        &profile,
        crate::store::vaults::now_ms(),
    )
}

#[tauri::command]
pub async fn delete_profile(domain: String, state: State<'_, AppState>) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    sites_store::delete(&open.conn, &domain.trim().to_lowercase())
}

#[tauri::command]
pub async fn set_default_profile(profile: Profile, state: State<'_, AppState>) -> AppResult<()> {
    let store = state.store.lock().await;
    let open = store.require()?;
    let mut st = settings_store::load(&open.conn)?;
    st.default_profile = profile;
    settings_store::save_defaults(&open.conn, &st)
}
