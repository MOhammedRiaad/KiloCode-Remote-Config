# Security report - cycle 0027 - T-038: Plugin JSDoc trim pass and wording fixes (comment-only)

## Inputs read
- `git diff v0.16.2 -- backend/plugin/azdo-remote-config.ts` (92+/194-), `git diff --name-only v0.16.2`
- `factory/runs/cycle-0027/03-backend.md`, T-038 in `factory/backlog.json` (7 ACs)
- `factory/runs/cycle-0026/04-security.md` (severity calibration for false JSDoc claims)
- `docs/architecture/contracts/plugin-interface.md` sections 2e and 2f-L; ADR-0007/0008/0009/0018/0020 headings

## Work done
### 1. Comment-only proof (four independent methods, all vs tag v0.16.2)
- `node tools/compare-plugin-shape.mjs --base-ref v0.16.2` (from backend/) -> PASS, exit 0: 195 declarations, 10
  exports, 6 `__internals` keys, 200-statement multiset identical.
- Own TypeScript 5.9.3 parser check (scratch script, not committed): AST leaf-token sequence (kind + text) with all
  JSDoc nodes and trivia excluded -> base 11011 tokens, head 11011 tokens, identical in order.
- `ts.createPrinter({ removeComments: true }).printFile()` of base and head -> byte-identical output (52323 chars).
- Non-comment line diff: `git diff -U0 v0.16.2` +/- lines not starting with optional whitespace then `*`, `/**` or `//`
  -> 0 lines.

### 2. The six wording fixes, re-tested live (fresh import of the head file under node 24)
| Fix | Claim now in JSDoc | Live result | True? |
|---|---|---|---|
| a | Phase 1 "throws on over-deep input" (no longer "the only phase that throws") | 70-deep and cyclic shared -> `Error: Config merge: config nested too deeply`; write phase also throws (frozen target) | yes |
| b | mergeConfig: frozen target -> TypeError; throwing getter -> its own error, not TypeError | frozen: `TypeError: Cannot define property x, object is not extensible`; getter: custom `Mine` error, `instanceof TypeError` false | yes |
| c | readCappedBody cap on running total of `chunk.byteLength`, trusted as chunk size | honest 3x700000 B -> `too-large` (crossing chunk not pushed); over-reporting -> `too-large`; a 2 MiB Uint8Array subclass reporting byteLength 0 IS accumulated (cap bypassed, as the "trusted" qualifier says), then `joinChunks` throws RangeError -> outer catch -> `network` | yes |
| d/e | applyShared/runConfigHook rollback: ordinary objects, best-effort | nested `preventExtensions` object mid-merge in enforce mode -> config byte-identical afterwards, L-MERGE logged; a Proxy whose deleteProperty returns false keeps the added key after rollback (best-effort, non-ordinary) | yes |
| f | runConfigHook logs sanitised L-UNRESOLVED placeholder NAMES, never values | resolved env value and PAT absent from all logs; names logged verbatim (`env:MISSING_NAME, file:/no/such/file, ...`); 401 run logs no PAT, org or host | yes (see finding 1 for the surviving absolute clause) |

Also re-checked live: 470 -> `network-blocked` with `getReader` never called (body unread); a 302 -> exactly one fetch call.

### 3. Removed comment lines that carried invariants
Every removed sentence was reviewed. Security-relevant ones and where they still live:
- "body never read" / "discarded unread" (codeForStatus, handleResponse) - kept verbatim.
- "exactly one request", "Authorization never logged or returned" (performRequest) - kept. "(never followed)" for
  redirects dropped; still implied by "redirect is manual, so a redirect is just a non-success status" and normative in
  contract 2e row 7 and ADR-0007 section 9. Harmless.
- "never logs the value" (findPat), "never logged" (basicHeader, azAuthorization token) - kept.
- "results hold fixed codes only ... (AC-9)" (fetchRemoteConfig), "reason never holds a value, URL or secret"
  (acquireRemote), "no path, value or secret is returned" (readCache) - kept.
- `__internals`: "never holds the entry point" dropped; still true (6 keys, compare PASS) and the entry-point JSDoc
  keeps "not exported by name (ADR-0002)". Harmless.
- logHint: "never on the success path and never twice" condensed to "calls it once, right after the cache-fallback or
  no-cache line"; equivalent for the two call sites; contract 2f-L keeps the full rule. Harmless.
- readPlaceholderFile: error-discard rationale shortened ("may carry paths"); errors are still discarded. Harmless.
- resolvePlaceholders `@param deps`: "(a guarded file reader)" became "the defaults are the real ones" (info 3).
- Phase 2 banner: "keys of the target not in the tree are untouched" dropped; merge semantics, not security; contract
  2c is normative. Harmless.

### 4. Third sweep of absolute claims in the hot-path JSDoc blocks
Checked against code every "never throws / never rejects / does not throw / never logged / unread / exactly one /
exactly once / pure" claim (lines 5, 186-189, 312-317, 473, 498, 687, 796, 879, 938, 952, 991, 1092, 1106, 1126,
1167, 1206, 1223, 1258-1260, 1319, 1350, 1443, 1476, 1512, 1551, 1597, 1629, 1647, 1700, 1724-1727, 1789-1792).
All hold except the residual wording in finding 1 and the info notes 2 and 4. In particular: validateShared,
checkCacheEnvelope, writeCache, readCache, cacheBindingOf, extractContent, makeLogger, findPat, azAuthorization and
acquireRemote never throw (every external call sits in try/attempt/readOwn); runConfigHook evaluates
`readHookDeps(deps)` inside its try.

