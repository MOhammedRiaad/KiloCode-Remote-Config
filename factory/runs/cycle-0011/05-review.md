# Code Review report — cycle 0011 — F-010: Bootstrap installer for macOS/Linux (install.sh)

## Inputs read
- `git diff main...HEAD` (20 files), `git status` (clean, no uncommitted changes)
- `factory/runs/cycle-0011/01-product-owner.md` (8 ACs), `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/contracts/installer-cli.md`, `docs/architecture/ADR-0012-posix-bootstrap-installer.md`
- `backend/installer/install.sh`, `install-helper.ts`, `personal-config-edit.ts`
- `backend/test/installer/helpers.ts`, `install-sh.test.ts`, `personal-config-edit.test.ts`
- `backend/tools/check-fr11.mjs`, `backend/test/tools/check-fr11.test.ts`, `backend/tsconfig.json`
- `backend/personal-config/kilo.jsonc`, `backend/package.json`

## Work done
- Ran the full quality gate myself.
- Traced every AC to code and to a test that would fail if the behaviour broke (table below).
- Checked contract conformance: CLI flags, env precedence, processing order, exit codes 0/1/2/3, stdin record protocol, update rules, file modes, backup naming and `wx`, output wording, and what is never printed.
- Reviewed the code for correctness: flag parsing under `set -u`, Node version parsing, pipefail exit propagation, read-only and write phase split, `structuredClone`/`isDeepStrictEqual` idempotency, the plugin-entry merge index, `childObject` with `in`, backup collision loop, temp-file cleanup, and Windows `chmod` gating.
- Ran probes in a scratch sandbox (Git Bash, fake PATH, temp HOME):
  - Node `22.17.9` stub: exit 1 with the "22.18 or later" message. The boundary behaves correctly.
  - Existing config already canonical with comments: exit 0, "already up to date", no backup, comments kept.
  - `CDPATH` set and a relative invocation path: works on this host. Security low #2 still stands as a follow-up.
  - Config with a UTF-8 BOM: parsed, backed up and updated. Exit 0.
  - `install.sh` copied alone without the helper: Node prints a stack trace and exits 1 (follow-up #2).
- Checked test hermeticity. Each test gets an `mkdtemp` sandbox. HOME, USERPROFILE, TEMP and TMP are redirected. PATH holds only stub `node`/`az`, and the stub `node` execs the absolute `process.execPath`. Only fake secrets are used, there is no network, and the real home directory is never touched. 4 tests skip on Windows: the mode assertions and the symlink refusal. They skip with a clear message ("POSIX permissions are not enforced on Windows"), and the Windows run still exercises the rest of each test, which is what AC-8 allows.
- Lanes: source changes are only under `backend/`. `docs/architecture/` was changed by the Architect, and `factory/` by the PO and orchestrator.

### AC -> code -> test
| AC | Code | Test(s) that would fail |
|----|------|-------------------------|
| AC-1 fresh install | `install-helper.ts` buildPlan/applyPlan, `personal-config-edit.ts` renderFresh | install-sh "AC-1 fresh install ..." (byte-identical plugin, exact plugin array, apiKey, 0600 on POSIX); flags/env and XDG tests; unit fresh render tests |
| AC-2 no secret echo / placeholder | `install.sh:134` (stdin only), helper fixed messages | "AC-2 neither the key nor the PAT ...", "without a key the placeholder ...", "--key not echoed", "control characters" |
| AC-3 update + byte-identical backup | `planUpdate`, `mergePlugins`, `applyKey`, `writeBackup` (same Buffer that was read) | "AC-3 update keeps ... backs up byte-identically" (backup content === original), "update without a key keeps the existing key"; unit "update keeps other settings" (provider.other, headers, baseURL) |
| AC-4 nothing in plugin/, entry once | helper writes only `azdo/` and `kilo.jsonc[.bak-*]` | "AC-4 nothing is written to plugin/ ...", "existing copy in plugin/ triggers a warning" |
| AC-5 prerequisites before writes | `install.sh:85-124` | "no az and no PAT", "az not logged in", "logged-in az", "PAT skips az", "Node too old", "every failing prerequisite" (all assert `snapshot(home) == {}`) |
| AC-6 idempotent, no extra backup | `isDeepStrictEqual` no-write path, plugin `Buffer.equals` | "running twice changes nothing (fresh / update start)" (recursive byte + mode snapshot, backup count); unit "update is idempotent" |
| AC-7 errors, no echo, files untouched | install.sh usage paths; helper `parseExisting`, `UPDATE_MESSAGES`, `toMessage` | missing org/project/repo, unknown flags, invalid values, problem configs (CONTENT_SENTINEL not echoed, snapshot unchanged), oversized, relative XDG, symlink |
| AC-8 CI, FR-11, protected files | `check-fr11.mjs` rule 6 | ci.sh PASS; check-fr11 installer tests; `git diff main...HEAD -- backend/plugin backend/personal-config backend/validator backend/package.json` is empty |

## Files changed
- `factory/runs/cycle-0011/05-review.md` — this report.

## Verification
- `bash scripts/ci.sh` -> exit 0 (`tests 380, pass 376, fail 0, skipped 4`; `check-lf: PASS`; `ci: PASS`).
- `git diff main...HEAD --stat -- backend/plugin backend/personal-config backend/validator backend/package.json` -> no output (unchanged).
- Manual probes listed under Work done. All behaviour matched the contract, apart from follow-up #2 (an unsupported layout).

## Findings / issues
No gating findings. The non-gating items below are listed for traceability and are repeated under Follow-ups.

| # | Severity | File:line | Finding | Required fix | Owner |
|---|----------|-----------|---------|--------------|-------|
| 1 | low | backend/test/installer/install-sh.test.ts:246-254 | "AC-5 Node 22.18 and newer pass the version check" runs with `--help`. `--help` is handled before the prerequisite check (install.sh:25-32), so the test passes whatever the version logic does. Example: change `-ge 18` to `-ge 19` at install.sh:98 and the test stays green. The boundary itself is correct (probe: 22.17.9 is rejected). Only this test is vacuous. | Run with `REQUIRED_ARGS` + `AZDO_PAT` and assert exit 0. Add a `22.17.x` case that asserts exit 1. | backend |
| 2 | low | backend/installer/install.sh:134 | If `install-helper.ts` is missing next to the script (for example, only `install.sh` was downloaded), Node prints a stack trace and exits 1. Exit 1 means "prerequisite missing", while the contract (sections 3 and 7) maps missing sources to exit 3 with no stack trace. ADR-0012 section 2 requires the checkout layout, so this is an unsupported layout. | Before the hand-off, check `[ -f "$script_dir/install-helper.ts" ]`. If it fails, print `install.sh: error: installer sources are missing ...` and exit 3. | backend |
| 3 | info | backend/test/installer/install-sh.test.ts:24,91-99 | The AC-2 text names the key `sk-bf-AbCdEf1234567890`. The test uses `FAKE_SECRET_SECRET_TAIL`, which also triggers the "unusual key" warning path. Coverage is equivalent or broader, but the `sk-bf-` path, which prints no warning, is not checked for leaks end to end. | Optional: loop the leak test over both an `sk-bf-...` key and a key without the prefix. | backend |
| 4 | info | backend/test/installer/install-sh.test.ts:41,129-147 | The AC-3 integration fixture does not contain `provider.other` or `provider.bifrost.options.headers`. The unit test covers them (personal-config-edit.test.ts:56-75), so the AC is covered. | Optional: add both keys to `EXISTING` and deep-compare them after the run. | backend |

## Assumptions made (no human available)
- I accept follow-up #1 as non-gating. The prerequisite under test (Node >= 22.18) is contract behaviour, not one of the 8 ACs. The lower side is covered by real assertions (20.11.0 and 18.0.0 fail), and I verified the boundary by probe.
- Running install.sh outside the documented checkout layout (follow-up #2) is out of scope per ADR-0012 section 2, so it is not a correctness bug for this item.
- The POSIX-only assertions (modes, symlink refusal) skip on this Windows host. I reviewed them statically. They are expected to run on Linux CI. I treat them as valid hermetic tests, not as weakened tests.

## Follow-ups for the backlog
- Fix the vacuous Node version test and add a 22.17 boundary case (finding 1).
- Guard against a missing `install-helper.ts` in install.sh: fixed message, exit 3 (finding 2).
- Optional: run the AC-2 leak test with an `sk-bf-` key too, and widen the AC-3 integration fixture (findings 3, 4).
- Carry over the security follow-ups from 04-security.md: post-plan symlink re-check, `CDPATH= cd --`, sanitising printed auto-load names, and a docs note on backups that contain the key.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0011/05-review.md
summary: F-010 installer passes review; ci.sh green (376 pass/4 POSIX skips), all 8 ACs covered by code and failing-capable tests, contract conformant, protected files unchanged; 2 low + 2 info backend follow-ups.
