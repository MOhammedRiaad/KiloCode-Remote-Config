# Backend report — cycle 0009 — F-007

## Work done
BE-1..BE-6 implemented per ADR-0010 and contracts/validator-cli.md. The plugin file is untouched.

## Files changed
- backend/shared-config/kilo.jsonc (new)
- backend/validator/kilo-schema-subset.json, kilo-config-rules.ts, validate-kilo-config.ts (new)
- backend/tsconfig.json (include validator/**), backend/tools/check-fr11.mjs (rule 5)
- backend/test/validator/{helpers.ts,example-config,cli,rules,schema-subset}.test.ts (new)
- backend/test/tools/check-fr11.test.ts (extended)

## Acceptance criteria -> tests
- AC1 example config valid, with and without --allowed-hosts: example-config.test.ts (first 4 tests)
- AC2 apiKey anywhere: cli.test.ts "AC2"
- AC3 sk-bf- secrets in values/arrays/comments: cli.test.ts "AC3", rules.test.ts (escaped secret, no value echo)
- AC4 malformed input / non-object root / usage / io: cli.test.ts "AC4" tests, rules.test.ts
- AC5 schema subset pinned and enforced: schema-subset.test.ts
- AC6 {file:} placeholders: cli.test.ts "AC6"
- AC7 prototype keys, host allowlist, plugin warning: cli.test.ts "AC7"
- AC8 multi-file, no plugin change, lint rule 5: cli.test.ts "AC8", example-config.test.ts, check-fr11.test.ts

## Verification
- `bash scripts/ci.sh` -> exit 0 (315 tests, 314 pass, 0 fail, 1 skipped pre-existing; "ci: PASS")

## Assumptions / notes
- Depth boundary tested as: root object plus 63 nested arrays allowed, 64 too deep (container level >= 64).
- Added exported helper `fileTooLargeFinding()` in the rules library so the CLI can report oversize files without reading them.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0009/03-backend.md
summary: F-007 validator CLI, rules library, schema subset, example config, lint rule 5 and tests; ci.sh passes
