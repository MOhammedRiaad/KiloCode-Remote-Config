# Security report — cycle 0018 — F-016: User and operator documentation

## Inputs read
- `git diff main...HEAD` (13 files; code: `backend/tools/check-docs.mjs`, `backend/test/tools/check-docs.test.ts`)
- `factory/runs/cycle-0018/02-architect.md`, `03-backend.md`
- `docs/architecture/contracts/docs-check.md`, ADR-0017, the `validator-cli.md` edit
- Rework iteration 0 (first pass). There are no earlier findings.

## Work done
- Read the tool and the tests line by line. Checked imports, I/O, path handling, regexes and output.
- Ran adversarial probes against temp fixtures (scratchpad scripts, nothing in the repo):
  key in link targets, quadratic regex inputs, binary input, an unterminated fence, CRLF, and a
  directory junction that points outside `--root`.
- Ran the tool read-only against the repo root.
- Ran the tool's tests, `npm audit`, and a grep of the diff for secrets.

## Verification
- `node backend/tools/check-docs.mjs` on the repo: exit 1 with exactly 6 findings, all expected
  (3x `page-missing` for the three new pages, 3x README `cross-link`). There is **no `secret-key`
  finding**. The `validator-cli.md` example (`sk-bf-AbCd1234`) and README:64
  (`sk-bf-<your-virtual-key>`) are clean.
- `node --test test/tools/check-docs.test.ts`: 15/15 pass.
- `npm audit --omit=dev --audit-level=high` (backend): 0 vulnerabilities. The diff changes no
  dependency or lockfile.
- Diff secret grep (`sk-bf-` + 16 alphanumerics, private keys, `ghp_`, `AKIA`, passwords): none
  found. There is no `.env` file. The test key is built at run time (`"sk-" + "bf-" + "Ab1".repeat(6)`).
