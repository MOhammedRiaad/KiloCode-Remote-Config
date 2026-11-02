# ADR-0023: Installer writes the Bifrost key where the smoke test reads it (`x-bf-vk` key header) and adds no redundant `provider.bifrost` block
- Status: accepted
- Date: 2026-11-02
- Cycle / item: cycle-0028 / T-040 (user-directed; implementation in commit a1b8f92)
- Amends: ADR-0022 decision 5 ("write phase unchanged") and its first consequence (the "header
  wins over a supplied `KILO_BIFROST_KEY`" gap); ADR-0012 update rule for `apiKey`.
  Contract: `contracts/installer-cli.md` 1.4.0 -> 1.5.0 (sections 2, 3, 5, 7, 9). No change to the
  plugin (`contracts/plugin-interface.md`), the personal config template
  (`contracts/personal-config-template.md`), fresh installs, the smoke test request or any output
  text.

## Context

ADR-0022 made the smoke test take the effective key, on update, from the personal config's
`provider.azurefoundry.options.headers["x-bf-vk"]` when it is a non-empty string, else from
`provider.bifrost.options.apiKey`. The write phase was left untouched, so on a config that already
carries the key in that header the installer:

- still created a `provider.bifrost.options.apiKey` placeholder (a redundant block the team's
  real config does not use), and
- wrote a supplied `KILO_BIFROST_KEY` to `bifrost.options.apiKey` while the smoke test checked the
  header, so the written key and the tested key could differ, and the hint "set KILO_BIFROST_KEY
  and re-run" could not fix a placeholder header.

The user asked for the installer to align the written key with the key the smoke test checks.

## Decision

1. **Key header.** The existing (update-path) config has a key header when `provider`,
   `provider.azurefoundry`, `.options` and `.options.headers` are plain objects and
   `headers["x-bf-vk"]` is a non-empty string. This is exactly the condition under which
   `storedApiKey` returns the header (ADR-0022 decision 3), so the write rule and the read rule
   share one definition.
2. **Key header present.** A supplied `KILO_BIFROST_KEY` replaces the header value; with no key
   supplied the header is kept. Nothing under `provider.bifrost` is created, changed, validated or
   deleted (no block, no placeholder `apiKey`; an existing block, even with a stale `apiKey` or a
   non-object value, is kept deep-equal as parsed). The installer never creates the key header and
   adds no other key under `provider.azurefoundry`.
3. **No key header.** The 1.4.0 rules apply unchanged: `provider.bifrost.options.apiKey` is set to
   the supplied key, kept when present, or set to the placeholder; missing objects are created;
   non-object `provider` / `bifrost` / `options` -> exit 3.
4. **Fresh installs unchanged.** The template is rendered with `bifrost.options.apiKey` (the key or
   the placeholder); there is no existing header to detect.
5. **Invariant.** After any successful write phase, the value at the key location the smoke test
   reads (`storedApiKey` of the planned object) equals the supplied key when one was given. The
   1.4.0 caveat "header wins over a supplied key" no longer exists.
6. **Idempotency and no-leak unchanged.** A run whose supplied key equals the current header
   value plans a deep-equal object: no write, no backup. The key (old header value or new key) is
   never printed, logged, put in argv or in a report; the backup keeps the previous bytes with
   mode `0600` exactly as before. Input validation of `KILO_BIFROST_KEY` (control characters ->
   exit 2, unusual prefix -> warning) is unchanged and applies to the header path too.

## Consequences

- Written key == smoke-tested key in every case; the "Smoke test: set KILO_BIFROST_KEY and re-run"
  hint is now accurate for header-based configs.
- A config with a key header no longer gets a `provider.bifrost` placeholder block on update.
  Configs that already have such a block keep it (the installer never deletes user content);
  with a supplied key its `apiKey` is no longer updated and may be stale. Accepted: Kilo and the
  smoke test use the header; removal is left to the engineer.
- With a key header, a malformed `provider.bifrost` (e.g. a string) is no longer an exit-3 error,
  because it is not touched. Contract exit-3 row updated.
- A header holding a `{env:` / `{file:` reference is replaced by a literal key when
  `KILO_BIFROST_KEY` is supplied. Same behaviour as `bifrost.options.apiKey` has always had; the
  engineer explicitly supplied the key. The file stays `0600` (POSIX) / inherited ACL (Windows).
- The fixed hint `Set your Bifrost virtual key: ... or edit provider.bifrost.options.apiKey in
  <path>.` still names only the `apiKey` location even when the placeholder sits in the header.
  Wording deliberately unchanged in this item (no output change); follow-up candidate.
- Tests: `backend/test/installer/personal-config-edit.test.ts` covers "no bifrost block, key kept"
  and "no bifrost block, supplied key replaces header" (commit a1b8f92).

## Alternatives considered

- **Keep writing `bifrost.apiKey` and make the smoke test prefer it.** Rejected: the team's real
  config authenticates through the header; testing a key Kilo does not send would make the smoke
  test pass or fail for the wrong key.
- **Write the key to both locations.** Rejected: duplicates the secret in the file and re-adds the
  redundant block the user asked to drop.
- **Delete an existing `provider.bifrost` block when a key header exists.** Rejected: the installer
  only adds or replaces what it owns; deleting user content is outside its contract.
- **Create the key header on fresh installs.** Rejected for now: changes the personal config
  template and its contract (ADR-0011); the shared config decides the provider shape.
