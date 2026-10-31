# Security report — cycle 0014 — F-011: Bootstrap installer for Windows (install.ps1)

## Inputs read
- `git diff main...HEAD` (21 files): backend/installer/install.ps1 (new), install-helper.ts (`frontend` record),
  smoke.ts (`formatSmoke(report, frontEnd)`), backend/test/installer/{ps-helpers.ts, install-ps1.test.ts,
  install-ps1-smoke.test.ts, install-ps1-static.test.ts, install-helper-frontend.test.ts, smoke.test.ts}, .gitattributes
- factory/runs/cycle-0014/02-architect.md (security notes), 03-backend.md
- docs/architecture/contracts/installer-cli.md 1.2.0 (sections 4, 6, 10), install.sh (parity reference)

## Work done
Static review of install.ps1 and the helper change, plus dynamic experiments on this Windows host (pwsh 7.6.9)
in a scratchpad sandbox (copy of backend/installer, plugin, personal-config; from-scratch env; stub `node.cmd`
logging argv; planted `az.cmd`/`node.cmd` in cwd logging hijacks):

1. **Secrets**: no real secrets in the diff (only test sentinels like `sk-bf-AbCdEf1234567890`). The key is read
   from `KILO_BIFROST_KEY`, put only into the in-memory stdin record buffer, written to the helper's stdin via
   `System.Diagnostics.Process` (`RedirectStandardInput` only) and the byte buffer is cleared afterwards. Spy:
   node-argv log shows only `-p process.versions.node` and the quoted helper path; key/PAT canaries absent from
   argv, stdout, stderr. PAT vars are only tested for non-emptiness. No temp files, no `Start-Process`.
2. **Injection**: no `Invoke-Expression`, no string-built commands; native calls use `& $exe @constArgs`.
   Interpolated `"org=$org"` records are not re-evaluated (values with `$()`/backticks are inert). `Process.Start`
   with `UseShellExecute=$false`, `FileName` = resolved path, `Arguments` = `"<helper>"` with `"` rejected.
   Helper path in a directory containing `&` and spaces works (CreateProcess wraps the .cmd command line for
   cmd /c). `%VAR%` in the checkout path IS expanded by cmd.exe when node resolves to a `.cmd` shim (see L-1).
3. **Usage errors**: verified no echo for unknown args containing OSC/CSI escape sequences, `-Org:<canary>`,
   hashtable / DateTime values in-process, `-NoSmoke:$false`; all exit 2 with fixed text. An ESC in `-Org`
   reaches the helper, which rejects it with a fixed reason (no echo). Node version is shown only if it matches
   `^[0-9A-Za-z.+-]{1,32}$`.
4. **Command lookup**: `Get-Command -CommandType Application`, Windows accepts only .exe/.cmd/.bat/.com
   (extensionless stub ignored; tested). Empty PATH entries (`;;`) do NOT cause a cwd lookup (planted cwd
   `node.cmd` not run); cwd is used only if the user explicitly has `.` in PATH (same trust as any shell).
   Helper executed only from `Join-Path $PSScriptRoot install-helper.ts`; empty `$PSScriptRoot` (irm|iex) -> exit 3.
5. **`frontend` record**: strict allow-list (`install.sh`/`install.ps1`), duplicate/invalid -> exit 3; only
   used for message text; test proves byte-identical kilo.jsonc with/without it (fresh and update).
6. **Windows file protection**: no ACL/chmod code on win32 confirmed. icacls on the written kilo.jsonc shows
   inherited SYSTEM / Administrators / user only, matching contract section 6. XDG_CONFIG_HOME warning present
   (Windows only), text fixed and contains no path.
7. **Error handling**: top-level catch prints fixed `install.ps1: error: internal error.`, exit 3; no PowerShell
   error records; output only through `[Console]` writes.
8. **Format**: install.ps1 ASCII only, no BOM, LF (`i/lf w/lf attr/text eol=lf`); no `KILO_TEST_`/`NODE_OPTIONS`.
9. **Tests hermetic**: from-scratch env (PATH = sandbox bin only, temp HOME/USERPROFILE/TEMP/APPDATA), `.cmd`
   stubs pointing at `process.execPath`, F-019 fake-network preload; az is either stubbed or a PAT is set, so the
   real az cannot be resolved. install-helper-frontend tests send no `smoke` record (absent = off), so no network
   / az. No test passes empty deps into `runSmoke`.
10. **Dependencies**: `npm audit --omit=dev --audit-level=high` -> 0 vulnerabilities. No dependency changes.

## Files changed
- `factory/runs/cycle-0014/04-security.md` — this report.

## Verification
- `node --test test/installer/install-ps1*.test.ts test/installer/install-helper-frontend.test.ts` -> 78 pass, 0 fail
  (pwsh 7 + Windows PowerShell 5.1 parity tests).
- `npm audit --omit=dev --audit-level=high` -> found 0 vulnerabilities.
- Scratchpad experiments (see Work done 2-4, 6): argv spy, cwd hijack with empty PATH entries, escape-sequence
  args, in-process invocation, `&`/`%` in checkout path, icacls of the result.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| L-1 | low | backend/installer/install.ps1:136,220 | When `node` resolves to a `.cmd` shim (nvm/volta/scoop-style), cmd.exe performs `%VAR%` expansion on the helper path: checkout dir `a & b %OS% c` became `a & b Windows_NT c`, so node ran (tried to run) a different path and printed its own module-not-found stack trace. Exploitation needs control of both the checkout directory name and an env var; no privilege boundary crossed. | Backlog: also reject a helper path containing `%` (alongside `"`) with the existing exit-3 message, or prefer a sibling `node.exe` over a `.cmd` shim. |
| I-1 | info | backend/installer/install.ps1:86,109,141 | `KILO_BIFROST_KEY` and PAT vars stay in the inherited environment of the `node -p` probe, the `az account show` probe and the helper (same as install.sh). Same-user processes only; the helper itself reads the key from stdin. | Optional: remove `KILO_BIFROST_KEY` from `$startInfo.EnvironmentVariables` and run probes without it. |
| I-2 | info | contracts/installer-cli.md:163-166 | Residual risk statement verified accurate for a default profile (icacls: SYSTEM, Administrators, user, all inherited). A pre-existing `.config` with looser ACLs, or a redirected profile, would be inherited as is. | Already a follow-up (ACL hardening); F-016 docs should mention it. |
| I-3 | info | backend/installer/install.ps1:61-70 | PATH resolution trusts the user's PATH (user-writable dirs such as `%APPDATA%\npm` or an explicit `.` entry can shadow node/az). Same trust level as install.sh; empty PATH entries verified not to trigger cwd lookup. | None. |

No critical, high or medium findings.

## Assumptions made (no human available)
- The `%` expansion is rated low: attacker needs to control the user's checkout path and environment, which
  already implies code execution as the user.
- Env inheritance of the key into child processes is accepted for parity with install.sh (ADR-0012/0014).

## Follow-ups for the backlog
- L-1: reject `%` in the helper path (or prefer `node.exe`) in install.ps1.
- I-1: strip `KILO_BIFROST_KEY` from the probe/helper child environments (both front ends).
- Windows ACL hardening / warning on loose config-dir ACLs (already proposed by the architect).
- Windows CI job so PowerShell 5.1 paths are gated in CI.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0014/04-security.md
summary: install.ps1 keeps key/PAT out of argv/output/files, no echo or injection, hermetic tests, 0 audit vulns; 1 low (% expansion via .cmd shim) + 3 info to backlog
