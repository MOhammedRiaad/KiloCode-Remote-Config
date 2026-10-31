# Code Review report — cycle 0009 — F-007: Shared config repo: example kilo.jsonc and validation script

## Inputs read
- `git diff main...HEAD` (23 files; working tree clean)
- `factory/runs/cycle-0009/01-product-owner.md` (8 ACs), `02-architect.md`, `03-backend.md`, `04-security.md`
- `docs/architecture/contracts/validator-cli.md`, `docs/architecture/ADR-0010-shared-config-validator.md`
- `backend/validator/*`, `backend/shared-config/kilo.jsonc`, `backend/test/validator/*`,
  `backend/tools/check-fr11.mjs`, `backend/test/tools/check-fr11.test.ts`, `backend/tsconfig.json`
- `backend/plugin/azdo-remote-config.ts` (`resolvePlaceholders`, `SUPPORTED_KILO_RANGE`), read only

## Work done
- Ran the full quality gate.
- Mapped each AC to the code and to a test that would fail if the code broke.
- Checked the CLI and library against the contract: arguments, exit codes, output lines, locations, rule ids and messages, the schema subset and how it is loaded, the placeholder probe, and the library API.
- Looked for bugs: the depth boundary, prototype handling, redacting secret keys, `--` handling, the size cap and stat-then-read, the 200-line output cap, and how placeholders are deduplicated (the plugin's `note()` deduplicates by `kind:name`, which matches "one per distinct placeholder per string").
- Checked lanes: the engineer edited only `backend/`. `docs/architecture/` was edited by the Architect and `factory/` by the PO. `backend/plugin/` has no diff, and the export surface is pinned by `example-config.test.ts` "AC8".
- Checked hermeticity: CLI tests write only to `mkdtemp` directories, which are removed in `finally`. Placeholder probing uses fake `env`, `homedir` and `readFile`. No test touches the real home directory, environment secrets or the network. The fake secret is built at runtime.

### AC -> code -> test
| AC | Code | Test(s) |
|---|---|---|
| 1 example valid, content | `shared-config/kilo.jsonc` | `example-config.test.ts` AC1 x4 (child process, with and without `--allowed-hosts`, keys, no apiKey/plugin/sk-bf-) |
| 2 apiKey anywhere | `keyFindings` (rules.ts:224) | `cli.test.ts` AC2 (top, nested, array, APIKEY; path asserted; value sentinel absent) |
| 3 sk-bf- in values, arrays, comments | `valueFindings`, `textSecretFindings`, `renderKey` | `cli.test.ts` AC3, `rules.test.ts` escaped secret / no value echo / scan after parse error |
| 4 parse/shape errors exit 1; usage/I-O exit 2 | `validateConfigText`, `structureFindings`, CLI `parseArgs`/`readFile` | `cli.test.ts` AC4 x4 |
| 5 schema subset enforced and pinned | `kilo-schema-subset.json`, `schemaFindings`, `loadSchemaSubset` | `schema-subset.test.ts` (pin == `SUPPORTED_KILO_RANGE`, 7 violations, unknown keys ok) |
| 6 `{file:}` warnings | `placeholderFindings` | `cli.test.ts` AC6 x2 (5 bad forms warn once, exit 0; 3 good forms silent) |
| 7 prototype keys, member names, allowlist | `keyFindings`, `baseUrlFindings`, `hostAllowed` | `cli.test.ts` AC7 x3, `rules.test.ts` pollution test |
| 8 multi-file, ci, no deps, export surface | CLI `run`, `check-fr11.mjs` rule 5 | `cli.test.ts` AC8 x2, `example-config.test.ts` AC8, `check-fr11.test.ts` validator cases |

### Contract deviation
- `fileTooLargeFinding()` is exported from `kilo-config-rules.ts` but is not listed in contract section 8. Accepted: section 8 says this module is not the plugin and may export functions. The finding it returns is exactly the contracted `file-too-large` row. It also removes a duplicated literal, because the CLI must report oversize files without reading them. A contract doc touch-up is a follow-up for the Architect.

## Files changed
- `factory/runs/cycle-0009/05-review.md` — this report.

## Verification
- `bash scripts/ci.sh` -> exit 0, "ci: PASS" (315 tests, 314 pass, 0 fail, 1 skipped, which was there before; check-lf PASS).
- `git diff main...HEAD -- backend/plugin` -> empty.

## Findings / issues
None block the gate. All are low or info.

| # | Severity | Owner | File:line | Finding | Required fix |
|---|----------|-------|-----------|---------|--------------|
| 1 | low | backend | backend/test/validator/schema-subset.test.ts:43 | `path.replace(/\./g, "\.")`: `"\."` is the string `"."`, so nothing is escaped and the regex `.` matches any character. The CLI-path assertion is slightly looser than intended. It still passes for correct output, and the library assertion on line 37 is exact. | Use `"\\."` (follow-up). |
| 2 | low | backend | backend/test/validator/cli.test.ts:84 | `assert.ok(!r.all.includes("host"))` also scans the temp file path. On a machine whose temp path contains "host" (for example user `ghost`), the test fails even though the code is correct. | Check that the output has no `host/share` / `\\host`, or strip the dir prefix (follow-up). |
| 3 | info | backend | backend/validator/validate-kilo-config.ts:32-39 vs kilo-config-rules.ts:71-78 | `cleanName` duplicates `sanitize`. | Export one sanitiser from the rules library and reuse it (combine with security finding 1, Unicode format characters). |
| 4 | info | architect | docs/architecture/contracts/validator-cli.md section 8 | `fileTooLargeFinding()` is not listed in the library API. | Add it to the contract in a later doc pass. |
| 5 | info | backend | backend/validator/validate-kilo-config.ts:56-62 | `--help` combined with an unknown option is a usage error (exit 2), not help. The contract does not specify this case. | None, or document it. |

## Assumptions made (no human available)
- The extra export `fileTooLargeFinding` is not a contract violation. Section 8 allows extra exports from the library, and the output is unchanged.
- The skipped test is the one that was skipped before this cycle (the engineer and security reports give the same count, and it is outside `test/validator/`).

## Follow-ups for the backlog
- T-015-style test nits: findings 1 and 2.
- Shared output sanitiser plus Unicode `\p{Cf}`/`\p{Zl}`/`\p{Zp}` replacement (finding 3 plus security finding 1).
- Contract section 8: list `fileTooLargeFinding` (finding 4).
- Carry over the security follow-ups: recursive rule-5 scan (T-002), a bounded `fstat` read and symlink rejection, and wiring `--allowed-hosts` into F-008.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0009/05-review.md
summary: F-007 passes review; ci.sh green, all 8 ACs implemented and tested, contract matched (extra export accepted), plugin untouched; 2 low test nits + 3 info as follow-ups