- Confirmed OK:
  - Imports are `node:fs`, `node:path`, `node:process` and `node:url` only. There is no
    `require`/`eval`/`Function`/child_process/network. Nothing is written.
  - The plugin is read as text, never imported.
  - `--root` must be an existing directory, otherwise exit 2. A duplicated `--root` or extra
    arguments also give exit 2.
  - Absolute links (`/`, `\`) are rejected.
  - `..` and percent-encoded traversal (`%2F`, `%5C%5C` UNC, `C%3A`) are blocked. `isInside`
    runs before any `existsSync` or read, so no UNC/SMB access happens.
  - Scheme-like targets (`C:/...`) are treated as external and never touched.
  - The scan uses `lstat`/Dirent, so symlinked files and directories under `docs/` are skipped.
  - Binary input and invalid UTF-8 cause no crash (replacement characters).
  - An unterminated fence is handled.
  - Unexpected errors fail closed with exit 2 and print only `error.code`.
  - The scan covers README.md plus all `docs/**/*.md` (any case of `.md`) with no exclusions,
    and fences are included.
  - The `secret-key` message never echoes the value.
  - Tests are hermetic: they use `mkdtemp` and cleanup in `finally`, never touch the real repo
    tree, and use no network.

## Findings / issues
| # | Severity | File:line | Finding | Required fix |
|---|----------|-----------|---------|--------------|
| 1 | medium | `backend/tools/check-docs.mjs:267` (also `:403`) | **The secret value is printed through `link-broken`.** The message quotes `link.target` verbatim. A key used as a link target or fragment is written in clear to stderr (and so to CI logs), next to the "value not shown" `secret-key` line. Reproduced with `[x](KEY)`, `[x]: KEY`, `[x](#KEY)` and `[x](a.md#KEY)`. All four printed `sk-bf-Zz9Zz9...` in full. This breaks contract section 2: "The output never includes text matched by `secret-key`". The fix is cheap and in code touched this cycle. | Redact at the single output point. In `main()`, apply `message.replace(/sk-bf-[A-Za-z0-9]{16,}/gi, "sk-bf-<redacted>")` to every finding message before writing. A stricter `/sk-bf-[A-Za-z0-9]+/gi` is also acceptable. This also covers the `kilo-range` message, which echoes text from the plugin file. Add a table-driven test that puts the run-time `SECRET` in each of the four link forms above. It must assert exit 1, a `secret-key` finding, and that neither stdout nor stderr contains `SECRET`. |
| 2 | low | `backend/tools/check-docs.mjs:228,269-274` (`slugsFor` :249-259) | **A link can escape `--root` through a symlink or junction.** `isInside` is purely lexical, but `existsSync` and `readFileSync` follow links. A committed `docs/j` -> outside directory lets `[x](j/secret.md#hello)` read a file outside the root. Verified with a junction: `#hello` passes and `#nope` fails, which gives an oracle on file existence and on headings outside the repo. A FIFO or device target ending in `.md` could also block `readFileSync`. The impact is small (read-only, the attacker must commit a symlink, and the output is only pass/fail), but it contradicts "no reading outside root". | Use `realpathSync` on the root once. For a resolved target, require `isInside(realRoot, realpathSync(resolved))`, and treat a realpath error as "file not found". Before `slugsFor` reads, require `lstatSync(resolved).isFile()` (or `statSync` after the realpath check). Add a test with a directory symlink or junction (skip it when creation fails). Recommended in the same rework because it is cheap, but it does not block on its own. |
| 3 | low | `backend/tools/check-docs.mjs:132,196,197` | **Quadratic regex time on very long lines.** `/\[([^\]]*)\]\([^)]*\)/g`, `/!?\[[^\]]*\]\(([^)]*)\)/g` and similar are O(n^2) per line. A single 50k-char line of `[](` takes about 2 s. A 200k-char line (about 600 KB) takes about 70 s. There is no exponential blowup. `HEADING`, `FENCE`, the code-span regex and the secret regex measured linear (about 50 ms). The input is reviewed repo content, so this is a CI DoS only. | Backlog: skip link extraction for lines over a cap (e.g. 10,000 chars) and report them as a finding (`line-too-long`). Or switch to a single-pass scanner. Keep the secret and forbidden scans on the full line. |
| 4 | info | `backend/tools/check-docs.mjs:339` | The docs scan only looks for `sk-bf-` + 16 or more alphanumerics. Shorter real-looking keys and other credentials (PATs, bearer tokens) are not detected. This matches the design (ADR-0017). The repo gitleaks job is the broader control. | None for this item. Docs-writer must use only `sk-bf-<your-virtual-key>` / `sk-bf-...` placeholders and must not paste sample PATs or tokens. |
| 5 | info | `backend/test/tools/check-docs.test.ts` | Tests do not cover the symlink-skip behaviour or the link-target redaction. | Covered by the tests required for #1 and #2. |

### Opinion on the planned content rules (docs phase)
- The forbidden terms and required phrases contain no secrets and do not conflict with each other.
  The `required-text` messages echo only rule-table constants, which is safe.
- **E4/E5 (`-ExecutionPolicy Bypass`, `Unblock-File`)**: the engineer-setup page must:
  - scope the bypass to a single invocation (`powershell -ExecutionPolicy Bypass -File ...`);
  - never recommend `Set-ExecutionPolicy Unrestricted/Bypass` at machine or user scope;
  - tell readers to run `Unblock-File` only on scripts taken from the trusted shared-config repo
    checkout.
  The checker cannot enforce this, so Code Review and Docs review must check it.
- **R16/R17 ("bypass policies", "edit policies")**: the phrase check passes whether the runbook
  says to grant or to deny these permissions. The runbook must state that ordinary contributors
  and the pipeline identity are **not** granted Bypass/Edit policies (least privilege). Reviewers
  must check the wording.
- **T3/T4**: the troubleshooting text should prefer `az login` over PATs. It should never show a
  PAT on a command line or in an env-var example with a real-looking value. It should note that the
  cache file at `~/.cache/kilo-azdo/remote-config.json` holds the shared config (no keys) and is
  safe to delete.
- **R18 (keys issued and disabled manually)**: good. The docs should also tell engineers to keep
  their key only in the personal config or in `KILO_BIFROST_KEY`, and never in the shared repo.
- **ci.sh wiring (release phase)**: run the tool with no arguments (the repo root comes from the
  script location). Do not pipe its output into anything that echoes it elsewhere. Once #1 is
  fixed, the output is safe for CI logs.

## Assumptions made (no human available)
- The threat model is: docs content comes from repo contributors via reviewed PRs, the tool runs in
  CI, and CI logs may be visible to a wider audience than the repo or kept longer. This is why #1
  is medium and #2/#3 are low.
- I rated #1 medium rather than high because a key that reaches this path is already committed and
  is flagged by `secret-key`. The extra exposure is the cleartext copy in logs, which contradicts an
  explicit contract invariant. Per the gate policy, a cheap medium in touched code means FAIL.

## Follow-ups for the backlog
- #3: cap line length for link and heading parsing (CI DoS hardening).
- #2: if it is not fixed in this rework, add a realpath-based containment check.
- #4: consider adding gitleaks (or an equivalent PAT/bearer pattern) to the docs gate, so docs
  get the same coverage as code.

FACTORY_RESULT
status: FAIL
report: factory/runs/cycle-0018/04-security.md
summary: FAIL - check-docs prints sk-bf- keys verbatim via link-broken messages (medium, cheap fix); symlink escape and quadratic regex are low.
