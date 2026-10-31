# Security report (Re-check 1) — cycle 0008 — F-006: Plugin: cache, fallback, logging and never-crash wiring

## Inputs read
- `git show HEAD` (f32588d, "fix(F-006): address review findings (rework 1)")
- `git diff --stat f7fe24c HEAD` (everything since the first security pass)
- `factory/runs/cycle-0008/03-backend-rework1.md`, `factory/runs/cycle-0008/04-security.md` (first pass: PASS, no open findings)
- `backend/plugin/azdo-remote-config.ts` (resolveSettings / runConfigHook missing-settings path, read-only)

## Work done
- Confirmed the scope of the rework: since the first security pass only `backend/test/plugin/hook.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts` and factory bookkeeping files (`03-backend-rework1.md`, `05-review.md`, `state.json`) changed. No product code under `backend/plugin/` or elsewhere changed.
- Secrets: the only credential-like values are the existing fake sentinels (`PATSENTINEL-9999`, `tok.SENTINEL-4242`). No real keys, tokens or `.env` files added.
- Child-process env handling (hostile-deps test): env is copied from `process.env`, then all `KILO_AZDO_*`, `AZDO_PAT` and `AZURE_DEVOPS_EXT_PAT` are deleted and `HOME`/`USERPROFILE` point to a fresh `mkdtemp` dir that is removed in `finally`. The child is started with `execFileSync(process.execPath, [...])` (no shell), and the only interpolated value is the plugin file URL, passed through `JSON.stringify`, so there is no command or code injection.
- Real home and network access: the child calls `runConfigHook({}, { org: 'o' }, cfg, deps)`. `project` and `repo` are missing, so `resolveSettings` reports missing settings and the hook logs "Remote config skipped" before any fetch or cache I/O (`azdo-remote-config.ts:1266-1271`). So no network call is made and nothing is written to the real home. The test also checks that no `.cache` dir appears in the temp home.
- Smoke test change: it only adds a `logsAfterServer === 0` assertion. It has no new I/O and no env changes.
- Other edits (cfg unchanged assertion, exact `invalid-shape` reason) are assertion-only. They tighten the tests and do not weaken them.

## Files changed
- `factory/runs/cycle-0008/04-security-rerun1.md`: this report.

## Verification
- `node --test test/plugin/hook.test.ts test/plugin/azdo-remote-config.smoke.test.ts` (in `backend/`): 47 pass, 0 fail, 0 skipped.
- Dependency audit: not re-run, because no dependency manifests changed in this rework (the first pass covered them).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | info | backend/test/plugin/hook.test.ts:545-551 | The child env inherits every other parent variable (e.g. CI tokens, `XDG_CACHE_HOME`, `LOCALAPPDATA`). This is harmless today because the code path exits on missing settings before any cache or network access. It would only matter if the test were later changed to supply full settings. | None required. Optionally build a minimal env (PATH, SystemRoot, HOME, USERPROFILE) instead of copying `process.env`. |

## Assumptions made (no human available)
- `05-review.md` and `state.json` changes are orchestrator/reviewer bookkeeping and outside this security scope.

## Follow-ups for the backlog
- (info) Consider an allow-list env for child-process tests (finding 1).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0008/04-security-rerun1.md
summary: Re-check 1 PASS. The rework changed only tests, with no secrets, real-home access, network calls or injection; 1 info finding.
