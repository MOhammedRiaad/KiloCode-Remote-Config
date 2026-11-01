# Code Review report — cycle 0027 — T-038: Plugin JSDoc trim pass and wording fixes (comment-only)

## Inputs read
- `git diff v0.16.2..HEAD` and `git diff main...HEAD` (7 files; the only backend file is `backend/plugin/azdo-remote-config.ts`, 92+/194-)
- `factory/runs/cycle-0027/01-product-owner.md`, `03-backend.md`, `04-security.md`; T-038 in `factory/backlog.json` (7 ACs)
- `docs/architecture/ADR-0021-plugin-source-layout-and-hot-path-jsdoc.md` section 3 (hot-path JSDoc standard)
- No architect report this cycle (comment-only; ADR-0021 and the ACs are the design)

## Work done
### AC verification (each re-run by the reviewer)
| AC | Check | Result |
|----|-------|--------|
| 1 | `node tools/compare-plugin-shape.mjs --base-ref v0.16.2` (from backend/) | PASS, exit 0: 195 declarations, 10 exports, 6 `__internals` keys, 200 statements identical |
| 2 | `git diff --name-only v0.16.2 -- backend`; `git diff --exit-code v0.16.2 -- backend/test backend/tools docs/architecture` | plugin file only; exit 0 |
| 3 | `bash scripts/ci.sh` | exit 0; 724 tests, 714 pass, 0 fail, 10 skipped (same platform skips as before); check-lf, check-docs PASS; `ci: PASS` |
| 4 | `wc -l`; longest comment line (CR stripped) | 1837 (<= 1839); 110 (<= 110) |
| 5 | `^ \* Codes: none` / full fetch list / section 2e pointers | 0; full list only in fetchRemoteConfig (line 1317-1318); readCappedBody, handleResponse, performRequest, runFetch and acquireRemote cite section 2e |
| 6 | 'The only phase that throws'; mergeConfig getter wording | 0; line 506-508 says the getter's own error propagates, not a TypeError (true: mergeInto reads `target[key]`) |
| 7 | readCappedBody byteLength; applyShared/runConfigHook 'ordinary objects' + 'best-effort'; L-UNRESOLVED names | all present and true against the code (security also re-proved them live) |

Every AC has an implementation and an automated check (compare tool, layout test, ci) or a grep the reviewer ran.
Lane check: the engineer changed only `backend/plugin/azdo-remote-config.ts` plus its report.

### Readability of the trim
- Overall it is good. The purpose sentences, Invariants and @see lines are intact. The removed text was
  mostly repeated (16 `Codes: none`, 6 `@param deadline`, `@returns nothing`, repeated fetch code lists).
  Wrapping run-on lines to 110 characters makes the hard-to-read blocks from v0.16.2 (mergeConfig,
  applyShared, resolvePlaceholders) readable again.
- The `see contracts/plugin-interface.md section 2e` pointer is clear: it names the file and section, the
  section exists and contains the full FetchErrorCode union, and blocks with local codes still list them
  (readCappedBody: bad-response/too-large; runFetch: invalid-settings/network/auth-unavailable). The full
  list is still visible in fetchRemoteConfig, which is the public entry point, so this is the right block to keep it in.
- Removing the blank ` *` line after the purpose sentence does not break ADR-0021, which does not require
  that line. Blocks are a little denser but still easy to scan, because each line starts with `@param`, `Codes:` or `Invariants:`.
