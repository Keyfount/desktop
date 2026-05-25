//! Deterministic password rendering — Random Characters mode.
//!
//! Given an arbitrary-precision integer of entropy and a profile describing
//! which character classes to include, produce a password of the requested
//! length that contains at least one character from each enabled class.
//!
//! The algorithm is a deterministic base conversion: we repeatedly divide
//! the entropy by the size of the active character pool and use the
//! remainder as the index of the next character. Required-class characters
//! are then inserted at deterministic positions to guarantee class coverage.

use num_bigint::BigUint;
use num_traits::{ToPrimitive, Zero};

use crate::error::{AppError, AppResult};
use crate::types::RandomProfile;

pub const POOL_LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
pub const POOL_UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
pub const POOL_DIGITS: &str = "0123456789";
pub const POOL_SYMBOLS: &str = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

struct EnabledPools<'a> {
    pools: Vec<&'a str>,
    combined: String,
}

fn enabled_pools(profile: &RandomProfile) -> AppResult<EnabledPools<'static>> {
    let mut pools: Vec<&'static str> = Vec::with_capacity(4);
    if profile.lower {
        pools.push(POOL_LOWER);
    }
    if profile.upper {
        pools.push(POOL_UPPER);
    }
    if profile.digits {
        pools.push(POOL_DIGITS);
    }
    if profile.symbols {
        pools.push(POOL_SYMBOLS);
    }
    if pools.is_empty() {
        return Err(AppError::invalid(
            "at least one character class must be enabled",
        ));
    }
    let mut combined = String::new();
    for p in &pools {
        combined.push_str(p);
    }
    Ok(EnabledPools { pools, combined })
}

/// Consume `length` characters from `entropy` by repeated
/// `divmod(pool.length)`, appending the character at the remainder index.
/// Returns the consumed string and the remaining entropy.
pub fn consume_entropy(entropy: &BigUint, pool: &str, length: usize) -> (String, BigUint) {
    let chars: Vec<char> = pool.chars().collect();
    let pool_size = BigUint::from(chars.len() as u32);
    let mut value = entropy.clone();
    let mut out = String::with_capacity(length);
    for _ in 0..length {
        let remainder: BigUint = &value % &pool_size;
        value /= &pool_size;
        let idx = remainder.to_usize().unwrap_or(0);
        out.push(chars[idx]);
    }
    (out, value)
}

/// Insert each character of `extra` into `base` at a deterministically
/// derived position, consuming entropy as we go.
pub fn insert_pseudo_randomly(base: &str, extra: &str, entropy: &BigUint) -> (String, BigUint) {
    let mut chars: Vec<char> = base.chars().collect();
    let mut value = entropy.clone();
    for c in extra.chars() {
        let position_count = BigUint::from((chars.len() + 1) as u32);
        let position = (&value % &position_count).to_usize().unwrap_or(0);
        value /= &position_count;
        chars.insert(position, c);
    }
    (chars.into_iter().collect(), value)
}

/// Render a Random Characters password from an entropy integer.
pub fn render_random(entropy: &BigUint, profile: &RandomProfile) -> AppResult<String> {
    if !(5..=35).contains(&profile.length) {
        return Err(AppError::invalid(format!(
            "profile.length must be between 5 and 35, got {}",
            profile.length
        )));
    }
    let pools = enabled_pools(profile)?;
    if (profile.length as usize) < pools.pools.len() {
        return Err(AppError::invalid(format!(
            "length {} too short to satisfy {} enabled classes",
            profile.length,
            pools.pools.len()
        )));
    }
    if entropy.is_zero() {
        return Err(AppError::Crypto("entropy is zero".into()));
    }
    let bulk_len = (profile.length as usize) - pools.pools.len();
    let (bulk, entropy_after_bulk) = consume_entropy(entropy, &pools.combined, bulk_len);

    let mut entropy_after = entropy_after_bulk;
    let mut one_of_each = String::with_capacity(pools.pools.len());
    for pool in &pools.pools {
        let (consumed, remaining) = consume_entropy(&entropy_after, pool, 1);
        one_of_each.push_str(&consumed);
        entropy_after = remaining;
    }

    let (inserted, _) = insert_pseudo_randomly(&bulk, &one_of_each, &entropy_after);
    Ok(inserted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use num_bigint::BigUint;
    use num_traits::Num;

    fn entropy_from_hex(hex: &str) -> BigUint {
        BigUint::from_str_radix(hex, 16).unwrap()
    }

    #[test]
    fn consume_entropy_produces_expected_length() {
        let e = BigUint::from(1234567890u64);
        let (consumed, _) = consume_entropy(&e, POOL_LOWER, 5);
        assert_eq!(consumed.len(), 5);
    }

    #[test]
    fn consume_entropy_zero_returns_first_char() {
        let e = BigUint::from(0u64);
        let (consumed, remaining) = consume_entropy(&e, "abc", 3);
        assert_eq!(consumed, "aaa");
        assert!(remaining.is_zero());
    }

    #[test]
    fn render_random_satisfies_length() {
        let entropy = entropy_from_hex(&"ff".repeat(32));
        let profile = RandomProfile::default();
        let pw = render_random(&entropy, &profile).unwrap();
        assert_eq!(pw.chars().count(), 16);
    }

    #[test]
    fn render_random_satisfies_classes() {
        let entropy = entropy_from_hex(&"deadbeef".repeat(8));
        let profile = RandomProfile::default();
        let pw = render_random(&entropy, &profile).unwrap();
        assert!(pw.chars().any(|c| c.is_ascii_lowercase()));
        assert!(pw.chars().any(|c| c.is_ascii_uppercase()));
        assert!(pw.chars().any(|c| c.is_ascii_digit()));
        assert!(pw.chars().any(|c| POOL_SYMBOLS.contains(c)));
    }

    #[test]
    fn render_random_rejects_too_short() {
        let entropy = entropy_from_hex(&"ff".repeat(32));
        let profile = RandomProfile {
            length: 3,
            ..RandomProfile::default()
        };
        assert!(render_random(&entropy, &profile).is_err());
    }

    #[test]
    fn render_random_rejects_no_classes() {
        let entropy = entropy_from_hex(&"ff".repeat(32));
        let profile = RandomProfile {
            length: 10,
            lower: false,
            upper: false,
            digits: false,
            symbols: false,
            counter: 1,
        };
        assert!(render_random(&entropy, &profile).is_err());
    }

    #[test]
    fn render_random_deterministic() {
        let entropy = entropy_from_hex(&"feedface".repeat(8));
        let profile = RandomProfile::default();
        let a = render_random(&entropy, &profile).unwrap();
        let b = render_random(&entropy, &profile).unwrap();
        assert_eq!(a, b);
    }
}
