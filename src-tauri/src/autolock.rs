//! Idle auto-lock enforcement.
//!
//! A background task ticks every [`TICK`] and locks the active vault once
//! the session has been idle longer than the user-configured
//! `auto_lock_minutes`. Locking zeroises the in-memory master and closes
//! the SQLCipher connection, then emits a `vault:locked` event so the
//! frontend can route back to the unlock screen.
//!
//! User activity defers the lock: a handful of command handlers call
//! `AppState::touch()`, which resets the idle clock. A value of `0`
//! disables auto-lock entirely (matches the Settings UI hint).
//!
//! Touch is deliberately wired only into commands that are *exclusively*
//! user gestures — `generate`, `get_profile`, `copy_with_auto_clear`. The
//! account/profile mutation and list commands look like activity but are
//! also driven by the every-~60s background sync (see `src/sync/auto.ts`),
//! which calls them with no user present. Touching there would keep the
//! vault unlocked forever whenever sync is enabled, so those handlers are
//! intentionally left out.

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::session::SessionState;
use crate::store::{StoreHandle, settings as settings_store};

/// How often the background task wakes up to evaluate the idle timer.
pub const TICK: Duration = Duration::from_secs(30);

/// Event name emitted when the vault is auto-locked.
pub const LOCK_EVENT: &str = "vault:locked";

/// Pure decision: should a session that has been idle for `idle` be
/// locked given a timeout of `auto_lock_minutes`? `0` disables the timer.
///
/// Kept free of clocks and locks so the policy is trivially unit-testable.
pub fn should_lock(auto_lock_minutes: u32, idle: Duration) -> bool {
    if auto_lock_minutes == 0 {
        return false;
    }
    idle >= Duration::from_secs(u64::from(auto_lock_minutes) * 60)
}

/// Run the auto-lock loop forever. Spawned once from the Tauri setup hook.
pub async fn run(
    app: AppHandle,
    session: Arc<Mutex<SessionState>>,
    store: Arc<Mutex<StoreHandle>>,
) {
    loop {
        tokio::time::sleep(TICK).await;
        if tick_once(&session, &store).await {
            // Best-effort: a missing window or torn-down event loop just
            // means the frontend will reconcile on its next `status()`.
            let _ = app.emit(LOCK_EVENT, ());
        }
    }
}

/// Evaluate the timer once. Returns `true` if it locked the vault on this
/// pass (so the caller knows to emit the event).
async fn tick_once(session: &Mutex<SessionState>, store: &Mutex<StoreHandle>) -> bool {
    // Snapshot idle time without holding the lock across the store read.
    let idle = match session.lock().await.idle() {
        Some(d) => d,
        None => return false, // already locked
    };

    // Read the configured timeout from the (open) DB. If the store isn't
    // open we have nothing to lock.
    let minutes = {
        let guard = store.lock().await;
        match guard.require() {
            Ok(open) => settings_store::load(&open.conn)
                .map(|s| s.auto_lock_minutes)
                .unwrap_or(0),
            Err(_) => return false,
        }
    };

    if !should_lock(minutes, idle) {
        return false;
    }

    // Re-check idle while holding the session lock so a `touch()` that
    // raced between the snapshot and now cancels the lock.
    {
        let mut sess = session.lock().await;
        match sess.idle() {
            Some(d) if should_lock(minutes, d) => sess.lock(),
            _ => return false,
        }
    }

    // Drop the SQLCipher connection too — same teardown as the manual
    // `lock` command, so the page-key material doesn't linger.
    store.lock().await.close();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_minutes_never_locks() {
        assert!(!should_lock(0, Duration::from_secs(60 * 60 * 24)));
    }

    #[test]
    fn does_not_lock_before_the_threshold() {
        assert!(!should_lock(1, Duration::from_secs(59)));
        assert!(!should_lock(15, Duration::from_secs(15 * 60 - 1)));
    }

    #[test]
    fn locks_at_and_after_the_threshold() {
        // Acceptance criterion: 1 min timeout, 70 s idle → lock.
        assert!(should_lock(1, Duration::from_secs(70)));
        assert!(should_lock(1, Duration::from_secs(60)));
        assert!(should_lock(15, Duration::from_secs(15 * 60)));
        assert!(should_lock(240, Duration::from_secs(240 * 60 + 1)));
    }
}
