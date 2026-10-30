# Changelog

## [0.0.1] - 2026-10-30

### Added
- T-001: backend project skeleton (TypeScript, node:test, tsc) and ADR-0001 tech stack.
- `scripts/check-lf.sh` and `.gitattributes` to keep shell scripts LF-only.

### Changed
- T-001: `scripts/ci.sh` and the CI workflow now cover the backend only (typecheck, test, build).

### Fixed
- T-001: removed stale compose/Docker checks and the docker-smoke job left over from another product.