- The ADR-0021 deviation is real. Section 3 item 2 says "`@param name - prose` per parameter and `@returns prose`".
  Measured with a scratch script, 14 hot-path blocks now miss an @param and/or @returns:
  codeForInterrupted, azAuthorization, resolveAuthorization, readCappedBody, handleResponse,
  performRequest (deadline), extractContent (bytes), cacheBindingOf (settings), hintFor (reason),
  and @returns in mergeConfig, codeForStatus, performRequest, runFetch, logHint and executeHook. At v0.16.2 every hot path complied.
  No information is lost: the dropped items are a `Deadline`-typed parameter, a self-describing single
  parameter, `@returns nothing`, or a return value already given by a `Codes:` line. The item text allowed
  dropping `@param deadline`. The other drops go beyond the item text, but they are in the same spirit.
  AC-2 forbids editing ADRs in this cycle, and the 2-line slack under AC-4 rules out re-adding about 20 lines.
  The right fix is to align the ADR, not to revert the drops (finding 5, architect, T-039).
  The layout test does not need to enforce @param, because that would bring back the size the user wants removed.
- Small information losses: the Phase 2 comment (line 423) no longer says target keys not in the tree are
  untouched. Contract 2c still says it, so this is acceptable. readCache line 1550 abbreviates the codes to `-missing`, `-unreadable` and so on,
  so `grep cache-missing` no longer finds readCache's doc (nit, follow-up).

### Is further trimming worthwhile?
No, not much. The file now has 1209 code lines, 451 comment lines and 177 blank lines. The code count is identical to
v0.16.2. The 35 hot-path blocks have a fixed floor of about 175 lines (`/**`, purpose, Invariants, @see, `*/`), and
the remaining comment text is mostly real invariants. A more aggressive pass might save another 60-100 lines,
which is 3-5% of the file, and it would start losing facts the security review relies on. The other 1209 lines are real code. The
growth from 1456 lines (v0.16.1) was mostly comments (TOC, banners, hot-path JSDoc). Reducing it further
would mean code-level changes, which are out of scope for a comment-only item.

### Security finding 1 (runConfigHook log claim): fix it in this cycle
Recommendation: fix now, as comment-only rework. This item exists to make the JSDoc claims accurate, and AC-7
targets exactly this sentence. As written, line 1791-1792 contradicts itself: it says "no secret, URL, host or config value
appears in any log" and then says placeholder NAMES are logged. `cleanName` (line 1655) only
truncates and replaces control characters, so a name like `file://corp-host.example/share/x` is logged verbatim.
The fix is a one-line wording change and fits the 2-line slack.
The same rework should also fix two small inaccuracies that this diff introduced (findings 2 and 3). All three are cheap.

## Files changed
- `factory/runs/cycle-0027/05-review.md` — this report.

## Verification
- `bash scripts/ci.sh` → exit 0 (`ci: PASS`; tests 724 / pass 714 / fail 0 / skipped 10)
- `node tools/compare-plugin-shape.mjs --base-ref v0.16.2` → PASS, exit 0
- `git diff --exit-code v0.16.2 -- backend/test backend/tools docs/architecture` → exit 0
- `wc -l` 1837; max comment line 110; `^ \* Codes: none` 0; 'The only phase that throws' 0
- Scratch @param/@returns coverage script (scratchpad, not committed): 14 hot-path blocks deviate from ADR-0021 3.2 (0 at v0.16.2)

