//! Subdomain + linked-domain matching.
//!
//! Mirrors `extension/src/shared/domain.ts`. The match rule is the single
//! source of truth for "which saved accounts should be offered on this
//! URL", used by both the desktop UI and the iOS AutoFill extension (over
//! FFI). Matching is **match-only**: an account's `domain` stays its
//! derivation salt; `linked_domains` never affect derivation.

use crate::types::AccountEntry;

/// Resolve the matchable host of a raw input (a full URL or a bare host),
/// lowercased. Returns `None` for anything we won't autofill:
/// non-web schemes (`chrome:`, `file:`…), IP literals, and empty input.
fn host_of(input: &str) -> Option<String> {
    if let Ok(u) = url::Url::parse(input) {
        return match u.scheme() {
            "http" | "https" => match u.host()? {
                url::Host::Domain(d) => Some(d.to_lowercase()),
                // IPv4 / IPv6 literals are not matchable.
                _ => None,
            },
            // Any other scheme (chrome:, file:, about:, …) has no host we trust.
            _ => None,
        };
    }
    // Not a URL — treat as a bare host. Reject IP literals so an IP never
    // gains a spurious registrable domain via the PSL `*` default rule.
    let host = input.trim().trim_end_matches('.').to_lowercase();
    if host.is_empty() || host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }
    Some(host)
}

/// Full lowercased host of a URL or bare host, or `None` for non-web inputs.
pub fn full_host(input: &str) -> Option<String> {
    host_of(input)
}

/// Registrable domain (eTLD+1) of a URL or bare host, lowercased. `None`
/// for inputs with no public registrable domain (`localhost`, IPs, etc.).
pub fn registrable_domain(input: &str) -> Option<String> {
    let host = host_of(input)?;
    psl::domain_str(&host).map(str::to_lowercase)
}

/// Rank a single match domain against a host:
///   2 = exact-host (narrow) match, 1 = registrable (broad) match, -1 = none.
///
/// A match domain that equals its own registrable domain is broad (matches
/// the registrable root and every subdomain). Any other match domain is a
/// specific host and matches that host exactly.
fn match_rank(match_domain: &str, host: &str) -> i32 {
    let m = match_domain.trim().to_lowercase();
    let h = host.trim().to_lowercase();
    if m.is_empty() || h.is_empty() {
        return -1;
    }
    if registrable_domain(&m).as_deref() == Some(m.as_str()) {
        if h == m || h.ends_with(&format!(".{m}")) {
            1
        } else {
            -1
        }
    } else if h == m {
        2
    } else {
        -1
    }
}

/// True when `match_domain` (registrable → broad, full host → narrow)
/// covers `host`.
pub fn domain_matches(match_domain: &str, host: &str) -> bool {
    match_rank(match_domain, host) >= 0
}

/// Accounts whose match set (`{domain} ∪ linked_domains`) covers the URL's
/// host, most-specific first (exact-host before registrable) then
/// most-recently-used. Empty for non-web URLs.
pub fn match_accounts(url: &str, accounts: &[AccountEntry]) -> Vec<AccountEntry> {
    let (Some(host), Some(_)) = (host_of(url), registrable_domain(url)) else {
        return Vec::new();
    };
    let mut ranked: Vec<(i32, &AccountEntry)> = Vec::new();
    for a in accounts {
        let mut best = -1;
        for m in std::iter::once(&a.domain).chain(a.linked_domains.iter()) {
            best = best.max(match_rank(m, &host));
        }
        if best >= 0 {
            ranked.push((best, a));
        }
    }
    // Higher rank first, then most-recently-used first.
    ranked.sort_by(|x, y| {
        y.0.cmp(&x.0)
            .then_with(|| y.1.last_used_at.cmp(&x.1.last_used_at))
    });
    ranked.into_iter().map(|(_, a)| a.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Profile, RandomProfile};

    fn acc(domain: &str, last_used_at: i64, linked: &[&str]) -> AccountEntry {
        AccountEntry {
            domain: domain.into(),
            username: "u".into(),
            profile: Profile::Random(RandomProfile::default()),
            linked_domains: linked.iter().map(|s| (*s).into()).collect(),
            created_at: 0,
            last_used_at,
        }
    }

    #[test]
    fn full_host_and_registrable() {
        assert_eq!(full_host("https://Accounts.Google.com/x").as_deref(), Some("accounts.google.com"));
        assert_eq!(registrable_domain("https://accounts.google.com").as_deref(), Some("google.com"));
        assert_eq!(registrable_domain("https://www.example.co.uk").as_deref(), Some("example.co.uk"));
        assert_eq!(full_host("chrome://extensions"), None);
        assert_eq!(full_host("http://127.0.0.1:3000"), None);
        assert_eq!(registrable_domain("http://localhost:3000"), None);
    }

    #[test]
    fn registrable_is_broad() {
        assert!(domain_matches("y.com", "y.com"));
        assert!(domain_matches("y.com", "x.y.com"));
        assert!(domain_matches("y.com", "a.b.y.com"));
        assert!(!domain_matches("y.com", "evil-y.com"));
        assert!(!domain_matches("y.com", "yy.com"));
    }

    #[test]
    fn full_host_is_narrow() {
        assert!(domain_matches("w.y.com", "w.y.com"));
        assert!(!domain_matches("w.y.com", "y.com"));
        assert!(!domain_matches("w.y.com", "z.y.com"));
    }

    #[test]
    fn broad_offered_on_subdomains() {
        let out = match_accounts("https://gist.github.com", &[acc("github.com", 0, &[])]);
        assert_eq!(out.iter().map(|e| e.domain.as_str()).collect::<Vec<_>>(), ["github.com"]);
    }

    #[test]
    fn narrow_only_on_exact_host() {
        assert_eq!(match_accounts("https://w.y.com", &[acc("w.y.com", 0, &[])]).len(), 1);
        assert_eq!(match_accounts("https://y.com", &[acc("w.y.com", 0, &[])]).len(), 0);
        assert_eq!(match_accounts("https://z.y.com", &[acc("w.y.com", 0, &[])]).len(), 0);
    }

    #[test]
    fn linked_offered_on_unrelated_site_carrying_source_salt() {
        let out = match_accounts(
            "https://app.other-site.com",
            &[acc("w.example.org", 5, &["other-site.com"])],
        );
        assert_eq!(out.iter().map(|e| e.domain.as_str()).collect::<Vec<_>>(), ["w.example.org"]);
    }

    #[test]
    fn ranks_exact_host_above_registrable_then_recency() {
        let out = match_accounts(
            "https://x.y.com",
            &[acc("y.com", 1, &[]), acc("x.y.com", 2, &[])],
        );
        assert_eq!(
            out.iter().map(|e| e.domain.as_str()).collect::<Vec<_>>(),
            ["x.y.com", "y.com"]
        );
    }

    #[test]
    fn non_web_urls_match_nothing() {
        assert!(match_accounts("http://localhost:3000", &[acc("localhost", 0, &[])]).is_empty());
        assert!(match_accounts("chrome://extensions", &[acc("github.com", 0, &[])]).is_empty());
    }
}
