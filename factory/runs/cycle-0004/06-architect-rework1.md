# Architect report — cycle 0004 — F-002: Plugin: {env:} and {file:} placeholder resolution (rework 1)

## Inputs read
- `factory/runs/cycle-0004/04-security.md` (FAIL: finding 1 medium, finding 2 accepted, finding 3 low, finding 4 info)
- `docs/architecture/ADR-0004-placeholder-resolution.md`, `docs/architecture/contracts/plugin-interface.md`,
  `docs/architecture/overview.md`
- `backend/plugin/azdo-remote-config.ts` (read only, to align wording; not modified)

## Work done
- ADR-0004 amended (still "accepted", amendment line added):
  - Point 2: imports now `readFileSync, statSync` from `node:fs`.
  - Point 6: new **UNC rejection** rule, checked first on `PATH` as written: regex `^[\\/]{2}`
    (covers `\\`, `//` and the mixed `\/`, `/\`). The result is unresolved, and neither `homedir` nor
    `readFile` is called. This applies to all readers. It is not re-applied to the expanded `~/`
    target, so a network home directory still works.
  - Point 6: new **default reader guard**. A module-local constant sets
    `MAX_PLACEHOLDER_FILE_BYTES = 1024 * 1024`. The reader calls `statSync(p)`, then rejects
    anything where `!isFile()` or `size > cap` by throwing (the existing unbound catch discards the
    error), then calls `readFileSync(p, "utf8")`. Exactly 1 MiB is allowed. Directories, FIFOs,
    pipes, devices (`/dev/zero` etc.), sockets, oversize files and symlinks to them are unresolved.
    The TOCTOU race is accepted.
  - The guard covers the default reader **only**. Injected readers are unchanged.
  - Consequences: test plan (temp file larger than 1 MiB on all platforms; `/dev/zero` skipped on
    win32; UNC cases with a recording fake reader that must never be called). Files larger than
    1 MiB are a documented limit. Finding 2 stays an accepted medium risk, and the allowlist /
    path-prefix limit is a backlog follow-up.
  - Alternatives: open+fstat rejected (it blocks on a FIFO). Guarding injected readers rejected.
- Contract `plugin-interface.md` bumped **0.3.0 -> 0.3.1** (patch: tightened behaviour, no
  signature or export change). Section 2 imports now list `statSync`. In section 2b the
  `readFile` default comment changed, the `MAX_PLACEHOLDER_FILE_BYTES` constant (module-local) was
  added, and three new rows were added: "UNC rejection", "Default reader", "Injected reader".
  The "value" row now mentions the guard.
- overview.md: the C2 internal-structure line now describes the guarded default reader and the UNC rejection.

## Files changed
- `docs/architecture/ADR-0004-placeholder-resolution.md` — amendment for security findings 1 and 3, finding 2 still accepted
- `docs/architecture/contracts/plugin-interface.md` — v0.3.1, section 2 imports, section 2b rules
- `docs/architecture/overview.md` — C2 structure line
- `factory/runs/cycle-0004/06-architect-rework1.md` — this report

## Verification
- Docs only. No code touched. Checked that no other doc references contract version 0.3.0.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | contracts/plugin-interface.md 2b "UNC rejection" | The contract defines UNC as "first two characters are both `/` or `\`". This is a superset of the backend instruction ("two backslashes or two forward slashes"), because it also covers mixed `\/` and `/\`, which Windows also treats as UNC. | Backend should use `/^[\\/]{2}/.test(path)`. If it only checks `\\` and `//`, add the mixed forms plus a test case. |

## Assumptions made (no human available)
- Patch bump (0.3.1): no type, signature or export change, only narrower acceptance of inputs.
- The UNC check runs on `PATH` as written, not on the expanded `~/` target, so users with a
  network home directory are not broken.
- The UNC rule applies to injected readers too, because it is a path-classification rule. Only
  the stat/size guard is limited to the default reader.
- Size cap boundary: `size > 1 MiB` is rejected and `size == 1 MiB` is allowed.

## Follow-ups for the backlog
- Optional allowlist / path-prefix restriction for `{file:}` and a name allowlist for `{env:}`
  (security finding 2, accepted risk).
- Use a `Set` for `unresolved` de-dup (security finding 4, info).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0004/06-architect-rework1.md
summary: ADR-0004 point 6 and contract 2b (v0.3.1) now specify UNC rejection (^[\\/]{2}, no reader call, all readers) and the default-reader guard (statSync isFile + 1 MiB cap MAX_PLACEHOLDER_FILE_BYTES, default only); finding 2 still accepted with allowlist as follow-up.
