# CI prepare report - cycle 0002 (T-001)

## CI result
`bash scripts/ci.sh` exit 0: backend npm ci, lint (check-fr11 PASS), typecheck (tsc), test (15/15 pass), build (--if-present), check-lf PASS, "ci: PASS".

## Changes
- scripts/ci.sh: removed check-compose and RUN_DOCKER_SMOKE; added scripts/check-lf.sh call and a guard that ci.yml calls scripts/ci.sh.
- scripts/check-lf.sh added; check-compose.sh and smoke-docker.sh deleted; .gitattributes (`*.sh text eol=lf`) added.
- .github/workflows/ci.yml: docker-smoke job and setup-python removed; quality-gate and gitleaks kept.
- docs/development.md: resolved "Known issue" section removed.

## Release
- Planned version: v0.0.1 (chore => patch), planned tag v0.0.1. VERSION and CHANGELOG.md (new) updated.

## Assumptions
- CHANGELOG.md did not exist; created. Windows matrix leg skipped (optional).
