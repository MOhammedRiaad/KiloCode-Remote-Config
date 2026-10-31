# Product Owner report — cycle 0016 — F-014: End-to-end simulated startup test

## Inputs read
- `factory/VISION.md` (vision defined; no template marker)
- `factory/backlog.json`, `factory/state.json` (cycle 16, last release v0.12.0)
- `factory/runs/cycle-0015/*` (summary, security, review, PR, docs and release-prepare follow-ups)
- `backend/plugin/azdo-remote-config.ts` export surface, `backend/test/installer/fixtures/fake-network.ts`, `backend/installer/install.sh` usage line (to make sure the acceptance criteria can be tested)

## Work done
- The user decision still applies. F-012 and F-013 stay `blocked` with their "SKIPPED by user instruction" note. I did not select them, split them or add any key-provisioning items.
- Cycle 0015 follow-ups were already in the backlog: T-023 (policy idempotency), T-024 (leading `@` / usage printf / assemble tests), T-025 (real-org policy semantics) and the F-016 runbook notes (bypass/edit-policy permissions). Nothing new needed adding.
- Security triage: cycle 0015 reported no critical, high or medium findings. The open security-sourced items are all low or info and stay at priority 3 or lower: T-013 (cache bound to settings, low), T-019 (installer TOCTOU, low), T-024 (`@` file expansion, low; the policy script is run by trusted platform engineers). None of them outranks the critical path.
- Remaining vision work: F-014 (end-to-end verification of AC-1/2/3/4/6/7/9/10/12), F-015 (optional per-team files, FR-15) and F-016 (docs). Not DONE.
- I picked **F-014**. I raised its priority from 3 to 2, set it to `in_progress`, added F-010 to its dependencies (the test drives install.sh), wrote a full description (test-only, with a Kilo start simulator that loads the *installed* plugin and personal config and reuses the F-019 fake-network preload) and replaced the 3 vague acceptance criteria with 8 Given/When/Then criteria. Doing F-014 before F-016 means the docs can describe a flow that has been verified.

