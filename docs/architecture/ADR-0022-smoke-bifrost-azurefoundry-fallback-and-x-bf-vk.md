# ADR-0022: Installer smoke test reads the gateway URL from `provider.azurefoundry` as fallback and authenticates with `x-bf-vk`
- Status: accepted
- Date: 2026-11-02
- Cycle / item: cycle-0027 / out-of-band user-directed change riding along with T-038 (commit 7701a9b)
- Amends: ADR-0013 (smoke test: baseURL source, Bifrost request header, effective key source).
  Contract: `contracts/installer-cli.md` 1.3.2 -> 1.4.0 (sections 7, 9 and 9.2). No change to the
  plugin (`contracts/plugin-interface.md`), the personal config template or the installer's write
  phase.
- Amended by: ADR-0023 (cycle-0028, T-040): decision 5 and the first consequence are superseded.
  On update with a non-empty `azurefoundry` `x-bf-vk` header the installer writes a supplied
  `KILO_BIFROST_KEY` into that header and adds no `provider.bifrost` block, so the written key is
  the smoke-tested key (contract `installer-cli.md` 1.5.0).

## Context

ADR-0013 made the smoke test read the gateway URL only from the shared config's
`provider.bifrost.options.baseURL`, take the "effective key" only from the personal config's
`provider.bifrost.options.apiKey`, and send `Authorization: Bearer <key>` to `GET <baseURL>/models`.
The team's real, working shared config does not look like that: it declares the Bifrost gateway on
`provider.azurefoundry.options.baseURL`, and the engineer's personal config carries the Bifrost
virtual key as a custom header `provider.azurefoundry.options.headers["x-bf-vk"]`. The Bifrost
gateway authenticates virtual keys through the `x-bf-vk` header. With the old rules the smoke
test reported `fail no-base-url` (or `fail 401`) against a config that works in Kilo. The user asked
for the code to match the real config; the change was made in commit 7701a9b and this ADR records it.

## Decision

1. **baseURL source.** The smoke test reads `provider.bifrost.options.baseURL` from the shared
   config. Only when that value is absent (not reachable as an own property through plain objects)
   does it read `provider.azurefoundry.options.baseURL`. Bifrost wins when both are declared. A
   present but non-string bifrost value does **not** fall back; it fails `no-base-url` as before.
   All URL validation (https only, no userinfo / query / fragment, `/models` suffix) is unchanged
   and applies to whichever value was selected.
2. **Request header.** The single Bifrost request sends exactly `Accept: application/json` and
   `x-bf-vk: <effective key>`. No `Authorization` header is sent to Bifrost. The AzDO request is
   unchanged (`Authorization: Basic` PAT or `Bearer <az token>`).
3. **Effective key source** (`storedApiKey`, update path). The personal config's
   `provider.azurefoundry.options.headers["x-bf-vk"]` when it is a non-empty string, otherwise
   `provider.bifrost.options.apiKey` (any value, as before). This value also drives the
   "Set your Bifrost virtual key" hint (shown only when it equals the placeholder). Fresh installs
   are unchanged: the effective key is `KILO_BIFROST_KEY` or the placeholder, because the template
   is rendered by the installer.
4. **Key validation and no-leak guarantees unchanged.** The effective key goes through the same
   `classifyKey` rules (placeholder / empty -> `skipped no-key`, `{env:` / `{file:` ->
   `skipped key-reference`, > 4096 chars or char outside 0x21-0x7E -> `fail invalid-key`), is sent
   only to the validated https models URL, never to AzDO, never printed, never written to argv,
   logs or reports. The PAT / az token is never sent to Bifrost.
5. **Write phase unchanged** (superseded by ADR-0023 for configs with a non-empty `x-bf-vk`
   header). The installer still writes `KILO_BIFROST_KEY` (or the placeholder when
   no `apiKey` exists) to `provider.bifrost.options.apiKey` on fresh and update. It does not write
   or touch `provider.azurefoundry`.

## Consequences

- The smoke test passes against the team's real config shape and keeps working for configs that
  use the original `provider.bifrost` shape.
- (Resolved by ADR-0023: a supplied key is now written into the header.) On **update**, a non-empty `azurefoundry` `x-bf-vk` header in the personal config takes priority
  over a `KILO_BIFROST_KEY` supplied on this run: the supplied key is still written to
  `bifrost.options.apiKey`, but the smoke test checks the header key. The fixed hint
  `Smoke test: set KILO_BIFROST_KEY and re-run install.sh ...` can therefore be misleading when the
  header itself holds the placeholder or another non-usable value; the wording is left unchanged
  in this change (follow-up candidate).
- A Bifrost deployment that only accepts `Authorization: Bearer` would now fail `401` in the smoke
  test. Accepted: the team gateway uses `x-bf-vk`.
- Tests updated in commit 7701a9b (`smoke.test.ts`, `install-smoke.test.ts`,
  `install-ps1-smoke.test.ts`, `e2e/startup.test.ts`, `fixtures/fake-network.ts`) including a
  fallback / precedence test and a `storedApiKey` precedence test.
- Test-only fixture contract `contracts/e2e-harness.md` 1.1.0 -> 1.1.1: the fake-network `auth`
  answer gains an optional lower-case `header` name (default `"authorization"`), matched as
  `headers[header ?? "authorization"] === authorization`; the e2e fake Bifrost uses
  `header: "x-bf-vk"`.

## Alternatives considered

- **Send both `Authorization: Bearer` and `x-bf-vk`.** Rejected: doubles the places the secret
  travels and the contract demands an exact header set.
- **Read only `provider.azurefoundry`.** Rejected: breaks configs already using the documented
  `provider.bifrost` shape.
- **Change the installer to write the key into `azurefoundry.options.headers`.** Deferred: it
  changes the personal config template and write contract (ADR-0011 / ADR-0012); recorded as a
  follow-up candidate.
