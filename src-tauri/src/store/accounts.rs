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

/// Upsert an account row. Also clears any tombstone with the same key
/// in the same transaction — re-creating an account the user had
/// previously deleted must un-do the tombstone so the next snapshot
/// apply does not silently suppress the new row.
pub fn record(conn: &rusqlite::Connection, entry: &AccountEntry) -> AppResult<AccountEntry> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
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
    tx.execute(
        "DELETE FROM deleted_accounts WHERE domain = ?1 AND username = ?2",
        params![entry.domain, entry.username],
    )?;
    tx.commit()?;
    Ok(entry.clone())
}

/// Delete an account row and atomically record a tombstone so peers
/// learn about the delete on their next snapshot apply, even when the
/// originating `delete_account` event has been compacted server-side.
pub fn delete(conn: &rusqlite::Connection, domain: &str, username: &str) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM accounts WHERE domain = ?1 AND username = ?2",
        params![domain, username],
    )?;
    let now = super::vaults::now_ms();
    tx.execute(
        "INSERT INTO deleted_accounts(domain, username, deleted_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(domain, username) DO UPDATE SET deleted_at = excluded.deleted_at",
        params![domain, username, now],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct TombstoneRow {
    pub domain: String,
    pub username: String,
    pub deleted_at: i64,
}

/// Return every tombstone the local user has produced. Used by the
/// snapshot push path to populate `SyncableState.tombstones`.
pub fn list_tombstones(conn: &rusqlite::Connection) -> AppResult<Vec<TombstoneRow>> {
    let mut stmt = conn.prepare(
        "SELECT domain, username, deleted_at FROM deleted_accounts ORDER BY deleted_at ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(TombstoneRow {
            domain: r.get(0)?,
            username: r.get(1)?,
            deleted_at: r.get(2)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Merge a list of incoming tombstones into the local store. Used by
/// `applyStateLocally` on snapshot pull so the receiving device
/// carries forward every tombstone it learns about into its own
/// future snapshots.
pub fn merge_tombstones(conn: &rusqlite::Connection, incoming: &[TombstoneRow]) -> AppResult<()> {
    if incoming.is_empty() {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    for t in incoming {
        tx.execute(
            "INSERT INTO deleted_accounts(domain, username, deleted_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(domain, username) DO UPDATE SET
                 deleted_at = MAX(deleted_accounts.deleted_at, excluded.deleted_at)",
            params![t.domain, t.username, t.deleted_at],
        )?;
    }
    tx.commit()?;
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
        assert!(
            stamp.is_none(),
            "freshly-recorded row should have no sync stamp"
        );
    }

    #[test]
    fn stamp_synced_writes_both_timestamp_and_direction() {
        let conn = fresh_db();
        record(&conn, &fixture()).expect("record");
        stamp_synced(
            &conn,
            "example.com",
            "alice@example.com",
            1_700_000_000_000,
            SyncDir::Push,
        )
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
        stamp_synced(
            &conn,
            "example.com",
            "alice@example.com",
            1_000,
            SyncDir::Push,
        )
        .expect("stamp push");
        stamp_synced(
            &conn,
            "example.com",
            "alice@example.com",
            2_000,
            SyncDir::Pull,
        )
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

    #[test]
    fn delete_inserts_a_tombstone_in_the_same_transaction() {
        let conn = fresh_db();
        record(&conn, &fixture()).expect("record");
        delete(&conn, "example.com", "alice@example.com").expect("delete");

        let tombstones = list_tombstones(&conn).expect("list tombstones");
        assert_eq!(tombstones.len(), 1);
        assert_eq!(tombstones[0].domain, "example.com");
        assert_eq!(tombstones[0].username, "alice@example.com");
        assert!(tombstones[0].deleted_at > 0);

        let rows = list(&conn).expect("list accounts");
        assert!(rows.is_empty());
    }

    #[test]
    fn delete_on_missing_account_still_writes_a_tombstone() {
        let conn = fresh_db();
        // Cross-device delete contract: peer asked to delete X but we
        // never had it locally. A tombstone still records the intent so
        // the next snapshot we push tells other devices about it.
        delete(&conn, "never.here.example", "ghost").expect("delete");
        let tombstones = list_tombstones(&conn).expect("list");
        assert_eq!(tombstones.len(), 1);
        assert_eq!(tombstones[0].domain, "never.here.example");
    }

    #[test]
    fn record_clears_tombstone_for_the_recreated_pair() {
        let conn = fresh_db();
        record(&conn, &fixture()).expect("record");
        delete(&conn, "example.com", "alice@example.com").expect("delete");
        assert_eq!(list_tombstones(&conn).expect("list").len(), 1);

        // Re-create the account.
        record(&conn, &fixture()).expect("re-record");
        assert!(
            list_tombstones(&conn).expect("list").is_empty(),
            "re-creating an account must clear its tombstone"
        );
    }

    #[test]
    fn merge_tombstones_keeps_the_max_deleted_at_on_conflict() {
        let conn = fresh_db();
        merge_tombstones(
            &conn,
            &[TombstoneRow {
                domain: "a.com".into(),
                username: "u".into(),
                deleted_at: 100,
            }],
        )
        .expect("merge");
        merge_tombstones(
            &conn,
            &[TombstoneRow {
                domain: "a.com".into(),
                username: "u".into(),
                deleted_at: 50,
            }],
        )
        .expect("merge older");

        let rows = list_tombstones(&conn).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].deleted_at, 100);
    }

    #[test]
    fn merge_tombstones_is_a_noop_on_empty_input() {
        let conn = fresh_db();
        merge_tombstones(&conn, &[]).expect("empty merge");
        assert!(list_tombstones(&conn).expect("list").is_empty());
    }

    #[test]
    fn list_tombstones_returns_oldest_first() {
        let conn = fresh_db();
        merge_tombstones(
            &conn,
            &[
                TombstoneRow {
                    domain: "later.com".into(),
                    username: "u".into(),
                    deleted_at: 200,
                },
                TombstoneRow {
                    domain: "earlier.com".into(),
                    username: "u".into(),
                    deleted_at: 100,
                },
            ],
        )
        .expect("merge");

        let rows = list_tombstones(&conn).expect("list");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].domain, "earlier.com");
        assert_eq!(rows[1].domain, "later.com");
    }
}
