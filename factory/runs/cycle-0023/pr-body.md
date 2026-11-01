## Summary
Second half of the user's Azure IP firewall requirement (F-020 = installer pre-flight, shipped v0.15.0). The plugin's remote config fetch now classifies firewall / network-blocked failures and writes an actionable hint to Kilo's log. Backend only.

What an engineer behind the firewall now sees in Kilo's log:
- Silent drops: code `timeout` + network hint.
- DNS failure / connection reset: `network-unreachable` + network hint.
- HTML 403 or 407 (proxy / firewall block page): `network-blocked` + network hint.
- JSON 401/403, including the Azure DevOps org IP policy: `http-401` / `http-403` + credentials hint that also mentions the VPN.

BEHAVIOUR CHANGE: a rejected fetch used to be reported as `network`; it is now `network-unreachable`. New codes: `network-unreachable`, `network-blocked`.

Versions and docs: plugin contract 0.9.0, ADR-0020 (plugin fetch network classification), installer-cli contract 1.3.1. F-022 (docs) follows.

## Backlog item
- **ID / title:** F-021 - Plugin: classify Azure firewall / network-blocked failures in the remote fetch with an actionable log hint
- **Type:** feature (user-sourced, priority 1)
- **Factory cycle:** `factory/runs/cycle-0023/`

## Acceptance criteria
- [x] AC-1 fetch rejection / timeout / stream error classification - tests: fetch.test.ts "F-021 AC-1" (x5)
- [x] AC-3 status and Content-Type rules (JSON 403, 401, 404/500/503/302, 2xx) - tests: "F-021 AC-3", "AC-5: JSON 403 / text 403"
- [x] AC-4 log hints per code, exact messages and levels - tests: hook.test.ts `HINT_CASES` (16 cases, with and without bound cache)
- [x] AC-5 cache survives a failed fetch, one fetch call, cache bytes/mtime unchanged - tests: hook.test.ts "F-021 AC5"
- [x] AC-6 no leakage (body, headers, PAT, az token, throwing getters/sinks) - tests: "F-021 AC6" canary matrix plus AC7/AC8 leak suites
- [x] AC-7 installer smoke output unchanged apart from new codes - tests: smoke.test.ts "F-021 AC-7a", install-smoke.test.ts "F-021 AC-7b"

## Gates
| Gate | Verdict | Report |
|------|---------|--------|
| Security | PASS (spy-verified, 0 findings above info) | `04-security.md` |
| Code review | PASS (11/11 mutations killed; 1 low + 1 info test nits to backlog) | `05-review.md` |
| Local CI (`scripts/ci.sh`) | PASS: tests 690, pass 680, fail 0, skipped 10 (pre-existing); check-lf, check-docs PASS | `03-backend.md` |

## Risk & rollback
- Behaviour change: consumers matching on the code `network` for a rejected plugin fetch must use `network-unreachable`. Installer bifrost smoke still uses `network`.
- Known limits (follow-ups): a JSON 403 from a TLS-inspecting proxy reads as `http-403`; Azure Firewall HTTP 470 and a 203 HTML sign-in page are not classified.
- Rollback: squash merge gives a single revert commit.

## How to verify
```
bash scripts/ci.sh
```
