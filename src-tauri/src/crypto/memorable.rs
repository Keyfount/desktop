//! Memorable password rendering.
//!
//! Produces a passphrase of N words drawn from the EFF Large Wordlist,
//! separated by a single character, optionally with one word capitalised
//! and an optional `<digit><symbol>` suffix to satisfy dumb complexity
//! validators.
//!
//! With the default of 6 words, output entropy is approximately
//! `6 * log2(7776) ≈ 77.5 bits` — above the 70-bit project target.

use num_bigint::BigUint;
use num_traits::ToPrimitive;

use crate::crypto::render::consume_entropy;
use crate::crypto::wordlist::{EFF_LARGE_WORDLIST, EFF_LARGE_WORDLIST_SIZE};
use crate::error::{AppError, AppResult};
use crate::types::MemorableProfile;

const SUFFIX_DIGITS: &str = "0123456789";
const SUFFIX_SYMBOLS: &str = "!@#$%^&*?";

pub fn render_memorable(entropy: &BigUint, profile: &MemorableProfile) -> AppResult<String> {
    if !(5..=8).contains(&profile.word_count) {
        return Err(AppError::invalid(format!(
            "profile.wordCount must be between 5 and 8, got {}",
            profile.word_count
        )));
    }

    let pool_size = BigUint::from(EFF_LARGE_WORDLIST_SIZE as u32);
    let mut value = entropy.clone();
    let mut words: Vec<String> = Vec::with_capacity(profile.word_count as usize);
    for _ in 0..profile.word_count {
        let index = (&value % &pool_size).to_usize().unwrap_or(0);
        value /= &pool_size;
        words.push(EFF_LARGE_WORDLIST[index].to_string());
    }

    if profile.capitalise {
        let position_count = BigUint::from(words.len() as u32);
        let position = (&value % &position_count).to_usize().unwrap_or(0);
        value /= &position_count;
        let word = &mut words[position];
        if let Some(first) = word.chars().next() {
            let rest = &word[first.len_utf8()..];
            *word = first.to_uppercase().to_string() + rest;
        }
    }

    let mut result = words.join(profile.separator.as_str());

    if profile.suffix {
        let (digit, remaining) = consume_entropy(&value, SUFFIX_DIGITS, 1);
        let (symbol, _) = consume_entropy(&remaining, SUFFIX_SYMBOLS, 1);
        result.push_str(&digit);
        result.push_str(&symbol);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use num_bigint::BigUint;
    use num_traits::Num;

    use crate::types::Separator;

    fn entropy_from_hex(hex: &str) -> BigUint {
        BigUint::from_str_radix(hex, 16).unwrap()
    }

    #[test]
    fn render_memorable_default_word_count() {
        let entropy = entropy_from_hex(&"ff".repeat(32));
        let profile = MemorableProfile::default();
        let pw = render_memorable(&entropy, &profile).unwrap();
        // 6 words + 5 separators + 2-char suffix
        let separator_count = pw.matches(profile.separator.as_str()).count();
        assert!(separator_count >= 5);
    }

    #[test]
    fn render_memorable_capitalises_one_word() {
        let entropy = entropy_from_hex(&"deadbeef".repeat(8));
        let profile = MemorableProfile {
            word_count: 6,
            separator: Separator::Dash,
            capitalise: true,
            suffix: false,
            counter: 1,
        };
        let pw = render_memorable(&entropy, &profile).unwrap();
        assert!(pw.chars().any(|c| c.is_uppercase()));
    }

    #[test]
    fn render_memorable_no_suffix_no_digits() {
        let entropy = entropy_from_hex(&"ff".repeat(32));
        let profile = MemorableProfile {
            word_count: 5,
            separator: Separator::Underscore,
            capitalise: false,
            suffix: false,
            counter: 1,
        };
        let pw = render_memorable(&entropy, &profile).unwrap();
        assert!(
            !pw.chars()
                .last()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
        );
    }

    #[test]
    fn render_memorable_deterministic() {
        let entropy = entropy_from_hex(&"feedface".repeat(8));
        let profile = MemorableProfile::default();
        let a = render_memorable(&entropy, &profile).unwrap();
        let b = render_memorable(&entropy, &profile).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn render_memorable_rejects_invalid_word_count() {
        let entropy = entropy_from_hex(&"ff".repeat(32));
        let profile = MemorableProfile {
            word_count: 4,
            separator: Separator::Dash,
            capitalise: true,
            suffix: false,
            counter: 1,
        };
        assert!(render_memorable(&entropy, &profile).is_err());
    }
}
