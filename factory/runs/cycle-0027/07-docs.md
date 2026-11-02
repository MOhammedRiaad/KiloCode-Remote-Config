# Docs report - cycle 0027 (T-038 + installer smoke change, ADR-0022)

status: DONE

## Pages changed
- docs/user-guide.md: smoke test section (baseURL fallback, x-bf-vk header, effective key on update, caveat) and `no-base-url` row.
- docs/troubleshooting.md: Bifrost 401 section (x-bf-vk, key precedence, caveat, no-base-url).
- docs/development.md: ADR-0022 note on fake network / e2e checks.

## Notes
- Caveat documented: a non-empty azurefoundry x-bf-vk header wins over a fresh KILO_BIFROST_KEY on update.
- docs/platform-runbook.md line 17 (A3, `Authorization: Bearer` for Kilo's own provider) left unchanged: it concerns Kilo, not the installer smoke.
- Placeholders only; no real keys. backend/ and root kilo.jsonc untouched.
- `node tools/check-docs.mjs`: PASS (38 files).
