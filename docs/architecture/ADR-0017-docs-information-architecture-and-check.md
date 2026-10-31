# ADR-0017: User and operator docs structure and the automated docs check
- Status: accepted
- Date: 2026-10-31
- Cycle / item: cycle-0018 / F-016
- Contract: `contracts/docs-check.md` 1.0.0
- Amends: ADR-0001 sections 3, 7 and 8 (one more zero-dependency tool in `backend/tools/`)

## Context

F-016 adds three task-oriented pages: `docs/engineer-setup.md`, `docs/platform-runbook.md` and
`docs/troubleshooting.md`. The repo already has reference docs. `docs/user-guide.md` holds the
settings, merge, cache, log messages, validator, shared config repo, personal config template, and
installer flags, exit codes and smoke codes. `docs/development.md` holds contributor notes and the
manual Phase 0 list. `docs/api.md` documents `__internals`. `README.md` doubles as the factory README
and the product overview.

The six acceptance criteria call for an automated check wired into `bash scripts/ci.sh`. It needs
negative controls built from fixtures and must not hard-code the supported Kilo range.

User decisions apply. F-012 and F-013 (key provisioning, offboarding) and F-015 (per-team files) are
skipped. The new pages must not describe them. Bifrost virtual keys are issued and disabled by hand by
the platform team.

Constraints:
- ADR-0001: Node >= 22.18, zero runtime dependencies, `node:test`, no ESLint, gate is `scripts/ci.sh`.
- FR-11: the plugin file must not change. The check reads `SUPPORTED_KILO_RANGE` as text and never
  imports the plugin.
- Lanes: docs-writer owns `README.md` and `docs/**` except `docs/architecture/**`. ci-releaser owns
  `scripts/ci.sh`. senior-backend owns `backend/**`.
- Phase order: Implement -> Security -> Review -> PR -> **Docs** -> Release. The real pages are
  written only in phase 6, after both gates.

## Decision

### 1. Information architecture: new pages are task guides, user-guide stays the reference

| Page | Audience | Role | Rule |
|---|---|---|---|
| `docs/engineer-setup.md` | engineers | ordered "get working" guide | Links to user-guide sections for flag tables, exit codes and settings. Does not copy them. |
| `docs/platform-runbook.md` | platform team | procedures and checklists | Canonical home of the Phase 0 checklist, repo/pipeline/policy procedure, permission hardening, config-change procedure and key statement. Links to user-guide for flag/exit tables. |
| `docs/troubleshooting.md` | both | symptom -> cause -> fix | Links to user-guide for the full log-message and smoke-code tables. Owns KILO_PURE, auth, cache and installer-exit guidance. |
| `docs/user-guide.md` | both | reference (unchanged structure) | Keeps its sections and anchors. Short pointers are added to the new pages. The stale "Not yet available ... PR gate (F-008)" line is fixed. |
| `docs/development.md` | contributors | dev notes | "What stays manual (Phase 0)" stays (anchor kept). It gains a line that the runbook is the canonical checklist. |
| `README.md` | everyone | entry point | Links to all three pages (product section "More:" line and "Still manual (Phase 0)"). |

Nothing is moved out of `user-guide.md`. Existing anchors (`#setting-up-the-shared-config-repo-platform-engineers`,
`#installing-on-windows-engineers`, ...) stay valid, and link churn is kept small. Small, deliberate
duplication is accepted where an acceptance criterion requires the text to be on the page. Examples:
the install commands, the permission names, the cache path and `KILO_PURE=1`. Tables are never
duplicated.

The new pages carry no factory-process content. The GitHub-origin/remote-mode PR flow is covered by
the root README.

### 2. Location of the check: `backend/tools/check-docs.mjs` (senior-backend)

The check is a zero-dependency Node ES module next to `tools/check-fr11.mjs`. Its tests,
`backend/test/tools/check-docs.test.ts`, are hermetic (temp-dir fixtures) and run in `npm test`.
ci-releaser adds one line to `scripts/ci.sh` (`node backend/tools/check-docs.mjs`) that runs it
against the real repository.

Why this placement:
- **No lane violations.** The tool and tests are in senior-backend's lane, the wiring is in
  ci-releaser's, and the pages are in docs-writer's.
- **Gate coverage.** The security and review gates (phase 4) see the tool and its tests. A tool
  under `scripts/` would only appear in phase 7, after both gates.
