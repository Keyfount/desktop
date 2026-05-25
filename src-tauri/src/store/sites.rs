//! Per-site profile overrides.

use rusqlite::{OptionalExtension, params};

use crate::error::AppResult;
use crate::types::Profile;

pub fn get(conn: &rusqlite::Connection, domain: &str) -> AppResult<Option<Profile>> {
    let row: Option<String> = conn
        .query_row(
            "SELECT profile_json FROM sites WHERE domain = ?",
            [domain],
            |r| r.get(0),
        )
        .optional()?;
    match row {
        Some(json) => Ok(Some(serde_json::from_str(&json)?)),
        None => Ok(None),
    }
}

pub fn upsert(
    conn: &rusqlite::Connection,
    domain: &str,
    profile: &Profile,
    now_ms: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO sites(domain, profile_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET
             profile_json = excluded.profile_json,
             updated_at = excluded.updated_at",
        params![domain, serde_json::to_string(profile)?, now_ms],
    )?;
    Ok(())
}

pub fn delete(conn: &rusqlite::Connection, domain: &str) -> AppResult<()> {
    conn.execute("DELETE FROM sites WHERE domain = ?", [domain])?;
    Ok(())
}
