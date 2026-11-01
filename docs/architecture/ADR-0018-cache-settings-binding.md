# ADR-0018: Bind the config cache to the settings that produced it
- Status: accepted
- Date: 2026-11-01
- Cycle / item: cycle-0019 / T-013
- Amends: ADR-0008 sections 2 (flow, missing-settings fallback) and 4 (cache content and read);
  ADR-0009 section 3 (adds the binding). Contract: `contracts/plugin-interface.md` 0.8.0, section 2f.

## Context

Cycle 0008 security finding (low 1): the cache `~/.cache/kilo-azdo/remote-config.json` (FR-7) is
one fixed file holding a bare shared config. It is not linked to the org / project / repo / path /
branch it was fetched from. When the fetch fails, a cache written for **another** org, repo, path or
branch is applied, so an engineer who switched settings (re-ran the installer with `--repo`,
`--branch`, ...) and then starts offline silently gets the wrong models / providers. Also, with
missing settings (`org`, `project` or `repo` unset) the cache is applied today although nothing
says which source it belongs to.

Constraints: FR-7 fixes the cache path (one file); FR-11 / ADR-0001 (single file, `node:` imports
only, zero runtime deps, no slash-star sequences); ADR-0002 (no new named exports, `__internals`
keys unchanged); FR-9 / AC-9 (no setting values, PATs or tokens in logs); ADR-0008 never-crash and
"cache never modified on the fallback path"; the PAT is a non-enumerable property of `settings`
(ADR-0006) and must never reach disk.

PO decisions (cycle 0019): legacy (unbound) caches are unusable once after the upgrade; with
missing required settings the cache is **not** applied; the version bump is a patch.

## Decision

### 1. File format: envelope with plain binding fields (no hash)

The cache file becomes a versioned envelope:

```json
{
  "format": "kilo-azdo-cache-v1",
  "binding": {
    "org": "acme",
    "project": "proj",
    "repo": "cfg",
    "path": "/kilo.jsonc",
    "branch": "main"
  },
  "config": { "...": "sanitised, unresolved shared config, exactly as before" }
}
```

- Serialised as `JSON.stringify({ format, binding, config }, null, 2) + "\n"`, keys in this order,
  binding keys in the order `org, project, repo, path, branch`.
- `format` is the module-local constant `CACHE_FORMAT = "kilo-azdo-cache-v1"`. A later
  incompatible change uses a new value; any value other than the exact constant is "outdated".
- `binding` is built **field by field** from the five resolved settings:
  `{ org: settings.org, project: settings.project, repo: settings.repo, path: settings.path, branch: settings.branch }`.
  It is never built by spreading or serialising `settings` (that would add `mode` and `timeoutMs`;
  `pat` is non-enumerable, but the rule removes any reliance on that).
- `config` is `sanitizeShared(shared)` (ADR-0005 phase 1), unchanged from ADR-0008: unresolved
  placeholders, no `apiKey`, no prototype keys, no top-level `$schema` / `plugin`.
- `MAX_CACHE_BYTES` (2 MiB) applies to the whole serialised envelope (`cache-too-large`).
- **Never in the file**: the PAT (option or env), `AZDO_PAT` / `AZURE_DEVOPS_EXT_PAT`, any
  `Authorization` header value, the `az` access token, `mode`, `timeoutMs`, resolved placeholder
  values.

Why plain fields and not a hash: the five values are non-secret identifiers that already appear in
the engineer's own Kilo config (plugin options) and in Azure DevOps URLs; the file is 0600 in the
user's home. Plain fields are debuggable by a human, need no `node:crypto` import (FR-11 keeps the
import list minimal), and give an exact comparison with no collision or encoding questions. A hash
would hide nothing that is secret and would need a canonical encoding rule.

Why `mode` is not in the binding: `mode` changes how the cached content is merged, not which content
is correct. The cached content for the same source is valid in both modes; `settings.mode` of the
current run is applied, as before. `timeoutMs` is irrelevant to the content.

### 2. Comparison rule (normative)

The cache is applied only when, for **each** of the five fields,
`storedBinding[field] === currentBinding[field]`, where `currentBinding` is built from the
`settings` returned by `resolveSettings` in the current run.

