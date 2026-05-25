//! Centralised error type. Every Tauri command returns `Result<T, AppError>`
//! so the frontend gets a consistent shape and we can map low-level errors
//! (rusqlite, argon2, opaque, network) to a stable taxonomy.

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("crypto failure: {0}")]
    Crypto(String),

    #[error("storage failure: {0}")]
    Storage(String),

    #[error("invalid input: {0}")]
    Invalid(String),

    #[error("locked")]
    Locked,

    #[error("no active vault")]
    NoActiveVault,

    #[error("network failure: {0}")]
    Network(String),

    #[error("not supported on this platform")]
    Unsupported,

    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn invalid<S: Into<String>>(reason: S) -> Self {
        Self::Invalid(reason.into())
    }

    pub fn internal<S: Into<String>>(reason: S) -> Self {
        Self::Internal(reason.into())
    }

    pub fn storage<S: Into<String>>(reason: S) -> Self {
        Self::Storage(reason.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        let (kind, message) = match self {
            Self::Crypto(_) => ("crypto", self.to_string()),
            Self::Storage(_) => ("storage", self.to_string()),
            Self::Invalid(_) => ("invalid", self.to_string()),
            Self::Locked => ("locked", "locked".to_string()),
            Self::NoActiveVault => ("no_active_vault", "no active vault".to_string()),
            Self::Network(_) => ("network", self.to_string()),
            Self::Unsupported => ("unsupported", "not supported on this platform".to_string()),
            Self::Internal(_) => ("internal", self.to_string()),
        };
        state.serialize_field("kind", kind)?;
        state.serialize_field("message", &message)?;
        state.end()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::Storage(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        Self::Internal(err.to_string())
    }
}

impl From<argon2::password_hash::Error> for AppError {
    fn from(err: argon2::password_hash::Error) -> Self {
        Self::Crypto(err.to_string())
    }
}

impl From<argon2::Error> for AppError {
    fn from(err: argon2::Error) -> Self {
        Self::Crypto(err.to_string())
    }
}

impl From<aes_gcm::Error> for AppError {
    fn from(err: aes_gcm::Error) -> Self {
        Self::Crypto(err.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(err: keyring::Error) -> Self {
        Self::Storage(err.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