```json
{
  "id": "F-014",
  "title": "End-to-end simulated startup test",
  "type": "feature",
  "priority": 2,
  "status": "in_progress",
  "scope": { "backend": true, "frontend": false },
  "depends_on": ["F-006", "F-007", "F-010", "F-019"],
  "description": "Vision AC-1 / AC-2 / AC-3 / AC-4 / AC-6 / AC-7 / AC-9 / AC-10 / AC-12, simulated end to end (startup sequence steps 1-7). Cycle 0016 PO: priority raised to 2 (critical path; last vision verification slice before docs). TEST-ONLY item: a new node:test suite (PO default backend/test/e2e/; Architect fixes the location and records the harness design in an ADR or contract note) that chains the shipped pieces exactly as an engineer's machine would: (1) run backend/installer/install.sh in a child bash process with a temp HOME (and USERPROFILE), an allow-listed env, AZDO_PAT and KILO_BIFROST_KEY set (so no az is needed); (2) a test-only 'Kilo start simulator' (child Node process, test code under backend/test/, never product code) that reads the INSTALLED personal config `<home>/.config/kilo/kilo.jsonc` with the plugin's parseJsonc, resolves each plugin entry path relative to the Kilo global config dir, dynamically imports the INSTALLED plugin file `<home>/.config/kilo/azdo/azdo-remote-config.ts` (not the backend/ source), calls its default export's `server(input, options)` with the entry's options and a capturing fake logger, runs the returned `config` hook on the parsed personal config, and writes the resulting config and captured log records to a file/stdout for assertions. Network is faked with the F-019 preload (backend/test/installer/fixtures/fake-network.ts via --import, scenario file per start); the Architect may extend that fixture (e.g. a Bifrost answer that returns 401 unless `Authorization: Bearer <expected key>` matches, and a way to change the AzDO content between starts) but it stays under backend/test/. The plugin reads its cache from `<temp home>/.cache/kilo-azdo/`; tests never touch the real home directory, real network, real az or real Kilo. When bash is unavailable the suite skips with a clear message. Product files (backend/plugin/, backend/validator/, backend/installer/, backend/personal-config/, backend/shared-config/, backend/tools/) are NOT changed; if a product defect is found the engineer records it as a finding instead of weakening the test. Zero runtime npm deps (FR-11).",
  "acceptance_criteria": [
    "Given a fresh temp HOME, install.sh run with --org/--project/--repo, AZDO_PAT, KILO_BIFROST_KEY and --no-smoke, and a fake AzDO Items API serving backend/shared-config/kilo.jsonc, When the Kilo start simulator loads the installed personal config and the installed plugin and runs its config hook, Then the resulting config has provider.bifrost.options.baseURL equal to the shared value, provider.bifrost.models with keys `azure/gpt-5` and `azure/gpt-5-mini`, provider.bifrost.options.apiKey equal to KILO_BIFROST_KEY, and exactly one AzDO request was sent to the dev.azure.com Items API with the installed org/project/repo, path `/kilo.jsonc`, branch `main` and api-version=7.1 (AC-1, simulated).",
    "Given the installed personal config, When the simulator resolves its plugin entries, Then exactly one entry resolves to `<home>/.config/kilo/azdo/azdo-remote-config.ts`, the plugin server is invoked exactly once per simulated start, and nothing exists under `<home>/.config/kilo/plugin/` or `plugins/` (AC-12).",
    "Given a first successful simulated start, When the shared file served by the fake AzDO is changed (e.g. a new model `azure/gpt-5-nano` added and a top-level `small_model` value changed) and the simulator starts again with no installer re-run, Then the new model and value are in effect, every other resulting key deep-equals the first start's result, the personal config and installed plugin file are byte-identical to before, and `<home>/.cache/kilo-azdo/remote-config.json` holds the new shared content (AC-2).",
    "Given a successful start has written the cache, When the next start's fake AzDO fails (request throws, and separately returns HTTP 500), Then the resulting config deep-equals the result of the successful start and a warn-level record with service `azdo-remote-config` was logged; and Given a fresh install with no cache and a failing fake AzDO, When the simulator starts, Then the resulting config deep-equals the installed personal config as parsed (local config only), an error-level record was logged, and the simulator exits 0 (AC-3, AC-4, FR-10).",
    "Given a personal config edited after install to add a local top-level `model: 'local-model'` and a shared file that sets `model: 'azure/gpt-5'`, When the simulator starts with the installed mode `defaults` and again after re-running install.sh with --mode enforce, Then defaults keeps `local-model`, enforce yields `azure/gpt-5`, and in both runs provider.bifrost.options.apiKey still equals KILO_BIFROST_KEY even if the shared file carries an `apiKey` (AC-6, AC-7).",
    "Given a fake Bifrost that enforces auth (401 unless `Authorization: Bearer <the engineer's key>`), When install.sh runs with smoke enabled and the matching KILO_BIFROST_KEY, Then it prints `smoke bifrost: pass` and exits 0; When it runs with a different key (simulating another or a disabled key), Then it prints `smoke bifrost: fail 401` and exits 4 with the installed files unchanged; and When a request to `<baseURL>/models` without an Authorization header is sent through the same fake, Then it gets 401 (AC-10, simulated).",
    "Given every scenario above with KILO_BIFROST_KEY `sk-bf-AbCdEf1234567890` and AZDO_PAT set to a sentinel, When all installer stdout/stderr, simulator stdout/stderr and every captured logger record are serialised, Then none contains the key, the PAT sentinel or the base64 Basic credential (AC-9).",
    "Given the repository after the change, When `bash scripts/ci.sh` (including the FR-11 lint) runs, Then it exits 0 and runs the new end-to-end suite (or skips it with a clear message when bash is unavailable), all existing suites still pass, no real network or az call is made, backend/package.json has no runtime `dependencies`, and backend/plugin/, backend/validator/, backend/installer/, backend/personal-config/ and backend/shared-config/ are unchanged."
  ],
  "source": "vision",
  "cycle_done": null
}
```

## Files changed
- `factory/backlog.json`: F-014 is now `in_progress` at priority 2, with a new description, an added F-010 dependency and 8 acceptance criteria.

## Verification
- `node -e "require('./factory/backlog.json')"`: the JSON is valid. Exactly one item (F-014) is `in_progress`, and it has 8 acceptance criteria.
- `backend/installer/install.sh` accepts `--mode defaults|enforce` and `--no-smoke`, which the acceptance criteria rely on.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|

## Assumptions made (no human available)
- F-014 tests behaviour only. It verifies the shipped product and must not change product code. If it finds a defect, that is recorded as a finding or follow-up instead of being fixed under this item, so the slice stays small.
- A Node child process that loads the installed plugin stands in for Kilo. Real Kilo, real Bifrost and VS Code cannot run in CI. The real AC-1 (CLI `/models` and the VS Code listing) is still a Phase 0 manual check, which F-016 will document.
- "Disabled key" in AC-10/AC-11 is simulated as a key the fake Bifrost rejects. Key provisioning (F-012/F-013) stays skipped by user instruction.
- install.sh, not install.ps1, drives the end-to-end flow, because CI runs bash. Parity of install.ps1 is already covered by the F-011 tests.
- The open low-severity security items (T-013, T-019, T-024) stay at priority 3. No high or critical findings are open.

## Follow-ups for the backlog
- After F-014, the next candidates are F-016 (docs, priority 3) and then F-015 (per-team configs, priority 4, optional per FR-15). Security tech-debt T-013, T-019 and T-024 come next by priority.

FACTORY_RESULT
status: PASS
report: factory/runs/cycle-0016/01-product-owner.md
summary: Selected F-014 (end-to-end simulated startup test, test-only, backend) with 8 testable acceptance criteria; F-012/F-013 remain skipped.
