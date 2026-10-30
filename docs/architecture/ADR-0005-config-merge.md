# ADR-0005: In-place config merge (defaults / enforce), secret-safe and pollution-safe
- Status: accepted
- Date: 2026-10-30
- Cycle / item: cycle-0005 / F-003

## Context

FR-6 / AC-6 / AC-7: the plugin merges the shared config (already parsed by ADR-0003 and
placeholder-resolved by ADR-0004) into Kilo's resolved config object **in place** through the
`config` hook. Mode `defaults`: local values win on conflict. Mode `enforce`: shared values win.
Keys absent from the shared file are never changed. `$schema` and `plugin` in the shared file are
ignored. The engineer's local `apiKey` must stay unchanged in either mode (AC-6), and the shared
file must never carry an `apiKey` (FR-12 / FR-13). If the C1 validator is bypassed, the plugin
must still not apply a shared `apiKey`.

Constraints:
- FR-11 / ADR-0001: single file, zero npm dependencies, only `node:` imports.
- ADR-0002: helpers reach tests only through `__internals`; no named function exports.
- The shared value comes from the network. JSON.parse creates own keys `__proto__`,
  `constructor` and `prototype` as data properties. A naive recursive merge
  (`target[key] = ...` or `target[key]` lookups) turns them into prototype pollution. Security
  asked (cycle-0003 finding 3) for these keys to be skipped or defined as own properties, with
  regression tests. ADR-0004 left key filtering to this merge.
- ADR-0004 caps nesting at 64 container levels (64 nested containers pass, 65 throw). The merge
  should use the same rule.
- Not wired yet: F-006 calls the merge from the `config` hook and catches every error (FR-10).

## Decision

1. **Exposure and signature.** A module-local function exposed as `__internals.mergeConfig`.
   It is added as the third key: `{ parseJsonc, resolvePlaceholders, mergeConfig }`.
   ```ts
   function mergeConfig(target: unknown, shared: unknown, mode?: unknown): void;
   ```
   - It is synchronous and returns `undefined`. The only effect is the in-place mutation of
     `target`. It does no I/O and no logging, and it touches no global state.
   - Parameters are typed `unknown` so that callers (F-006) and tests can pass anything without
     casts. No new types are exported. Any helper type or constant stays module-local.
2. **Mode.** `mode === "enforce"` (strict equality, case-sensitive) selects enforce. **Every
   other value** (`"defaults"`, `undefined`, `"ENFORCE"`, `""`, numbers, objects) selects
   defaults. Settings validation itself stays in F-004.
3. **Plain object.** A value `v` is a plain object iff `typeof v === "object"`, `v !== null`,
   `!Array.isArray(v)`, and `Object.getPrototypeOf(v)` is `Object.prototype` or `null`.
   Arrays, `null`, primitives and every other object (Date, Map, class instance, function) are
   **not** plain objects. Only plain objects are merged recursively. Everything else is a leaf.
4. **Non-object inputs: no-op.** If `target` or `shared` is not a plain object (for example
   `null`, `undefined`, an array, a string or a number), the function returns without changing
   anything and without throwing.
5. **Two phases. The target is not touched until the shared value is fully validated.**
   - **Phase 1: sanitize (deep clone of `shared`).** Builds a fresh tree from `shared`. Phase 1 is
     the only place that can throw, so a throw always leaves `target` unchanged. Rules:
     - Strings, numbers, booleans and `null` are copied as is.
     - Arrays become a **new** array with each element sanitized, in order.
     - Plain objects become a **new** ordinary object (`{}`, prototype `Object.prototype`). Only
       own enumerable string keys are read (`Object.keys`). Every kept key is written with
       `Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true })`.
     - **Skipped keys, at any depth (in objects nested in arrays too):**
       - any key whose `key.toLowerCase() === "apikey"` (`apiKey`, `apikey`, `APIKEY`, `ApiKey`, ...);
       - the keys `__proto__`, `constructor` and `prototype` (exact, case-sensitive).
     - **Skipped keys at the top level only:** `$schema` and `plugin` (exact, case-sensitive).
       A nested key named `plugin` or `$schema` is ordinary data.
     - **Non-JSON values** (`undefined`, functions, symbols, bigints, non-plain objects): as an
       object value the key is omitted. As an array element the element becomes `null` (the
       same as `JSON.stringify`). JSON input never contains them. The rule exists so that the
       clone never aliases anything from `shared`.
     - **Depth cap:** the root container is level 0. A container (array or plain object) at
       level 64 or deeper throws `Error("Config merge: config nested too deeply")`. So 64
       nested containers merge and 65 throw. A cyclic `shared` hits the cap and throws the same
       error (no stack overflow). The message is fixed and contains no input data. **This is the
       only error the function itself throws.**
     The sanitized tree is private. Its subtrees can be inserted into `target` directly, with no
     second clone, and each one is inserted at most once.
   - **Phase 2: merge the sanitized tree `S` into `target` `T`** (recursive, starting at the roots).
     For each key `k` of `S` in key order:
     - **Absent locally:** `T` has no own property `k`, or its own value is `undefined`. Then
       `S[k]` is written to `T` in **both** modes.
     - **Both plain objects** (`T[k]` and `S[k]`): recurse into the **existing** `T[k]` object.
       It is never replaced, so nested references such as `target.provider` stay the same.
     - **Otherwise it is a conflict.** This covers scalar vs scalar, array vs anything, object vs
       non-object, and `null`.
       - `defaults`: keep `T[k]`.
       - `enforce`: write `S[k]`. **Exception (apiKey guard):** if `T[k]` is an array or plain object
         that contains, at any depth, an own key whose lowercase is `apikey`, then `T[k]` is
         kept. Without this exception, enforce mode could replace a local object holding the
         engineer's key with a scalar or array, and AC-6 would fail. The scan reads own
         enumerable keys only and follows arrays and plain objects. If it reaches level 64
         (deep or cyclic local config), it returns "contains" so that the local value is kept.
         The scan never throws.
     - Arrays are leaves. They are **replaced wholesale** per the rules above and never
       concatenated or merged by index.
     - All writes use `Object.defineProperty(T, k, { value, enumerable: true, writable: true,
       configurable: true })`, never `T[k] = ...`. Reads of `T` use
       `Object.prototype.hasOwnProperty.call` before the value is read. A new key is appended at
       the end of `T`'s key order. An existing key keeps its position.
     - Keys of `T` that are not in `S` are never read, written or deleted.
