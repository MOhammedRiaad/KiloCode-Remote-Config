# Security report — cycle 0004 — F-002: Plugin: {env:} and {file:} placeholder resolution

## Inputs read
- `git diff main...HEAD` (excluding `factory/`): `backend/plugin/azdo-remote-config.ts`,
  `backend/test/plugin/placeholders.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`,
  `docs/architecture/ADR-0004-placeholder-resolution.md`, `docs/architecture/contracts/plugin-interface.md`,
  `docs/architecture/overview.md`
- `factory/backlog.json` (F-002 criteria), `factory/templates/report.md`
- `git status`: clean working tree

## Work done
- Secrets scan of the diff (keys/tokens/passwords/private keys/.env): only the test canary
  `SECRET-CANARY-42` and the word "secret" in file names/docs. No real secrets, no `.env` files.
- Reviewed `resolvePlaceholders`, `readPlaceholderFile`, `lookupPlaceholder`, `resolveContainer`
  against the requested focus list:
  - **Secret handling**: `homedir()` / `readFile()` run in `try { } catch { }` with no bound error;
    nothing is rethrown, logged, attached as `cause` or stringified. The only throw is the fixed
    depth-cap message with no input data. `unresolved` holds only `kind:name` as written (never a
    value, never the expanded `~` path). Values appear only in the returned `value`. OK.
  - **Env lookup**: `Object.prototype.hasOwnProperty.call(deps.env, name)` + non-empty string check;
    `constructor`, `toString`, `__proto__` cannot resolve to inherited members (tested). OK.
  - **Re-expansion / injection**: single pass via `String.replace` with a callback, so `$&`, `$1`,
    `$$` in values are inert and resolved values (env or file content) are never re-scanned (tested). OK.
  - **Prototype pollution**: output objects built with `Object.defineProperty` on own keys from
    `Object.keys`; an own `__proto__` key stays a data property; input not mutated (tested). OK.
  - **Path handling**: relative paths, bare `~`, `~user` are rejected without a read. `~/..`
    traversal can escape home, but absolute paths are allowed by design (FR-5), so it grants no
    extra capability. Symlinks are followed (same reasoning). NUL bytes in a path make `fs` throw,
    which is swallowed. **Device files / FIFOs / huge files are NOT guarded** -> finding 1.
  - **Recursion / DoS**: depth cap 64 converts deep and cyclic input into the fixed error (tested).
  - **ReDoS**: `\{(env|file):([^{}\r\n]+)\}` cannot backtrack super-linearly: the name class
    excludes `{` so each candidate scan stops at the next `{`. Probed: 200 000-char unclosed
    placeholder 1 ms; 100 000 repeated `{env:a` openings 1 ms.
  - **Unresolved de-dup**: `Array.includes` is O(n^2): 20 000 distinct unresolved names took ~300 ms.
    Only reachable with an absurd trusted config -> low/info follow-up.
  - **FR-11**: only `node:fs`, `node:os`, `node:path` imports; no `require`, no dynamic import, no
    runtime deps (`tools/check-fr11.mjs` passes in CI).
- Trust boundary (accepted by the Architect, ADR-0004 Consequences): the PR-gated shared config can
  read any env var and any user-readable file into Kilo's config (and could, for example, combine
  it with a provider `baseURL` to exfiltrate it). Rated **medium (accepted risk)**; not a FAIL on its own.

## Files changed
- `factory/runs/cycle-0004/04-security.md` — this report (no source edits).

