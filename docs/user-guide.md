# User guide

## Current status

The Kilo azdo-remote-config plugin is at an early stage (T-001 skeleton, F-001 JSONC parser).
There is nothing to install or configure for end users yet.

What exists today:
- A stub plugin file, `backend/plugin/azdo-remote-config.ts`. If Kilo loaded it, it would start
  normally and change nothing: it makes no network calls, reads no files and writes no logs.
- An internal JSONC parser (F-001). It is not used by the plugin yet, so it has no user-visible
  effect today. Once the fetch step is built, the shared `kilo.jsonc` will be parsed with it, so the
  file may contain `//` and `/* */` comments, trailing commas and `https://` URLs inside strings.

Not yet available (planned, see `factory/VISION.md`): using the parser on a fetched file, fetching the shared config from Azure DevOps,
merging it into Kilo, the local cache, the bootstrap installers and key provisioning.

Supported Kilo version range (pinned): `>=7.2.0 <8.0.0`.

This page will describe setup and settings once those features ship.
