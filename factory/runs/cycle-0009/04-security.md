# Security report — cycle 0009 — F-007: Shared config repo: example kilo.jsonc and validation script

## Inputs read
- `git diff main...HEAD` (22 files; working tree clean)
- `factory/runs/cycle-0009/02-architect.md` (security notes), `03-backend.md`
- `docs/architecture/ADR-0010-shared-config-validator.md`, `docs/architecture/contracts/validator-cli.md`
- `backend/validator/kilo-config-rules.ts`, `backend/validator/validate-kilo-config.ts`,
  `backend/validator/kilo-schema-subset.json`, `backend/shared-config/kilo.jsonc`,
  `backend/tools/check-fr11.mjs`, `backend/test/validator/*`, `backend/test/tools/check-fr11.test.ts`
- `backend/plugin/azdo-remote-config.ts` (`parseJsonc`, `resolvePlaceholders`), read only. Not in the diff.

## Work done
Checked each point the Architect listed:

| Concern | Result |
|---|---|
| Placeholders are not resolved against the real env or filesystem | OK. `resolvePlaceholders` gets all three deps as fakes (`env: {}`, `homedir: () => "/probe-home"`, `readFile: () => "probe"`). The plugin's default `process.env`, `os.homedir` and `readGuardedFile` are never reached. `env` lookup uses `hasOwnProperty`. Only the count of `file:` entries is used. Names and paths are never printed. |
| No execution, no network | OK. The validator imports only `node:fs` and the plugin `__internals`. It has no `child_process`, `fetch` or `net`. Importing the plugin module has no side effects at load time. |
| 1 MiB size cap before reading | OK. `statSync` runs, then the file is read only if `isFile()` and `size <= 1 MiB`, and `validateConfigBytes` checks the size again. A 1,048,590-byte file gives `file-too-large`. A non-regular file gives `io-error`. |
| Strict UTF-8 | OK. Uses `TextDecoder("utf-8", {fatal: true})`. |
| Depth cap 64 | OK. `exceedsDepth` is iterative, and the recursive `walkTree` and schema walks run only after it passes. Probes: a 1,000,000-character `[` run gives `invalid-jsonc` (no stack overflow). A balanced 500k-deep nesting under 1 MiB gives `too-deep`, exit 1. |
| No values, URLs or placeholder paths in output; no stack traces | OK. Messages are fixed text. Parser errors are value-free (`jsoncError` uses only line and column, and `JSON.parse` messages are replaced by "malformed JSON"), and the CLI prints them only with the `Invalid JSONC: ` prefix. Probes with a secret inside malformed JSON printed only `malformed JSON` plus `line 1`. I/O errors print only `err.code` matching `^[A-Z0-9_]+$`. `main()` catches everything and prints a fixed "internal error". |
| Secret keys redacted | OK. A JSON-escaped key `sk-bf-...` was printed as `[<redacted>]`. A value got a path only, and a comment got `line N`. |
| Control characters sanitised | OK for C0, DEL and C1 in keys and file names (`ESC[2J` in a file name printed as `?[2J`). See finding 1 for Unicode format characters. |
| `Object.prototype` not polluted | OK. Reads use own descriptors only and nothing is written. Probe with `__proto__`, `constructor.prototype` and `provider.__proto__.options.baseURL`: all reported as `prototype-key`, and nested `apiKey` and `base-url-host` were still detected under `__proto__`. The test suite pins that `Object.prototype` is unchanged. |
| `--allowed-hosts` and userinfo | OK. `https://allowed.com:8443@evil.com/`, `https://evil.com\@allowed.com/`, `https://allowed.com%2eevil.com/` and the trailing-dot `allowed.com.` were all rejected. Upper-case `ALLOWED.com` is accepted (correct, because `URL` normalises it). Host-list grammar is strict ASCII DNS labels. |
| Secret scan of keys, values and comments | OK. Tree check covers keys and values (after JSON unescape). The raw line scan covers comments and still runs after a parse failure. |
| No secrets in test literals | OK. `FAKE_SECRET` is built at runtime (`"sk-" + "bf-" + ...`). The only `sk-bf-` literals added are the non-matching placeholders `sk-bf-...` and `sk-bf-<your-key>`. `kilo.jsonc` has no `apiKey` and no `sk-bf-`. |
| check-fr11 rule 5 | OK within known limits. The allowlist regexes are anchored, and `../../x.ts`, `../plugin/other.ts`, bare packages and `require(` are rejected. Remaining evasions are the known T-002 class plus non-recursive directory scanning (finding 2). |
| Plugin file unchanged | OK. `backend/plugin/` is not in the diff, and the export surface is pinned by tests. |

