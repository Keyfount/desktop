//! Vault registry — `vaults.json` next to the per-vault directories.
//!
//! Lists every known vault and tracks the active one. The active vault
//! drives where `StoreHandle::open` looks for the SQLite file.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::types::VaultMeta;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultRegistry {
    #[serde(rename = "schemaVersion", default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(rename = "activeId", default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub vaults: Vec<VaultMeta>,
}

fn default_schema_version() -> u32 {
    1
}

impl Default for VaultRegistry {
    fn default() -> Self {
        Self {
            schema_version: 1,
            active_id: None,
            vaults: Vec::new(),
        }
    }
}

impl VaultRegistry {
    pub fn load<P: AsRef<Path>>(path: P) -> AppResult<Self> {
        match fs::read_to_string(path.as_ref()) {
            Ok(s) => Ok(serde_json::from_str(&s)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save<P: AsRef<Path>>(&self, path: P) -> AppResult<()> {
        if let Some(parent) = path.as_ref().parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        fs::write(path.as_ref(), json + "\n")?;
        Ok(())
    }

    pub fn upsert(&mut self, meta: VaultMeta) {
        if let Some(slot) = self.vaults.iter_mut().find(|v| v.id == meta.id) {
            *slot = meta;
        } else {
            self.vaults.push(meta);
        }
    }

    pub fn remove(&mut self, id: &str) {
        self.vaults.retain(|v| v.id != id);
        if self.active_id.as_deref() == Some(id) {
            self.active_id = self
                .vaults
                .iter()
                .max_by_key(|v| v.last_used_at)
                .map(|v| v.id.clone());
        }
    }

    pub fn touch_active(&mut self) {
        let Some(id) = self.active_id.clone() else {
            return;
        };
        let now = now_ms();
        if let Some(meta) = self.vaults.iter_mut().find(|v| v.id == id) {
            meta.last_used_at = now;
        }
    }
}

pub fn root_dir() -> PathBuf {
    if let Some(d) = dirs_appdata_keyfount() {
        return d;
    }
    PathBuf::from(".keyfount")
}

#[cfg(target_os = "macos")]
fn dirs_appdata_keyfount() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|p| p.join("Library/Application Support/Keyfount"))
}

#[cfg(target_os = "windows")]
fn dirs_appdata_keyfount() -> Option<PathBuf> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|p| p.join("Keyfount"))
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn dirs_appdata_keyfount() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .or_else(|| {
            std::env::var_os("HOME").map(|h| {
                let mut p = PathBuf::from(h);
                p.push(".local/share");
                p.into_os_string()
            })
        })
        .map(PathBuf::from)
        .map(|p| p.join("Keyfount"))
}

pub fn vault_dir(vault_id: &str) -> PathBuf {
    root_dir().join(vault_id)
}

pub fn registry_path() -> PathBuf {
    root_dir().join("vaults.json")
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn registry_default_is_empty() {
        let r = VaultRegistry::default();
        assert!(r.active_id.is_none());
        assert!(r.vaults.is_empty());
    }

    #[test]
    fn upsert_replaces_existing() {
        let mut r = VaultRegistry::default();
        r.upsert(VaultMeta {
            id: "a".into(),
            fingerprint: "1".into(),
            created_at: 1,
            last_used_at: 1,
        });
        r.upsert(VaultMeta {
            id: "a".into(),
            fingerprint: "1".into(),
            created_at: 1,
            last_used_at: 99,
        });
        assert_eq!(r.vaults.len(), 1);
        assert_eq!(r.vaults[0].last_used_at, 99);
    }

    #[test]
    fn remove_active_falls_back_to_most_recent() {
        let mut r = VaultRegistry::default();
        r.upsert(VaultMeta {
            id: "a".into(),
            fingerprint: "1".into(),
            created_at: 1,
            last_used_at: 1,
        });
        r.upsert(VaultMeta {
            id: "b".into(),
            fingerprint: "2".into(),
            created_at: 2,
            last_used_at: 50,
        });
        r.active_id = Some("a".into());
        r.remove("a");
        assert_eq!(r.active_id.as_deref(), Some("b"));
    }

    #[test]
    fn load_save_round_trip() {
        let tmp = env::temp_dir().join("keyfount-test-vaults.json");
        let _ = std::fs::remove_file(&tmp);
        let mut r = VaultRegistry::default();
        r.upsert(VaultMeta {
            id: "x".into(),
            fingerprint: "a1".into(),
            created_at: 1,
            last_used_at: 1,
        });
        r.save(&tmp).unwrap();
        let back = VaultRegistry::load(&tmp).unwrap();
        assert_eq!(back.vaults.len(), 1);
        assert_eq!(back.vaults[0].id, "x");
        let _ = std::fs::remove_file(&tmp);
    }
}
