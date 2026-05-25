//! HTTP client for the Keyfount sync server.
//!
//! The actual OPAQUE login and pull/push flows are completed in M6. This
//! module exposes the URL builders and the connection-probe helper that
//! the IPC layer needs from the start.

use crate::error::{AppError, AppResult};

#[derive(Debug)]
pub struct SyncClient {
    base_url: String,
    agent: ureq::Agent,
}

impl SyncClient {
    pub fn new(base_url: &str) -> AppResult<Self> {
        // Trim trailing slashes so we can concatenate paths freely.
        let trimmed = base_url.trim_end_matches('/').to_string();
        if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
            return Err(AppError::invalid(
                "server URL must start with http:// or https://",
            ));
        }
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(15))
            .timeout_write(std::time::Duration::from_secs(15))
            .user_agent(concat!("keyfount-desktop/", env!("CARGO_PKG_VERSION")))
            .build();
        Ok(Self {
            base_url: trimmed,
            agent,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// Hit `/health` and return `true` when it responds 200.
    pub fn probe(&self) -> Result<bool, String> {
        match self.agent.get(&self.url("/health")).call() {
            Ok(resp) => Ok(resp.status() == 200),
            Err(ureq::Error::Status(_, _)) => Ok(false),
            Err(err) => Err(err.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_url_without_scheme() {
        assert!(SyncClient::new("keyfount.example.com").is_err());
    }

    #[test]
    fn trims_trailing_slash() {
        let c = SyncClient::new("https://sync.example.com/").unwrap();
        assert_eq!(c.base_url(), "https://sync.example.com");
    }

    #[test]
    fn url_concatenates_path() {
        let c = SyncClient::new("https://sync.example.com").unwrap();
        assert_eq!(c.url("/health"), "https://sync.example.com/health");
    }
}
