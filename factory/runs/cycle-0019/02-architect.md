# Architect report — cycle 0019 — T-013: Bind cache to the settings that produced it

## Inputs read
- `factory/runs/cycle-0019/01-product-owner.md` (item JSON with the 7 ACs, PO assumptions)
- `docs/architecture/ADR-0008-config-hook-wiring-cache-logging.md`, `ADR-0009-...trust-boundary.md`,
  `ADR-0006` (via contract 2d), `contracts/plugin-interface.md` 0.7.0 (2d, 2e, 2f, 2f-L, 5),
  `contracts/e2e-harness.md`, `contracts/docs-check.md`, `overview.md`
- `backend/plugin/azdo-remote-config.ts` (cache / hook section, lines 1060-1331)
- `backend/test/plugin/hook.test.ts`, `backend/test/plugin/azdo-remote-config.smoke.test.ts`,
  `backend/test/e2e/startup.test.ts`, `backend/test/e2e/helpers.ts`, `backend/test/installer/helpers.ts`
  (REQUIRED_ARGS), `docs/user-guide.md`, `docs/troubleshooting.md`, `docs/api.md`, `README.md`

## Work done

### Design summary (ADR-0018, contract plugin-interface 0.8.0 section 2f-C)

1. **Format**: the cache file becomes an envelope with **plain fields** (no hash):
   ```json
   { "format": "kilo-azdo-cache-v1",
     "binding": { "org": "...", "project": "...", "repo": "...", "path": "/kilo.jsonc", "branch": "main" },
     "config": { ...sanitised, unresolved shared config, as before... } }
   ```
   `JSON.stringify({ format, binding, config: sanitizeShared(shared) }, null, 2) + "\n"`. The binding
   is built field by field from the resolved `settings` (never spread or serialised). `mode`,
   `timeoutMs` and `pat` are never in it. No PAT, Authorization value or az token is ever in the file.
   2 MiB cap applies to the whole envelope.
2. **Comparison rule**: `stored[f] === current[f]` for each of org, project, repo, path, branch,
   where `current` = the values as normalised by `resolveSettings` (trimmed, leading `/` on path,
   defaults `/kilo.jsonc` and `main`). Case-sensitive, no Unicode normalisation, stored values never
   trimmed. Fail closed.
3. **Read order** after stat / size / read (unchanged): parse fails or root not plain object ->
   `cache-invalid`; no own `format` or not exactly `CACHE_FORMAT` -> `cache-outdated` (every legacy
   cache); root keys not exactly {format, binding, config} -> `cache-invalid`; binding not a plain
   object with exactly the 5 keys, all strings -> `cache-invalid`; config not a plain object or a
   container at level >= 64 measured from `config` -> `cache-invalid`; any field differs ->
   `cache-mismatch`. Shape errors come before the comparison. The file is never modified on the
   fallback path.
4. **Missing settings** (`org`, `project` or `repo` unset): L-MISSING (unchanged), then L-NONE
   `Remote config unavailable (missing-settings) and no usable cache (cache-skipped); continuing with local config only.`
   No fetch, no az, **no cache read, no fs call**, config unchanged.
5. **Logs**: no new template. L-NONE gains read codes `cache-outdated`, `cache-mismatch`,
   `cache-skipped`. Mismatch example (error level):
   `Remote config unavailable (network) and no usable cache (cache-mismatch); continuing with local config only.`
   No log ever names the differing field or contains a stored or current setting value.
   L-CACHE `<reason>` can no longer be `missing-settings`.
6. **Signatures** (module-local, no new exports, no new `__internals` key, no new import; FR-11 holds):
   ```ts
   interface CacheBinding { org: string; project: string; repo: string; path: string; branch: string }
   const CACHE_FORMAT = "kilo-azdo-cache-v1";
   const CACHE_BINDING_KEYS = ["org", "project", "repo", "path", "branch"] as const;
   function cacheBindingOf(settings: Settings): CacheBinding | undefined;
   function writeCache(shared: Record<string, unknown>, binding: CacheBinding, homeFn: unknown, rawFs: unknown): CacheWrite;
   function readCache(binding: CacheBinding, homeFn: unknown, rawFs: unknown): CacheRead; // + "cache-outdated" | "cache-mismatch"
   ```
7. **Versions**: plugin contract 0.7.0 -> 0.8.0; e2e-harness contract 1.0.0 -> 1.0.1
   (`expectedCache` returns the envelope, `DEFAULT_BINDING`). Product version: patch (PO).

### Backend tasks (senior-backend)

