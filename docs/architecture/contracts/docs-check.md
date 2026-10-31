# Contract: docs check (`check-docs`)

- Version: 1.0.0 (F-016, cycle-0018). Decision record: ADR-0017.
- Owner: Architect. Implemented by: `backend/tools/check-docs.mjs` (senior-backend).
  Tests: `backend/test/tools/check-docs.test.ts`.
- Consumers: `scripts/ci.sh` (ci-releaser adds `node backend/tools/check-docs.mjs`), docs-writer
  (self-check before PASS), tests.
- Content obligations (section 5) apply to `docs/engineer-setup.md`, `docs/platform-runbook.md`
  and `docs/troubleshooting.md` (docs-writer).

## 1. Command line

```
node backend/tools/check-docs.mjs [--root <dir>]
```

- No arguments: root is the repository root, resolved from the script location
  (`<script dir>/../..`). The current working directory is not used.
- `--root <dir>`: check the tree under `<dir>`. Tests use this. Relative `<dir>` resolves against
  the cwd. Only the `--root value` form is accepted (two argv elements).
- `--help` / `-h`: print usage on stdout, exit 0.
- Anything else (unknown option, positional argument, `--root` without a value, `--root` given
  twice, `<dir>` not an existing directory): print usage on stderr, exit 2.
- Code: one ES module, Node >= 22.18, imports only `node:` built-ins (`node:fs`, `node:path`,
  `node:url`, `node:process` as needed). No `require(`, no network, no child processes, no writes.
  It never imports `backend/plugin/azdo-remote-config.ts`. It reads the file as text.

## 2. Output and exit codes

| Exit | When | Output |
|---|---|---|
| 0 | no findings | stdout: `check-docs: PASS (<n> markdown files checked)` |
| 1 | one or more findings | stderr: one line per finding (format below), then `check-docs: FAIL (<k> problem(s))` |
| 2 | usage error, or unexpected internal error | stderr: usage text, or `check-docs: internal error (<error.code or "unknown">)` |

Finding line format (stderr):

```
check-docs: FAIL <file>[:<line>]: <rule>: <message>
```

- `<file>` is relative to the root, with `/` separators on every OS.
- `<line>` is 1-based and present when the finding is on a specific line.
- `<rule>` is one of the rule ids in section 4.
- The tool runs every rule and reports all findings (no fail-fast). Findings are sorted by file,
  then line, then rule, so the output is deterministic.
- The output never includes text matched by `secret-key`. Other messages may quote link targets,
  phrases and forbidden terms from the rule tables, because they are not secrets.

## 3. Files and parsing

**Scanned set S**: `README.md` at the root, plus every regular file whose name ends in `.md`
(case-insensitive) anywhere under `docs/`, recursively. `docs/architecture/` is included. Use
`lstat`: symlinks (files or directories) are skipped, never followed. Nothing else is excluded.

**Pages P**: `docs/engineer-setup.md`, `docs/platform-runbook.md`, `docs/troubleshooting.md`.

Reading: UTF-8. Split lines on `/\r?\n/`. CRLF and LF input must give identical results.

**Code fences**: a line matching `/^ {0,3}(```|~~~)/` toggles fence state, and so does the closing
line. Lines inside a fence (and the fence lines themselves) are ignored for links and headings.
They are **not** ignored for required phrases, forbidden terms or the secret scan.

**Inline code**: before extracting links from a line, remove code spans with
`/(`+)[^`]*?\1/g` (the spans are replaced by an empty string).

**Links extracted** (outside fences, after removing inline code):
- inline links and images: `/!?\[[^\]]*\]\(([^)]*)\)/g`. The target is the group trimmed. If it
  starts with `<`, take the text up to the next `>`. Otherwise take the text up to the first
  whitespace, which drops an optional `"title"`.
- reference definitions: a line matching `/^ {0,3}\[[^\]]+\]:\s*(\S+)/`. The target is group 1,
  with `<` and `>` stripped.
- Autolinks (`<https://...>`) and bare URLs are ignored.

**Classification of a target**:
- external: matches `/^[a-z][a-z0-9+.-]*:/i` (http, https, mailto, ...) or starts with `//`.
  Ignored.
- same-file anchor: starts with `#`.
- absolute path: starts with `/` or `\`. Reported as `link-broken` ("absolute links are not
  allowed").
- otherwise relative: split at the first `#` into path and fragment, and drop any `?query` from the
  path. `decodeURIComponent` the path and the fragment. A decode error is `link-broken`.

