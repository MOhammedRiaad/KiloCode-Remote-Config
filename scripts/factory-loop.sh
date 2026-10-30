#!/usr/bin/env bash
# Runs the AI Factory headless, one /factory-cycle per iteration, until the factory reports
# done/halted, a STOP file appears, or FACTORY_MAX_CYCLES iterations have run.
#
# Env:
#   FACTORY_MAX_CYCLES       iterations for this invocation (default 10)
#   FACTORY_PERMISSION_MODE  acceptEdits (default, uses .claude/settings.json allowlist)
#                            or bypassPermissions (only inside a disposable container/VM/CI runner)
#   FACTORY_MODEL            optional model override for the orchestrator (e.g. opus)
#   FACTORY_MAX_TURNS        per-cycle turn cap for the orchestrator (default 400)
set -euo pipefail
cd "$(dirname "$0")/.."

MAX="${FACTORY_MAX_CYCLES:-10}"
MODE="${FACTORY_PERMISSION_MODE:-acceptEdits}"
TURNS="${FACTORY_MAX_TURNS:-400}"
mkdir -p factory/logs

state_status() {
  node -e 'console.log(JSON.parse(require("fs").readFileSync("factory/state.json","utf8")).status)'
}

bash scripts/bootstrap.sh

for ((i = 1; i <= MAX; i++)); do
  if [ -f factory/STOP ]; then echo "factory: STOP file present — stopping"; break; fi
  status="$(state_status)"
  if [ "$status" != "running" ]; then echo "factory: status=$status — stopping"; break; fi

  ts="$(date +%Y%m%d-%H%M%S)"
  log="factory/logs/cycle-$ts.log"
  echo "factory: iteration $i/$MAX — log $log"

  args=(-p "/factory-cycle" --permission-mode "$MODE" --max-turns "$TURNS" --output-format text)
  if [ -n "${FACTORY_MODEL:-}" ]; then args+=(--model "$FACTORY_MODEL"); fi

  if ! claude "${args[@]}" 2>&1 | tee "$log"; then
    echo "factory: claude exited non-zero (see $log); continuing to next iteration"
  fi
done

echo "factory: final status=$(state_status)"
