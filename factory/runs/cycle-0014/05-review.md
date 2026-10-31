# Code Review report - cycle 0014 - F-011: Bootstrap installer for Windows (install.ps1)

## Inputs read
- `git diff main...HEAD` (22 files; working tree clean)
- `factory/backlog.json` (F-011, AC-1..AC-8), `01-product-owner.md`, `02-architect.md`, ADR-0014,
  `docs/architecture/contracts/installer-cli.md` 1.2.0 (sections 4, 6, 10), `03-backend.md`, `04-security.md`
- `backend/installer/install.ps1`, `install-helper.ts`, `smoke.ts`, and the tests
  `install-ps1.test.ts`, `install-ps1-smoke.test.ts`, `install-ps1-static.test.ts`,
  `install-helper-frontend.test.ts`, `ps-helpers.ts`, `smoke.test.ts`

## Work done
- Ran the full quality gate.
- Mapped each AC to the code that implements it and a test that would fail if it broke.
- Checked install.ps1 against contract section 10 (parsing, order, messages, exit codes, stdin records, argv).
- Checked the helper `frontend` record against contract section 4 (the install.sh path keeps its output).
- Tested the colon-form deviation myself on pwsh 7 and Windows PowerShell 5.1.
- Checked lanes and confirmed the protected files are unchanged.

## Files changed
- `factory/runs/cycle-0014/05-review.md` - this report (only file edited).

## Verification
- `bash scripts/ci.sh` -> exit 0 (`ci: PASS`): 484 tests, 480 pass, 0 fail, 4 skipped (pre-existing POSIX-only
  skips such as `/dev/zero`). Lint, typecheck and check-lf passed. The install.ps1 tests really ran: 55 `[pwsh]` and 12 `[powershell5]` test lines.
- `git diff --stat main...HEAD -- backend/installer/install.sh backend/plugin backend/personal-config backend/validator backend/package.json package.json frontend scripts .github` -> empty.
  install.sh, the plugin, the personal-config template, the validator and the package manifests are unchanged.
  The engineer did not edit anything outside `backend/` (`.gitattributes` was changed by the orchestrator, docs by the Architect).
- install.sh output: the helper only switches text when `frontend=install.ps1` is sent. With the record absent,
  the prefix (`install.sh:`), the `--name` labels, the usage hint and the no-key hint text are byte-identical to the
  previous constants. The existing install.sh, helper and smoke suites pass unchanged, and
  `install-helper-frontend.test.ts` "frontend=install.sh behaves like an absent record" pins this.
- Colon form, tested with a `$args` dump script:
  - `-File` on both hosts: `-Org:value` arrives as `-Org`, `value`, and `-Org:` arrives as `-Org`. The script cannot tell
    these apart from `-Org value`.
  - In-process `& install.ps1 -Org:value` (both hosts): `$args` holds `-Org:`, `value`, and the real install.ps1 exits 2 with
    `unknown option or argument.` (verified).
  - So the implementation follows the contract wherever the distinction is visible. Under `-File` the value is
    taken as a normal value: it is never echoed, nothing is bypassed, and it goes through the same validation.
    This deviation is acceptable. Contract 10.1 should be relaxed to say the `-Name:value` usage error applies
    to in-process calls only (Architect follow-up, not blocking).

### Acceptance criteria -> code -> tests
| AC | Code | Test that fails if broken |
|----|------|---------------------------|
| AC-1 | install.ps1 records + helper | `AC-1 fresh install matches install.sh byte for byte` (plugin bytes == source, kilo.jsonc == install.sh reference; pwsh + PS 5.1), defaults/placeholder, XDG target |
| AC-2 | install.ps1:156-199 | env vs parameter precedence (both hosts), empty = absent, 3 missing-input tests + all-missing, 9 bad-argument forms (exact stderr, no canary echo, no footprint, node not run), 5 help spellings |
| AC-3 | helper (unchanged logic) | `AC-3 update keeps other settings...` (model, provider.other, headers, sk-bf-existing, my-other-plugin, single entry, byte-identical backup, == install.sh reference) |
| AC-4 | helper | fresh/update: one reference, no `plugin`/`plugins` dir, second run snapshot-equal, no new backup; auto-loaded copy untouched |
| AC-5 | install.ps1:61-115, 207-216 | no az + no PAT, az not logged in (argv logged), each PAT var skips az, no node, 22.17.0, unknown version, all reported, 22.18.0/23.0.1 pass, extensionless ignored (Windows), helper missing exit 3 |
| AC-6 | helper + `formatSmoke(frontEnd)` | smoke pass (2 requests, Basic/Bearer), 401 -> exit 4 with files equal to the success run, AzDO fail, -NoSmoke (default and explicit), no-key hint names install.ps1 |
| AC-7 | install.ps1 has no key parameter, records go on stdin, `[Array]::Clear` | output and node/az argv logs checked on the success, usage, prerequisite and smoke-failure paths; az token path |
| AC-8 | install.ps1 format, contract section 10 | `install-ps1-static.test.ts` (ASCII/LF/no BOM, banned commands, no test seams, strict mode), contract presence; PS_SKIP skip path in `ps-helpers.ts` |

