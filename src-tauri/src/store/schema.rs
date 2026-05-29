//! SQLite schema and migrations.
//!
//! Each migration is a `(version, sql)` pair. The current schema version
//! is the highest entry in `MIGRATIONS`. On every connection open we apply
//! any missing migrations in order.

use rusqlite::Connection;

use crate::error::AppResult;

const MIGRATIONS: &[(u32, &str)] = &[
    (
        1,
        r#"
    CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        default_profile_json TEXT NOT NULL,
        auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
        history_enabled INTEGER NOT NULL DEFAULT 0,
        favicon_fallback_enabled INTEGER NOT NULL DEFAULT 1,
        clipboard_clear_seconds INTEGER NOT NULL DEFAULT 30,
        fingerprint TEXT,
        -- `pin_blob_id` is a leftover from the original PIN design that
        -- stored the wrapped master inside the encrypted DB. The PIN blob
        -- now lives in a sidecar file (`store::pin_sidecar`) because it has
        -- to be readable before the SQLCipher key is known. The column is
        -- never read or written; dropping it would need a v4 migration so
        -- we keep it as a NULL slot.
        pin_blob_id TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sites (
        domain TEXT PRIMARY KEY,
        profile_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS accounts (
        domain TEXT NOT NULL,
        username TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        last_synced_at INTEGER,
        last_synced_dir TEXT CHECK (last_synced_dir IN ('push', 'pull')),
        PRIMARY KEY (domain, username)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS accounts_last_used_idx
        ON accounts(last_used_at DESC);

    CREATE TABLE IF NOT EXISTS pending_saves (
        domain TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        profile_json TEXT,
        created_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS recent_usernames (
        domain TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    ) STRICT;
    "#,
    ),
    (
        2,
        r#"
    -- Persistent FIFO queue of sync ops that have been locally committed
    -- but not yet acknowledged by the server. Drained on every sync push
    -- path; survives vault lock, pending session, and network outage.
    CREATE TABLE IF NOT EXISTS pending_ops (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        op_json     TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        attempts    INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS pending_ops_oldest_idx
        ON pending_ops(id ASC);
    "#,
    ),
    (
        3,
        r#"
    -- Tombstones for accounts the user explicitly deleted. Travels in
    -- the SyncableState v2 snapshot so peers can converge on the
    -- delete even when the originating delete_account event was
    -- compacted server-side. Re-creating an account clears its
    -- tombstone (see store::accounts::record).
    CREATE TABLE IF NOT EXISTS deleted_accounts (
        domain      TEXT NOT NULL,
        username    TEXT NOT NULL,
        deleted_at  INTEGER NOT NULL,
        PRIMARY KEY (domain, username)
    ) STRICT;
    "#,
    ),
    (
        4,
        r#"
    -- Match-only linked domains for an account, stored as a JSON array of
    -- strings. NEVER part of the derivation salt — the canonical `domain`
    -- column stays the sole identity + salt. NULL / absent means "no links".
    ALTER TABLE accounts ADD COLUMN linked_domains_json TEXT;
    "#,
    ),
];

pub fn ensure_schema(conn: &Connection) -> AppResult<()> {
    let current: u32 = conn.query_row(
        "SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'schema_version'), 0)",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    for (version, sql) in MIGRATIONS {
        if *version > current {
            conn.execute_batch(sql)?;
            conn.execute(
                "INSERT INTO meta(key, value) VALUES ('schema_version', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![version.to_string()],
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn migrations_apply_on_fresh_db() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        let version: String = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, "4");
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        ensure_schema(&conn).unwrap();
    }

    #[test]
    fn migration_v2_creates_pending_ops_table() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='pending_ops'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migration_v3_creates_deleted_accounts_table() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='deleted_accounts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let version: String = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, "4");
    }

    #[test]
    fn migration_v4_adds_linked_domains_column() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('accounts') WHERE name = 'linked_domains_json'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
