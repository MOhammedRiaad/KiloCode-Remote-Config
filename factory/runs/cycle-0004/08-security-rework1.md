# Security report (Re-check 1) — cycle 0004 — F-002: Plugin: {env:} and {file:} placeholder resolution

## Inputs read
- Previous findings: `factory/runs/cycle-0004/04-security.md` (FAIL on finding 1).
- `git show HEAD` (18e8208, "fix(F-002): address security findings (rework 1)") and
  `git diff main...HEAD` for context.
- `backend/plugin/azdo-remote-config.ts` (lines 165-280), `backend/test/plugin/placeholders.test.ts`,
  `docs/architecture/ADR-0004-placeholder-resolution.md`, `docs/architecture/contracts/plugin-interface.md`
  (v0.3.1), `docs/architecture/overview.md`, `factory/templates/report.md`.

## Work done
- **Finding 1 (medium, default reader unguarded) — FIXED.** `readGuardedFile`
  (`backend/plugin/azdo-remote-config.ts:181-185`) runs `statSync` (follows symlinks, does not open)
  and throws unless `isFile()` and `size <= MAX_PLACEHOLDER_FILE_BYTES` (1 MiB, line 176). It is the
  default reader only (line 246). The thrown `Error("unreadable")` carries no path/data and lands in the
  existing unbound `catch` (line 206), so nothing leaks. FIFOs, devices, directories, sockets and
  oversize files are rejected before any open.
  - Tests really exercise it: `placeholders.test.ts:130-140` writes a real 1 MiB + 1 byte temp file and
    calls `resolvePlaceholders` **without** deps (default reader); without the guard `x` would resolve
    and `deepEqual(r.value, { y: "ok" })` would fail, so the test is a genuine regression test. The
    `/dev/zero` test (`:142-148`) is skipped on Windows (correct; seen as the 1 skipped test here) and
    runs on Linux CI. Directory test still passes.
  - Windows probe (scratch, outside repo, default reader): `C:\CON`, `C:\NUL`, `C:\Windows\..\CON`,
    `\??\C:\...`, `C:CON`, `CON`, `\\.\pipe\x`, `//./NUL` all unresolved in 0 ms; a file of exactly
    1 048 576 bytes resolves, 1 048 577 bytes is unresolved (boundary matches the contract).
- **Finding 3 (low, UNC) — FIXED.** `isUncLike` (`:188-191`) rejects when chars 0 and 1 are each `/`
  or `\` (covers `\\host`, `//host`, `\/`, `/\`, `\\.\`, `\\?\`). It is checked first in
  `readPlaceholderFile` (`:197`), before `homedir()` and before any reader, so it applies to injected
  readers too. Test `placeholders.test.ts:150-165` proves 6 forms never call the reader nor `homedir`.
  Not re-checked after `~/` expansion (documented; a network-share home is the user's own config, and
  `join(home, "\\host")` cannot produce a new UNC prefix since the home prefix stays first).
- **Finding 4 (info, O(n^2) de-dup) — FIXED.** `Set`-based `seen` (`:249-255`); order and output
  of `unresolved` unchanged (first-occurrence test still passes).
- **Regression checks:**
  - Secrets: `unresolved` still holds only `kind:name` as written; no new logging, `cause`, or error
    text; the guard's error is constant. OK.
  - FR-11: only adds `statSync` from `node:fs`; `tools/check-fr11.mjs` passes in CI. OK.
  - Prototype pollution / re-expansion / depth cap: code unchanged (`defineProperty`, single-pass
    `replace` callback, depth 64); tests still pass. OK.
  - Diff secrets scan: only test canary strings; no keys, tokens, `.env` files.
- **TOCTOU (statSync then readFileSync) — acceptable.** Swapping a regular file for a FIFO/device or
  growing it between the two calls requires write control of a path that the PR-gated config names,
  i.e. an attacker who already controls the user's filesystem. The rejected alternative
  (open + fstat) blocks on FIFOs at open, so the chosen order is the safer one. Impact is availability
  only. Accepted, consistent with ADR-0004 point 6.
- Residual (low, not blocking): Linux pseudo-files (`/proc/*`, `/sys/*`) report `isFile()` true and
  `size 0`, so they bypass the size cap; they are bounded in practice and readable only by the user
  anyway, within the accepted trust boundary (finding 2). Listed as a follow-up only.

## Files changed
- `factory/runs/cycle-0004/08-security-rework1.md` — this report (no source edits).

## Verification
- `bash scripts/ci.sh` -> `ci: PASS` (64 tests: 63 pass, 1 skipped = `/dev/zero` on win32; typecheck,
  FR-11 lint, check-lf PASS).
- `npm audit --omit=dev --audit-level=high` (backend) -> found 0 vulnerabilities.
- Scratch probe of the default reader on Windows device/UNC/NT paths and the 1 MiB boundary (results above).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | resolved (was medium) | backend/plugin/azdo-remote-config.ts:176-185, 246; backend/test/plugin/placeholders.test.ts:130-148 | Default reader now stat-guards to regular files <= 1 MiB; oversize and `/dev/zero` tests use the default reader. | None. |
| 2 | medium (accepted risk) | backend/plugin/azdo-remote-config.ts:195-216 | Shared config can read any env var / user-readable file into Kilo config (FR-5 by design, PR-gated). Unchanged. | None this cycle (architect-accepted, ADR-0004 Consequences). |
| 3 | resolved (was low) | backend/plugin/azdo-remote-config.ts:188-191, 197; backend/test/plugin/placeholders.test.ts:150-165 | UNC / device-namespace paths rejected before `homedir()` and any reader. | None. |
| 4 | resolved (was info) | backend/plugin/azdo-remote-config.ts:249-255 | `Set`-based de-dup. | None. |
| 5 | info | backend/plugin/azdo-remote-config.ts:181-185 | stat-then-read TOCTOU; also `/proc`/`/sys` pseudo-files report size 0 and pass the cap. Availability only, needs local filesystem control or a user-readable bounded pseudo-file. | None required; optional follow-up: cap the actual read (e.g. check `content.length` after read) if ever needed. |

## Assumptions made (no human available)
- TOCTOU accepted as in ADR-0004: exploitation presupposes filesystem control, impact is a startup hang only.
- The `/dev/zero` test only runs on Linux CI; the Windows run skipping it is correct and the oversize
  temp-file test covers the guard on every platform.

## Follow-ups for the backlog
- Optional allowlist / prefix restriction for `{file:}` and name allowlist for `{env:}` (finding 2).
- Optional: post-read length check to also bound pseudo-files / files grown after stat (finding 5).
- Optional: explicit test for a file of exactly 1 048 576 bytes resolving (boundary verified by probe only).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0004/08-security-rework1.md
summary: PASS - findings 1 (default reader guard), 3 (UNC rejection), 4 (Set de-dup) verified fixed with real default-reader tests; no secret/FR-11/pollution regressions; TOCTOU accepted (info); finding 2 remains accepted risk; CI PASS, 0 vulns.
