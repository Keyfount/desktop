//! In-memory unlocked session state.
//!
//! The master password lives here while the app is unlocked, and only here.
//! It is never written to disk in plaintext. When the auto-lock timer
//! fires, or the user explicitly locks, the master is zeroised.

use std::time::{Duration, Instant};

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

    /// Time elapsed since the last unlock or `touch()`, or `None` while
    /// locked. The auto-lock task compares this against the configured
    /// timeout (see `crate::autolock`).
    pub fn idle(&self) -> Option<Duration> {
        self.inner.as_ref().map(|s| s.unlocked_at.elapsed())
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

    #[test]
    fn idle_is_none_while_locked() {
        let s = SessionState::default();
        assert!(s.idle().is_none());
    }

    #[test]
    fn idle_is_some_after_unlock() {
        let mut s = SessionState::default();
        s.unlock("m".into(), [0, 0, 0]);
        assert!(s.idle().is_some());
    }

    #[test]
    fn touch_advances_the_idle_clock() {
        let mut s = SessionState::default();
        s.unlock("m".into(), [0, 0, 0]);
        let before = s.inner.as_ref().unwrap().unlocked_at;
        std::thread::sleep(Duration::from_millis(2));
        s.touch();
        let after = s.inner.as_ref().unwrap().unlocked_at;
        assert!(after > before, "touch() must move unlocked_at forward");
    }

    #[test]
    fn touch_on_a_locked_session_is_a_noop() {
        let mut s = SessionState::default();
        s.touch();
        assert!(!s.is_unlocked());
    }
}
