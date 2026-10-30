# Backend rework 1b

status: PASS

## Change
- backend/plugin/azdo-remote-config.ts: new helper `isUncLike` (char check: first two characters each `/` or `\`), replaces the two startsWith checks in `readPlaceholderFile`. It runs before `~/` expansion, so reader and homedir are never called for such paths. No regex, so no forbidden delimiter pairs.
- backend/test/plugin/placeholders.test.ts: the AC-5 UNC test now covers `\\host\share\x`, `//host/share/x`, `\/host/share/x`, `/\host\share\x` (plus the earlier f.txt variants). A recording reader and homedir assert zero calls.

## Verification
- `bash scripts/ci.sh`: exit 0 (64 tests, 63 pass, 0 fail, 1 skipped on win32; check-lf PASS).
- No CR characters in the edited files.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0004/07-backend-rework1b.md
summary: UNC rejection aligned with contract (mixed slash forms), tests added, ci passes
