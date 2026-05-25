//! Argon2id key derivation.
//!
//! Parameters are pinned for the lifetime of v1.x — changing any value here
//! would silently invalidate every password ever generated. See the design
//! doc for the migration policy.

use argon2::{Algorithm, Argon2, ParamsBuilder, Version};
use num_bigint::BigUint;

use crate::error::{AppError, AppResult};

/// Memory cost in KiB. 64 MiB.
pub const ARGON2_MEMORY_KIB: u32 = 65_536;
/// Time cost (number of iterations).
pub const ARGON2_ITERATIONS: u32 = 3;
/// Parallelism.
pub const ARGON2_PARALLELISM: u32 = 1;
/// Derived key length in bytes.
pub const ARGON2_HASH_LEN: usize = 32;

/// Derive a 32-byte secret from a master password and a pre-built salt.
///
/// The output is returned as raw bytes so the caller can interpret it as a
/// big integer for the rendering step.
pub fn derive_bits(master: &str, salt: &[u8]) -> AppResult<[u8; ARGON2_HASH_LEN]> {
    let params = ParamsBuilder::new()
        .m_cost(ARGON2_MEMORY_KIB)
        .t_cost(ARGON2_ITERATIONS)
        .p_cost(ARGON2_PARALLELISM)
        .output_len(ARGON2_HASH_LEN)
        .build()
        .map_err(|e| AppError::Crypto(format!("argon2 params: {e}")))?;

    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; ARGON2_HASH_LEN];
    argon
        .hash_password_into(master.as_bytes(), salt, &mut out)
        .map_err(|e| AppError::Crypto(format!("argon2id: {e}")))?;
    Ok(out)
}

/// Build the canonical salt for a derivation: `domain || email || counterHex`.
///
/// The inputs are concatenated with no separator. `domain` and `email` are
/// expected to be already normalised (lower-cased, trimmed) by the caller.
/// The counter is encoded as **lower-case hexadecimal with no padding**, to
/// match the extension's behaviour (`counter.toString(16)` in JavaScript).
pub fn build_salt(domain: &str, email: &str, counter: u32) -> AppResult<Vec<u8>> {
    if counter < 1 {
        return Err(AppError::invalid(format!(
            "counter must be a positive integer, got {counter}"
        )));
    }
    let mut salt = Vec::with_capacity(domain.len() + email.len() + 8);
    salt.extend_from_slice(domain.as_bytes());
    salt.extend_from_slice(email.as_bytes());
    salt.extend_from_slice(format!("{counter:x}").as_bytes());
    Ok(salt)
}

/// Convert a byte sequence to a [`BigUint`], big-endian.
pub fn bytes_to_big_int(bytes: &[u8]) -> BigUint {
    BigUint::from_bytes_be(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn salt_lowercases_hex_counter_no_padding() {
        let salt = build_salt("example.com", "user@example.com", 17).unwrap();
        let text = std::str::from_utf8(&salt).unwrap();
        assert!(text.ends_with("11"));
        assert!(text.starts_with("example.com"));
    }

    #[test]
    fn salt_for_counter_one() {
        let salt = build_salt("example.com", "user@example.com", 1).unwrap();
        let text = std::str::from_utf8(&salt).unwrap();
        assert_eq!(text, "example.comuser@example.com1");
    }

    #[test]
    fn salt_for_large_counter() {
        let salt = build_salt("example.com", "user@example.com", 255).unwrap();
        let text = std::str::from_utf8(&salt).unwrap();
        assert_eq!(text, "example.comuser@example.comff");
    }

    #[test]
    fn salt_rejects_zero_counter() {
        let err = build_salt("example.com", "user", 0);
        assert!(err.is_err());
    }

    #[test]
    fn argon2_derives_expected_length() {
        let salt = build_salt("example.com", "user@example.com", 1).unwrap();
        let bytes = derive_bits("correct horse battery staple", &salt).unwrap();
        assert_eq!(bytes.len(), ARGON2_HASH_LEN);
    }

    #[test]
    fn argon2_is_deterministic() {
        let salt = build_salt("example.com", "user@example.com", 1).unwrap();
        let a = derive_bits("hunter2hunter2", &salt).unwrap();
        let b = derive_bits("hunter2hunter2", &salt).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn different_counter_different_output() {
        let s1 = build_salt("example.com", "user@example.com", 1).unwrap();
        let s2 = build_salt("example.com", "user@example.com", 2).unwrap();
        let a = derive_bits("hunter2hunter2", &s1).unwrap();
        let b = derive_bits("hunter2hunter2", &s2).unwrap();
        assert_ne!(a, b);
    }
}
