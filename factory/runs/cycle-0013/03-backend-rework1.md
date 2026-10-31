# Backend rework 1 (cycle 0013, F-019)

Status: PASS

## Finding 1 (medium) fixed
backend/test/installer/smoke.test.ts, last block of the "globalThis.fetch at call time" test: replaced `null` deps with `{ env: {}, fetch: 42, runAz: 42 }` and installed a rejecting guard fetch. Asserts azdo fail, bifrost skipped/azdo-failed, and 0 guard fetch calls. Original fetch restored in finally.

## Scan of other tests
All other runSmoke calls pass an injected fetch plus PAT or a fake runAz. install-smoke.test.ts runs the installer in a sandbox with scenario-injected fetch and PAT or a fake az. No other path reaches real fetch, az or home.

## Verification
`bash scripts/ci.sh` exit 0: 405 tests, 401 pass, 0 fail, 4 skipped; check-lf PASS. No product code changed.
