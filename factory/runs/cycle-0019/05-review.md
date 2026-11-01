# Code review report — cycle 0019 — T-013: Bind cache to the settings that produced it

## Inputs read
- `git diff main...HEAD` (working tree clean, no uncommitted changes)
- `factory/backlog.json` (T-013, 7 ACs), `01-product-owner.md`, `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/ADR-0018-cache-settings-binding.md`, `contracts/plugin-interface.md` 0.8.0 (2f, 2f-C, 2f-L),
  `contracts/e2e-harness.md` 1.0.1, `overview.md`
- `backend/plugin/azdo-remote-config.ts` (cache / hook section), `backend/test/plugin/hook.test.ts`,
  `backend/test/plugin/azdo-remote-config.smoke.test.ts`, `backend/test/e2e/helpers.ts`, `backend/test/e2e/startup.test.ts`

## Work done
- Ran the full quality gate.
- Checked the code against contract 2f-C point by point:
  - Envelope: `{ format, binding, config }` in that order. `bindingCopy` builds org, project, repo, path, branch
    field by field (no spread of `settings`). `mode`, `timeoutMs` and `pat` are absent. The size cap covers the whole envelope.
  - Read order in `checkCacheEnvelope` (`azdo-remote-config.ts:1199`): parse/plain-object -> `cache-invalid`;
    `readOwn(format) !== CACHE_FORMAT` -> `cache-outdated`; exact root keys -> `cache-invalid`; binding plain object
    with exactly 5 own keys, all strings -> `cache-invalid`; `isPlainObject(config) && !exceedsDepth(config, 0)` ->
    `cache-invalid`; field-by-field `===` -> `cache-mismatch`. Shape checks run before the comparison, and stored
    values are never trimmed. This matches 2f-C steps 4-9.
  - Depth: `exceedsDepth(config, 0)` uses `MAX_MERGE_DEPTH` (64) measured from `config` as level 0. The tests seed
    65 nested containers (deepest at level 64, rejected) and 64 nested containers (deepest at level 63, applied).
    The boundary is correct.
  - Missing settings (`executeHook`): `missing.length > 0 || binding === undefined` -> L-MISSING (only when
    `missing` is non-empty), then L-NONE `(missing-settings) ... (cache-skipped)` at level error, and return. There
    is no fetch, no az, no `readCache` and no fs access. The messages match 2f-L exactly.
  - `validateShared` is unchanged for fetched text. The envelope check reuses the same parse, plain-object and
    depth primitives, so the cache content is not validated less strictly than before.
- Checked FR-11 and the export surface. There is no new import and no new export. The `__internals` keys are
  unchanged, and the smoke export-surface tests pass. The plugin is still one file with `node:` imports only, and
  the lint rule check-fr11 passed.
- Ran mutation testing on a scratch copy (`git archive HEAD backend` into the session scratchpad; the repo was not
  touched) and re-ran `test/plugin/hook.test.ts` for each mutant:

  | Mutant | Result |
  |---|---|
  | Skip `branch` in the comparison | KILLED |
  | Write a fixed `branch: "main"` into the binding | KILLED |
  | Add `mode` into the written binding | KILLED |
  | Use the cache on missing settings (readCache with a guessed binding) | KILLED |
  | Depth off by one (`exceedsDepth(config, 1)`) | KILLED |
  | Compare before the shape check (mismatch before invalid) | KILLED |
  | Check the format after the root key set (outdated vs invalid order) | KILLED |
  | Remove the exact root key-set check | KILLED |
  | Trim stored values before comparing | KILLED |
  | Case-insensitive comparison | KILLED |
  | `==` instead of `===` | survived: equivalent mutant (both operands are already proven strings) |
  | Reorder `CACHE_BINDING_KEYS` | survived: equivalent (write order comes from `bindingCopy`, not the constant) |

- Checked the replaced and strengthened tests:
  - AC2 "success writes": now asserts the full envelope, the key order of the root and the binding, and the
    absence of the PAT, the Basic value, `"mode"`, `"pat"` and `timeoutMs`. This is stronger than before.
  - AC3 fallback loop and "AC5 invalid fetched content keeps an existing cache": they now seed a bound cache, and
    their expectations are unchanged.
  - "AC5 missing settings ... then use the cache": replaced by 4 tests (missing org, missing project, missing repo,
    all three missing). Each asserts exact messages, the error level, zero fs calls through a spy fs, no
    fetch/az call, `cfg` unchanged and the cache bytes unchanged. The PO approved this behaviour change.
  - AC7 secrets test: the fallback leg now also asserts that the cache was really applied, which it did not do
    before. A mismatch leg was added.
  - Smoke default-wiring test: `existsSync(.cache) === false` was replaced by byte-equality of a seeded legacy
    file. This alone is slightly narrower, because it would not catch a stray file created in `.cache`. The new
    hook test that asserts zero fs calls on this path covers that gap. Overall coverage is not weakened.
