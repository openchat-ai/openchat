# Branch Strategy

## Branches
- `main` — production-ready, CI must be green
- `feat/*` — new features, branched from `main`
- `fix/*` — bug fixes, branched from `main`
- `chore/*` — refactoring, lint fixes, docs

## Rules
- No direct commits to `main` (except hotfixes with review)
- Feature branches must be merged via PR
- Commits must be atomic: one concern per commit (no mixed feat/fix/chore)
- Before merge: rebase onto `main`, squash fixup commits
- Flutter work must use `feat/flutter-*` branches to keep JS/TS history clean
