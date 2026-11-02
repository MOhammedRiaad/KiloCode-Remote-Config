# Backend rework 3 (cycle 0027)

Status: PASS (engineer report relayed by the orchestrator; the engineer did not write a file).

Root cause: the [pwsh] argv allow-list expected the node helper path wrapped in double quotes. The Windows node.cmd stub logs `%*` (quoted); the POSIX stub logs `$*` (bare). On the Linux runner the bare path never matched, so 7 [pwsh] tests failed (24, 25, 26, 29, 30, 31, 82). Same failures on main at 2d197f6, so pre-existing.

Fix (backend/test/installer only): ps-helpers.ts exports isAllowedNodeArgv(line) (exactly `-p process.versions.node` or the helper path, quoted on Windows, bare on POSIX, case-insensitive as before); install-ps1-smoke.test.ts and install-ps1.test.ts use it. No test skipped, deleted or weakened; leak assertions unchanged.

Local: lint PASS, 716 pass / 0 fail / 10 skipped (the [pwsh] tests skip on Windows). Linux proof is CI only.
