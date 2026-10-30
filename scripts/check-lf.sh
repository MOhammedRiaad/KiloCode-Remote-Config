#!/usr/bin/env bash
# Shell scripts must be LF-only: a CR byte breaks bash on Linux.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
for f in scripts/*.sh; do
  if [ "$(tr -cd '\015' < "$f" | wc -c)" -gt 0 ]; then
    echo "check-lf: FAIL $f contains CR bytes (use LF endings)" >&2; fail=1
  fi
done

[ "$fail" -eq 0 ] || exit 1
echo "check-lf: PASS"