## Verification
- `bash scripts/ci.sh` -> `ci: PASS` (61 tests pass, typecheck, FR-11 lint, check-lf).
- `npm audit --omit=dev --audit-level=high` (backend) -> found 0 vulnerabilities.
- Scratch probe (outside the repo) for ReDoS timings and de-dup cost, results above.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | medium | backend/plugin/azdo-remote-config.ts:230 (default reader), used at :180-193 | The default reader `readFileSync(p, "utf8")` is called on any absolute / `~/` path with no file-type or size check. `{file:/dev/zero}`, `{file:/dev/urandom}` (or a `~/` symlink to them) make the read unbounded until memory is exhausted; `{file:/dev/stdin}`, a FIFO, or on Windows a `\\.\pipe\...` / console device makes `open`/`read` block forever. Both happen synchronously during Kilo startup and cannot be caught by the F-006 try/catch, so a single config typo or hostile line hangs or crashes Kilo for every developer (contradicts FR-10 "never break Kilo"). Also any very large regular file is read fully into memory. Cheap to fix and in code touched this cycle. | Replace the default reader with a guarded one, keeping all errors swallowed by the existing catch: `(p) => { const st = statSync(p); if (!st.isFile() \|\| st.size > MAX_PLACEHOLDER_FILE_BYTES) throw new Error("unreadable"); return readFileSync(p, "utf8"); }` with `import { readFileSync, statSync } from "node:fs"` and a module constant `MAX_PLACEHOLDER_FILE_BYTES = 1024 * 1024` (or smaller). Use `statSync` (not open+fstat) so a FIFO is rejected before it is opened. Add tests: (a) a real temp file larger than the cap with the default reader -> unresolved, nothing in `value`; (b) on non-Windows only (`{ skip: process.platform === "win32" }`), `{file:/dev/zero}` with the default reader -> unresolved and returns promptly. The existing directory test must still pass. |
| 2 | medium (accepted risk) | backend/plugin/azdo-remote-config.ts:180-193, 219-260 | By design (FR-5, ADR-0004) the shared remote config can read any env var and any user-readable file and place it into Kilo's config, where other config keys could send it off-host. Mitigated only by PR review of the shared repo. | None required this cycle (architect-accepted). See follow-ups. |
| 3 | low | backend/plugin/azdo-remote-config.ts:184 | On Windows `isAbsolute("\\\\host\\share\\x")` is true, so `{file:\\host\share\x}` makes the machine connect to an arbitrary SMB host and offer NTLM credentials. Within the accepted trust boundary (trusted config), but it is an extra outbound side-channel. | Follow-up (not blocking): reject paths that start with `\\` or `//` (UNC / device namespace) as unresolved; can be folded into the fix for #1 if convenient. |
| 4 | info | backend/plugin/azdo-remote-config.ts:235 | `unresolved` de-dup uses `Array.includes` (O(n^2)); ~300 ms at 20 000 distinct names. | Follow-up: use a `Set` alongside the array. |

## Assumptions made (no human available)
- Finding 1 rated medium (availability only, needs a config line written by a PR-gated author or a
  user-owned symlink). Per the gate rule "medium, cheap to fix, in code touched this cycle" it
  blocks. Exact failure mode of `/dev/zero` (OOM abort vs. very long hang) varies between Node and
  Bun; either is unacceptable at startup and could not be reproduced on this Windows host.
- The stat-then-read race (TOCTOU) left by the fix is acceptable: the attacker would need to
  already control the user's filesystem.

## Follow-ups for the backlog
- Optional allowlist / prefix restriction for `{file:}` and `{env:}` (e.g. only `~/.config/...`
  or names matching `*_API_KEY`) to narrow the FR-5 trust boundary (finding 2).
- Reject UNC / device-namespace paths on Windows (finding 3).
- Use a `Set` for `unresolved` de-dup (finding 4).
- Architect: after the fix, update ADR-0004 point 6 to document the regular-file-only rule and the size cap.

FACTORY_RESULT
status: FAIL
report: factory/runs/cycle-0004/04-security.md
summary: FAIL - medium: default {file:} reader has no regular-file/size guard (/dev/zero, FIFOs, pipes hang or crash Kilo startup); otherwise secret, pollution, re-expansion, ReDoS and FR-11 checks pass; CI PASS, 0 vulns.
