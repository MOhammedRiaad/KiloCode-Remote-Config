# CI/Release report — cycle 0011 — F-010: Bootstrap installer for macOS/Linux (install.sh)

## Work done
- Ran `bash scripts/ci.sh`: PASS (376 pass, 0 fail, 4 skipped; check-lf PASS).
- Bumped VERSION 0.8.0 -> 0.9.0 (feature -> minor); planned tag v0.9.0.
- Added CHANGELOG [0.9.0] section.

## Files changed
- `VERSION`, `CHANGELOG.md`

## Assumptions made (no human available)
- No shellcheck added; not trivial.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0011/08-release-prepare.md
summary: CI green, bumped to v0.9.0
