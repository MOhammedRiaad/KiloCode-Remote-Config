#!/usr/bin/env bash
# Static compose/env checks (no Docker needed): loopback-only backend port and
# T-002 env vars present in both docker-compose.yml and .env.example.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
vars="TRUST_PROXY CORS_ALLOWED_ORIGINS RATE_LIMIT_WINDOW_MINUTES RATE_LIMIT_AUTH_IP_MAX RATE_LIMIT_LOGIN_EMAIL_MAX"

# Backend service block: from "  backend:" up to the next top-level service.
backend="$(awk '/^  backend:/{f=1;next} f&&/^  [a-zA-Z]/{f=0} f' docker-compose.yml)"

ports="$(printf '%s\n' "$backend" | awk '/^    ports:/{f=1;next} f&&/^    [a-zA-Z]/{f=0} f' | grep -E '^\s*-' || true)"
if [ -z "$ports" ]; then
  echo "check-compose: FAIL backend has no ports mapping" >&2; fail=1
elif printf '%s\n' "$ports" | grep -vqE '^\s*-\s*"?127\.0\.0\.1:'; then
  echo "check-compose: FAIL backend port mapping is not 127.0.0.1-prefixed" >&2; fail=1
fi

for v in $vars; do
  grep -qE "^${v}=" .env.example || { echo "check-compose: FAIL $v missing from .env.example" >&2; fail=1; }
  printf '%s\n' "$backend" | grep -qE "^\s+${v}:" || { echo "check-compose: FAIL $v missing from compose backend environment" >&2; fail=1; }
done

# Shell scripts must be LF-only: a CR byte breaks bash on Linux (and makes git treat the file as binary).
for f in scripts/*.sh; do
  if [ "$(tr -cd '\015' < "$f" | wc -c)" -gt 0 ]; then
    echo "check-compose: FAIL $f contains CR bytes (use LF endings; write tr -d '\\r' with an escaped backslash-r)" >&2; fail=1
  fi
done

[ "$fail" -eq 0 ] || exit 1
echo "check-compose: PASS"
