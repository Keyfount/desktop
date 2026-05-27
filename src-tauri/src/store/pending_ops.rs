//! Persistent FIFO queue of sync ops that have been locally committed
//! but not yet acknowledged by the server.
//!
//! Rows are inserted by [`enqueue`] after the local mutation commits,
//! and removed by [`delete_by_id`] when the drainer confirms the
//! server accepted the op. Failed pushes leave the row in place and
//! bump its `attempts` via [`record_failure`] so the next drain
//! re-tries it later.
//!
//! Order is preserved by `id` (autoincrement) — drainers MUST consume
//! oldest-first so a `delete_account` queued behind an `upsert_account`
//! for the same `(domain, username)` does not lose to an out-of-order
//! upsert pushed live.

use rusqlite::{Connection, params};

use crate::error::AppResult;

#[derive(Debug, Clone)]
pub struct PendingOpRow {
    pub id: i64,
    pub op_json: String,
    pub created_at: i64,
    pub attempts: i64,
    pub last_error: Option<String>,
}

/// Append a serialised op to the queue. Returns the new row id.
pub fn enqueue(conn: &Connection, op_json: &str) -> AppResult<i64> {
    let now = super::vaults::now_ms();
    conn.execute(
        "INSERT INTO pending_ops (op_json, created_at) VALUES (?1, ?2)",
        params![op_json, now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Return up to `limit` queued ops in insertion order (oldest first).
pub fn list_oldest_first(conn: &Connection, limit: i64) -> AppResult<Vec<PendingOpRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, op_json, created_at, attempts, last_error
         FROM pending_ops
         ORDER BY id ASC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |r| {
        Ok(PendingOpRow {
            id: r.get(0)?,
            op_json: r.get(1)?,
            created_at: r.get(2)?,
            attempts: r.get(3)?,
            last_error: r.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Bump `attempts` and record the most recent failure reason on the
/// given row. The row stays in the queue.
pub fn record_failure(conn: &Connection, id: i64, error: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE pending_ops SET attempts = attempts + 1, last_error = ?2 WHERE id = ?1",
        params![id, error],
    )?;
    Ok(())
}

/// Remove a row once the server has acknowledged it.
pub fn delete_by_id(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM pending_ops WHERE id = ?1", params![id])?;
    Ok(())
}

/// Total number of rows currently queued. Useful for tests and the
/// future "N pending" UI indicator.
pub fn count(conn: &Connection) -> AppResult<i64> {
    let n: i64 = conn.query_row("SELECT count(*) FROM pending_ops", [], |r| r.get(0))?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::store::schema::ensure_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn enqueue_then_list_returns_in_insertion_order() {
        let conn = fresh_conn();
        let id1 = enqueue(
            &conn,
            "{\"t\":\"delete_account\",\"domain\":\"a.com\",\"username\":\"u\"}",
        )
        .unwrap();
        let id2 = enqueue(&conn, "{\"t\":\"upsert_account\"}").unwrap();

        let rows = list_oldest_first(&conn, 100).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, id1);
        assert_eq!(rows[1].id, id2);
        assert_eq!(rows[0].attempts, 0);
        assert!(rows[0].last_error.is_none());
        assert!(rows[0].created_at > 0);
    }

    #[test]
    fn record_failure_increments_attempts_and_keeps_row() {
        let conn = fresh_conn();
        let id = enqueue(&conn, "{\"t\":\"set_pref\"}").unwrap();
        record_failure(&conn, id, "network timeout").unwrap();
        record_failure(&conn, id, "still down").unwrap();

        let rows = list_oldest_first(&conn, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].attempts, 2);
        assert_eq!(rows[0].last_error.as_deref(), Some("still down"));
    }

    #[test]
    fn delete_by_id_removes_the_row() {
        let conn = fresh_conn();
        let id = enqueue(&conn, "{}").unwrap();
        delete_by_id(&conn, id).unwrap();
        assert_eq!(list_oldest_first(&conn, 10).unwrap().len(), 0);
        assert_eq!(count(&conn).unwrap(), 0);
    }

    #[test]
    fn list_respects_limit() {
        let conn = fresh_conn();
        for _ in 0..5 {
            enqueue(&conn, "{}").unwrap();
        }
        let rows = list_oldest_first(&conn, 3).unwrap();
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn count_reflects_inserts_and_deletes() {
        let conn = fresh_conn();
        assert_eq!(count(&conn).unwrap(), 0);
        enqueue(&conn, "{}").unwrap();
        enqueue(&conn, "{}").unwrap();
        assert_eq!(count(&conn).unwrap(), 2);
    }
}
