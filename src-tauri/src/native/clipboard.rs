//! Clipboard auto-clear.
//!
//! When the user copies a generated password we remember what we wrote
//! and schedule a clear after `clipboard_clear_seconds`. The clear only
//! fires when the clipboard still contains the value we wrote — we never
//! stomp on something the user copied themselves.

use std::time::{Duration, Instant};

#[derive(Debug, Default)]
pub struct ClipboardState {
    pub last_written: Option<String>,
    pub armed_at: Option<Instant>,
    pub clear_after: Option<Duration>,
}

impl ClipboardState {
    pub fn arm(&mut self, value: String, seconds: u32) {
        self.last_written = Some(value);
        self.armed_at = Some(Instant::now());
        self.clear_after = Some(Duration::from_secs(seconds as u64));
    }

    pub fn cancel(&mut self) {
        self.last_written = None;
        self.armed_at = None;
        self.clear_after = None;
    }

    pub fn is_due(&self) -> bool {
        match (self.armed_at, self.clear_after) {
            (Some(t), Some(d)) => t.elapsed() >= d,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn freshly_armed_is_not_due() {
        let mut s = ClipboardState::default();
        s.arm("pw".into(), 30);
        assert!(!s.is_due());
    }

    #[test]
    fn cancel_clears_state() {
        let mut s = ClipboardState::default();
        s.arm("pw".into(), 30);
        s.cancel();
        assert!(s.last_written.is_none());
        assert!(!s.is_due());
    }
}
