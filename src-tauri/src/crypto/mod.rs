//! Deterministic password derivation.
//!
//! This module is a byte-for-byte Rust port of `extension/src/background/crypto/`.
//! Any divergence is enforced as a CI failure via the shared golden vector
//! suite (see `tests/golden_vectors.rs`).

pub mod argon2;
pub mod emoji_table;
pub mod fingerprint;
pub mod master_kek;
pub mod memorable;
pub mod pin;
pub mod render;
pub mod wordlist;

pub use self::argon2::{ARGON2_HASH_LEN, ARGON2_ITERATIONS, ARGON2_MEMORY_KIB, ARGON2_PARALLELISM};
pub use self::fingerprint::{FINGERPRINT_EMOJIS, fingerprint_master, format_fingerprint};
pub use self::memorable::render_memorable;
pub use self::pin::{PIN_PBKDF2_ITERATIONS, decrypt_master, encrypt_master};
pub use self::render::render_random;

use crate::error::AppResult;
use crate::types::{DerivationInputs, Profile};

/// Normalise the derivation inputs.
///
/// The master is used verbatim; the domain and email are lower-cased and
/// trimmed. The caller is expected to have already reduced the URL to its
/// registrable domain — we do not do TLD parsing here.
pub fn normalise(inputs: &DerivationInputs) -> DerivationInputs {
    DerivationInputs {
        master: inputs.master.clone(),
        domain: inputs.domain.trim().to_lowercase(),
        email: inputs.email.trim().to_lowercase(),
    }
}

/// Derive a password from the given inputs and profile.
pub async fn derive_password(inputs: &DerivationInputs, profile: &Profile) -> AppResult<String> {
    use crate::error::AppError;
    if inputs.master.is_empty() {
        return Err(AppError::invalid("master password must not be empty"));
    }
    if inputs.domain.is_empty() {
        return Err(AppError::invalid("domain must not be empty"));
    }
    let normalised = normalise(inputs);
    let salt = argon2::build_salt(&normalised.domain, &normalised.email, profile.counter())?;
    let bytes = argon2::derive_bits(&normalised.master, &salt)?;
    let entropy = argon2::bytes_to_big_int(&bytes);

    match profile {
        Profile::Random(p) => render_random(&entropy, p),
        Profile::Memorable(p) => render_memorable(&entropy, p),
    }
}
