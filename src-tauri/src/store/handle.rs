//! Per-vault SQLite handle. Opened lazily once the user has chosen (or
//! created) an active vault. Closed on `lock()` to flush WAL.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

#[derive(Debug)]
pub struct StoreHandle {
    inner: Option<OpenStore>,
}

#[derive(Debug)]
pub struct OpenStore {
    pub vault_id: String,
    pub path: PathBuf,
    pub conn: Connection,
}

impl StoreHandle {
    pub fn uninitialised() -> Self {
        Self { inner: None }
    }

    pub fn open<P: AsRef<Path>>(vault_id: String, dir: P) -> AppResult<Self> {
        std::fs::create_dir_all(dir.as_ref())?;
        let path = dir.as_ref().join("vault.db");
        let conn = Connection::open(&path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        super::schema::ensure_schema(&conn)?;
        Ok(Self {
            inner: Some(OpenStore {
                vault_id,
                path,
                conn,
            }),
        })
    }

    pub fn close(&mut self) {
        self.inner.take();
    }

    pub fn require(&self) -> AppResult<&OpenStore> {
        self.inner.as_ref().ok_or(AppError::NoActiveVault)
    }

    pub fn require_mut(&mut self) -> AppResult<&mut OpenStore> {
        self.inner.as_mut().ok_or(AppError::NoActiveVault)
    }
}