All in `backend/`. Follow ADR-0018 and contract `plugin-interface.md` 0.8.0 sections 2f and 2f-C
exactly. FR-11: one file, `node:` imports only (no new import, no `node:crypto`), no slash-star
sequences, ASCII, LF, erasable TS. No new named export, `__internals` keys unchanged.

**B1. `backend/plugin/azdo-remote-config.ts`** (AC-1..AC-6)
- Add module-local `CacheBinding`, `CACHE_FORMAT`, `CACHE_BINDING_KEYS`, `cacheBindingOf(settings)`
  (returns `{ org, project, repo, path, branch }` built field by field, or `undefined` unless all
  five are strings).
- Extend `CacheReadCode` with `"cache-outdated" | "cache-mismatch"`; the hook's L-NONE code admits
  `"cache-skipped"` (hook-produced only).
- `writeCache(shared, binding, homeFn, rawFs)`: serialise the envelope in key order format, binding
  (org, project, repo, path, branch), config = `sanitizeShared(shared)`. Size cap on the envelope.
  Mechanics (mkdir 0700, temp `wx` 0600, rename, guarded unlink) unchanged.
- `readCache(binding, homeFn, rawFs)`: steps 1-3 unchanged; replace the `validateShared(text)` call
  with the envelope checks of 2f-C in the exact order (parse via `parseJsonc` in `try` / plain-object
  root -> `cache-invalid`; `readOwn(root, "format") !== CACHE_FORMAT` -> `cache-outdated`; exact
  root key set; exact binding key set with string values; `isPlainObject(config) &&
  !exceedsDepth(config, 0)`; field-by-field `===` -> `cache-mismatch`). Use `readOwn` / own-key
  checks; exact key set = `Object.keys(o).length === keys.length` and every key own. Never throws.
  `validateShared` stays unchanged for fetched text.
- `executeHook`: compute `binding = cacheBindingOf(settings)` after `resolveSettings`. If
  `missing.length > 0 || binding === undefined`: L-MISSING (only when `missing` non-empty), then
  L-NONE with `missing-settings` / `cache-skipped`, return (no fetch, no az, no `readCache`, no fs).
  Else fetch; on success `writeCache(remote.value, binding, home, deps.fs)`; on failure
  `readCache(binding, home, deps.fs)`. Messages unchanged otherwise.
- Update the file header comment (cache is bound to its settings).

**B2. `backend/test/plugin/hook.test.ts`** (existing tests that must change, and why; none weakened)
- Add helper `seedBoundCache(home, config, binding = { org: "o", project: "p", repo: "r", path: "/kilo.jsonc", branch: "main" })`
  writing the 0.8.0 envelope. Keep raw `seedCache` for corrupt / legacy files.
- `AC2 success writes ...`: assert the parsed file deep-equals the envelope (format, binding of
  OPTIONS with normalised path/branch, config as today), `Object.keys` order
  `["format","binding","config"]` and binding key order; additionally assert the bytes contain
  neither `PAT`, nor `Buffer.from(":" + PAT).toString("base64")`, nor `"mode"` / `"timeoutMs"` inside
  `binding`. (Strengthened.)
- `AC3 <code> falls back to the cache ...`: seed with `seedBoundCache` (the old bare seed is now
  legacy and correctly unusable). Expectations unchanged.
- `AC5 missing settings skip fetch and az, then use the cache` -> **superseded** by the PO decision
  (cycle 0019): rename to "missing settings skip fetch, az and the cache". Seed a bound cache, run
  with each of `org`, `project`, `repo` missing (and all three missing); assert fetch and az not
  called, an injected spy `fs` (wrapping real fs) records **zero** calls, `cfg` unchanged,
  messages exactly `[L-MISSING <names>, "Remote config unavailable (missing-settings) and no usable cache (cache-skipped); continuing with local config only."]`,
  second log level `error`, cache bytes unchanged. Covers T-013 AC-5.
- `AC5 invalid fetched content keeps an existing cache and uses it`: seed bound cache.
- `AC7 no log argument contains a secret ...`: fallback leg seeds a bound cache (so the
  fallback path is really exercised); also add a mismatch leg.
- `AC4 corrupt cache` loop and other tests: unchanged (still `cache-invalid` / `cache-missing` /
  `cache-unreadable`).

