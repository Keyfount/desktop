//! Master-password fingerprint.
//!
//! Computes a short, deterministic visual hash of the master password so
//! the user can detect a typo at unlock time without ever displaying the
//! master.
//!
//! The fingerprint is derived via Argon2id with a fixed, project-specific
//! salt, truncated to 3 bytes. Each byte indexes into a 256-entry emoji
//! table to produce a 3-emoji visual code.

use argon2::{Algorithm, Argon2, ParamsBuilder, Version};

pub use crate::crypto::emoji_table::FINGERPRINT_EMOJIS;
use crate::error::{AppError, AppResult};

const FINGERPRINT_SALT: &[u8] = b"keyfount:verify";

const FP_MEMORY_KIB: u32 = 65_536;
const FP_ITERATIONS: u32 = 3;
const FP_PARALLELISM: u32 = 1;
const FP_HASH_LEN: usize = 16;

/// Compute the raw 3-byte fingerprint of a master password.
pub fn fingerprint_master(master: &str) -> AppResult<[u8; 3]> {
    let params = ParamsBuilder::new()
        .m_cost(FP_MEMORY_KIB)
        .t_cost(FP_ITERATIONS)
        .p_cost(FP_PARALLELISM)
        .output_len(FP_HASH_LEN)
        .build()
        .map_err(|e| AppError::Crypto(format!("argon2 params: {e}")))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; FP_HASH_LEN];
    argon
        .hash_password_into(master.as_bytes(), FINGERPRINT_SALT, &mut out)
        .map_err(|e| AppError::Crypto(format!("argon2id: {e}")))?;
    Ok([out[0], out[1], out[2]])
}

/// Format a 3-byte fingerprint as a space-joined emoji triplet.
pub fn format_fingerprint(bytes: &[u8]) -> AppResult<String> {
    if bytes.len() < 3 {
        return Err(AppError::invalid(format!(
            "fingerprint must be at least 3 bytes, got {}",
            bytes.len()
        )));
    }
    Ok(format!(
        "{} {} {}",
        FINGERPRINT_EMOJIS[bytes[0] as usize],
        FINGERPRINT_EMOJIS[bytes[1] as usize],
        FINGERPRINT_EMOJIS[bytes[2] as usize]
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_deterministic() {
        let a = fingerprint_master("hunter2hunter2").unwrap();
        let b = fingerprint_master("hunter2hunter2").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn fingerprint_differs_for_different_masters() {
        let a = fingerprint_master("hunter2hunter2").unwrap();
        let b = fingerprint_master("hunter3hunter3").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn format_fingerprint_produces_three_glyphs() {
        let bytes = [0u8, 128u8, 255u8];
        let s = format_fingerprint(&bytes).unwrap();
        let glyphs: Vec<&str> = s.split(' ').collect();
        assert_eq!(glyphs.len(), 3);
    }

    #[test]
    fn emoji_table_has_256_entries() {
        assert_eq!(FINGERPRINT_EMOJIS.len(), 256);
    }
}
