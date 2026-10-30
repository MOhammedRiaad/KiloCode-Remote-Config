# User guide

## Current status

The Kilo azdo-remote-config plugin is at the project-skeleton stage (T-001). There is nothing to
install or configure for end users yet.

What exists today:
- A stub plugin file, `backend/plugin/azdo-remote-config.ts`. If Kilo loaded it, it would start
  normally and change nothing: it makes no network calls, reads no files and writes no logs.

Not yet available (planned, see `factory/VISION.md`): fetching the shared config from Azure DevOps,
merging it into Kilo, the local cache, the bootstrap installers and key provisioning.

Supported Kilo version range (pinned): `>=7.2.0 <8.0.0`.

This page will describe setup and settings once those features ship.