6. **Local apiKey is always preserved.** Phase 1 never lets a shared `apiKey` (any case, any
   depth) through, and the enforce guard stops a subtree that holds a local `apiKey` from being
   replaced. A shared `apiKey` is never added where the local config has none.
7. **`__proto__` / `constructor` / `prototype` are skipped.** They are not defined as own keys.
   Skipping covers the shared data and the merge into `target`. Own keys of `target` with these
   names, if any, are left alone. Kilo's config schema has no such keys, so nothing legitimate
   is lost. Kilo or other plugins may later process the config with naive `obj[key] = ...`
   code, and skipping means no such key can ever reach that code from the shared file.
8. **Shared is not mutated.** Phase 1 only reads `shared`, and `target` never aliases any
   object or array of `shared`.
9. **Out of contract.** `target` must consist of ordinary, extensible objects with data
   properties (as Kilo's resolved config is). A frozen or sealed `target`, or one with a
   non-configurable property, may cause `Object.defineProperty` to throw a `TypeError` in
   phase 2. F-006 catches all errors anyway (FR-10).
10. **Not wired yet.** The `config` hook stays a no-op. F-006 wires parse, then resolve, then merge.

## Consequences

- AC-6 holds in both modes even when the C1 PR gate is bypassed: defense in depth for FR-12.
- A shared key named `apiKey` in any case is silently dropped, including any legitimate
  non-secret use of that name. This is intended. FR-13 forbids the name in C1 anyway.
- A malformed or hostile shared file (too deep or cyclic) is rejected before `target` is
  touched, so Kilo keeps a consistent local config.
- Vision risk "Kilo pre-fills scalar defaults that block shared values in `defaults` mode"
  stays. The mitigation is `enforce` mode. The merge cannot tell a Kilo default from a user value.
- F-006 may later want to log which keys were ignored. This needs a return value, which would
  be a contract change in that item. It is not added now (YAGNI).

## Alternatives considered

- **Return `target` or a new object.** Returning a new object breaks the in-place requirement,
  because Kilo keeps its own reference. Returning `target` invites callers to use a
  replacement pattern. Rejected in favour of `void`.
- **Single pass that clones while merging.** Simpler, but a depth or cycle error halfway through
  would leave `target` partly merged. Rejected in favour of sanitize first, then merge.
- **Define `__proto__` / `constructor` / `prototype` as own data properties** (the ADR-0004
  approach). Safe inside this function, but it plants keys that downstream naive merges in Kilo
  could turn into prototype changes. These keys have no meaning in a Kilo config. Rejected
  in favour of skipping.
- **Case-sensitive `apiKey` match only.** Kilo reads exactly `apiKey`, but other provider SDK
  options are passed through and some accept other casings. Matching any case costs nothing.
  Rejected.
- **Concatenating or index-merging arrays.** Duplicates entries (`instructions`) and has no
  clear "local wins / remote wins" meaning. Rejected (FR-6).
- **`structuredClone` for the deep clone.** It does not strip keys and does not cap depth,
  and it keeps prototype-related own keys. Rejected.
- **Throwing on an unknown mode or on non-object inputs.** That would push validation into a
  pure helper. The conservative no-op or defaults behaviour matches F-004. Rejected.