## Verification
- `bash scripts/ci.sh` gives `ci: PASS`: 315 tests, 314 pass, 0 fail, 1 skipped (pre-existing).
- `npm audit --omit=dev --audit-level=high` (backend) reports 0 vulnerabilities. No new dependencies.
- Secrets grep over the added diff lines (AKIA, ghp_, private keys, password=, bearer, xox, sk-bf- with an alphanumeric next character): no real secrets, and no `.env` files.
- Adversarial CLI probes (scratchpad): deep nesting, oversize file, escaped secret keys and values, a secret inside malformed JSON, prototype keys, URL-confusion baseURLs, and control and bidi characters in keys and file names. Results are listed in the table above.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | low | backend/validator/kilo-config-rules.ts:71-78 (and validate-kilo-config.ts:32-39) | `sanitize` / `cleanName` replace only C0, DEL and C1. Unicode format and line characters pass through unchanged into the CI log, for example U+202E RIGHT-TO-LEFT OVERRIDE, U+2028/U+2029 and zero-width characters. A crafted key can visually reorder a finding line, or start a new line in some log viewers (Trojan-Source-style log spoofing). Exit code and gate result are not affected. | Also replace U+2028, U+2029, U+200B-U+200F, U+202A-U+202E, U+2066-U+2069 and U+FEFF with `?`, or more simply anything with `\p{Cf}` / `\p{Zl}` / `\p{Zp}`. Add a test. |
| 2 | low | backend/tools/check-fr11.mjs:35 | Rule 5 scans only `.ts` files directly in `validator/` (`readdirSync` is not recursive). A file at `validator/sub/x.ts` could import npm packages unchecked. It is not reachable from the allowed sibling regex, but tsconfig includes `validator/**/*.ts`. There are also the known T-002 evasions (`/*` in strings, `import(variable)`, template literals), and any `node:` builtin is allowed (for example `node:child_process` and `node:net`). | Fold into T-002: scan `validator/` recursively (or fail if subdirectories exist). Optionally narrow validator `node:` imports to a list (`node:fs`, `node:path`, `node:url`). |
| 3 | info | backend/validator/validate-kilo-config.ts:83-85 | Stat-then-read (TOCTOU). A file that grows between `statSync` and `readFileSync` is read in full before the second size check. `statSync` also follows symlinks, so a symlinked PR file would be read from its target. Output stays value-free, but `secret-pattern at line N` gives a small oracle on the target's contents. In CI the input is a checked-out tree, so there is no realistic race. | Optional: `openSync` + `fstatSync` + a read bounded to 1 MiB + 1 byte, and `lstatSync` to reject symlinks (the same fix as noted in ADR-0004). |
| 4 | info | backend/validator/kilo-config-rules.ts:257-265 | `base-url-host` is opt-in and does not check the port. Without `--allowed-hosts`, an `http:` baseURL or any host passes. | F-008 must pass `--allowed-hosts <bifrost host>` in the pipeline, as the Architect already noted. |
| 5 | info | backend/validator/kilo-config-rules.ts:80-86 | Object keys are printed in locations, and only keys matching `sk-bf-` are redacted. A non-Bifrost secret used as a key (for example a PAT) would be echoed. This is by contract (FR-13 pattern only). | None now. Consider a generic high-entropy key heuristic later. |

No critical, high or medium findings.

## Assumptions made (no human available)
- Printing input-derived keys in locations is accepted by the contract (validator-cli.md section 4). Only `sk-bf-` keys must be redacted.
- Allowing any `node:` builtin in `validator/` matches the existing plugin rule, so it is treated as within the T-002 scope and not as a new gap.

## Follow-ups for the backlog
- Unicode format-character sanitising in validator output (finding 1).
- T-002 extension: recursive `validator/` scan and an optional `node:` allowlist (finding 2).
- Bounded `open` + `fstat` read and symlink rejection in the validator CLI (finding 3).
- F-008: wire `--allowed-hosts` in `azure-pipelines.yml` (finding 4).

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0009/04-security.md
summary: F-007 validator passes security gate; 0 critical/high/medium, 2 low (Unicode bidi/line-separator chars not sanitised in output; rule 5 non-recursive + T-002 gaps), 3 info
