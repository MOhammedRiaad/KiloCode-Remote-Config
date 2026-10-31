# Security report — cycle 0011 — F-010: Bootstrap installer for macOS/Linux (install.sh)

## Inputs read
- `git diff main...HEAD` (19 files), `git status` (clean)
- `factory/runs/cycle-0011/02-architect.md`, `03-backend.md`
- `docs/architecture/contracts/installer-cli.md` (incl. security rules), ADR-0012
- `backend/installer/install.sh`, `install-helper.ts`, `personal-config-edit.ts`
- `backend/test/installer/*.ts`, `backend/tools/check-fr11.mjs` (rule 6), `backend/test/tools/check-fr11.test.ts`
- `backend/plugin/azdo-remote-config.ts` (`parseJsonc`, `resolveSettings`, used by the installer)

## Work done
- **Secrets**: grepped the diff for key/token/private-key patterns and committed `.env`/`.pem`/`.key` files. Only fake fixtures (`FAKE_SECRET_SECRET_TAIL`, `sk-bf-existing`, `OLD_PAT_VALUE`, the AC example `sk-bf-AbCdEf1234567890`) were found. No real secrets.
- **Key hand-off**: the key goes from `KILO_BIFROST_KEY` through the bash builtin `printf '%s\0'` into the helper's stdin. It is never in an external process argv, never in a flag (unknown args are not echoed), and never in output, errors or backup names (backups are named only by UTC timestamp). The helper prints only fixed wording plus paths. The "unusual key" warning does not echo the key. `toMessage` reduces unknown errors to `file system or internal error (<ERRNO>)`, so no stack traces and no messages built from file content. `parseJsonc` error details contain only line and column.
- **stdin parsing**: 64 KiB cap is checked before buffering grows. Fatal UTF-8 decode. The record must end with NUL. Names come from an allow-list and must be unique and complete (`Object.hasOwn`). The value split is on the first `=`, so an `=` inside a value is safe. Probed directly: unknown name `__proto__=1` gives exit 3 `bad helper input`.
- **Value validation**: the six settings go through the plugin's `resolveSettings(..., { env: {} })`, which has no process-env fallback and returns fixed warning texts. Probe: `org=../x` gives exit 2 with fixed wording. The key is rejected on C0/DEL control characters.
- **Shell safety**: `set -euo pipefail`, all expansions quoted, no `eval`/`set -x`/external utilities (enforced by the AC-8 test), and `case` parsing with `shift 2`. The Node version check is numeric-guarded before `[ -gt ]`. `az account show` output is discarded. Only bash 3.2-compatible features are used (`${var//$'\r'/}`, `printf '%s\0'`, `BASH_SOURCE`). Exit codes propagate correctly under pipefail (the rightmost non-zero, the helper's, wins).
- **File system**: every target is checked with `lstat` (no symlink following for `configDir`, `azdo/`, `kilo.jsonc`, or the plugin destination). Temp files use `wx` (O_EXCL, does not follow a planted symlink), get an explicit `chmod`, then `rename` (which replaces a path, never follows a symlink). The temp file is removed on error. The backup uses `wx` in a loop, so it is never overwritten, and it holds the same `Buffer` that was read and parsed, so it is byte-identical, mode 0600. `kilo.jsonc` is 0600; directories are 0700 when created; group/other write is stripped on existing directories. umask can only tighten the modes, and an explicit chmod follows. The read-only planning phase runs before any write.
- **XDG_CONFIG_HOME**: a relative value is rejected (exit 2). An absolute value is used only as the base for fixed file names, so there is no attacker-controlled path component.
- **AC-12**: the helper writes only to `<configDir>/azdo/` and `<configDir>/kilo.jsonc[.bak-*]`. `plugin/` and `plugins/` are only read (readdir) for a warning.
- **Prototype pollution**: `parseJsonc` uses `JSON.parse`, so `__proto__` becomes an own data property. `structuredClone`, `isDeepStrictEqual` and `JSON.stringify` keep it as data. `childObject`/`applyKey` only touch the fixed keys `provider`/`bifrost`/`options`/`apiKey`/`plugin`, none of which exist on `Object.prototype`. Probed with root-level and nested `__proto__` payloads: they round-trip as plain data, nothing is polluted, the key is set correctly, and nothing is echoed. Dropped option names are filtered through `^[A-Za-z0-9_.-]{1,40}$`.
- **Lint rule 6**: `installer/*.ts` may import only `node:`, sibling `.ts` and `../plugin/azdo-remote-config.ts`, and may not use `require(`. Tests cover both the allowed and the rejected cases.
- **Test hermeticity**: every test uses an `mkdtemp` sandbox with `HOME`/`XDG_CONFIG_HOME`/`USERPROFILE`/`TEMP` redirected, `PATH` set to a stub-only bin directory (stub `node` execs the real one, stub `az` logs to the sandbox), and only fake secrets. No network, no real `az`, no real home directory.

## Files changed
- `factory/runs/cycle-0011/04-security.md` — this report (no source changes).

## Verification
- `node --test test/installer/*.test.ts test/tools/check-fr11.test.ts` → 66 pass, 0 fail, 3 skipped (POSIX-only symlink/mode tests on Windows host).
- `npm audit --omit=dev --audit-level=high` → found 0 vulnerabilities (no runtime dependencies; diff adds none).
- Direct helper probes in a scratch `XDG_CONFIG_HOME`: `__proto__` payloads, traversal-like `org`, unknown record name. All behaved as the contract says, and the key was not echoed.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/installer/install-helper.ts:278-297, 307 | TOCTOU between the read-only `lstat` phase and the write phase. If `configDir` did not exist at plan time, `mkdirSync(recursive)` accepts a symlink planted afterwards. `stripGroupOtherWrite` and the no-change `chmodSync(configPath)` follow symlinks. Exploiting this needs write access to the user's own `~/.config` (same user), so the practical impact is minimal. | Backlog: re-`lstat` `configDir`/`azdo` immediately after `mkdirSync` and refuse non-directories. Before the no-change chmod, re-check `isFile()` with `lstat` (or open with `O_NOFOLLOW` and `fchmod`). |
| 2 | low | backend/installer/install.sh:132 | `script_dir=$(cd "$script_dir" && pwd)` is affected by `CDPATH`. With a relative invocation path (`bash backend/installer/install.sh`) and a matching `CDPATH` entry, `cd` prints the directory and/or resolves elsewhere. The helper path then breaks (DoS), or a same-named helper under the CDPATH directory runs. The environment is user-controlled. | Use `script_dir=$(CDPATH= cd -- "$script_dir" && pwd)`. |
| 3 | info | backend/installer/install-helper.ts:214 | File names from `plugin/`/`plugins/` (prefix `azdo-remote-config.`) are printed raw to stderr. A crafted name could contain terminal escape sequences. These are the user's own files. | Optional: print only names that match a safe charset, otherwise `(unprintable name)`, as is already done for option names. |
| 4 | info | backend/installer/install-helper.ts:143-156 | Backups keep old keys (mode 0600) and pile up on every changing run. | Optional docs note (F-docs) to delete old backups after verifying the install. |
| 5 | info | backend/installer/install.sh:116 | `az` inherits the exported `KILO_BIFROST_KEY` environment variable. It does not log it, and this is an inherent consequence of env-var input. | None required. |

No critical, high or medium findings.

## Assumptions made (no human available)
- Same-user local attackers (who can already write `~/.config`) are out of scope for this threat model. This puts the TOCTOU and CDPATH findings at low.
- The 3 tests skipped on the Windows host (symlink refusal, POSIX modes) are assumed to run on Linux CI, as the contract states. Their logic was reviewed statically.

## Follow-ups for the backlog
- Harden the write phase against post-plan symlink swaps (finding 1).
- `CDPATH= cd --` in `install.sh` (finding 2). Also apply this to F-011 if it adds a shell shim.
- Sanitize printed auto-load file names (finding 3).
- Docs: mention backup files containing the key and how to clean them up (finding 4).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0011/04-security.md
summary: F-010 installer passes security gate; key never in argv/output, safe NUL stdin parsing, lstat/wx/rename writes, no pollution; 2 low + 3 info follow-ups.
