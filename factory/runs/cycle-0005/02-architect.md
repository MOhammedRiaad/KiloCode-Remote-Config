# Architect report — cycle 0005 — F-003: Plugin: in-place merge with defaults/enforce modes

## Inputs read
- factory/runs/cycle-0005/01-product-owner.md (the item and its 8 acceptance criteria)
- factory/VISION.md (FR-6, FR-11, FR-12, FR-13, FR-16, AC-6, AC-7, risk "Kilo pre-fills scalar defaults")
- docs/architecture/ADR-0001..0004, overview.md, contracts/plugin-interface.md v0.3.1
- backend/plugin/azdo-remote-config.ts (current `__internals`, depth-cap pattern, `defineProperty` pattern)
- backend/test/plugin/azdo-remote-config.smoke.test.ts (asserts the exact `__internals` key list)
- backend/tools/check-fr11.mjs (its comment stripper uses the regex `/\/\*[\s\S]*?\*\//`)
- factory/runs/cycle-0003/04-security.md finding 3 and cycle-0004 reports (prototype keys are deferred to F-003)

## Work done
Design summary (full detail in ADR-0005 and contract section 2c):

- **Signature.** `function mergeConfig(target: unknown, shared: unknown, mode?: unknown): void`. It is module-local and exposed as the third `__internals` key: `{ parseJsonc, resolvePlaceholders, mergeConfig }`. It is synchronous and returns `undefined`. It mutates `target` in place. No new exports and no new imports.
- **Mode.** Only `mode === "enforce"` (strict, case-sensitive) selects enforce. Every other value selects defaults.
- **Plain object.** A plain object is a non-null object that is not an array and whose prototype is `Object.prototype` or `null`. Everything else is a leaf.
- **Non-object inputs.** If `target` or `shared` is not a plain object, the function is a no-op and does not throw.
- **Phase 1: sanitize.** This is a deep clone of `shared` into fresh arrays and ordinary objects, built with `Object.keys` and `Object.defineProperty`.
  - It drops any key whose lowercase form is `apikey`, at any depth, including inside objects in arrays.
  - It drops the keys `__proto__`, `constructor` and `prototype`, matched exactly, at any depth. They are **skipped**, not defined as own keys.
  - It drops `$schema` and `plugin` at the top level only.
  - Non-JSON values are omitted as object values. As array elements they become `null`.
  - Depth cap: a container at level 64 or deeper throws `Error("Config merge: config nested too deeply")`, so 64 nested containers pass and 65 throw. A cyclic `shared` throws the same error.
  - Phase 1 runs before `target` is touched, so a throw leaves `target` unchanged.
- **Phase 2: merge** (recursive):
  - Absent locally (no own key, or the own value is `undefined`): the sanitized value is added in both modes.
  - Both values are plain objects: recurse into the existing `target` object, so references are kept.
  - Any other pair is a conflict. Arrays are leaves and are replaced wholesale. In `defaults` the local value stays. In `enforce` the shared value is written, **unless** the local value is a container that holds an `apiKey`-named key at any depth. Then the local value is kept. This is the AC-6 guard. Its scan treats depth 64 or a cycle as "contains" and never throws.
  - All writes use `Object.defineProperty`. Own-key checks use `hasOwnProperty.call`. New keys are appended, and existing keys keep their position.
- **ADR-0005** records these decisions and the rejected alternatives: own-define for prototype keys, a single-pass merge, case-sensitive apiKey matching, array concatenation, `structuredClone`, and returning `target`.
- **Contract** bumped from 0.3.1 to **0.4.0** (new helper, so a minor bump). It adds section 2c and updates the `__internals` row. The `config` hook note now points at F-006.
- **Overview** updated: header, C2 status, data-flow merge line, internal-structure item 3, test layout.

## Files changed
- `docs/architecture/ADR-0005-config-merge.md`: new ADR (merge semantics, apiKey guard, prototype-key skipping, two-phase depth cap).
- `docs/architecture/contracts/plugin-interface.md`: v0.4.0, new section 2c `__internals.mergeConfig`, `__internals` key order, config-hook note.
- `docs/architecture/overview.md`: cycle-0005 / F-003 updates.
- `factory/runs/cycle-0005/02-architect.md`: this report.

## Backend tasks

All work is in `backend/`. There is no frontend work: `scope.frontend` is false and `frontend/` is intentionally absent.

**Constraints for the engineer:**
- Do not write the two-character sequences slash-star or star-slash anywhere in the plugin file. That includes comments, string literals and regex literals, because the check-fr11 comment stripper would treat them as a comment.
- New comments use `//` only.
- No raw invisible or non-ASCII characters.
- LF line endings in the repo. Git normalizes the working-tree CRLF.
- Only `node:` imports. Add no new import for this item.
- Erasable TypeScript only: no enum or namespace.
- `backend/package.json` keeps no `dependencies`.