**B3. New tests in `hook.test.ts`** (name them `T013 ACn ...`)
- AC-1 mismatch: use distinctive values (e.g. `orgSentA`, `projSentA`, `repoSentA`, `/sentA.jsonc`,
  `brSentA` vs `...B`; never one-letter values, they are substrings of messages). Write the cache with
  a real successful run for S, then for each of the 5 fields run with S differing in only that field
  and a failing fetch: `cfg` deep-equals the original, messages exactly
  `["Remote config unavailable (network) and no usable cache (cache-mismatch); continuing with local config only."]`,
  level `error`, `JSON.stringify(logs)` contains none of the 10 values, cache bytes and mtime unchanged.
- AC-2 round trip: successful run with S writes; failing run with identical S applies the cache:
  messages `[L-CACHE (network), "Applied shared config from cache in defaults mode."]`, merged as
  before. Also: same S but `mode: "enforce"` still applies (mode not bound).
- AC-3 no secrets in the written bytes, for each credential source: `pat` option, `AZDO_PAT` env,
  `KILO_AZDO_PAT` env, `AZURE_DEVOPS_EXT_PAT` env, and az token (`runAz` fake). Search the raw file
  bytes for the PAT, the Basic base64 value, `TOKEN`, `Bearer`, `Basic `. Assert
  `Object.keys(binding)` is exactly the 5 fields.
- AC-4 legacy / malformed (table-driven, each: not applied, never throws, cfg unchanged, exact L-NONE
  code): legacy bare `{"model":"cached"}` -> `cache-outdated`; `{}` -> `cache-outdated`;
  `format` `"kilo-azdo-cache-v0"` / `1` / `null` -> `cache-outdated`; binding missing a field,
  extra binding field, a binding value number / null, binding array / null / missing, config array /
  missing / string, extra top-level key -> `cache-invalid`; malformed binding whose values also differ
  -> `cache-invalid` (shape before compare); config nested 64 levels below `config` -> `cache-invalid`,
  63 levels -> applied (boundary). Then a successful fetch rewrites the file in the bound format
  (assert envelope).
- AC-6 comparison pins: option `org: " o "` vs stored `"o"` -> applied; `org: "O"` -> `cache-mismatch`;
  `path: "kilo.jsonc"` vs stored `"/kilo.jsonc"` -> applied; branch unset vs stored `"main"` ->
  applied; hand-written stored `" o"` vs current `"o"` -> `cache-mismatch`; settings from
  `KILO_AZDO_*` env equal to the stored option values -> applied (source irrelevant).

**B4. `backend/test/plugin/azdo-remote-config.smoke.test.ts`**
- Default-wiring child test: expected L-NONE becomes `... (missing-settings) and no usable cache (cache-skipped); ...`
  (behaviour change). Strengthen: before running, write a legacy cache file into the temp home and
  assert `cfg` is still `{ model: "local" }` and the file bytes are unchanged afterwards (replace the
  `existsSync(join(home, ".cache")) === false` assertion with a byte-equality check of the seeded file).
- Export-surface tests unchanged (must still pass: no new export, 6 `__internals` keys).

**B5. `backend/test/e2e/helpers.ts` and `startup.test.ts`** (AC-7; contract e2e-harness 1.0.1)
- `helpers.ts`: export `DEFAULT_BINDING = { org: "acme", project: "proj", repo: "cfg", path: "/kilo.jsonc", branch: "main" }`;
  `expectedCache(shared, binding = DEFAULT_BINDING)` returns
  `{ format: "kilo-azdo-cache-v1", binding: { ...binding }, config: <current stripped copy> }`.
  T1 / T2 assertions then check the envelope with no other change.
- T3 unchanged (same settings -> cache applied, bytes unchanged): this is the AC-7 cache-fallback scenario.
- New `T3b T-013: a cache from another branch is not applied`: install, online start (cache bound
  to DEFAULT_BINDING), re-run `install(sb, ["--branch", "release"])`, offline start
  (`{ mode: "throw", message: THROW_CANARY }`): `result.config` deep-equals `result.initialConfig`,
  logs exactly `[rec("error", "Remote config unavailable (network) and no usable cache (cache-mismatch); continuing with local config only.")]`,
  cache bytes unchanged, logs JSON does not contain `release` or `acme`. Then an online start:
  request URL is `expectedItemsUrl("acme","proj","cfg","/kilo.jsonc","release")` and the cache equals
  `expectedCache(shared, { ...DEFAULT_BINDING, branch: "release" })`.
- T7: unchanged (cache leak check already runs on the bound file).

**B6. Gate**: `bash scripts/ci.sh` exits 0 (lint incl. FR-11 rules, typecheck, all tests, docs check).

### Frontend tasks (senior-frontend)

None. The item has `scope.frontend: false` and the product has no frontend (ADR-0001).

