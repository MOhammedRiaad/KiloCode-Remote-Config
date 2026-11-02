# Security report — cycle 0028 — T-040: Installer: align written key with the key the smoke test checks

## Inputs read
- `git diff main...HEAD` (code commit a1b8f92 and docs commit 2701125), `git status` (clean)
- `factory/runs/cycle-0028/02-architect.md` (security notes)
- `backend/installer/personal-config-edit.ts` (whole file), `backend/installer/install-helper.ts` (planConfig, output paths), `backend/installer/smoke.ts` (key and baseURL use), `backend/plugin/azdo-remote-config.ts` (parseJsonc / own-key handling)
- `docs/architecture/ADR-0023-installer-key-follows-x-bf-vk-header.md`, `docs/architecture/contracts/installer-cli.md` 1.5.0

## Work done
- **Secrets.** `git ls-files | grep -i kilo.jsonc` lists only `backend/personal-config/kilo.jsonc` and `backend/shared-config/kilo.jsonc`. `git ls-files --error-unmatch kilo.jsonc` fails, so the root `kilo.jsonc` is untracked; it is excluded by `.git/info/exclude:50 /kilo.jsonc`. The root file now has no `sk-bf-` string. I took its non-trivial key values (`x-bf-vk` and `apiKey`, lengths 14 and 18) without printing them and searched for them. They are in 0 tracked files at HEAD, 0 commits in any history (`git log --all -S`) and 0 lines of the diff. In the diff, `sk-bf-` appears only in test fixtures (`sk-bf-old`, `sk-bf-new`, `sk-bf-header`, `sk-bf-api`, `sk-bf-existing`, `sk-bf-AbCdEf1234567890`) and the documented placeholder. The diff has no private keys, AWS/GitHub/Slack tokens or password literals.
- **Key disclosure.** The change adds no output line, log call, error message or argv use. `applyKey` returns no error on the header path. Neither the old nor the new header value reaches stdout, stderr or `UPDATE_MESSAGES`. The backup still holds the original bytes, and the config is still written with `writeAtomic(..., 0o600)`. The mode and backup code (`install-helper.ts` 140-200, 360-371) is unchanged.
- **Prototype pollution and hostile shapes.** `keyHeaders` reads only fixed, non-`Object.prototype` names (`provider`, `azurefoundry`, `options`, `headers`, `x-bf-vk`). It checks every level with `isPlainObject`, which rejects arrays and non-plain prototypes. It writes only to an object whose own `x-bf-vk` it just read as a non-empty string. `planUpdate` works on a `structuredClone`. I checked this with a scratch probe that imports the real module:
  - A `"__proto__"` key at `headers` or `provider` level is parsed as an own data property, not as a prototype link. It is not followed, so the run falls back to the 1.4.0 `bifrost.apiKey` path, and `Object.prototype` is not polluted.
  - Headers as an array, an empty `x-bf-vk`, or a numeric `x-bf-vk` all fall back to `bifrost.apiKey`. In each case `storedApiKey` returns the same value that was written.
  - A getter on `headers`: `structuredClone` turns it into a data property, and the clone gets the new value.
  - Frozen input: the clone is mutable, the supplied key is written, and the original object is unchanged.
  - A Proxy: `structuredClone` throws `DataCloneError`. This cannot happen in practice because `existing` always comes from `parseJsonc` (JSON.parse).
- **Key reaching the smoke request.** The key still reaches the smoke test only through `storedApiKey(update.result)` → `plan.effectiveApiKey` → `smoke.ts:412` header. The write predicate (`keyHeaders`) matches the read predicate (`storedApiKey`), so the key that is written is the key that is tested. The smoke destination is still the shared-config baseURL, validated as https with no userinfo, query or fragment (`smoke.ts` 144+). This change does not touch it.
- **Dependencies.** `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities.

## Files changed
- `factory/runs/cycle-0028/04-security.md` — this report

## Verification
- `bash scripts/ci.sh` → exit 1: 716 passed, 1 failed, 10 skipped. Lint (`check-fr11: PASS`) and `tsc --noEmit` both passed. The single failure is `install-ps1.test.ts` "AC-5 every failing prerequisite is reported [powershell5]": `spawnSync powershell.exe ETIMEDOUT` after 136 s. This is an environment timeout in a PowerShell prerequisite test that runs with `-NoSmoke` and does not reach the changed code. `install.ps1` is not in the diff.
- Rerun: `node --test test/installer/install-ps1.test.ts test/installer/personal-config-edit.test.ts test/installer/install-smoke.test.ts` → 88 passed, 0 failed (it includes the previously failing test).
- Hostile-shape probe (scratchpad, not committed): results as listed above.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/installer/install-helper.ts:407-408 | If the key header holds the placeholder and no key is supplied, the hint tells the engineer to edit `provider.bifrost.options.apiKey`, which is not where the key is read from. The guidance is misleading, but nothing is exposed. The code is not touched this cycle, and the Architect already logged it. | Backlog: name the `x-bf-vk` header in the hint when the key lives there. |
| 2 | info | backend/installer/personal-config-edit.ts:177 | A supplied key replaces a header that held a `{env:...}` / `{file:...}` reference with a literal secret in the `0600` file. This matches the long-standing `bifrost.apiKey` behaviour and is documented in ADR-0023. | None. |
| 3 | info | backend/installer/personal-config-edit.ts:175-179 | On the header path, an existing `provider.bifrost.options.apiKey` is left in place and may hold an old key at rest in the same `0600` file. Accepted in ADR-0023 (the installer never deletes user content). | None. Optionally, document that engineers should remove it. |
| 4 | info | backend/test/installer/install-ps1.test.ts:442 | The PowerShell 5 prerequisite test can exceed its spawn timeout on a loaded Windows host. | Backlog: consider a longer timeout or retry for powershell5 spawns. |

## Assumptions made (no human available)
- The single CI failure is an environment timeout, not a regression. The test runs `install.ps1 -NoSmoke` prerequisite checks, the diff touches neither `install.ps1` nor that path, and the test passes on an isolated rerun.

## Follow-ups for the backlog
- Hint wording for the `x-bf-vk` header location (finding 1).
- Harden the powershell5 test timeout (finding 4).
- Optional helper-level test: update with a key header plus `KILO_BIFROST_KEY` asserts the smoke request carries the supplied key (Architect follow-up).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0028/04-security.md
summary: T-040 header-first key write is safe: no key disclosure, no prototype pollution or hostile-shape redirection, mode/backup unchanged, real key untracked and absent from history; low/info follow-ups only