- Comparison is on the values **as normalised by `resolveSettings`** (ADR-0006): trimmed; `path`
  with a leading `/` prepended if missing; defaults applied (`path` `/kilo.jsonc`, `branch` `main`).
  So option `" acme "` matches stored `"acme"`; option `path: "kilo.jsonc"` matches stored
  `"/kilo.jsonc"`; an unset branch matches stored `"main"`.
- Exact UTF-16 code-unit equality: **case-sensitive**, no Unicode normalisation (NFC / NFD), no
  trimming or other transformation of the **stored** values. So `ACME` vs `acme` is a mismatch
  (although Azure DevOps treats org and project names case-insensitively), and a stored value with
  surrounding whitespace never matches (the plugin never writes one).
- Rationale: fail closed. A false mismatch costs one offline start with local config only and is
  repaired by the next successful fetch; a false match applies another team's config.

### 3. Read and validation order (`readCache(binding, homeFn, fs)`)

Steps 1-3 are unchanged from ADR-0008 section 4 (location -> `cache-unavailable`; `statSync` ->
`cache-missing` / `cache-unreadable`; regular file, size cap, `readFileSync` -> `cache-unreadable`).
Then, on the text:

| Step | Check | Failure code |
|---|---|---|
| 4 | `parseJsonc(text)` does not throw, and the root is a plain object (`isPlainObject`) | `cache-invalid` |
| 5 | root has an own `format` whose value is exactly `CACHE_FORMAT` (read with `readOwn`) | `cache-outdated` |
| 6 | root's own enumerable keys are exactly `format`, `binding`, `config` (any order, no others) | `cache-invalid` |
| 7 | `binding` is a plain object whose own enumerable keys are exactly `org`, `project`, `repo`, `path`, `branch` (any order, no others) and every value is a `string` | `cache-invalid` |
| 8 | `config` is a plain object and `exceedsDepth(config, 0)` is false (same depth rule as `validateShared`, measured from `config` as level 0) | `cache-invalid` |
| 9 | all five fields equal per section 2 | `cache-mismatch` |
| ok | `{ ok: true, value: config }` | |

- A legacy cache (bare shared config, written by plugin <= contract 0.7.0) is a plain object with
  no own `format` key, so it ends at step 5: `cache-outdated`. To be read as bound, a legacy file
  would need the exact constant value **and** the exact envelope shape of steps 6-8 **and** a
  matching binding, which a Kilo shared config does not have.
- Shape failures (steps 6-8) are reported before the comparison, so a malformed binding is
  `cache-invalid`, never `cache-mismatch`.
- Stored binding values are only compared, never logged, never used to build a path or URL, and
  never validated with the settings charset rules (a non-matching string simply mismatches).
- The depth check is measured from `config`, not from the envelope root, so any config accepted by
  `validateShared` on the fetch path (levels 0..63) is accepted from the cache.
- The cache file is never modified, deleted or rewritten on the fallback path, whatever the result
  (unchanged rule). The next validated fetch overwrites it in the bound format.

### 4. Write (`writeCache(shared, binding, homeFn, fs)`)

Unchanged mechanics (mkdir 0700, temp file `wx` 0600, rename, guarded unlink, result codes
`cache-unavailable` / `cache-too-large` / `cache-write-failed`). Only the serialised data changes
(section 1). Written only after a validated fetch, so it is always bound to the settings that were
actually used for that fetch.

### 5. Hook flow change (amends ADR-0008 section 2)

```
2. { settings, missing, warnings } = resolveSettings(options, { env }); warnings -> L-SET
   binding = cacheBindingOf(settings)   // undefined unless org, project, repo, path, branch are all strings
3. if missing.length > 0 or binding === undefined:
       missing.length > 0 -> L-MISSING (warn, unchanged text)
       L-NONE (error): reason "missing-settings", readCode "cache-skipped"
       return                            // no fetch, no az, NO cache read (no fs call at all)
   r = await fetchRemoteConfig(...); validateShared(...)   (unchanged)
4. remote ok   -> L-REMOTE; writeCache(shared, binding, home, fs); failure -> L-CACHE-WRITE
   otherwise   -> readCache(binding, home, fs): ok -> L-CACHE; else L-NONE(reason, readCode), return
5., 6. unchanged
```

