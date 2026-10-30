# Backend rework 1 (cycle 0003)

status: PASS

## Changes
- backend/plugin/azdo-remote-config.ts: messages now `unterminated string starting at L, column C` and `unterminated block comment starting at ...` (contract 2a).
- backend/test/plugin/jsonc.test.ts: three exact-message assertions updated.
- azdo-remote-config.ts:38: `BOM` now uses the escape `﻿` instead of a raw invisible character.
- Memory/size-cap item left for F-005/F-006.

## Verification
`bash scripts/ci.sh` -> exit 0 (tests fail 0, check-lf PASS, ci PASS).
