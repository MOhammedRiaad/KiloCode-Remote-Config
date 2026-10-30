#!/usr/bin/env bash
# Single quality gate used locally by the agents and by .github/workflows/ci.yml.
# Owned by the ci-releaser agent: extend it when ADR-0001 introduces new tooling.
set -euo pipefail
cd "$(dirname "$0")/.."

ran=0

run_node() {
  local dir="$1"
  echo "::group::node $dir"
  pushd "$dir" >/dev/null
  if [ -f package-lock.json ]; then npm ci; else npm install; fi
  npm run lint --if-present
  npm run typecheck --if-present
  npm test --if-present
  npm run build --if-present
  popd >/dev/null
  echo "::endgroup::"
}

run_python() {
  local dir="$1"
  echo "::group::python $dir"
  pushd "$dir" >/dev/null
  python -m pip install --upgrade pip >/dev/null
  if [ -f pyproject.toml ]; then python -m pip install -e ".[dev]" 2>/dev/null || python -m pip install -e .; fi
  if [ -f requirements.txt ]; then python -m pip install -r requirements.txt; fi
  if [ -f requirements-dev.txt ]; then python -m pip install -r requirements-dev.txt; fi
  if python -m ruff --version >/dev/null 2>&1; then python -m ruff check .; fi
  python -m pytest -q
  popd >/dev/null
  echo "::endgroup::"
}

for dir in backend frontend; do
  [ -d "$dir" ] || continue
  if [ -f "$dir/package.json" ]; then run_node "$dir"; ran=1; fi
  if [ -f "$dir/pyproject.toml" ] || [ -f "$dir/requirements.txt" ]; then run_python "$dir"; ran=1; fi
done

# Factory metadata must always be valid JSON.
node -e 'for (const f of ["factory/state.json","factory/backlog.json"]) JSON.parse(require("fs").readFileSync(f,"utf8"))'

bash scripts/check-lf.sh

grep -q 'scripts/ci.sh' .github/workflows/ci.yml || { echo "ci: ci.yml must call scripts/ci.sh" >&2; exit 1; }

if [ "$ran" -eq 0 ]; then
  echo "ci: no packages yet (backend/ and frontend/ not initialised) — metadata checks only"
fi
echo "ci: PASS"
