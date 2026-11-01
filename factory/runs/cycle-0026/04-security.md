# Security report - cycle 0026 - T-037: Organise the single plugin file (TOC, numbered sections) and JSDoc every hot path - zero behaviour change

## Inputs read
- `git diff main...HEAD` (14 files; plugin, 2 new tests, 1 new tool, ADRs, factory records); `git status` clean.
- `factory/runs/cycle-0026/01-product-owner.md`, `02-architect.md`, `03-backend.md`, ADR-0021.
- Base for the zero-behaviour proof: tag `v0.16.1` (`dea0ed5`); the plugin is byte-identical between v0.16.1 and `main`.

## Work done
1. Zero-behaviour-change proof, re-run independently (did not rely on 03-backend.md):
   - `node backend/tools/compare-plugin-shape.mjs --base-ref v0.16.1` -> PASS (200/200 statements, 195 declarations,
     10 exports, 6 `__internals` keys identical).
   - Own method A (TypeScript compiler AST, `backend/node_modules/typescript`): parsed base and head, for each of the
     200 top-level statements collected the exact source text of every leaf token, JSDoc nodes excluded (so string,
     template and regex literals are compared raw). Sorted multiset of per-statement token sequences: identical,
     0 differences. Printer-based (removeComments) multiset: identical. Statement order differs (expected, moves).
   - Own method B: `git diff v0.16.1 -- backend/plugin/azdo-remote-config.ts`, sorted multiset of non-comment,
     non-blank `+` lines vs `-` lines: 131 vs 131, identical.
   - Own method C: check-fr11's own `stripComments` applied to base and head: whitespace-free stripped length
     39538 vs 39538, same import specifier list (`node:child_process,node:fs,node:os,node:path`), no `require(`,
     zero `/*` or `*/` left after stripping.
   - Reordered runtime (non-hoisted) top-level statements reviewed one by one: all initialisers are literals,
     `Symbol(...)`, `Object.freeze([...])` of constants, or lazy arrow functions; the only intra-constant
     dependency chain (`AZ_RESOURCE` -> `AZ_TOKEN_ARGS` -> `AZ_COMMAND_LINE`) keeps its order. No side-effect order
     change, no TDZ hazard.
2. Module-load safety: fresh `node` process import -> exports `PLUGIN_ID, SUPPORTED_KILO_RANGE, __internals, default`;
   default `{ id, server }` with `server` a function returning `{ config }`; `__internals` keys exactly the six.
   No ReferenceError/TDZ, no stderr.
3. JSDoc content: ASCII only (0 non-ASCII bytes in all added lines); URLs only `https://dev.azure.com/` and
   placeholder forms (`<org>/<project>/...`); no tokens, keys, org names or credentials (regex scan for PAT/JWT/AWS/
   Slack/GitHub/private-key patterns: none). AST comment walk: 44 block comments, 66 line comments, 0 nested `/*` or
   `*/`. `AZ_RESOURCE` GUID is the public, well-known Azure DevOps resource ID (pre-existing code, not a secret).
4. Lint exactness: `npm run lint` PASS. Negative controls on temp roots (`--root`): a non-node import placed directly
   after the last JSDoc block -> FAIL as expected; `require(` placed after the first JSDoc block -> FAIL as expected;
   the same import/require text placed INSIDE a JSDoc block -> PASS (correctly ignored). The stripper is still exact.
5. Security-claim accuracy: spot-checked 16 hot paths against the code and with live probes (see Findings):
   readContentType, codeForStatus, isJsonMediaType, performRequest, runFetch, fetchRemoteConfig, findPat,
   basicHeader, azAuthorization, defaultRunAz, readCappedBody, handleResponse, mergeConfig, applyShared, writeCache,
   readCache, cacheBindingOf, makeLogger, hintFor, executeHook, runConfigHook, resolveSettings, parseJsonc.
   Probes confirmed TRUE: parseJsonc errors never echo input (7 malformed inputs with a marker); resolveSettings
   never throws on a fully hostile Proxy (options and env) and keeps `pat` non-enumerable; fetchRemoteConfig on a
   hostile Proxy -> `invalid-settings`; a full hook run with a PAT and a 401 logs no PAT, host, org or URL;
   codeForStatus never reads the body; performRequest headers/redirect/single request as documented.
   Three claims are FALSE or overstated (findings 1-3).
6. New tool `backend/tools/compare-plugin-shape.mjs`: `execFileSync("git", [...])` without a shell; `REF_PATTERN`
   `^[A-Za-z0-9][A-Za-z0-9._/-]*$` rejects `--output=x`, `v0.16.1;rm -rf x`, `$(id)`, `-p`, `../../etc`,
   `v0.16.1 x` (exit 2); `node:` imports only; no writes (no stray files after runs); SKIP exit 0 with git absent
   from PATH. Missing/duplicate args -> exit 2.
7. New tests: `source-layout.test.ts` is hermetic (fs read + `spawnSync(process.execPath)` fresh import, no network,
   no writes); `compare-plugin-shape.test.ts` writes only to an `mkdtemp` dir under `os.tmpdir()`.
8. `git diff --stat main -- backend/test` -> only the 2 new files (+472), no existing test modified;
   `backend/tools/check-fr11.mjs` unchanged. `git ls-files --eol` -> `i/lf w/lf` for the plugin, tool and both tests.

