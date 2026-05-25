//! Shared data types exposed to the frontend.
//!
//! Mirrors `extension/src/shared/types.ts`. The serde representation is
//! frozen — any change here is also a change to the IPC contract and to
//! the on-disk SQLite payload format.

use serde::{Deserialize, Serialize};

/// A site profile drives the generation parameters. Two flavours: a random
/// character string of a fixed length, or a memorable passphrase built from
/// the EFF wordlist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode")]
pub enum Profile {
    #[serde(rename = "random")]
    Random(RandomProfile),
    #[serde(rename = "memorable")]
    Memorable(MemorableProfile),
}

impl Profile {
    /// Default profile used at first install.
    pub fn default_random() -> Self {
        Self::Random(RandomProfile::default())
    }

    pub fn counter(&self) -> u32 {
        match self {
            Self::Random(p) => p.counter,
            Self::Memorable(p) => p.counter,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RandomProfile {
    /// Total password length. Must be between 5 and 35 inclusive.
    pub length: u32,
    pub lower: bool,
    pub upper: bool,
    pub digits: bool,
    pub symbols: bool,
    /// Rotation counter. Must be >= 1.
    pub counter: u32,
}

impl Default for RandomProfile {
    fn default() -> Self {
        Self {
            length: 16,
            lower: true,
            upper: true,
            digits: true,
            symbols: true,
            counter: 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemorableProfile {
    /// Number of words. Must be between 5 and 8 inclusive.
    #[serde(rename = "wordCount")]
    pub word_count: u32,
    pub separator: Separator,
    /// Capitalise one word at a deterministic position.
    pub capitalise: bool,
    /// Append a deterministic `<digit><symbol>` suffix.
    pub suffix: bool,
    /// Rotation counter. Must be >= 1.
    pub counter: u32,
}

impl Default for MemorableProfile {
    fn default() -> Self {
        Self {
            word_count: 6,
            // Default to "." rather than "-" — four EFF words contain hyphens
            // (drop-down, felt-tip, t-shirt, yo-yo) which would make a "-"
            // separator ambiguous to read aloud or dictate.
            separator: Separator::Dot,
            capitalise: true,
            suffix: true,
            counter: 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Separator {
    #[serde(rename = "-")]
    Dash,
    #[serde(rename = ".")]
    Dot,
    #[serde(rename = "_")]
    Underscore,
}

impl Separator {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Dash => "-",
            Self::Dot => ".",
            Self::Underscore => "_",
        }
    }
}

/// The three deterministic inputs that, together with a profile, produce
/// a password.
#[derive(Debug, Clone)]
pub struct DerivationInputs {
    pub master: String,
    pub domain: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountEntry {
    pub domain: String,
    pub username: String,
    /// Generation profile frozen at account-creation time, so the
    /// password recomputes identically forever regardless of later
    /// changes to per-site or default profiles.
    pub profile: Profile,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "lastUsedAt")]
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMeta {
    pub id: String,
    pub fingerprint: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "lastUsedAt")]
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinBlob {
    /// AES-GCM ciphertext of the master, base64 (RFC 4648, no padding).
    pub ciphertext: String,
    /// AES-GCM IV, base64.
    pub iv: String,
    /// PBKDF2 salt for deriving the wrapping key, base64.
    pub salt: String,
    /// PBKDF2 iterations used to derive the wrapping key.
    pub iterations: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_profile_default_matches_extension() {
        let p = RandomProfile::default();
        assert_eq!(p.length, 16);
        assert!(p.lower && p.upper && p.digits && p.symbols);
        assert_eq!(p.counter, 1);
    }

    #[test]
    fn memorable_profile_default_separator_is_dot() {
        let p = MemorableProfile::default();
        assert_eq!(p.separator, Separator::Dot);
        assert_eq!(p.word_count, 6);
        assert!(p.capitalise);
        assert!(p.suffix);
        assert_eq!(p.counter, 1);
    }

    #[test]
    fn profile_round_trips_through_serde() {
        let p = Profile::default_random();
        let json = serde_json::to_string(&p).unwrap();
        let back: Profile = serde_json::from_str(&json).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn random_profile_json_matches_extension_shape() {
        let p = Profile::Random(RandomProfile::default());
        let v: serde_json::Value = serde_json::to_value(p).unwrap();
        assert_eq!(v["mode"], "random");
        assert_eq!(v["length"], 16);
        assert_eq!(v["counter"], 1);
    }
}
