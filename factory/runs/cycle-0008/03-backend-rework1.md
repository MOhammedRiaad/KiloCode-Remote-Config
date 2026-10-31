# Backend rework 1 (F-006)

Status: PASS. Test-only changes; no product behaviour changed.

| Finding | Fix |
|---|---|
| 1 (medium) | `backend/test/plugin/hook.test.ts` "AC8 hostile deps never reject" now runs in a child process with HOME and USERPROFILE set to a temp dir and KILO_AZDO_*, AZDO_PAT and AZURE_DEVOPS_EXT_PAT removed. It asserts every cfg stays `{}` and that no `.cache` is created. |
| 3 | The failing-collaborators loop asserts `cfg` deep-equals the local config. |
| 4 | The deep-nesting case asserts exactly `invalid-shape`. |
| 5 | The smoke test asserts `server()` logs nothing before the config hook runs. |

Verification: `bash scripts/ci.sh` exits 0 (267 tests, 266 pass, 0 fail, 1 skipped, which was already skipped before this rework).
