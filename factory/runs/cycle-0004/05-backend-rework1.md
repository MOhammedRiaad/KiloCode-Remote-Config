# Backend rework 1 (security findings 1, 3, 4)

Changes (backend/ only):
- plugin/azdo-remote-config.ts: guarded default reader `readGuardedFile` (statSync first; rejects non-files and files over `MAX_PLACEHOLDER_FILE_BYTES` = 1 MiB; error swallowed by the existing catch). The injected reader is unchanged. UNC-style paths (two backslashes or two forward slashes) are unresolved without calling the reader. `unresolved` de-dup now uses a Set alongside the array.
- test/plugin/placeholders.test.ts: new tests for an oversize file with the default reader, `/dev/zero` (skipped on win32), and UNC paths.

Verification: `bash scripts/ci.sh` exits 0 (64 tests, 63 pass, 0 fail, 1 skipped: the /dev/zero test on win32; check-lf PASS). The /dev/zero test did not run here (Windows), so it is unverified on this host.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0004/05-backend-rework1.md
summary: guarded default reader, UNC rejection, Set de-dup; ci.sh passes
