# 03 — Senior Backend (cycle 0010, F-009)

Note: the engineer could not write this file itself; the orchestrator transcribed its hand-back.

- status: PASS
- Added `backend/personal-config/kilo.jsonc` (exact text from contract section 1; ASCII, LF, no BOM).
- Added `backend/test/personal-config/template.test.ts` (9 tests, AC1-AC6). Reuses parseJsonc / resolveSettings / mergeConfig, validateConfigText / SECRET_PATTERN, and test helpers (FAKE_SECRET built at runtime).
- One fix: a `tsc` cast in the new test changed to `as unknown as Record<string, unknown>`.
- `bash scripts/ci.sh` exit 0: 324 tests, 323 pass, 0 fail, 1 skipped (pre-existing). check-lf PASS.
- Untouched: backend/plugin/**, backend/validator/**, tools/, package.json, tsconfig.json, scripts/ci.sh.

| AC | Test |
|----|------|
| AC1 | template parses with expected root keys and schema; comments name global path and warn about project dirs |
| AC2 | plugin entry is a tuple with exactly six options and no pat |
| AC3 | plugin settings resolve with nothing missing and no warnings |
| AC4 | provider holds only an apiKey placeholder that is not secret-shaped |
| AC5 | no secret-pattern finding for template; positive control flagged without echoing value |
| AC6 | merge (defaults and enforce) keeps apiKey and plugin |
| AC7 | ci.sh exits 0 |