- **Ordering.** The unit tests are fixture-based, so `npm test` passes before the real pages exist.
  The real-repo run is added to `ci.sh` only in phase 7, after docs-writer has written the pages
  (phase 6). Docs-writer must run the tool itself and get exit 0 before it reports PASS.
- **Precedent.** `check-fr11.mjs` is already a plain `.mjs` repo guard in `backend/tools/`, tested by
  `test/tools/check-fr11.test.ts` through `spawnSync`.

Consequence for the orchestrator: although `scope.backend` is `false` (no product code), the
Backend task list is not empty. senior-backend must be dispatched for it in phase 3.

The tool is **not** added to `npm run lint`. If it were, the backend lint would fail on the real repo
until phase 6. The single real-repo invocation is in `scripts/ci.sh`.

### 3. Check rules (exact definitions in the contract)

- Required files: `README.md` and the three pages.
- Cross-links: each page links to the other two, and README links to all three, through relative
  links that resolve.
- Every relative link in `README.md` and `docs/**/*.md` must resolve to an existing file or directory
  inside the root. A `#fragment` on a `.md` target, or a same-file `#fragment`, must match a GitHub
  heading slug in the target. External links (any URL scheme) are not fetched.
- Required content per page (phrases, raw regexes, heading phrases). The Kilo range is read at check
  time from `backend/plugin/azdo-remote-config.ts` with a text regex.
- Secret scan over `README.md` and every `*.md` under `docs/`, recursively, including
  `docs/architecture/`: `/sk-bf-[A-Za-z0-9]{16,}/i`. Nothing is excluded. The matched text is never
  printed.
- Forbidden content in all three new pages: `provision`, `offboard`, `teams/` or `teams\`, `per-team`
  (case-insensitive). This applies to all three pages, not only the two named in the AC: it is the
  conservative choice, and troubleshooting has no need for these words. `user-guide.md` and
  `development.md` are not covered, because they correctly describe the validator's existing
  `teams/*/kilo.jsonc` behaviour and the generic `path` setting.
- All failures are collected and reported (not fail-fast). Exit codes: 0 pass, 1 any failure,
  2 usage or internal error.

### 4. Line endings

`.md` files are not covered by `.gitattributes`. A Windows checkout with `core.autocrlf=true` may
produce CRLF. The tool splits on `\r?\n` and normalises whitespace, so CRLF and LF give identical
results (a test covers this). `scripts/check-lf.sh` stays as it is: it guards `scripts/*.sh`, where
a CR breaks bash. `.mjs` and `.md` are not affected by CR bytes. No `.gitattributes` change is needed.

### 5. Existing docs fixed by this item

`contracts/validator-cli.md` section 4 used `sk-bf-` followed by 16 alphanumerics as an example of
a matching secret. The new scan would flag it. The example is shortened to
`sk-bf-AbCd1234`, which still matches the validator's `/sk-bf-[a-z0-9]/i`, so the meaning is
unchanged. A prototype of the rules run over today's README and `docs/**` found no other secret hit
and no broken relative link or anchor.

## Consequences

- One extra Node invocation in the gate, with a negligible runtime.
- Docs authors must keep certain fixed phrases on the pages (listed in the contract). This is
  deliberate: the check stays deterministic and reviewable.
- If `SUPPORTED_KILO_RANGE` changes, the gate fails until `engineer-setup.md` is updated. This is
  the intended drift guard.
- Renaming a heading that other docs link to now breaks the gate. Fix the link, not the check.
- FR-11 is unaffected. The plugin file is read, not modified or imported. Lint rule 8 covers only
  `tools/*.ts`, so `check-docs.mjs` is not lint-checked. Its `node:`-only imports are enforced by
  review, the same as for `check-fr11.mjs`.

## Alternatives considered

- **`scripts/check-docs.mjs` plus tests under `scripts/` (ci-releaser).** Also has no lane
  violations. Rejected: ci-releaser runs after the security and review gates, so the code would
  ship ungated. It would also need a second test runner invocation in `ci.sh`.
- **`scripts/check-docs.mjs` written by senior-backend.** A lane violation. Rejected.
- **Markdown link checker from npm (markdown-link-check, remark).** Adds dev dependencies
  (ADR-0001 section 4 requires a new ADR for each) and network access. Rejected.
- **Free-form semantic checks (for example "mentions CI near KILO_PURE").** Not deterministic.
  Rejected in favour of fixed phrases.
- **Moving the platform sections from `user-guide.md` into the runbook.** Cleaner, but it breaks
  anchors that the README, development.md and earlier reports use. Deferred as a possible follow-up.
