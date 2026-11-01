# Security report (Re-check 1) - cycle 0027 - T-038: plugin JSDoc trim pass and wording fixes

## Inputs read
- `git show HEAD` (cbcfd39, rework 1) for `backend/plugin/azdo-remote-config.ts`
- `factory/runs/cycle-0027/04-security.md` (first pass: PASS, 1 low + 3 info)
- `factory/runs/cycle-0027/05-review.md`, `factory/runs/cycle-0027/03-backend-rework1.md`
- `git diff main...HEAD --stat`, `git diff --name-only v0.16.2 -- backend`

## Work done
1. Comment-only proof for the rework commit and for the whole cycle:
   - `git diff -U0 HEAD~1 HEAD -- backend/plugin/azdo-remote-config.ts`: changed lines that are not
     ` * ` JSDoc body lines = **0** (three edits at L310, L315-317, L1723, L1791-1793).
   - Whole cycle vs v0.16.2: no changed line outside `/**`, ` *`, `//` lines.
   - `node tools/compare-plugin-shape.mjs --base-ref v0.16.2` (from backend/): 195 declarations,
     10 exports, 6 `__internals` keys, 200 statements identical -> **PASS**.
   - Independent check: TypeScript AST leaf-token stream with JSDoc nodes excluded (CRLF normalised),
     HEAD vs HEAD~1 and HEAD vs v0.16.2: 11011 tokens, **IDENTICAL** in both comparisons.
2. Live probes (scratch script importing `__internals`, injected fetch/env/home, no network):
   - **runConfigHook (L1791-1793)**: shared config with `{file://corp-host.example/share/x}`,
     `{env:SECRET_SET}` (resolved sentinel), `{env:MISSING_ONE}`, `{file:/abs/secret}` (resolved via
     injected reader). Log: `Unresolved placeholders: file://corp-host.example/share/x, env:MISSING_ONE.`
     The UNC-like name appears verbatim (in kind:name form). Logs do not contain the PAT, the resolved
     env or file values, `dev.azure.com`, `https:`, or the org. The fetch URL did contain the host and org,
     so the sanitisation really happens. Resolved values were applied to the config. The statement is TRUE.
   - **resolvePlaceholders default reader (L310, L315)**: the default reads a small regular file
     (trimmed) and a file of exactly 1 MiB. It rejects a file of 1 MiB + 1 byte and a directory. An
     injected readFile is called for both the >1 MiB file and the directory, and its result is used
     (not guarded). UNC-like paths are rejected before any reader is called. The statement is TRUE.
   - **executeHook (L1723)**: all resolved -> no L-UNRESOLVED, exactly one L-APPLIED (last line).
     Unresolved + normal merge -> L-UNRESOLVED, then exactly one L-APPLIED (last line).
     Unresolved + failed merge (frozen config, new key) -> L-UNRESOLVED, then exactly one L-MERGE
     (last line), no L-APPLIED. The statement is TRUE.
3. Format and scope checks: file is 1838 lines (<= 1839); 0 comment lines > 110 chars; 0 `/*` or
   `*/` inside JSDoc bodies; 0 non-ASCII bytes. `git diff --name-only v0.16.2 -- backend` lists only
   `backend/plugin/azdo-remote-config.ts`. `git ls-files .kilo` is empty. `git diff main...HEAD --stat`
   lists only the plugin file and `factory/` files (backlog.json, state.json, cycle-0027 reports).
4. Previous findings re-verified:
   - Low #1 (runConfigHook claimed "no host/URL in any log" although the verbatim placeholder names can
     contain a host): **FIXED**. The comment now limits the claim to secrets, PAT, token, the Azure DevOps
     URL or host, and resolved values. It also says that L-UNRESOLVED names are copied as written and may
     contain paths or hosts. The probe confirms this.
   - Info items from the first pass: unchanged, still informational (no code change this cycle).

## Files changed
- `factory/runs/cycle-0027/04-security-rerun1.md` - this report (no source modified).

## Verification
- `node tools/compare-plugin-shape.mjs --base-ref v0.16.2` -> PASS
- AST token comparison (HEAD vs HEAD~1, HEAD vs v0.16.2) -> IDENTICAL
- Live probes -> all pass (after one probe-harness correction: a frozen config in defaults mode with an
  existing key is a no-op merge, so a new key was used to force L-MERGE)
- `bash scripts/ci.sh` -> exit 0 (724 tests: 714 pass, 0 fail, 10 skipped; check-lf PASS; check-docs PASS;
  ci: PASS)
- Secrets: diff is comment-only; no keys, tokens or `.env` files added. Dependency audit: not applicable
  (no dependency changes).

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| - | - | - | No new findings. The previous low finding (runConfigHook log claim) is fixed and was checked with a live probe. | - |

## Assumptions made (no human available)
- "Verbatim" for the probe means the name text after `file:` / `env:` is copied unchanged. The log line
  uses kind:name form without braces, which matches the contract format.

## Follow-ups for the backlog
- None new. The first-pass info items in 04-security.md stay as they are.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0027/04-security-rerun1.md
summary: Rework 1 is comment-only (shape PASS, AST tokens identical); all three rewritten statements are true per live probes; prior low fixed; ci.sh PASS.