### BE-1: implement `mergeConfig` in `backend/plugin/azdo-remote-config.ts` (all ACs)
- Add a new section `// ---- Config merge (ADR-0005) ----` after the placeholder resolver and before `__internals`.
- Module-local, not exported:
  - `const MAX_MERGE_DEPTH = 64;`
  - `isPlainObject(v)`
  - `isApiKeyName(k)` (`k.toLowerCase() === "apikey"`)
  - a set or check for the skipped prototype keys
  - `sanitizeShared(value, depth, isRoot)`, which can throw only the fixed depth error
  - `containsApiKey(value, depth)`, which returns true at depth >= 64 and never throws
  - `defineOwn(obj, key, value)`, a defineProperty wrapper
  - `mergeInto(target, sanitized, enforce)`
  - `mergeConfig(target, shared, mode)`
- Follow contract section 2c exactly:
  - Phase 1 runs completely before any write to `target`.
  - The depth rule matches the resolver: the check `depth >= MAX_MERGE_DEPTH` runs on entering a container, with the root container at level 0.
  - The error message is exactly `Config merge: config nested too deeply`.
  - Insert sanitized subtrees directly. They are private, so no second clone is needed.
- Change the export to `export const __internals = { parseJsonc, resolvePlaceholders, mergeConfig };`. Keep this key order.
- Update the header comment on lines 3-4 to mention the merge helper (ADR-0005) and that it is not wired yet. Use `//` comments.
- The `config` hook stays a no-op. Do not wire anything (F-006).

### BE-2: tests in `backend/test/plugin/merge.test.ts` (new)
Test names start with the AC number. Run every two-mode case for both `"defaults"` and `"enforce"`. Use `JSON.parse` to build shared inputs that contain prototype keys.
- **AC-1:** defaults, `{model:'a'}` + `{model:'b', small_model:'s'}` gives `{model:'a', small_model:'s'}`. Also enforce adds shared-only keys.
- **AC-2:** nested `provider.bifrost.options.baseURL`, L vs S, with `model` a vs b. Enforce gives b/S. Defaults gives a/L.
- **AC-3** (apiKey):
  - local `sk-bf-local` plus shared `sk-bf-shared` and `baseURL`, both modes: apiKey stays local and baseURL follows the mode.
  - Local with no apiKey: the key is not added, in both modes.
  - The case variants `apikey`, `APIKEY` and `ApiKey` in shared are never added.
  - apiKey inside an object in a shared array is stripped. Example: shared `{list:[{apiKey:'x', a:1}]}` gives `target.list` equal to `[{a:1}]`.
  - A whole new provider subtree absent locally that contains `options.apiKey` is added without the apiKey.
  - Enforce guard: local `provider.bifrost = {options:{apiKey:'sk-bf-local'}}` with shared `provider.bifrost = 'x'`, and also with `['x']`, keeps the local object. A local container without apiKey is still replaced in enforce, as in the AC-7 case.
- **AC-4:** local-only keys (`provider.other`, `provider.bifrost.options.headers`, `agent.x`) stay deep-equal and keep the same reference, in both modes.
- **AC-5:**
  - Top-level `$schema` and `plugin` in shared do not change the local values and are not added when absent locally, in both modes.
  - A nested `plugin` key (e.g. `agent.x.plugin`) is merged normally.
- **AC-6:**
  - After the merge, `target` is the same reference and so is `target.provider`, with the return value `undefined`.
  - `shared` is deep-equal to a `structuredClone` taken before the merge.
  - Mutating the shared nested object and array after the merge does not change `target`.
  - Added objects and arrays are not `===` to the shared ones.
- **AC-7:**
  - `instructions:['a']` vs `['b','c']`: defaults keeps `['a']` and enforce gives `['b','c']` (no concatenation, length 2).
  - Local object vs shared string, and local string vs shared object: defaults keeps local and enforce takes shared.
  - Unrecognised modes `"ENFORCE"`, `""`, `undefined`, `null`, `1` and `{}` behave as defaults.
  - Shared `null` vs local scalar: enforce writes `null`.
- **AC-8** (prototype pollution):
  - Shared `JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"p2":1}},"prototype":{"p3":1},"a":{"__proto__":{"polluted":2},"constructor":{"x":1},"prototype":1,"k":2}}')`, in both modes, with local `{a:{}}` and with local `{}`. Expect:
    - `({} as any).polluted`, `p2` and `p3` are `undefined`;
    - `Object.getPrototypeOf(target)` and `Object.getPrototypeOf(target.a)` are `Object.prototype`;
    - `target` and `target.a` have no own keys `__proto__`, `constructor` or `prototype`;
    - `target.a.k === 2`.
  - Prototype keys nested inside array elements are stripped as well.
- **Depth and cycles:**
  - 64 nested containers (arrays, and also objects) merge without error. 65 throw exactly `Config merge: config nested too deeply`.
  - A cyclic shared object throws the same error.
  - After either throw, `target` is deep-equal to its snapshot and is the same reference.
  - A deep or cyclic **local** value under an enforce conflict does not throw and is kept (treated as containing apiKey).
