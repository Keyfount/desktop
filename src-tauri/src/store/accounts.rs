//! Account history (opt-in). Stores `(domain, username, profile, timestamps)`
//! tuples — never the password.

use rusqlite::params;

use crate::error::AppResult;
use crate::types::{AccountEntry, Profile};

pub fn list(conn: &rusqlite::Connection) -> AppResult<Vec<AccountEntry>> {
    let mut stmt = conn.prepare(
        "SELECT domain, username, profile_json, created_at, last_used_at
         FROM accounts
         ORDER BY last_used_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        let domain: String = r.get(0)?;
        let username: String = r.get(1)?;
        let json: String = r.get(2)?;
        let created: i64 = r.get(3)?;
        let last: i64 = r.get(4)?;
        Ok((domain, username, json, created, last))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (domain, username, json, created_at, last_used_at) = row?;
        let profile: Profile = serde_json::from_str(&json)?;
        out.push(AccountEntry {
            domain,
            username,
            profile,
            created_at,
            last_used_at,
        });
    }
    Ok(out)
}

pub fn record(conn: &rusqlite::Connection, entry: &AccountEntry) -> AppResult<AccountEntry> {
    conn.execute(
        "INSERT INTO accounts(domain, username, profile_json, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(domain, username) DO UPDATE SET
             profile_json = excluded.profile_json,
             last_used_at = excluded.last_used_at",
        params![
            entry.domain,
            entry.username,
            serde_json::to_string(&entry.profile)?,
            entry.created_at,
            entry.last_used_at,
        ],
    )?;
    Ok(entry.clone())
}

pub fn delete(conn: &rusqlite::Connection, domain: &str, username: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM accounts WHERE domain = ? AND username = ?",
        params![domain, username],
    )?;
    Ok(())
}

pub fn rename(
    conn: &rusqlite::Connection,
    domain: &str,
    old_username: &str,
    new_username: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE accounts SET username = ?
         WHERE domain = ? AND username = ?",
        params![new_username, domain, old_username],
    )?;
    Ok(())
}

pub fn update_profile(
    conn: &rusqlite::Connection,
    domain: &str,
    username: &str,
    profile: &Profile,
) -> AppResult<()> {
    conn.execute(
        "UPDATE accounts SET profile_json = ?
         WHERE domain = ? AND username = ?",
        params![serde_json::to_string(profile)?, domain, username],
    )?;
    Ok(())
}
