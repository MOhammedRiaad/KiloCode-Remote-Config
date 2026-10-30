#!/usr/bin/env bash
# Idempotent repo bootstrap for the AI Factory. Safe to run before every cycle.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  git init -b main
fi

# A commit identity is required for autonomous commits; only set a repo-local one if none exists.
if [ -z "$(git config user.name || true)" ]; then
  git config user.name "AI Factory"
fi
if [ -z "$(git config user.email || true)" ]; then
  git config user.email "ai-factory@users.noreply.github.com"
fi

mkdir -p factory/runs factory/logs docs/architecture/contracts

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git add -A
  git commit -m "chore: bootstrap AI Factory"
fi

# Labels used by the factory (remote mode only; failures are harmless).
if git remote get-url origin >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh label create ai-factory --color 5319e7 --description "Created by the AI Factory" 2>/dev/null || true
  for t in feature bug chore tech-debt security; do
    gh label create "$t" --color ededed 2>/dev/null || true
  done
fi

echo "bootstrap: ok (branch $(git branch --show-current))"
