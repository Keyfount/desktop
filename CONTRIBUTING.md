# Contributing to Keyfount Desktop

Thank you for considering a contribution! Because this project handles user credentials, we hold the bar high on code quality, testability, and security.

## Branch workflow

We use a **trunk-based** workflow.

- `main` is the only long-lived branch. It is always deployable and protected.
- All work happens on short-lived branches off `main`, then comes back via Pull Request.

**Branch naming:**

| Prefix            | Purpose                                |
| ----------------- | -------------------------------------- |
| `feat/<slug>`     | New feature                            |
| `fix/<slug>`      | Bug fix                                |
| `chore/<slug>`    | Tooling, config, deps                  |
| `docs/<slug>`     | Documentation only                     |
| `refactor/<slug>` | Internal refactor, no behaviour change |
| `test/<slug>`     | Tests only                             |
| `perf/<slug>`     | Performance improvement                |
| `build/<slug>`    | Build system / packaging               |
| `ci/<slug>`       | CI configuration                       |

Example: `feat/liquid-glass-fallback`

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(<scope>): <short imperative summary>

<optional body explaining the why>

<optional footers: BREAKING CHANGE:, Closes #123, ...>
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`.

Keep commits **atomic** — one logical change per commit. Larger PRs should arrive as a sequence of small, reviewable commits, not one giant blob.

## Pull Requests

1. Branch off `main`.
2. Make your changes with passing tests.
3. Open a PR against `main`. Fill in the template.
4. CI must be green and at least one maintainer must approve.
5. PRs are **merged with a merge commit** (`gh pr merge --merge --delete-branch`) to preserve per-commit history. No squashing — atomic commits are how we keep blame and bisect useful.

## Security-sensitive changes

Anything touching the **crypto module**, **storage**, **OS keychain**, or **sync client** requires extra scrutiny. Please reference the design spec and explain your reasoning in the PR description.

The Rust crypto module is locked to the algorithm defined in v1 of the design doc. **Any change that produces a different output for the same inputs is a breaking change for every existing user** and must go through a documented migration plan, not a silent rewrite.

## Code style

- TypeScript strict mode for the frontend.
- Rust 2024 edition, `clippy -- -D warnings` on the backend.
- Run `npm run lint`, `npm run lint:rust`, `npm test`, and `npm run test:rust` before pushing.
- Run `npm run format` to apply Prettier (TS/CSS) and `cargo fmt` (Rust).
- No new dependencies without discussion — we keep the attack surface small.

## UI conventions

- No emojis in user-facing UI except the **fingerprint** (which is intentionally a 3-emoji visual hash). Use the SVG icon set in `src/shared/icons.tsx` for everything else.
- The design tokens (colors, spacing, typography, motion) must stay aligned with the extension and the website — they share the same `theme.css` recipe.

## Reporting bugs / requesting features

Open a [GitHub issue](https://github.com/Keyfount/desktop/issues) using the appropriate template.

For **security vulnerabilities**, see [SECURITY.md](./SECURITY.md) — do not open a public issue.
