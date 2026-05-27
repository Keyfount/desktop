//! Account history (opt-in). Stores `(domain, username, profile, timestamps)`
//! tuples — never the password.

use rusqlite::params;

use crate::error::AppResult;
use crate::types::{AccountEntry, Profile};

/// Returns accounts whose `last_synced_at` column is NULL — i.e. local
/// writes the sync pipeline hasn't yet observed. The AutoFill
/// extension inserts via `record_account_ffi` and leaves the column
/// unset; this query is what the desktop frontend reads on startup to
/// replay them through `syncBus`.
pub fn list_unsynced(conn: &rusqlite::Connection) -> AppResult<Vec<AccountEntry>> {
    list_with_clause(conn, "WHERE last_synced_at IS NULL")
}

pub fn list(conn: &rusqlite::Connection) -> AppResult<Vec<AccountEntry>> {
    list_with_clause(conn, "")
}

fn list_with_clause(conn: &rusqlite::Connection, clause: &str) -> AppResult<Vec<AccountEntry>> {
    let sql = format!(
        "SELECT domain, username, profile_json, created_at, last_used_at
         FROM accounts {clause}
         ORDER BY last_used_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
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

/// Direction the last sync flowed in. Mirrors the schema CHECK
/// constraint and the extension's `SyncStamp.dir`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncDir {
    Push,
    Pull,
}

impl SyncDir {
    fn as_str(self) -> &'static str {
        match self {
            Self::Push => "push",
            Self::Pull => "pull",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "push" => Some(Self::Push),
            "pull" => Some(Self::Pull),
            _ => None,
        }
    }
}

/// Stamp the (last_synced_at, last_synced_dir) columns for one account.
/// Called by the JS sync engine after a successful push or pull. The
/// row stays untouched if no matching (domain, username) exists, so
/// stamping a freshly-deleted account is a no-op rather than an error.
pub fn stamp_synced(
    conn: &rusqlite::Connection,
    domain: &str,
    username: &str,
    ts_ms: i64,
    dir: SyncDir,
) -> AppResult<()> {
    conn.execute(
        "UPDATE accounts
         SET last_synced_at = ?, last_synced_dir = ?
         WHERE domain = ? AND username = ?",
        params![ts_ms, dir.as_str(), domain, username],
    )?;
    Ok(())
}

/// Per-account sync stamp. `None` means the row was never observed by
/// the sync pipeline (freshly created locally, or never pushed/pulled).
#[derive(Debug, Clone)]
pub struct SyncStamp {
    pub ts_ms: i64,
    pub dir: SyncDir,
}

pub fn get_sync_stamp(
    conn: &rusqlite::Connection,
    domain: &str,
    username: &str,
) -> AppResult<Option<SyncStamp>> {
    let mut stmt = conn.prepare(
        "SELECT last_synced_at, last_synced_dir
         FROM accounts
         WHERE domain = ? AND username = ?",
    )?;
    let row = stmt.query_row(params![domain, username], |r| {
        let ts: Option<i64> = r.get(0)?;
        let dir: Option<String> = r.get(1)?;
        Ok((ts, dir))
    });
    match row {
        Ok((Some(ts), Some(dir_str))) => {
            if let Some(dir) = SyncDir::from_str(&dir_str) {
                Ok(Some(SyncStamp { ts_ms: ts, dir }))
            } else {
                // Unknown direction (shouldn't happen given the CHECK
                // constraint, but be lenient) — treat as "no stamp".
                Ok(None)
            }
        }
        Ok(_) => Ok(None),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::schema::ensure_schema;
    use crate::types::RandomProfile;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        ensure_schema(&conn).expect("schema");
        conn
    }

    fn fixture() -> AccountEntry {
        AccountEntry {
            domain: "example.com".into(),
            username: "alice@example.com".into(),
            profile: Profile::Random(RandomProfile::default()),
            created_at: 0,
            last_used_at: 0,
        }
    }

    #[test]
    fn fresh_account_has_no_sync_stamp() {
        let conn = fresh_db();
        record(&conn, &fixture()).expect("record");
        let stamp = get_sync_stamp(&conn, "example.com", "alice@example.com").expect("query");
        assert!(stamp.is_none(), "freshly-recorded row should have no sync stamp");
    }

    #[test]
    fn stamp_synced_writes_both_timestamp_and_direction() {
        let conn = fresh_db();
        record(&conn, &fixture()).expect("record");
        stamp_synced(&conn, "example.com", "alice@example.com", 1_700_000_000_000, SyncDir::Push)
            .expect("stamp");
        let stamp = get_sync_stamp(&conn, "example.com", "alice@example.com")
            .expect("query")
            .expect("stamp present");
        assert_eq!(stamp.ts_ms, 1_700_000_000_000);
        assert_eq!(stamp.dir, SyncDir::Push);
    }

    #[test]
    fn stamp_synced_overwrites_with_latest_direction() {
        let conn = fresh_db();
        record(&conn, &fixture()).expect("record");
        stamp_synced(&conn, "example.com", "alice@example.com", 1_000, SyncDir::Push)
            .expect("stamp push");
        stamp_synced(&conn, "example.com", "alice@example.com", 2_000, SyncDir::Pull)
            .expect("stamp pull");
        let stamp = get_sync_stamp(&conn, "example.com", "alice@example.com")
            .expect("query")
            .expect("stamp present");
        assert_eq!(stamp.ts_ms, 2_000);
        assert_eq!(stamp.dir, SyncDir::Pull);
    }

    #[test]
    fn stamp_synced_is_a_noop_when_row_is_missing() {
        let conn = fresh_db();
        // Should not error even though no matching row exists.
        stamp_synced(&conn, "missing.example", "ghost", 1_000, SyncDir::Push).expect("noop");
        let stamp = get_sync_stamp(&conn, "missing.example", "ghost").expect("query");
        assert!(stamp.is_none());
    }
}
