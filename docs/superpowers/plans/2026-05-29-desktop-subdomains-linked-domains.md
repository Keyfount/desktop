# Desktop — Subdomains & Linked Domains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Mirror the extension's subdomain + linked-domain matching in the Rust core, Tauri/Preact UI, and iOS AutoFill, keeping derivation byte-identical and identity `(domain, username)`.

**Architecture:** `linked_domains: Vec<String>` is added to the Rust `AccountEntry` (serde `linkedDomains`, match-only, never salted). A new `src-tauri/src/domain.rs` implements the match rule with the `psl` crate (compile-time Public Suffix List — `publicsuffix` in Cargo.toml is unused and needs an external data file, so we add `psl`). Matching lives in Rust and is exposed over FFI (`vault_match_accounts_ffi`) so the iOS extension stops doing its own naive `getBaseDomain` substring match. The TS mirror + Preact editor reuse the extension's UX.

**Tech Stack:** Rust (rusqlite/SQLCipher, serde, psl), Tauri 2 FFI, Preact + signals, Swift (ASCredentialProvider), Playwright.

**Design:** `docs/superpowers/specs/2026-05-28-subdomains-and-linked-domains-design.md`. Closes Keyfount/desktop#72.

---

## File map

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | add `psl = "2"` |
| `src-tauri/src/types.rs:118` | `AccountEntry.linked_domains: Vec<String>` (serde `linkedDomains`, default, skip if empty) |
| `src-tauri/src/store/schema.rs` | migration v4: `ALTER TABLE accounts ADD COLUMN linked_domains_json TEXT` |
| `src-tauri/src/store/accounts.rs` | `list`/`record` carry the column; add `set_linked_domains`/`get`; update tests |
| `src-tauri/src/domain.rs` (new) | `registrable_domain`, `full_host`, `domain_matches`, `match_accounts` + table tests |
| `src-tauri/src/lib.rs` | `vault_load_accounts_ffi` emits `linkedDomains`; add `vault_match_accounts_ffi(master,url)` |
| `src-tauri/src/commands/accounts.rs` | `record_account` carries `linked_domains`; add `link_account_domain`/`unlink_account_domain` |
| `src-tauri/src/lib.rs` (invoke_handler) | register the two new commands |
| `src/types.ts:48` | mirror `linkedDomains?: string[]` |
| `src/popup|screens AccountDetail*` | linked-domains editor (mirror extension) |
| Swift `CredentialProviderViewController.swift` | call `vault_match_accounts_ffi` for suggestions; parse `linkedDomains` |
| `tests/e2e/desktop|mobile/accounts.spec.ts` | offered on subdomain + linked; narrow not on root |

---

## Task 1: Rust `AccountEntry.linked_domains` + schema v4 + store

- [ ] **types.rs** — add field:
```rust
    #[serde(rename = "linkedDomains", default, skip_serializing_if = "Vec::is_empty")]
    pub linked_domains: Vec<String>,
```
- [ ] **schema.rs** — append migration `(4, "ALTER TABLE accounts ADD COLUMN linked_domains_json TEXT;")`; update `migrations_apply_on_fresh_db` to assert `"4"`; add `migration_v4_adds_linked_domains_column` test.
- [ ] **store/accounts.rs** — `list_with_clause` SELECT adds `linked_domains_json`, parse `Option<String>` → `serde_json::from_str::<Vec<String>>().unwrap_or_default()`. `record` INSERT writes `linked_domains_json` (`serde_json::to_string(&entry.linked_domains)`) and ON CONFLICT updates it. Add `set_linked_domains(conn, domain, username, &[String]) -> AppResult<()>`. Update `fixture()` + every `AccountEntry { … }` literal in this file and `commands/accounts.rs`/`lib.rs` to include `linked_domains: vec![]`.
- [ ] **cargo test** `store::accounts` + `store::schema`.
- [ ] Commit `feat(store): persist linked_domains (+schema v4)`.

## Task 2: Rust match rule (`src-tauri/src/domain.rs`)

