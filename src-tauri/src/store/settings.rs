//! Settings CRUD against the `settings` row (single-row table).

use rusqlite::{OptionalExtension, params};

use crate::error::AppResult;
use crate::store::{DEFAULT_CLIPBOARD_CLEAR_SECONDS, SCHEMA_VERSION, StoredState};
use crate::types::Profile;

pub fn load(conn: &rusqlite::Connection) -> AppResult<StoredState> {
    let row: Option<(String, u32, u32, u32, u32, Option<String>)> = conn
        .query_row(
            "SELECT default_profile_json, auto_lock_minutes, history_enabled,
                    favicon_fallback_enabled, clipboard_clear_seconds, fingerprint
             FROM settings WHERE id = 1",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .optional()?;

    let mut state = StoredState::default();
    if let Some((profile_json, lock, hist, fav, clip, fp)) = row {
        state.default_profile = serde_json::from_str(&profile_json)?;
        state.auto_lock_minutes = lock;
        state.history_enabled = hist != 0;
        state.favicon_fallback_enabled = fav != 0;
        state.clipboard_clear_seconds = clip;
        state.fingerprint = fp;
    }

    // Hydrate sites
    let mut stmt = conn.prepare("SELECT domain, profile_json FROM sites")?;
    let rows = stmt.query_map([], |r| {
        let domain: String = r.get(0)?;
        let json: String = r.get(1)?;
        Ok((domain, json))
    })?;
    for row in rows {
        let (domain, json) = row?;
        let profile: Profile = serde_json::from_str(&json)?;
        state.sites.insert(domain, profile);
    }

    Ok(state)
}

pub fn save_defaults(conn: &rusqlite::Connection, state: &StoredState) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(id, default_profile_json, auto_lock_minutes,
                              history_enabled, favicon_fallback_enabled,
                              clipboard_clear_seconds, fingerprint)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
             default_profile_json = excluded.default_profile_json,
             auto_lock_minutes = excluded.auto_lock_minutes,
             history_enabled = excluded.history_enabled,
             favicon_fallback_enabled = excluded.favicon_fallback_enabled,
             clipboard_clear_seconds = excluded.clipboard_clear_seconds,
             fingerprint = excluded.fingerprint",
        params![
            serde_json::to_string(&state.default_profile)?,
            state.auto_lock_minutes,
            state.history_enabled as i64,
            state.favicon_fallback_enabled as i64,
            state.clipboard_clear_seconds,
            state.fingerprint,
        ],
    )?;
    Ok(())
}

pub fn set_fingerprint(conn: &rusqlite::Connection, fp: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings(id, default_profile_json, auto_lock_minutes,
                              history_enabled, favicon_fallback_enabled,
                              clipboard_clear_seconds, fingerprint)
         VALUES (1, ?, 15, 0, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET fingerprint = excluded.fingerprint",
        params![
            serde_json::to_string(&Profile::default_random())?,
            DEFAULT_CLIPBOARD_CLEAR_SECONDS,
            fp,
        ],
    )?;
    Ok(())
}

pub fn schema_version() -> u32 {
    SCHEMA_VERSION
}