## Files changed
- `factory/runs/cycle-0026/04-security.md` - this report (no source modified).

## Verification
- `node backend/tools/compare-plugin-shape.mjs --base-ref v0.16.1` -> PASS, exit 0.
- Independent AST token-multiset compare (TypeScript 5.9 parser) -> identical, 0 diffs.
- Non-comment `+`/`-` line multiset of `git diff v0.16.1` -> identical (131/131).
- Fresh-process import -> OK, exports/default/`__internals` as above.
- `npm run lint` -> `check-fr11: PASS`; 3 lint controls behave as expected.
- `bash scripts/ci.sh` -> exit 0 (`tests 724, pass 714, fail 0, skipped 10` - platform skips, pre-existing;
  check-lf PASS; check-docs PASS; `ci: PASS`).
- `npm audit --omit=dev --audit-level=high` -> 0 vulnerabilities; full `npm audit` -> 0 vulnerabilities.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | medium | `backend/plugin/azdo-remote-config.ts:1217` and `:1278` | New JSDoc claims `readCappedBody` "never throws" and `handleResponse` "never throws, even for hostile response objects". FALSE: `chunk instanceof Uint8Array` (l.1236) and `chunk.byteLength` (l.1240) are unguarded. Probe via `__internals.fetchRemoteConfig` with an injected fetch whose reader yields (a) a Proxy with a throwing `getPrototypeOf` trap or (b) a `Uint8Array` subclass with a throwing `byteLength` getter: both escape handleResponse and surface as `network` from fetchRemoteConfig's outer catch instead of the documented `bad-response`. No runtime impact today (outer catch holds, real fetch yields genuine Uint8Arrays), but it is an inaccurate adversarial-robustness invariant in the artefact this cycle ships, violating the AC "JSDoc must describe the CURRENT code"; a maintainer trusting it could drop the outer guard. | Comment-only edit. readCappedBody: replace "never throws;" with "does not throw for chunks a real fetch produces; a hostile injected chunk (throwing prototype lookup or byteLength getter) can throw and fetchRemoteConfig maps that to network;". handleResponse: replace "never throws, even for hostile response objects" with "every read of status, headers and body.getReader/cancel is guarded; a throw from a hostile chunk in readCappedBody propagates and fetchRemoteConfig maps it to network". Re-run compare-plugin-shape afterwards. |
| 2 | low | `backend/plugin/azdo-remote-config.ts:1880` | runConfigHook JSDoc: "every failure ends as the fixed LOG_UNEXPECTED message". Inaccurate: expected failures (fetch error, cache miss, merge failure, bad config) end with their own L-NONE/L-CACHE/L-MERGE/L-BADCONFIG lines; only an unexpected throw from executeHook produces LOG_UNEXPECTED. (The v0.16.1 comment said "a fixed log message", which was correct.) | Comment-only: "never rejects (FR-10): an unexpected throw from executeHook is caught and logged as the fixed LOG_UNEXPECTED message; every failure leaves the config unchanged or fully merged; no secret, URL, host or config value appears in any log (AC-9)." Fix in the same rework pass as #1. |
| 3 | low | `backend/plugin/azdo-remote-config.ts:512` | mergeConfig JSDoc: "it THROWS only for over-deep or cyclic shared input". Overstated (carried over from the v0.16.1 comment): probe shows it also throws when the target rejects a write (`Object.freeze({})` target -> TypeError) or a target property getter throws. applyShared contains this, so no impact. | Comment-only: "it throws for over-deep or cyclic shared input and when the target rejects a write (frozen or non-extensible target, non-configurable property or throwing getter);". Fix in the same rework pass. |
| 4 | info | `backend/tools/compare-plugin-shape.mjs:271-281` | Any `git show` failure (including a mistyped or unfetched ref, e.g. a shallow CI clone without tags) prints SKIP and exits 0, not only "git missing". Fail-open for a proof tool; documented and tested as designed, manual-only, not in ci.sh. | None for this cycle (backlog). |

## Assumptions made (no human available)
- Base ref `v0.16.1` used for the proof; verified the plugin is byte-identical between `v0.16.1` and `main`.
- Finding 1 rated medium (not low) because the item's acceptance criteria require the JSDoc to describe the current
  code, the false statement is a newly authored robustness/security invariant, and the fix is a cheap comment-only
  edit in code touched this cycle; per the gate rules that is a FAIL.
- Findings 2 and 3 alone would be backlog items; they are listed as required fixes only because the rework pass for
  #1 touches the same JSDoc and costs nothing extra.

## Follow-ups for the backlog
- compare-plugin-shape: distinguish "git not installed" (SKIP) from "ref not found / git error" (exit 2), or require
  an explicit `--allow-skip` (finding 4).
- Optional hardening (behaviour change, separate item): guard `instanceof`/`byteLength` in readCappedBody via
  `attempt` so hostile chunks yield `bad-response`, after which finding 1's original wording would become true.

FACTORY_RESULT
status: FAIL
report: factory/runs/cycle-0026/04-security.md
summary: Zero-behaviour change independently proven (AST token multiset, diff line multiset, lint stripper, fresh import, ci PASS, audit clean) but new JSDoc states false invariants (handleResponse/readCappedBody "never throws even for hostile objects"; runConfigHook/mergeConfig overstated) - comment-only fixes required.