### 5. Pointers, hygiene, scope
- `@see` lines are unchanged by the diff (0 added/removed). All 12 ADR files exist; every cited section heading exists
  (ADR-0007 1,3,5-10; ADR-0008 2,3,5,6,7; ADR-0009 1,2; ADR-0018 1-5; ADR-0020 4); contract sections 2, 2a-2f, 2f-C,
  2f-L, 3 and 5 exist.
- Contract section 2e exists and contains the full `FetchErrorCode` union and the "Code summary" row, so the new
  `Codes: see contracts/plugin-interface.md section 2e` pointers (readCappedBody, handleResponse, performRequest,
  runFetch, acquireRemote) resolve to the code list. Full fetch list remains in exactly one JSDoc block
  (fetchRemoteConfig).
- 44 JSDoc blocks, none containing `/*` or `*/` in the body; 0 non-ASCII bytes; 0 `^ \* Codes: none`; 0 "The only
  phase that throws"; longest comment line 110 (LF blob); 1837 lines.
- No secret-like text in added lines (grep for key/token/password assignments, `ghp_`, `AKIA`, PEM, JWT: 0 hits).
- `git diff --name-only v0.16.2 -- backend` -> only the plugin file; `git diff --exit-code v0.16.2 -- backend/test
  backend/tools docs/architecture` -> exit 0. Working tree clean.
- `git ls-files --eol`: `i/lf w/crlf` (index LF; CRLF only from local autocrlf checkout); index blob has 0 CR.

## Files changed
- `factory/runs/cycle-0027/04-security.md` - this report (no source changed).

## Verification
- `node tools/compare-plugin-shape.mjs --base-ref v0.16.2` -> PASS, exit 0
- AST leaf-token comparison (JSDoc excluded) -> identical, 11011 tokens; printer(removeComments) -> identical
- non-comment +/- lines in diff -> 0
- `bash scripts/ci.sh` -> exit 0 (tests 724, pass 714, fail 0, skipped 10 pre-existing platform skips; check-fr11,
  check-lf, check-docs PASS; `ci: PASS`)
- `npm audit --omit=dev --audit-level=high` -> 0 vulnerabilities; `npm audit` (incl. dev) -> 0 vulnerabilities

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | `backend/plugin/azdo-remote-config.ts:1791` | runConfigHook still says "no secret, URL, host or config value appears in any log (AC-9)" before the new names carve-out. Live: a shared config holding `{file://corp-host.example/share/x}` and `{env:https://evil.example.com/a}` logs `Unresolved placeholders: ..., file://corp-host.example/share/x, env:https://evil.example.com/a.`, so a host/URL CAN appear inside a placeholder name. No exposure: names come from the shared config that every consumer can read, values are never logged, and the next clause already says names are logged; the AzDO URL/host/org/PAT never appear (re-proved). | Backlog, comment-only: "no secret, PAT, token, Azure DevOps URL or host, or resolved config value appears in any log (AC-9); the only config-derived log text is the sanitised placeholder NAMES of L-UNRESOLVED (verbatim from the shared config, so they may contain paths or hosts), never their values." |
| 2 | info | `backend/plugin/azdo-remote-config.ts:1167-1169` | readCappedBody says hostile-chunk throws come from the unguarded instanceof and byteLength reads; an under-reporting `Uint8Array` subclass instead throws later in `joinChunks` (`bytes.set` RangeError). The outcome is the same (`network` via the outer catch). | Optional: "...so a hostile chunk (including one whose byteLength under-reports) can throw and fetchRemoteConfig maps that to network". |
| 3 | info | `backend/plugin/azdo-remote-config.ts:310,315` | Trim replaced "(defaults: ... a guarded file reader)" with "the defaults are the real ones"; the default reader is the guarded `readGuardedFile`, and "only regular files up to 1 MiB are read" holds only for that default, not an injected readFile. | Optional: "the default readFile is the guarded reader". |
| 4 | info | `backend/plugin/azdo-remote-config.ts:247, 1551` | Pre-existing: stat-then-read (readGuardedFile, readCache) is checked at stat time only; a same-user local attacker swapping the file between statSync and readFileSync could defeat "a FIFO or device never blocks" / "at most 2 MiB". Cache dir is 0o700 under the user's home; same-user attacker already owns the account. | None this cycle (backlog: read via an fd opened once with fstat, or qualify "at stat time"). |

## Assumptions made (no human available)
- Finding 1 rated low, not medium: it is a pre-existing absolute clause, the same sentence now discloses that names
  are logged, the logged text is non-secret shared-config text, and no AzDO URL, host, org, PAT, token or resolved
  value reaches any log (re-proved live). It does not meet the "medium, cheap, touched" FAIL rule.
- Scratch probe and token-comparison scripts were kept in the session scratchpad, not in the repo.

## Follow-ups for the backlog
- Comment-only wording for findings 1-3 (fits the T-039 follow-up batch or a future JSDoc pass).
- Finding 4: fd-based read with fstat in readGuardedFile/readCache (behaviour change, needs its own item and ADR note).
- Carried over from cycle 0026: guard instanceof/byteLength (and joinChunks) in readCappedBody so hostile chunks yield
  `bad-response` instead of `network`.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/04-security.md
summary: Comment-only change proven 4 ways (compare PASS, AST tokens and comment-free print identical, 0 code lines); six wording fixes re-tested live and true; no security invariant lost; ci and audit clean; 1 low + 3 info doc follow-ups.
