//! In-memory unlocked session state.
//!
//! The master password lives here while the app is unlocked, and only here.
//! It is never written to disk in plaintext. When the auto-lock timer
//! fires, or the user explicitly locks, the master is zeroised.

use std::time::Instant;

use zeroize::Zeroize;

#[derive(Debug, Default)]
pub struct SessionState {
    inner: Option<UnlockedSession>,
}

#[derive(Debug)]
pub struct UnlockedSession {
    master: String,
    pub unlocked_at: Instant,
    pub fingerprint: [u8; 3],
}

impl SessionState {
    pub fn is_unlocked(&self) -> bool {
        self.inner.is_some()
    }

    pub fn unlock(&mut self, master: String, fingerprint: [u8; 3]) {
        self.lock();
        self.inner = Some(UnlockedSession {
            master,
            unlocked_at: Instant::now(),
            fingerprint,
        });
    }

    pub fn fingerprint(&self) -> Option<[u8; 3]> {
        self.inner.as_ref().map(|s| s.fingerprint)
    }

    pub fn master(&self) -> Option<&str> {
        self.inner.as_ref().map(|s| s.master.as_str())
    }

    pub fn lock(&mut self) {
        if let Some(mut prev) = self.inner.take() {
            prev.master.zeroize();
        }
    }

    pub fn touch(&mut self) {
        if let Some(ref mut s) = self.inner {
            s.unlocked_at = Instant::now();
        }
    }
}

impl Drop for SessionState {
    fn drop(&mut self) {
        self.lock();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_locked() {
        let s = SessionState::default();
        assert!(!s.is_unlocked());
    }

    #[test]
    fn unlock_then_lock_clears_state() {
        let mut s = SessionState::default();
        s.unlock("master".into(), [1, 2, 3]);
        assert!(s.is_unlocked());
        assert_eq!(s.fingerprint(), Some([1, 2, 3]));
        s.lock();
        assert!(!s.is_unlocked());
        assert_eq!(s.master(), None);
    }

    #[test]
    fn unlocking_twice_replaces_master() {
        let mut s = SessionState::default();
        s.unlock("a".into(), [0, 0, 0]);
        s.unlock("b".into(), [1, 1, 1]);
        assert_eq!(s.master(), Some("b"));
        assert_eq!(s.fingerprint(), Some([1, 1, 1]));
    }
}
