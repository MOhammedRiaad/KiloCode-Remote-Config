#!/usr/bin/env bash
# Docker smoke test: build and start the stack, assert /api/health on both ports.
# Skips (exit 0) when Docker is unavailable or SKIP_DOCKER_SMOKE=1.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${SKIP_DOCKER_SMOKE:-0}" = 1 ] || ! docker info >/dev/null 2>&1; then
  echo "smoke: SKIP (docker unavailable)"
  exit 0
fi

# Load root .env (if any) so port overrides match compose.
if [ -f .env ]; then set -a; . ./.env; set +a; fi
FRONTEND_PORT="${FRONTEND_PORT:-8080}"
BACKEND_PORT="${BACKEND_PORT:-3000}"

trap 'docker compose down -v' EXIT

docker compose up -d --build --wait

check() {
  local url="$1" i body
  for i in $(seq 1 30); do
    body="$(curl -fsS --max-time 3 "$url" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -q '"status":"ok"'; then
      echo "smoke: OK $url"
      return 0
    fi
    sleep 2
  done
  echo "smoke: FAIL $url (last body: $body)" >&2
  docker compose logs --no-color --tail=50 >&2 || true
  return 1
}

check "http://localhost:${FRONTEND_PORT}/api/health"
check "http://localhost:${BACKEND_PORT}/api/health"

# Auth round trip through the frontend proxy: register -> /me with the session cookie.
base="http://localhost:${FRONTEND_PORT}"
email="smoke-$(date +%s)-$$@example.com"
hdrs="$(mktemp)"
trap 'rm -f "$hdrs"; docker compose down -v' EXIT

code="$(curl -sS --max-time 10 -o /dev/null -D "$hdrs" -w '%{http_code}' \
  -X POST "$base/api/v1/auth/register" \
  -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest' \
  -d "{\"email\":\"$email\",\"name\":\"Smoke Test\",\"password\":\"smoke-test-pass-123\"}")"
if [ "$code" != 201 ]; then
  echo "smoke: FAIL register returned $code" >&2
  docker compose logs --no-color --tail=50 >&2 || true
  exit 1
fi
cookie="$(tr -d '\r' < "$hdrs" | sed -n 's/^[Ss]et-[Cc]ookie: \(cf_session=[^;]*\).*/\1/p' | head -n1)"
if [ -z "$cookie" ]; then
  echo "smoke: FAIL register did not set cf_session cookie" >&2
  exit 1
fi
echo "smoke: OK register"

code="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
  "$base/api/v1/auth/me" -H "Cookie: $cookie")"
if [ "$code" != 200 ]; then
  echo "smoke: FAIL /me returned $code" >&2
  docker compose logs --no-color --tail=50 >&2 || true
  exit 1
fi
echo "smoke: OK /me"

# Security headers and loopback-only backend port (T-002).
bp="$(docker compose port backend 3000 | tr -d '\r')"
case "$bp" in
  127.0.0.1:*) echo "smoke: OK backend bound to $bp" ;;
  *) echo "smoke: FAIL backend port not loopback-only: $bp" >&2; exit 1 ;;
esac

api_h="$(curl -sS --max-time 10 -D - -o /dev/null "$base/api/health" | tr -d '\r')"
printf '%s' "$api_h" | grep -qi '^x-content-type-options: *nosniff'   || { echo "smoke: FAIL /api/health missing nosniff" >&2; exit 1; }
printf '%s' "$api_h" | grep -i '^content-security-policy:' | grep -q "default-src 'none'"   || { echo "smoke: FAIL /api/health CSP lacks default-src 'none'" >&2; exit 1; }
spa_h="$(curl -sS --max-time 10 -D - -o /dev/null "$base/" | tr -d '\r')"
printf '%s' "$spa_h" | grep -i '^content-security-policy:' | grep -q "default-src 'self'"   || { echo "smoke: FAIL / CSP lacks default-src 'self'" >&2; exit 1; }
echo "smoke: OK security headers"

# Rate limit through nginx: well-formed login with empty password fails validation (400)
# after the IP limiter, so each counts against the per-IP budget. Runs after register.
got429=0
for i in $(seq 1 25); do
  code="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}'     -X POST "$base/api/v1/auth/login"     -H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest'     -d "{\"email\":\"rl-$i@example.com\",\"password\":\"\"}")"
  if [ "$code" = 429 ]; then got429=1; break; fi
done
if [ "$got429" != 1 ]; then
  echo "smoke: FAIL no 429 after 25 logins through the proxy" >&2
  exit 1
fi
echo "smoke: OK rate limit 429"
echo "smoke: PASS"