## Findings / issues
No blocking findings.

| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | info | architect | docs/architecture/contracts/installer-cli.md (section 10.1, "Anything else" row) | Contract says `-Name:value` is a usage error. Under `-File`, both hosts split it into `-Name value` before the script runs (verified), so this cannot be implemented. In-process calls do give exit 2 (verified). | Not blocking. Relax the sentence: "`-Name:value` (in-process `&` calls only; under `-File` the host passes it as `-Name value`)". |
| 2 | low | architect | docs/architecture/overview.md:90 | The file contains literal NUL bytes (meant as `\0` text in the record list), so git treats it as binary (`Bin` in the diff stat). The same line also lost the backslash in `$PSScriptRoot\install-helper.ts`. | Not blocking (docs only, CI unaffected). Replace the NUL bytes with the text `\0` and restore the backslash. |
| 3 | low | backend | backend/installer/install.ps1:133-141 | `Invoke-Helper` starts `<node>` through `Process.Start`. If `node` resolves to a `.cmd`/`.bat` shim in a folder whose path contains spaces, and the helper path also contains spaces, then cmd.exe's `/c` quote stripping breaks the command line. The run fails with a non-zero exit, and no secret is exposed. Mainstream Node installs (installer, nvm-windows, volta, fnm, scoop) put `node.exe` on PATH, so this is rare. | Not blocking. Optional: when `node` is not `.exe`, resolve the real `node.exe` first (for example with the probe `<node> -p process.execPath`), or document the limitation. |
| 4 | info | backend | backend/test/installer/install-helper-frontend.test.ts:36 | The fallback `"C:\Windows"` in a JS string is `C:Windows`, because `\W` is not an escape sequence. It only applies when SYSTEMROOT is unset. | Not blocking. Use `"C:\\Windows"` (as `ps-helpers.ts` does). |
| 5 | info | backend | backend/test/installer/install-ps1.test.ts:518-525 | The AC-7 prerequisite-failure case runs without `AZDO_PAT`, because a PAT would skip the az check. PAT coverage on prerequisite-failure paths comes only indirectly from exact-stderr assertions in the node-version tests (`withPat`). install.ps1 never reads the PAT value (it only checks `IsNullOrEmpty`), so there is no real leak risk. | Not blocking. Optional: add `noSecrets` to the `Node older than 22.18` test, which already runs with `withPat`. |
| 6 | info | backend | backend/installer/install.ps1:117-130 | The NUL-character and invalid-Unicode branches have no direct test. A NUL or a lone surrogate cannot be passed through Node `spawnSync` argv or env. | Not blocking. Accept; both branches are simple and fail closed. |

## Assumptions made (no human available)
- The colon-form deviation is acceptable without rework. The host makes it impossible to implement, it is safe, and
  the in-process behaviour matches the contract. A contract wording change goes to the Architect as a follow-up.
- The overview.md NUL bytes are an Architect documentation defect and are outside the engineers' lanes, so they do not block this
  backend item.

## Follow-ups for the backlog
- Architect: relax contract 10.1 on `-Name:value` (finding 1). Fix the NUL bytes and the missing backslash in overview.md (finding 2).
- Backend: handle or document a `.cmd` node shim in paths with spaces (finding 3). Test nits (findings 4 and 5).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0014/05-review.md
summary: F-011 install.ps1 meets AC-1..AC-8 with real pwsh 7 + PS 5.1 tests; ci.sh exit 0; install.sh/plugin/template/validator unchanged; colon-form deviation is unavoidable and only needs a contract wording change.
