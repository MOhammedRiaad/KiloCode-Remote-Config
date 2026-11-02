# Security report (Re-check 2) — cycle 0027 — T-038: Plugin JSDoc trim pass and wording fixes (comment-only)

## Inputs read
- `git diff main...HEAD` (22 files), with focus on the out-of-band, user-directed commits made after 181823b:
  - 7701a9b `fix(installer): smoke reads baseURL from azurefoundry fallback and sends x-bf-vk header`
  - e51246f `docs(architecture): ADR-0022 ... ; installer-cli contract 1.4.0`
- `backend/installer/smoke.ts`, `backend/installer/personal-config-edit.ts`, `backend/installer/install-helper.ts`, `backend/validator/kilo-config-rules.ts`
- Earlier reports `04-security.md`, `04-security-rerun1.md`

## Work done
Read-only audit. No product code edited.

1. **Secrets**
   - `git ls-files | grep -i kilo.jsonc` lists only `backend/personal-config/kilo.jsonc` (placeholder `sk-bf-<your-virtual-key>`) and `backend/shared-config/kilo.jsonc` (no key, example host). The root `kilo.jsonc` is untracked (`git ls-files --error-unmatch kilo.jsonc` fails) and excluded by `.git/info/exclude:50:/kilo.jsonc`.
   - I took the real `sk-bf-...` key from the root `kilo.jsonc` without printing it and searched for it. It appears in 0 tracked files at HEAD and in 0 commits in any history (`git log --all -S`).
   - `sk-bf-` in the diff matches only test fixtures (`sk-bf-existing`, `sk-bf-header`, `sk-bf-api`, `sk-bf-AbCdEf1234567890`) and the documented placeholder.
2. **Where the key is sent (`smoke.ts:388-415`)**
   - The URL still comes only from `modelsUrl()`, which requires `https:` and rejects userinfo, `@` in the authority, `?`, `#`, search and hash. The request uses `redirect: "manual"`.
   - The key goes in one header, `x-bf-vk`, and only on the models request. The probe request (`smoke.ts:356`) has empty headers.
   - The PAT and az token are not sent to Bifrost. The header object holds only `Accept` and `x-bf-vk`. Tests that assert this were updated: `install-smoke.test.ts` AC-5, `install-ps1-smoke.test.ts` AC-7, `smoke.test.ts` az-token test.
3. **Header injection**: `classifyKey` still runs before any request. It rejects non-string, empty, placeholder, `{env:` and `{file:` references, values over the length limit, and any character outside 0x21-0x7E. CR/LF/NUL injection into `x-bf-vk` is not possible.
4. **Key never printed or logged**
   - The key reaches only `plan.effectiveApiKey` and then `runSmoke` (`install-helper.ts:302,414`). The smoke outcome codes are fixed enums or numeric status strings.
   - Error paths return codes, not key text. The existing no-leak assertions (`assertNoLeak`, `assertNoSecretsOrStack`, T-035 canary test) still pass.
5. **Does the azurefoundry fallback widen trust? No.**
   - `readSharedBaseUrl` reads `provider.azurefoundry.options.baseURL` only when `provider.bifrost.options.baseURL` is absent. Both values come from the same shared config, fetched from the same AzDO repo, and that config already decided where the key goes. The value then passes the same `modelsUrl` checks.
   - The CI host allowlist in `kilo-config-rules.ts:267-280` loops over every `provider.<id>.options.baseURL`, so the azurefoundry baseURL is covered by the same allowlist gate.
   - Kilo itself already sends this key to the azurefoundry baseURL at runtime, so the smoke test adds no new place the key can go.
6. **Prototype pollution**
   - The shared-config lookups use `ownPlainProperty`: plain-object check, `Object.hasOwn`, then a descriptor read.
   - `storedApiKey`/`providerOptions` use bracket access, but only after `isPlainObject` checks (prototype is `Object.prototype` or null), and every key name is a fixed literal (`provider`, `azurefoundry`, `bifrost`, `options`, `headers`, `x-bf-vk`, `apiKey`). Input cannot pick the key name. An inherited read could only happen if `Object.prototype` were already polluted, and the earlier `bifrost.options.apiKey` lookup used the same pattern. Recorded as info only.
7. **Dependencies**: `npm audit --omit=dev --audit-level=high` in `backend/` reports 0 vulnerabilities.
8. **Docs (e51246f)**: ADR-0022, contract 1.4.0 and overview text contain no secrets. They use only the placeholder or example hosts.

## Files changed
- `factory/runs/cycle-0027/04-security-rerun2.md` — this report.

## Verification
- `bash scripts/ci.sh` → exit 0 (`ci: PASS`; 726 tests: 716 pass, 0 fail, 10 skipped; check-lf PASS; check-docs PASS).
- `git ls-files --error-unmatch kilo.jsonc` → not tracked; `git check-ignore -v kilo.jsonc` → `.git/info/exclude:50:/kilo.jsonc`.
- Real-key search: tracked-files=0, history-commits=0.
- `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/installer/personal-config-edit.ts:203-209 | `storedApiKey` prefers `provider.azurefoundry.options.headers["x-bf-vk"]` over `provider.bifrost.options.apiKey`. When the user passes a new key (`KILO_BIFROST_KEY`), the installer writes it to `bifrost.options.apiKey`, but the smoke test checks the existing azurefoundry header key instead. This is a correctness issue, not a security one: the key that is sent belongs to the user and goes to the same validated gateway. The user may still get a misleading pass or fail. | Backlog: decide which key wins when both exist, and either write the new key to both places or check the key that was just supplied. |
| 2 | info | backend/installer/personal-config-edit.ts:196-209 | Bracket access on `isPlainObject` objects can return inherited values if `Object.prototype` is already polluted. Input cannot choose the key names, so this is not exploitable from config. The old code used the same pattern. | Optional: use `Object.hasOwn` for these reads, as `smoke.ts` `ownPlainProperty` does. |
| 3 | info | backend/installer/smoke.ts:109-115 | A personal-config azurefoundry key can now be sent to a shared-config `provider.bifrost` baseURL, even if the shared azurefoundry baseURL points to a different host. Both values are the team gateway config, the URL is https-validated and on the allowlist, and nothing leaves the trusted domain. | None required. |

No critical, high or medium findings. Earlier findings stay closed: rerun1 found nothing new, and the comment-only rework cbcfd39 is unchanged.

## Assumptions made (no human available)
- The user directed 7701a9b and e51246f to ride along with this cycle. I audited them as part of the cycle diff and did not treat them as out of scope.
- The shared config, from the team AzDO repo and checked against the CI allowlist, is the trust anchor for gateway URLs, as earlier ADRs (ADR-0013) decided.

## Follow-ups for the backlog
- Decide and document which key wins when both `azurefoundry.headers["x-bf-vk"]` and `bifrost.apiKey` exist (finding 1). Keep the user-supplied `KILO_BIFROST_KEY` and the key the smoke test checks consistent.
- Optional hardening: own-property reads in `providerOptions`/`storedApiKey` (finding 2).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/04-security-rerun2.md
summary: Re-check 2 PASS. The x-bf-vk key goes only to the https-validated models URL with redirects off and passes the visible-ASCII check, the azurefoundry fallback is covered by the same CI allowlist, the real key is in no tracked file or commit, CI is green and npm audit is clean.
