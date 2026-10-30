# ADR-0004: Placeholder resolution ({env:} / {file:}), secret-safe and pollution-safe
- Status: accepted
- Date: 2026-10-30
- Cycle / item: cycle-0004 / F-002
- Amended: cycle-0004 rework 1 (security finding 1 and 3 in `factory/runs/cycle-0004/04-security.md`):
  default reader guard (regular files only, 1 MiB cap) and UNC-style path rejection.

## Context

FR-5 / AC-8: after parsing the shared `kilo.jsonc` (ADR-0003) the plugin resolves `{env:VAR}`
and `{file:path}` placeholders (`~/` expands to the home directory). A value that is **only** an
unresolved placeholder is dropped; a partially unresolved string resolves the missing part to an
empty string. FR-9 says the names of unresolved placeholders are logged, never their values.

Constraints:
- FR-11 / ADR-0001: single file, zero npm dependencies, only `node:` imports.
- ADR-0002: pure helpers reach tests only through `__internals`; no named function exports.
- Resolved values are secrets (API keys). Neither file contents nor reader error text
  (an `fs` error, or an injected reader's error) may reach a return value, a thrown error or a log.
- The input comes from the network (shared repo), so object keys such as `__proto__`,
  `constructor` and `prototype` must not pollute prototypes.
- The resolver is wired into the config hook later (F-006). In this item it is a helper only.

## Decision

1. **Exposure and signature.** A module-local function exposed as `__internals.resolvePlaceholders`:
   ```ts
   interface PlaceholderDeps {          // module-local, NOT exported
     env?: Readonly<Record<string, string | undefined>>; // default: process.env (read at call time)
     homedir?: () => string;             // default: os.homedir (called lazily, only for "~/" paths)
     readFile?: (path: string) => string; // default: guarded reader, see point 6
   }
   interface PlaceholderResult { value: unknown; unresolved: string[] } // module-local
   function resolvePlaceholders(input: unknown, deps?: PlaceholderDeps): PlaceholderResult;
   ```
   It is **synchronous**: resolution happens once per Kilo start on a few tiny files, and a sync
   helper keeps the code simple and fully testable with plain fakes. The types are not exported,
   so the only new runtime or type export surface is the `resolvePlaceholders` key.
2. **Imports (FR-11).** The plugin gets its first imports, all `node:` built-ins that Bun and Node
   both provide:
   `import { readFileSync, statSync } from "node:fs";`, `import { homedir } from "node:os";`,
   `import { isAbsolute, join } from "node:path";`. This satisfies the FR-11 rule
   ("every specifier starts with `node:`"). No `require(`, no dynamic import.
3. **Grammar.** A placeholder is a match of `\{(env|file):([^{}\r\n]+)\}`. Anything else
   (for example `{env:}`, `{other:x}`, an unclosed `{env:X`) is literal text and is left as is.
   The name or path is used **verbatim**: no trimming and no case folding.
4. **Single pass, no re-expansion.** Each string is scanned once, left to right (`String.replace`
   with a callback, so `$` patterns in values are never interpreted). A resolved value is
   **never re-scanned**, so an env value that contains `{file:...}` cannot trigger a file read.
5. **`{env:NAME}`** resolves only when `NAME` is an **own** property of the env object and its
   value is a **non-empty string**. Otherwise it is unresolved. The own-property check stops
   `{env:constructor}` or `{env:__proto__}` from resolving to inherited members. An empty value
   counts as unresolved because Windows cannot hold empty variables, and an empty key is never
   useful (conservative, consistent across platforms).
6. **`{file:PATH}`**:
   - **UNC-style / device-namespace paths are rejected first.** If the first two characters of
     `PATH` (as written) are both path separators (`/` or `\`; regex `^[\\/]{2}`, which covers
     `\\host\share\x`, `//host/share/x`, `\\.\pipe\x`, `\\?\C:\x` and the mixed forms `\/`, `/\`),
     the placeholder is unresolved and **neither `homedir()` nor `readFile()` is called**. This
     applies to every reader (default or injected). Reason: on Windows such a path makes the
     machine contact an arbitrary SMB host and offer NTLM credentials, or opens a pipe/device.
     On POSIX `//x` is just another spelling of `/x`, so rejecting it loses nothing useful.
     The check is on `PATH` as written only. A `~/` path is not re-checked after expansion,
     so a home directory on a network share keeps working.
   - `PATH` starting with `~/` or `~\` -> `join(homedir(), rest)`.
   - `PATH` for which `path.isAbsolute(PATH)` is true -> used as is.
   - **Any other (relative, bare `~`, `~user`) -> unresolved, and no read is attempted.**
     The shared file is remote, so there is no meaningful base directory. Resolving against the
     process cwd would be unpredictable and could read project files. This is the conservative choice.
   - **Default reader guard.** When `deps.readFile` is omitted, the reader is:
     ```ts
     const MAX_PLACEHOLDER_FILE_BYTES = 1024 * 1024; // 1 MiB, module-local constant
     (p) => {
       const st = statSync(p);                        // follows symlinks
       if (!st.isFile() || st.size > MAX_PLACEHOLDER_FILE_BYTES) throw new Error("unreadable");
       return readFileSync(p, "utf8");
     }
     ```
     Only **regular files** of at most 1 MiB (exactly 1 048 576 bytes is still allowed) are read.
     Directories, FIFOs / named pipes, character and block devices (e.g. `/dev/zero`,
     `/dev/urandom`, `/dev/stdin`), sockets, larger files, and symlinks to any of these are
     unresolved. `statSync` (not open + fstat) is used so that a FIFO is rejected **before** it is
     opened (opening a FIFO blocks). The thrown error goes to the existing unbound `catch`, so it
     is discarded like any other reader failure. Reason (FR-10 "never break Kilo"): an unguarded
     synchronous read of a device or FIFO hangs or exhausts memory during Kilo startup, and
     F-006's try/catch cannot recover from that. The stat-then-read race (TOCTOU) is accepted:
     exploiting it needs control of the user's filesystem already.
   - The guard applies to the **default reader only**. An injected `deps.readFile` is called
     as is, without stat or size checks (tests and callers own their reader's behaviour).
     The UNC rule above and the relative-path rule below apply to all readers.
   - The content is `readFile(target)`. A non-string result counts as a failure. Otherwise the
     value is `content.trim()` (which also strips a BOM). An empty value after trimming counts
     as unresolved.
   - `homedir()` and `readFile()` run inside `try { ... } catch { ... }` **without binding the
     error**. The error is discarded: never rethrown, never attached as `cause`, never logged,
     never stringified. Any failure (missing file, directory, non-regular file, over the size
     cap, permission, throwing fake) gives "unresolved".
7. **Drop rules.** A string that is **exactly one** placeholder (whole-string match) and is
   unresolved is **dropped**:
   - in an object: the key is omitted (not present as `undefined` or `""`);
   - in an array: the element is removed (later elements shift down);
   - at the root: `value` is `undefined`.
   In any other string, an unresolved placeholder becomes `""`. For example `pre-{env:M}-post`
   becomes `pre--post`, and `{env:A}{env:B}` with both missing becomes `""` and is kept.
8. **`unresolved` list.** It holds entries `env:NAME` / `file:PATH`, using the name or path
   **as written** (never a value or an expanded path). It is de-duplicated and ordered by first
   occurrence (depth-first: object key order, array index order, left to right in a string).
   File paths and env names are not secret.
9. **Pure, non-mutating, pollution-safe traversal.**
   - Strings, numbers, booleans and `null` are returned as is. Strings without placeholders are
     returned unchanged.
   - Arrays produce a **new** array.
   - Any other non-null object produces a **new** ordinary object (`{}`, prototype
     `Object.prototype`). It copies only the input's own enumerable string keys (`Object.keys`).
     Every key is written with `Object.defineProperty(out, key, { value, enumerable: true,
     writable: true, configurable: true })`, never with `out[key] = ...`. So an own `__proto__`
     key stays an own data property and never calls the `__proto__` setter. `constructor` and
     `prototype` are ordinary data keys.
   - The input is never mutated. No global state is touched.
   - **Depth cap:** a container nested 64 or more levels deep (the root container is level 0)
     throws `Error("Placeholder resolution: config nested too deeply")`. This message is fixed
     and contains no input data. The cap also turns cyclic (non-JSON) input into this error
     instead of a stack overflow. It is the only error the function may throw.
10. **Not wired yet.** The `config` hook stays a no-op. F-006 calls the resolver after
    `parseJsonc`, logs the `unresolved` names (FR-9) and catches everything (FR-10).

## Consequences

- Tests inject `env`, `homedir` and `readFile` fakes. Only the default-reader cases use the
  real filesystem: "missing path", "directory", "regular temp file larger than 1 MiB" (all
  platforms, temp dir), and `{file:/dev/zero}` (skipped on Windows via
  `{ skip: process.platform === "win32" }`; must return promptly as unresolved). UNC cases use a
  throwing / recording fake reader to prove the reader is never called. Tests stay hermetic and
  work on Windows and Linux.
- A secret file larger than 1 MiB never resolves. Real API keys and tokens are far smaller,
  so this limit is not expected to matter in practice.
- Relative `{file:}` paths in the shared config never resolve. The validator (C1) and the docs
  must tell config authors to use `~/` or absolute paths.
- Secrets in resolved values exist only in the returned `value`. The caller (F-006) must never log it.
- Trust boundary (for Security): the shared config can read any file the user can read
  (`~/` or absolute) and any env variable, and put it into Kilo's config. That is the purpose of
  FR-5, and it relies on the shared repo being PR-gated (C1). No allowlist is added in this item.
  Security rated this **medium, accepted risk** (finding 2 in cycle-0004 security report). It stays
  accepted. An optional allowlist / path-prefix limit for `{file:}` (and a name allowlist for
  `{env:}`) is a backlog follow-up, not part of F-002.

## Alternatives considered

- **Async resolver with `fs/promises`**: no benefit for a few small reads at startup, and more
  complex tests. Rejected.
- **Relative paths against cwd or the config directory**: unpredictable / meaningless for a
  remote file. Rejected in favour of "unresolved".
- **Null-prototype output objects** (`Object.create(null)`): pollution-safe, but they break
  `deepStrictEqual` against ordinary objects, and Kilo's merge expects ordinary objects.
  `defineProperty` on ordinary objects gives the same safety. Rejected.
- **Skipping `__proto__` / `constructor` / `prototype` keys**: would silently lose data that
  `JSON.parse` legitimately produced. Key filtering, if any, belongs to the merge (F-003). Rejected here.
- **Recursive expansion** (re-scanning resolved values): enables injection from env values
  into file reads. Rejected.
- **open + fstat + bounded read** instead of `statSync` + `readFileSync`: no TOCTOU gap, but
  opening a FIFO blocks before fstat can reject it, and it needs more code. Rejected.
- **Guarding injected readers too**: would force tests to use the real filesystem and would
  stop callers from supplying their own reader. Rejected; the guard is part of the default only.