## Findings / issues
| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | medium (blocking) | backend | `backend/plugin/azdo-remote-config.ts:1791-1792` | runConfigHook Invariants still say "no secret, URL, host or config value appears in any log (AC-9)". The next clause and the code say otherwise. Scenario: the shared config contains `{file://corp-host.example/share/x}`, which stays unresolved, and L-UNRESOLVED logs `file://corp-host.example/share/x`, so a host and URL appear in the log. This item's purpose is claim accuracy (AC-7), so the false absolute must not ship. | Reword, for example: "no secret, PAT, token, Azure DevOps URL or host, or resolved config value appears in any log (AC-9); the only config-derived log text is the L-UNRESOLVED placeholder NAMES (verbatim from the shared config, control characters replaced, so they may contain paths or hosts), never their values." Stay <= 110 chars per line and <= 1839 lines total. |
| 2 | low (blocking, introduced by this diff) | backend | `backend/plugin/azdo-remote-config.ts:310` (with 315) | resolvePlaceholders `@param deps` changed from "a guarded file reader" to "the defaults are the real ones". Invariant line 315, "only regular files up to 1 MiB are read", now looks unconditional, but it holds only for the default reader. Scenario: a test or caller injects `readFile` and the injected function reads a FIFO or a 5 MiB file, so the documented invariant is false. | Say the default reader is the guarded one, for example "@param deps - optional seams env, homedir and readFile; the default readFile is the guarded reader." or qualify line 315 with "(default reader)". |
| 3 | low (blocking, introduced by this diff) | backend | `backend/plugin/azdo-remote-config.ts:1723` | executeHook `Logs:` changed from "then L-UNRESOLVED, and L-APPLIED or LOG_MERGE" to "then L-UNRESOLVED, L-APPLIED or LOG_MERGE". The new text reads as three alternatives. Code (lines 1772-1776): L-UNRESOLVED is logged when names are unresolved, and then always one of L-APPLIED or L-MERGE. Scenario: a reader concludes that a run with unresolved placeholders logs no L-APPLIED. | Restore the meaning, for example "then L-UNRESOLVED (if any) and L-APPLIED or LOG_MERGE (L-MERGE)." |
| 4 | low (non-blocking) | orchestrator | `.kilo/kilo.jsonc` (new, commit 53e58d3) | The security-report commit added a repo-root `.kilo/kilo.jsonc` containing only `$schema`. It is outside T-038 and outside every agent lane. It looks like a Kilo tool artifact. It contains no secrets, but it would land in main with the PR. | Remove it from the branch before the PR, or record why it belongs in the repo. |
| 5 | info (non-blocking) | architect | `docs/architecture/ADR-0021-plugin-source-layout-and-hot-path-jsdoc.md:77` | 14 hot-path blocks now omit @param and/or @returns, which ADR-0021 3.2 requires "per parameter". The item allowed it only for `deadline`. No information is lost, and AC-2 blocks ADR edits this cycle. | T-039: amend 3.2 to "@param for each parameter whose meaning is not obvious from its name and type (an operation-wide `deadline` needs none); @returns unless void or fully given by a Codes: line". Do not add a test for @param. |
| 6 | info (optional) | backend | `backend/plugin/azdo-remote-config.ts:1166-1169` | Security info 2: an under-reporting Uint8Array subclass throws later, in joinChunks, not at the unguarded reads. The outcome (`network`) is the same. | Optional in the same rework if the line budget allows; otherwise backlog. |

## Assumptions made (no human available)
- Findings 1-3 are classed as blocking even though their severity is low/medium. In a comment-only item whose
  purpose is JSDoc accuracy, a false or ambiguous invariant is a correctness defect of the change. The fix
  costs at most 2 lines and does not change behaviour (compare-plugin-shape must still print PASS).
- The ADR-0021 deviation (finding 5) is not blocking. The item explicitly allowed dropping `@param deadline`,
  the other drops lose no information, and AC-2 forbids editing ADRs this cycle.
- No new mutation run on the unchanged source-layout test, as instructed. The test passes unchanged in CI.

## Follow-ups for the backlog
- T-039 (architect): amend ADR-0021 section 3.2 as in finding 5.
- Comment nit: readCache line 1550 should spell out the full cache-* codes so they can be grepped.
- Carried over from security: fd-based read with fstat in readGuardedFile/readCache (security info 4); guard
  instanceof/byteLength/joinChunks in readCappedBody so hostile chunks yield bad-response.
- Further size reduction should be code-level work in its own item, not more comment trimming (see "Is further trimming worthwhile?").

FACTORY_RESULT
status: FAIL
report: factory/runs/cycle-0027/05-review.md
summary: ACs 1-7 and ci pass, but 3 cheap comment-only accuracy fixes are required (runConfigHook URL/host log claim, resolvePlaceholders default-reader qualifier, executeHook Logs ambiguity); ADR-0021 @param alignment goes to T-039.