- `binding === undefined` with an empty `missing` cannot happen under the `resolveSettings`
  contract; the guard only keeps the type narrow and the behaviour fail-closed.
- Missing settings no longer use the cache (PO decision): without the three identifiers no binding
  can be verified. Missing settings mean a misconfigured install, not an offline engineer, so AC-3
  ("AzDO unreachable and a cache exists") still holds whenever the settings are present.
- `<reason>` in L-CACHE can therefore no longer be `missing-settings`.

### 6. Log codes (amends ADR-0008 section 5)

No new message template. L-NONE gains three read codes:

| Code | Meaning |
|---|---|
| `cache-outdated` | The cache file has no or an unknown `format` (for example written by an older plugin version). Rewritten by the next successful fetch. |
| `cache-mismatch` | The cache was written for a different org / project / repo / path / branch than the current settings. |
| `cache-skipped` | Required settings are missing, so the cache was not consulted. |

Example: `Remote config unavailable (network) and no usable cache (cache-mismatch); continuing with local config only.`
(error level). The message never names the field that differed and never contains a stored or a
current setting value (FR-9). The full read-code set is `cache-unavailable`, `cache-missing`,
`cache-unreadable`, `cache-invalid`, `cache-outdated`, `cache-mismatch`, `cache-skipped`.

### 7. Code rules

- Module-local only: `CACHE_FORMAT`, `CACHE_BINDING_KEYS = ["org","project","repo","path","branch"]`,
  `interface CacheBinding { org: string; project: string; repo: string; path: string; branch: string }`,
  `cacheBindingOf(settings: Settings): CacheBinding | undefined`. No new named export, no new
  `__internals` key, no new import (FR-11).
- `CacheReadCode` gains `"cache-outdated" | "cache-mismatch"`; the hook's L-NONE read code type also
  admits `"cache-skipped"` (produced by the hook, never by `readCache`).
- The single-file rule, ASCII / LF, erasable TypeScript, and the no slash-star rule hold (the format
  constant contains no `/`).

## Consequences

- A stale cache from another org / project / repo / path / branch is never applied; the engineer
  sees an error-level `cache-mismatch` log and runs with local config until AzDO is reachable.
- One-time upgrade cost: every existing cache is `cache-outdated` until the first successful fetch
  after the upgrade. An engineer who upgrades and starts offline before any successful fetch runs with
  local config only once. Documented in the CHANGELOG and troubleshooting.
- Switching back and forth between two sources keeps only the latest one cached (one file, FR-7).
- Missing settings no longer fall back to the cache (behaviour change, recorded in the contract,
  user guide and CHANGELOG).
- The binding is **not** an integrity or authenticity control: anything that can write the user's
  home can forge a matching binding. The threat addressed is accidental reuse of a stale cache, not
  tampering (ADR-0009 section 3 still treats the file as untrusted content and validates it).
- Contract `plugin-interface.md` goes to 0.8.0 (behaviour change of an internal seam and of the
  cache file format). Product version: patch (security fix), per the PO.

## Alternatives considered

- **Hash of the five fields (`sha256`)**: hides nothing secret, needs `node:crypto` and a canonical
  encoding, makes the file opaque for support. Rejected.
- **One cache file per binding (name derived from the binding)**: keeps several sources warm, but
  FR-7 fixes one path, the file name needs a safe encoding or a hash, and old files accumulate.
  Rejected.
- **Case-insensitive comparison for org / project / repo**: matches Azure DevOps semantics, but adds
  a locale-free case-folding rule and fails open on any mismatch in that rule. Rejected; a case change
  costs at most one offline start.
- **Migrate legacy caches by assuming they match the current settings**: would apply exactly the
  unverified cache this item removes. Rejected (PO).
- **Include `mode` in the binding**: would invalidate a correct cache when only the merge mode
  changes. Rejected.
- **Separate L-MISMATCH log line in addition to L-NONE**: more noise for the same information; the
  read code in L-NONE is enough. Rejected.
- **Keep the cache fallback for missing settings**: no binding can be verified. Rejected (PO).