```rust
//! Subdomain + linked-domain matching. Mirrors extension/src/shared/domain.ts.
use crate::types::AccountEntry;

/// eTLD+1 (registrable domain) of a URL or bare host, lowercased.
pub fn registrable_domain(input: &str) -> Option<String> {
    let host = full_host(input).or_else(|| {
        // bare host (no scheme)
        let h = input.trim().trim_end_matches('.').to_lowercase();
        if h.is_empty() { None } else { Some(h) }
    })?;
    psl::domain_str(&host).map(|d| d.to_lowercase())
}

/// Full lowercased host of an http(s) URL, or None for non-web inputs.
pub fn full_host(input: &str) -> Option<String> {
    let parsed = url::Url::parse(input).ok()?;
    match parsed.scheme() {
        "http" | "https" => parsed.host_str().map(|h| h.to_lowercase()),
        _ => None,
    }
}

fn match_rank(match_domain: &str, host: &str) -> i32 {
    let m = match_domain.trim().to_lowercase();
    let h = host.trim().to_lowercase();
    if m.is_empty() || h.is_empty() { return -1; }
    if registrable_domain(&m).as_deref() == Some(m.as_str()) {
        if h == m || h.ends_with(&format!(".{m}")) { 1 } else { -1 }
    } else if h == m { 2 } else { -1 }
}

pub fn domain_matches(match_domain: &str, host: &str) -> bool {
    match_rank(match_domain, host) >= 0
}

/// Accounts whose match set ({domain} ∪ linked_domains) covers the URL host,
/// most-specific first then most-recently-used. Empty for non-web URLs.
pub fn match_accounts(url: &str, accounts: &[AccountEntry]) -> Vec<AccountEntry> {
    let (Some(host), Some(_)) = (full_host(url).or_else(|| bare_host(url)), registrable_domain(url)) else {
        return Vec::new();
    };
    let mut ranked: Vec<(i32, &AccountEntry)> = Vec::new();
    for a in accounts {
        let mut best = -1;
        for m in std::iter::once(&a.domain).chain(a.linked_domains.iter()) {
            best = best.max(match_rank(m, &host));
        }
        if best >= 0 { ranked.push((best, a)); }
    }
    ranked.sort_by(|x, y| y.0.cmp(&x.0).then(y.1.last_used_at.cmp(&x.1.last_used_at)));
    ranked.into_iter().map(|(_, a)| a.clone()).collect()
}

fn bare_host(input: &str) -> Option<String> {
    if input.contains("://") { return None; }
    let h = input.trim().trim_end_matches('.').to_lowercase();
    if h.is_empty() { None } else { Some(h) }
}
```
- [ ] `mod domain;` in `lib.rs`.
- [ ] Table tests mirroring `tests/match-accounts.test.ts` (broad/narrow/linked/precedence; localhost/IP/chrome → empty).
- [ ] cargo test `domain`. Commit `feat(domain): rust subdomain + linked-domain match rule`.

## Task 3: FFI + commands

- [ ] `vault_load_accounts_ffi` — add `"linkedDomains": <Vec<String> from new column>` to each JSON object (SELECT the column).
- [ ] New `vault_match_accounts_ffi(master, url) -> *mut c_char`: load accounts, `domain::match_accounts(url, &accounts)`, return JSON array incl. `linkedDomains` + `profile_json`.
- [ ] `commands/accounts.rs::record_account` — accept `linked_domains: Option<Vec<String>>`, set on the entry. Add `link_account_domain`/`unlink_account_domain(domain, username, linked)` → read row, mutate set via `set_linked_domains`, return updated `AccountEntry`.
- [ ] Register the 2 commands in `lib.rs` `generate_handler!`/`invoke_handler`.
- [ ] cargo build + clippy. Commit `feat(ffi): match accounts by url; carry linkedDomains; link/unlink commands`.

## Task 4: TS mirror + UI

- [ ] `src/types.ts:48` add `linkedDomains?: string[]`.
- [ ] Account detail screen: linked-domains add/remove calling the new commands (`invoke("link_account_domain", …)`), mirroring extension `AccountDetailScreen`.
- [ ] Save flow (mobile/desktop): if a host differs from its registrable root, offer the full-host save (sets the salt). Keep registrable default.
- [ ] `npm run lint && npm run typecheck`. Commit `feat(ui): linked-domains editor + save granularity`.

## Task 5: iOS AutoFill

- [ ] Add `@_silgen_name("vault_match_accounts_ffi")` decl; in `prepareCredentialList`, pass the raw service identifier (URL or domain) to it for `suggestions`; keep `others` = the rest. Parse `linkedDomains` in the `AccountEntry` decode.
- [ ] Note: compile-checked by reading only — no iOS simulator in this environment; flag in the PR.

## Task 6: Sync + e2e + verify

- [ ] Confirm the TS sync layer carries `linkedDomains` through `record_account` on apply (the wire `SyncableState` already serialises the field once on `AccountEntry`); add/extend a cargo or vitest test asserting round-trip.
- [ ] Playwright `tests/e2e/desktop/accounts.spec.ts` + `mobile`: link a domain, assert offered; narrow not on root.
- [ ] `cargo test && cargo clippy && npm run lint && npm run typecheck && npm test` + e2e. Push, `gh pr create --base develop` "Closes #72".
