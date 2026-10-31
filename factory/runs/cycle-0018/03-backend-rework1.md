# Backend rework 1 (F-016, from 04-security.md)

Files: backend/tools/check-docs.mjs, backend/test/tools/check-docs.test.ts

| # | Fix | Test |
|---|-----|------|
| 1 | main() redacts every message with `/sk-bf-[A-Za-z0-9]{16,}/gi` -> `sk-bf-<redacted>` | "link forms never echo a secret key" (4 forms: exit 1, secret-key finding, key in neither stream); "kilo-range message never echoes a secret key" |
| 2 | Root and link target resolved with realpathSync; target real path must be inside real root, resolve error = "file not found"; anchors only read for regular files | "links through a junction or symlink leaving the root fail" (ran, not skipped, on Windows) |
| 3 | Lines over 10000 chars skip link extraction and emit a `line-too-long` finding; secret/forbidden scans still run on the full line | "a very long line skips link extraction but keeps the secret scan" |

Proposed contract change (Architect owns): add rule `line-too-long` (links not checked on lines over 10000 characters; fails the gate) and state that link targets are checked by real path (symlinks/junctions leaving the root are "outside the repository"); state output messages are redacted.

Verification (in backend/): `npm run lint` PASS; `npm run typecheck` PASS; `npm test` 575 tests, 570 pass, 0 fail, 5 skipped (pre-existing).