### Docs / release tasks (docs writer and CI releaser phases, for the orchestrator)
- `docs/user-guide.md` "Cache": file holds the settings it came from (org, project, repo, path,
  branch; never PAT/token) and is used only when they match exactly (case-sensitive, after trimming);
  missing settings never use the cache. Log table: L-NONE codes add `cache-outdated`,
  `cache-mismatch`, `cache-skipped`; L-CACHE no longer for missing settings.
- `docs/troubleshooting.md` "Stale or missing shared config and cache": entries for
  `cache-mismatch` (settings changed since last successful fetch; fixed by the next online start),
  `cache-outdated` (one time after upgrading), `cache-skipped` (set org/project/repo). Avoid the
  docs-check forbidden pattern `teams/` in examples.
- `docs/api.md` runConfigHook: step 3 (missing settings: no cache), step 5 (bound cache), Cache
  paragraph (envelope), contract reference `(v0.8.0)` and ADR-0018. `README.md` line 56: "the
  validated cache written for the same settings".
- `CHANGELOG.md` (patch): security fix; upgrade note "existing caches are unusable once
  (`cache-outdated`) until the first successful fetch after upgrading"; behaviour change "missing
  required settings no longer fall back to the cache".

### Security notes for the Security engineer
- Binding fields are non-secret identifiers, stored in a 0600 file; they must never reach logs
  (check messages carry only fixed codes) and the binding must never be built from `settings` by
  spread / `JSON.stringify(settings)`.
- Verify the written bytes contain no PAT (all four sources), no Basic / Bearer value, no az token.
- Fail-closed: any parse / shape / format / compare failure -> not applied; shape checks before
  comparison; no stored value is used for a path, URL or log.
- Missing settings: no fs access at all on that path.
- The binding is not an integrity control (documented in ADR-0018 / ADR-0009 section 3); tampering
  by something that can write the user's home is out of scope, content validation still applies.
- Residual: AzDO names are case-insensitive, so a case-only change of settings produces a
  (safe) mismatch until the next online start.

## Files changed
- `docs/architecture/ADR-0018-cache-settings-binding.md` — new ADR (format, comparison rule, read order, flow, codes, alternatives).
- `docs/architecture/contracts/plugin-interface.md` — 0.8.0: 2f types and helper signatures, Order / Reasons / Missing settings / Cache content / Cache read rows, new section 2f-C, 2f-L L-CACHE / L-NONE codes, example sequences, section 5 cache bullet, 2e wiring note, module-local names list.
- `docs/architecture/contracts/e2e-harness.md` — 1.0.1: `DEFAULT_BINDING`, `expectedCache(shared, binding?)`.
- `docs/architecture/ADR-0008-config-hook-wiring-cache-logging.md` — status notes the amendment by ADR-0018.
- `docs/architecture/ADR-0009-settings-and-content-trust-boundary.md` — section 3: binding added, not an integrity control.
- `docs/architecture/overview.md` — last updated, ADR-0018 listed, C2 status, runtime data flow (missing settings, envelope, read checks).

## Verification
- Docs-only change in my lane; no code changed. Contract and ADR cross-checked against the current
  `writeCache` / `readCache` / `executeHook` code and the tests that pin the old behaviour (listed in B2, B4, B5).
- `bash scripts/ci.sh` not run by me (no product code changed); the engineer must run it (B6).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- Plain binding fields instead of a hash — values are non-secret, file is 0600, no `node:crypto` needed (FR-11), debuggable.
- Case-sensitive exact comparison on `resolveSettings`-normalised values — fail closed; a false mismatch costs one offline start.
- `mode` and `timeoutMs` not bound — they do not change which content is correct.
- Unknown / missing `format` is `cache-outdated` (including a future format read by an older plugin); malformed envelope is `cache-invalid`; distinct codes help troubleshooting after the upgrade.
- Missing settings keep the L-NONE line (code `cache-skipped`) for a consistent "no shared config applied" error, and skip all fs access.
- Strict envelope (exact key sets) — no forward-compat need, since a new format value is used for any change.
- e2e-harness contract bumped to 1.0.1 because the shared helper's return shape changes.

## Follow-ups for the backlog
- None new. T-029 (Kilo project-level override check) already split out by the PO.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0019/02-architect.md
summary: ADR-0018 + plugin contract 0.8.0 (2f-C): cache is a {format, binding, config} envelope bound to org/project/repo/path/branch, applied only on exact case-sensitive match; new L-NONE codes cache-outdated/cache-mismatch/cache-skipped; missing settings skip the cache; backend-only task list.
