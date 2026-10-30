# Security report — cycle 0005 — F-003: Plugin: in-place merge with defaults/enforce modes

## Inputs read
- `git diff main...HEAD`, excluding factory/ bookkeeping: `backend/plugin/azdo-remote-config.ts`, `backend/test/plugin/merge.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`, docs/architecture changes.
- `docs/architecture/ADR-0005-config-merge.md`, `factory/runs/cycle-0005/02-architect.md`, `factory/VISION.md` (FR-11/12/13).
- No previous `04-security.md` for this cycle (rework iteration 0).

## Work done
- Read every line of `mergeConfig`, `sanitizeNode`, `containsApiKey` and `mergeInto` (azdo-remote-config.ts:280-371) against ADR-0005.
- Grepped the diff for secrets. Only prose mentions were found and no credentials.
- FR-11: imports unchanged (`node:fs`, `node:os`, `node:path`). `package.json` is unchanged and has no runtime deps. The `check-fr11` lint passes.
- Wrote an adversarial probe outside the repo (scratchpad `probe.ts`) and ran it against the real module through `__internals.mergeConfig`. It made 46 assertions and printed 12 informational observations. All assertions passed:
  - **apiKey (FR-12/AC-6):** I tried shared `apiKey`/`APIKEY`/`ApiKey`/`apikey`/`aPiKeY` at the top level, nested, inside arrays and nested arrays, in both modes. None reached the target, and the local keys were unchanged. In enforce mode, scalar, array and `null` conflicts against a parent that holds a local apiKey (any case, at any depth, including inside arrays) kept the local subtree. A local `apiKey: undefined` was not filled. The unicode Kelvin-sign variant was also dropped (conservative). `APİKEY` passes through, but Kilo reads exactly `apiKey`, so this is harmless.
  - **Prototype pollution:** I tried `__proto__`/`constructor`/`prototype` from `JSON.parse` at the top level, nested and in arrays, into ordinary and null-prototype targets. No global pollution occurred, prototypes were unchanged and no own proto keys were planted. A local own `__proto__` key was left untouched. All writes use `defineProperty` and all reads go through a `hasOwn` guard.
  - **DoS / depth:** 64 nested containers pass and 65 throw. Cyclic and wide-cyclic shared input threw the fixed error in 0 ms. Cyclic and deep local subtrees are kept by the guard (it returns true at the cap). A 200k-key enforce merge took 281 ms. 200 conflicts against one aliased 100k local subtree took 691 ms (linear rescans).
  - **Errors / partial mutation:** the only error text is `Config merge: config nested too deeply`, which contains no input data. On a throw the target is byte-identical to its prior state, because sanitize runs fully before any write.
  - **Aliasing:** the target never aliases shared objects or arrays, and the shared input is not mutated. Top-level `plugin`/`$schema` are ignored (nested ones are kept as data), and `plugin` is not added when absent.
  - Non-object inputs are a no-op. `"ENFORCE"` and object modes fall back to defaults.

## Files changed
- `factory/runs/cycle-0005/04-security.md`: this report. No source was modified.

## Verification
- `bash scripts/ci.sh`: `ci: PASS` (94 tests: 93 pass, 1 skip, 0 fail). The skip is the pre-existing Windows-only `/dev/zero` test from F-002.
- `npm audit --omit=dev --audit-level=high` (backend): 0 vulnerabilities.
- Adversarial probe: 46/46 assertions OK. Observations are listed below.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/plugin/azdo-remote-config.ts:340 | `containsApiKey` has no visited set. A *local* subtree that is a DAG with shared references (no cycle, depth < 64) is scanned once per path, which is exponential. A 30-level DAG with 2 refs per level took 82.6 s in enforce mode. This cannot be triggered from the shared file: sanitize always produces a tree, and Kilo's config comes from JSON. Only aliasing by Kilo or other plugins could trigger it. | Backlog: track visited objects in a `WeakSet` inside `containsApiKey`. Return the memoised result, or `false` on revisit, because a revisit in the same scan finds the same keys. |
| 2 | info | backend/plugin/azdo-remote-config.ts:318 | `node.map` skips holes, so a sparse shared array keeps its holes instead of turning them into `null` as ADR-0005 §5 describes. `Array` subclasses would also go through `Symbol.species`. Neither can come from `JSON.parse`. | Optional: build the array with an index loop over `node.length` (`out.push(...)`). |
| 3 | info | backend/plugin/azdo-remote-config.ts:356,360 | A frozen or non-extensible target makes `defineProperty` throw a V8 `TypeError` whose message holds the key name (for example `Cannot define property b`). It also leaves earlier writes in place (partial merge). This is out of contract per ADR-0005 §9, and the key names are never secrets because apiKey keys are stripped. | F-006 must catch it and log only a fixed message, never `err.message` verbatim (FR-10). |
| 4 | info | backend/plugin/azdo-remote-config.ts:340 | The guard only recognises plain objects and arrays, and own *enumerable* keys only. A local apiKey held in a class instance, in a non-enumerable property or as a non-index property of an array is replaced in enforce mode. This is out of contract because Kilo's resolved config is plain JSON data. | None now. Re-check if F-006 finds that Kilo hands over non-plain objects. |
| 5 | info | design (ADR-0005 residual) | Even in defaults mode, the shared file can add `baseURL` (or headers) next to a local `apiKey`, which redirects the engineer's key to whatever endpoint the shared repo names. This is intended (VISION example), and the shared repo is trusted and PR-gated by C1. | Backlog / C1 (FR-13): consider an allow-list or review rule for `baseURL` hosts in the validator. |
| 6 | info | backend/plugin/azdo-remote-config.ts:351 | Shared keys such as `hasOwnProperty`/`toString` become own properties of the Kilo config and could break Kilo code that calls `config.hasOwnProperty(...)`. This is also possible with a plain local JSON config, and the shared file is trusted. | None required. Optionally have the C1 validator reject them with schema `additionalProperties`. |

No critical, high or medium findings. FR-12/AC-6 apiKey preservation, prototype-pollution safety, the depth and cycle caps, fixed error text, no partial mutation on a sanitize error, and FR-11 compliance all hold as designed.

## Assumptions made (no human available)
- Local (`target`) config is engineer- or Kilo-controlled and comes from JSON, so findings that need aliased or non-plain local objects are rated low/info.
- The shared repo is trusted and PR-gated (FR-13). Redirecting via other keys is an accepted residual per the ADR.

## Follow-ups for the backlog
- Finding 1: a visited `WeakSet` in `containsApiKey` (cheap hardening).
- Finding 3: F-006 must log a fixed message on merge errors, never `err.message`.
- Finding 5: C1 validator rule for `baseURL` / `headers` hosts in provider options.
- Finding 2: index-loop array clone, to match the ADR wording exactly.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0005/04-security.md
summary: mergeConfig is apiKey-safe, pollution-safe, depth/cycle-capped and atomic on error; CI passes and audit is clean. 1 low and 5 info findings go to the backlog.
