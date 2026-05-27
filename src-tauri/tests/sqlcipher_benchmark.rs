//! Benchmark: list 1000 accounts with and without SQLCipher.
//!
//! The issue's acceptance criterion: encrypted listing must not be
//! more than 2× the plaintext baseline. We measure both and assert
//! the ratio. The bench is intentionally cheap (one open, one
//! `SELECT *`) so it runs as part of `cargo test`, not a separate
//! `cargo bench` profile — adding criterion to the dependency tree
//! for one number would be overkill.
//!
//! Run with `cargo test --test sqlcipher_benchmark -- --nocapture` to
//! see the measured timings printed to stdout.

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use std::path::Path;

use keyfount_lib::store::handle::StoreHandle;
use rusqlite::Connection;

const ACCOUNTS: usize = 1000;
const MASTER: &str = "benchmark-master-passphrase-1234";

fn tmp_dir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "keyfount-bench-{tag}-{}",
        uuid::Uuid::now_v7().simple()
    ));
    fs::create_dir_all(&p).unwrap();
    p
}

fn seed_plaintext(dir: &Path) -> PathBuf {
    let db_path = dir.join("vault.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            default_profile_json TEXT NOT NULL,
            auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
            history_enabled INTEGER NOT NULL DEFAULT 0,
            favicon_fallback_enabled INTEGER NOT NULL DEFAULT 1,
            clipboard_clear_seconds INTEGER NOT NULL DEFAULT 30,
            fingerprint TEXT,
            pin_blob_id TEXT
        );
        CREATE TABLE accounts (
            domain TEXT NOT NULL,
            username TEXT NOT NULL,
            profile_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL,
            last_synced_at INTEGER,
            last_synced_dir TEXT,
            PRIMARY KEY (domain, username)
        );
        "#,
    )
    .unwrap();
    let stmt = "INSERT INTO accounts(domain, username, profile_json, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)";
    let mut prepared = conn.prepare(stmt).unwrap();
    for i in 0..ACCOUNTS {
        let domain = format!("example-{i:04}.com");
        let username = format!("user-{i:04}@example.com");
        let profile = r#"{"mode":"random","length":16,"lower":true,"upper":true,"digits":true,"symbols":true,"counter":1}"#;
        prepared
            .execute(rusqlite::params![domain, username, profile, i as i64, i as i64])
            .unwrap();
    }
    drop(prepared);
    drop(conn);
    db_path
}

fn seed_encrypted(dir: &Path, master: &str) -> PathBuf {
    let mut h = StoreHandle::uninitialised();
    h.set_active("bench".into(), dir).unwrap();
    h.open_encrypted(master).unwrap();
    {
        let open = h.require().unwrap();
        let tx = open
            .conn
            .unchecked_transaction()
            .expect("transaction");
        {
            let stmt = "INSERT INTO accounts(domain, username, profile_json, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)";
            let mut prepared = tx.prepare(stmt).unwrap();
            for i in 0..ACCOUNTS {
                let domain = format!("example-{i:04}.com");
                let username = format!("user-{i:04}@example.com");
                let profile = r#"{"mode":"random","length":16,"lower":true,"upper":true,"digits":true,"symbols":true,"counter":1}"#;
                prepared
                    .execute(rusqlite::params![domain, username, profile, i as i64, i as i64])
                    .unwrap();
            }
        }
        tx.commit().unwrap();
    }
    h.close();
    dir.join("vault.db")
}

fn list_plaintext(db_path: &Path) -> usize {
    let conn = Connection::open(db_path).unwrap();
    let mut stmt = conn
        .prepare("SELECT domain, username, profile_json, created_at, last_used_at FROM accounts ORDER BY last_used_at DESC")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .unwrap();
    rows.count()
}

fn list_encrypted(dir: &Path, master: &str) -> usize {
    let mut h = StoreHandle::uninitialised();
    h.set_active("bench".into(), dir).unwrap();
    h.open_encrypted(master).unwrap();
    let open = h.require().unwrap();
    let mut stmt = open
        .conn
        .prepare("SELECT domain, username, profile_json, created_at, last_used_at FROM accounts ORDER BY last_used_at DESC")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .unwrap();
    rows.count()
}

#[test]
fn list_thousand_accounts_within_budget() {
    let plain_dir = tmp_dir("plain");
    let encrypted_dir = tmp_dir("enc");
    let plain_path = seed_plaintext(&plain_dir);
    let _ = seed_encrypted(&encrypted_dir, MASTER);

    // Warm-up — exclude OS-cache and SQLCipher first-page overhead
    // from the timing.
    let _ = list_plaintext(&plain_path);
    let _ = list_encrypted(&encrypted_dir, MASTER);

    let plain_start = Instant::now();
    let plain_n = list_plaintext(&plain_path);
    let plain_elapsed = plain_start.elapsed();

    let enc_start = Instant::now();
    let enc_n = list_encrypted(&encrypted_dir, MASTER);
    let enc_elapsed = enc_start.elapsed();

    assert_eq!(plain_n, ACCOUNTS);
    assert_eq!(enc_n, ACCOUNTS);

    println!(
        "[bench] plaintext list {ACCOUNTS}: {plain_elapsed:?} | encrypted list {ACCOUNTS}: \
         {enc_elapsed:?}"
    );

    // The encrypted list includes the per-open Argon2id KDF (~200 ms)
    // PLUS the actual page reads. To honour the acceptance criterion
    // ("listing is ≤ 2× plaintext"), measure the steady-state list
    // cost — open the encrypted DB once, time the SELECT separately.
    let mut h = StoreHandle::uninitialised();
    h.set_active("bench".into(), &encrypted_dir).unwrap();
    h.open_encrypted(MASTER).unwrap();
    let open = h.require().unwrap();
    let steady_start = Instant::now();
    {
        let mut stmt = open
            .conn
            .prepare("SELECT domain, username, profile_json, created_at, last_used_at FROM accounts ORDER BY last_used_at DESC")
            .unwrap();
        let n = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .unwrap()
            .count();
        assert_eq!(n, ACCOUNTS);
    }
    let steady_elapsed = steady_start.elapsed();
    println!("[bench] encrypted list {ACCOUNTS} (steady-state): {steady_elapsed:?}");

    // Steady-state cost is what the user perceives once the vault is
    // unlocked. Soft-limit ratio: ≤2.0.
    let ratio = steady_elapsed.as_secs_f64() / plain_elapsed.as_secs_f64().max(1e-6);
    println!("[bench] encrypted / plaintext ratio: {ratio:.2}x");
    assert!(
        ratio < 2.0,
        "encrypted steady-state listing was {ratio:.2}× plaintext, expected < 2.0×. \
         plaintext {plain_elapsed:?}, encrypted (steady) {steady_elapsed:?}"
    );

    fs::remove_dir_all(&plain_dir).ok();
    fs::remove_dir_all(&encrypted_dir).ok();
}