**Headings and slugs** (ATX only; setext headings are not supported):
- A heading is a line outside fences that matches `/^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/`.
- Heading text for slugs: replace `[t](u)` with `t`, remove backticks, then GitHub slug: lowercase,
  remove every character that is not `\p{L}`, `\p{M}`, `\p{N}`, `\p{Pc}`, a space or `-`, then
  replace each space with `-`. Spaces are not collapsed, so `a  b` becomes `a--b`.
- Duplicates in one file: the first occurrence is `s`, then `s-1`, `s-2`, ...
- Fragments are compared exactly, after decoding, with the slug set of the target file.

**Normalised text N(file)** (used for phrases): take the full file text (fences included), remove a
leading `>` blockquote marker and one following space at each line start, remove every `` ` `` and
`*`, replace each run of whitespace (including newlines) with one space, then lowercase. A phrase
matches if it is a substring of N. A phrase therefore survives line wrapping, but not a list
marker, heading marker or table pipe placed inside it. Underscores are kept (`kilo_pure=1`).

**Heading text H(file)** (used for heading requirements): each heading's text (as above) with
backticks and `*` removed, whitespace collapsed, lowercased.

## 4. Rules

| Rule id | Applies to | Fails when | Message (examples) |
|---|---|---|---|
| `page-missing` | `README.md` and each file in P | the path is not an existing regular file | `docs/troubleshooting.md: page-missing: required page does not exist` |
| `cross-link` | each page in P, and `README.md` | the source does not have at least one relative link whose resolved path equals the target's path (a fragment is allowed; the resolution must succeed). Required pairs: each page in P to the other two pages in P, and README to all three. Skipped when the source page is missing (it is already reported). | `docs/engineer-setup.md: cross-link: no relative link to docs/troubleshooting.md` |
| `link-broken` | every file in S | a relative link's path, resolved against the source file's directory, is outside the root, or does not exist (file or directory). Or a fragment does not match a slug: for a same-file `#x`, the source's own slugs; for a target ending in `.md` (case-insensitive), the target's slugs. Fragments on non-`.md` targets are not checked. An absolute or undecodable target also fails. | `docs/user-guide.md:42: link-broken: development.md#nope (anchor not found)` |
| `required-text` | each page in P that exists | an item in section 5 for that page is not satisfied | `docs/troubleshooting.md: required-text: T2 missing phrase "ci jobs that need the shared config must not set kilo_pure=1"` |
| `kilo-range` | `docs/engineer-setup.md` (when it exists) | `<root>/backend/plugin/azdo-remote-config.ts` is unreadable, or no line matches `/^export const SUPPORTED_KILO_RANGE\s*=\s*"([^"\r\n]+)"\s*;/m`, or N(engineer-setup) does not contain the captured range, lowercased and with whitespace collapsed | `docs/engineer-setup.md: kilo-range: supported Kilo range ">=7.2.0 <8.0.0" not found` / `backend/plugin/azdo-remote-config.ts: kilo-range: cannot read SUPPORTED_KILO_RANGE` |
| `secret-key` | every file in S | any line matches `/sk-bf-[A-Za-z0-9]{16,}/i` (code fences included) | `docs/x.md:7: secret-key: possible Bifrost virtual key (value not shown)` |
| `forbidden-text` | each page in P that exists | any line (code fences included) matches one of: `/provision/i`, `/offboard/i`, `/teams[\/\\]/i`, `/per-team/i`. One finding per line per pattern. | `docs/platform-runbook.md:12: forbidden-text: "offboard" (out of scope by user decision)` |

Examples for `secret-key`: `sk-bf-...`, `sk-bf-<your-virtual-key>`, `sk-bf-` followed by 15
alphanumerics, and a bare `sk-bf-` do **not** match. `sk-bf-` followed by 16 or more alphanumerics
does, in any case and anywhere in the line.

## 5. Required content per page

Item kinds:
- **phrase**: substring of N(file), written here in lowercase.
- **regex**: tested on the raw file text.
- **heading**: substring of at least one entry of H(file).

### `docs/troubleshooting.md` (AC-2)

| Id | Kind | Value |
|---|---|---|
| T1 | phrase | `kilo_pure=1` |
| T2 | phrase | `ci jobs that need the shared config must not set kilo_pure=1` |
| T3 | phrase | `az login` |
| T4 | phrase | `~/.cache/kilo-azdo/remote-config.json` |
| T5 | phrase | `exit code 4` |
| T6 | phrase | `--no-smoke` |
| T7 | phrase | `-nosmoke` |