- **Inputs:**
  - `target` given as `null`, `undefined`, an array or a string returns `undefined` without throwing.
  - `shared` given as `null`, `undefined`, an array, a string or a number leaves `target` unchanged, in both modes.
  - A null-prototype `target` (`Object.create(null)`) is merged.
- **Values and order:**
  - A shared key with value `undefined` never erases or overwrites local, even in enforce.
  - A local own key with value `undefined` counts as absent and gets the shared value.
  - A shared function, Date or Map value is omitted as an object value and becomes `null` as an array element.
  - Existing keys keep their position. New keys are appended in shared key order (check `Object.keys`).

### BE-3: update `backend/test/plugin/azdo-remote-config.smoke.test.ts`
- Expect `Object.keys(mod.__internals)` to deep-equal `["parseJsonc", "resolvePlaceholders", "mergeConfig"]`.
- Assert `typeof mod.__internals.mergeConfig === "function"`.
- The runtime named exports stay exactly `PLUGIN_ID`, `SUPPORTED_KILO_RANGE`, `__internals` and `default` (no change to that test).

### BE-4: gate
- `bash scripts/ci.sh` must exit 0. That covers check-fr11, typecheck, all tests and check-lf.
- Confirm that the plugin file contains no slash-star or star-slash sequence (e.g. by grep) and that `backend/package.json` has no `dependencies`.

## Frontend tasks
- None. The item has `scope.frontend: false`, and the product has no frontend (overview.md).

## Security notes (for the Security engineer)
- **Secret handling (AC-6, FR-12):**
  - A shared `apiKey` is dropped at any depth and in any letter case before the merge.
  - A local subtree that holds an `apiKey` is never replaced in enforce mode. Verify both paths, including keys inside arrays.
  - The function never logs, never throws data-bearing errors, and its only error message is fixed text.
- **Prototype pollution** (closes cycle-0003 finding 3):
  - `__proto__`, `constructor` and `prototype` are skipped at every depth.
  - Writes go through `Object.defineProperty`, and own-key checks use `hasOwnProperty.call`.
  - Shared objects are rebuilt from `Object.keys` only, so inherited and symbol keys are never read.
  - Verify there is no `target[key] = ...` or `in`-based lookup on target.
- **Availability (FR-10):**
  - Phase 1 enforces the depth cap of 64 and turns cycles into a fixed error before any mutation, so there is no partial merge and no stack overflow.
  - The local-side apiKey scan is depth-bounded and never throws.
  - A frozen `target` is out of contract (TypeError). F-006 must catch it.
- **Accepted / residual:**
  - In enforce mode, the shared config can replace any other local value. That is the purpose of enforce.
  - In defaults mode, Kilo-prefilled scalars block shared values (vision risk, mitigation `enforce`).
  - Key filtering is name-based. Secrets under other key names, such as headers or tokens, remain the job of the C1 validator (FR-13). The `{env:}`/`{file:}` trust boundary is unchanged (F-017).

## Verification
- Only docs were changed. No product code was touched, so `scripts/ci.sh` is unaffected by this phase.
- Contract and overview edits were applied by exact-match replacement with assertions. All anchors matched.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- **Prototype keys are skipped rather than own-defined.** They have no meaning in a Kilo config, and skipping keeps them away from downstream naive merges in Kilo or other plugins. Security accepted either option.
- **apiKey matching is case-insensitive.** This is defense in depth. It costs nothing and could only drop a key literally named apiKey in some casing, which FR-13 forbids anyway.
- **apiKey guard in enforce mode.** AC-6 ("local apiKey unchanged in either mode") outranks "enforce takes shared" for a container that holds the key. The AC-7 type-conflict test uses containers without an apiKey, so both ACs hold.
- **A local value of `undefined` counts as absent.** An undefined value is "not set" in Kilo's parsed config. A shared `undefined` is ignored, so it never erases local.
- **Return value is `void`.** If F-006 later needs a list of ignored keys for logging, that item will make the contract change.
- **Depth constant is separate (`MAX_MERGE_DEPTH`)** with the same value and rule as ADR-0004. The existing resolver code is not refactored.

## Follow-ups for the backlog
- F-006: call `mergeConfig` inside the hook's try/catch, after `parseJsonc` and `resolvePlaceholders`. Consider logging the names of ignored keys (never values). That would need a return value (a contract change).
- C1 validator (FR-13): reject the same apiKey casings as the plugin, and reject `__proto__`/`constructor`/`prototype` keys, so authors get an early error.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0005/02-architect.md
summary: F-003 designed - ADR-0005 two-phase sanitize-then-merge (apiKey any-case/any-depth stripped plus enforce guard, proto keys skipped, depth 64/65, void in-place), contract v0.4.0 section 2c, 4 backend tasks, no frontend