- e2e T3 is unchanged and passes, so the AC-7 cache-fallback scenario still works. The new T3b covers a cache
  from another branch: not applied, exact error log, bytes unchanged, logs contain neither `release` nor `acme`,
  and the next online start fetches the new branch and rewrites the binding. T3b ran and passed in this CI run.
- Maintainability: `readCache` itself is now shorter than before. The envelope logic is in `checkCacheEnvelope`
  (17 lines, one linear early-return chain) with three small predicates (`hasExactKeys`, `isStringBinding`,
  `matchesBinding`). It is easy to read, and I see no complexity problem.
- Lanes: the engineer changed only files in `backend/`. The `docs/architecture` changes are the architect's
  (cycle commit fa46ae9). Nothing in `frontend/` changed, and none was in scope.

## Acceptance criteria coverage
| AC | Code | Test that fails if broken |
|----|------|---------------------------|
| 1 mismatch on any field | `matchesBinding`, `checkCacheEnvelope` | `T013 AC1 ... one field at a time` (5 fields, exact message, error level, no setting values in the logs, bytes and mtime unchanged); e2e T3b |
| 2 same settings applied, warning kept | `executeHook` fallback | `T013 AC2 ...; mode is not bound`, AC3 fallback loop, e2e T3 |
| 3 no PAT/token in the file | `bindingCopy`, envelope | `T013 AC3 the cache bytes hold no credential` x5 sources, AC2 success test |
| 4 legacy/malformed unusable, rewritten on success | `checkCacheEnvelope` | `T013 AC4 ... cache-outdated` x5, `... cache-invalid` x13, depth 63 applied, legacy rewritten |
| 5 missing settings never use the cache | `executeHook` early return | `T013 AC5 missing <x> skips fetch, az and the cache entirely` x4, smoke child-process test |
| 6 comparison rule pinned | `===` on `resolveSettings` values | `T013 AC6 comparison uses normalised settings ...` (trim, case, path, default branch, stored whitespace, env source) |
| 7 CI green, FR-11, e2e cache fallback | whole file | `bash scripts/ci.sh` exit 0; lint FR-11; e2e T3/T3b |

## Files changed
- `factory/runs/cycle-0019/05-review.md` — this report.

## Verification
- `bash scripts/ci.sh` -> exit 0 (`ci: PASS`): 607 tests, 602 pass, 0 fail, 5 skipped. The skips are existing
  POSIX-only tests skipped on Windows and do not involve T-013. check-lf PASS, check-docs PASS (34 files).
- Mutation run on a scratch copy: 10 of 10 non-equivalent mutants killed.

## Findings / issues
| # | Severity | File:line | Finding | Required fix | Owner |
|---|----------|-----------|---------|--------------|-------|
| 1 | info | backend/plugin/azdo-remote-config.ts:1122 | The comment on `validateShared` still says "Fetched text and cache text ... both pass through here". Since T-013, cache text goes through `checkCacheEnvelope`, not `validateShared`. | Reword the comment (follow-up, not blocking). | backend |
| 2 | info | docs/architecture/contracts/plugin-interface.md:318 | The 2f "Validation" row still says it is "Applied to fetched text and to cache text alike". 2f-C now defines the cache checks (equivalent parse, plain-object and depth rules applied to `config`). | Point the row to 2f-C for the cache (follow-up, architect lane). | architect |
| 3 | info | docs/user-guide.md:46, docs/troubleshooting.md | The user docs do not yet describe `cache-outdated`, `cache-mismatch` or `cache-skipped`, or that missing settings no longer use the cache. This is expected: the docs phase owns it (02-architect "Docs / release tasks"). | Docs writer phase of this cycle. | docs |

No correctness bugs, contract mismatches, missing AC coverage or weakened tests were found.

## Assumptions made (no human available)
- The `==` and key-order mutants that survived are equivalent: the binding values are proven to be strings
  before the comparison, and the written key order comes from `bindingCopy`. They are not test gaps.
- Replacing the AC5 "missing settings use the cache" test is an intentional, PO-approved behaviour change
  (01-po, 02-architect B2), not a weakened test.

## Follow-ups for the backlog
- Findings 1 and 2: wording clean-ups for the stale comment and contract row (fold into the next plugin item).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0019/05-review.md
summary: T-013 matches contract 0.8.0 2f-C exactly (envelope, read order, depth 63/64, missing-settings skip); all 7 ACs covered, 10/10 non-equivalent mutants killed, ci.sh exit 0; 3 info follow-ups only.