### `docs/engineer-setup.md` (AC-3)

| Id | Kind | Value |
|---|---|---|
| E1 | (rule `kilo-range`) | the `SUPPORTED_KILO_RANGE` value read at check time |
| E2 | phrase | `install.sh` |
| E3 | phrase | `install.ps1` |
| E4 | phrase | `-executionpolicy bypass` |
| E5 | phrase | `unblock-file` |

### `docs/platform-runbook.md` (AC-4, AC-6)

| Id | Kind | Value |
|---|---|---|
| R1 | regex | `/\bA1\b/` |
| R2 | regex | `/\bA2\b/` |
| R3 | regex | `/\bA3\b/` |
| R4 | phrase | `/models` |
| R5 | phrase | `vs code` |
| R6 | phrase | `model list` |
| R7 | phrase | `.ts plugin` |
| R8 | phrase | `path resolution` |
| R9 | phrase | `disabled virtual key is rejected by bifrost at request time` |
| R10 | heading | `phase 0` |
| R11 | heading | `shared config repo` |
| R12 | heading | `pipeline` |
| R13 | heading | `branch polic` |
| R14 | phrase | `set-branch-policies.sh` |
| R15 | heading | `permissions` |
| R16 | phrase | `bypass policies` |
| R17 | phrase | `edit policies` |
| R18 | phrase | `bifrost virtual keys are issued and disabled manually by the platform team outside this project` |

The forbidden terms (rule `forbidden-text`) apply to all three pages. The required phrases are
chosen so that none of them contains a forbidden term.

## 6. Test obligations (`backend/test/tools/check-docs.test.ts`)

Hermetic: each test builds a fixture root under `mkdtempSync(join(tmpdir(), "check-docs-"))`,
runs `spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" })` and removes the
fixture in `finally` / `t.after`. Tests never read or write the real `README.md` or `docs/`, and
never touch the network. A fixture builder creates a minimal valid tree: README with three links;
three pages that satisfy every section 5 item, with cross-links; a fake
`backend/plugin/azdo-remote-config.ts` containing only
`export const SUPPORTED_KILO_RANGE = ">=9.1.0 <10.0.0";` (deliberately not the real range); and
options to omit or override any file.

The key used in the negative controls is built at run time (for example
`"sk-" + "bf-" + "Ab1".repeat(6)`). No literal `sk-bf-` followed by 16 or more alphanumerics may
appear in the test source.

Required cases (each asserts the exit code and the named file, rule or item in stderr):
1. Valid fixture: exit 0, stdout starts with `check-docs: PASS`.
2. `page-missing` for each of the three pages and for README (4 cases, table-driven).
3. `cross-link`: remove each of the 9 required links, one at a time (3 pages x 2 targets, plus
   README x 3 targets; table-driven). The message names the source and the target. A link that is
   present but broken (for example a typo in the file name) fails both `link-broken` and `cross-link`.
4. `link-broken`: missing file; missing anchor; link escaping the root (`../../x.md`); absolute
   link. Passing cases: a valid anchor; a duplicate-heading anchor `#x-1`; a link inside a code
   fence and inside inline code to a missing file (ignored); `https://` and `mailto:` links
   (ignored); a reference-style definition to a missing file (fails).
5. `required-text`: removing each T, E and R item fails with its id (table-driven). R10 to R13
   and R15 fail when the phrase is only in body text and not in a heading. A phrase wrapped across
   two lines passes.
6. `kilo-range`: the fixture range passes. Changing only the fake plugin constant to another range
   fails (this proves the range is read at check time). A plugin file without the constant fails.
   A missing plugin file fails.
7. `secret-key`: a run-time key in `docs/architecture/nested/x.md` fails, and stderr/stdout do not
   contain the key. A key in README fails. `sk-bf-...`, `sk-bf-<your-virtual-key>` and `sk-bf-` + 15
   alphanumerics pass. A file named `x.MD` is scanned.
8. `forbidden-text`: each of the 4 patterns in each of the 3 pages fails (table-driven, with the
   line number). The same term in `docs/user-guide.md` passes.
9. CRLF: the valid fixture written with CRLF line endings passes. A CRLF fixture missing T2 fails
   the same way.
10. Usage: unknown option -> 2; `--root` without a value -> 2; `--root` pointing to a missing
    directory -> 2; `--help` -> 0.
11. Multiple findings are all reported (for example a missing page plus a secret gives two lines
    and exit 1).

No test runs the tool against the real repository. That run is the `scripts/ci.sh` gate.
