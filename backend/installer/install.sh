#!/usr/bin/env bash
# Bootstrap installer for macOS / Linux (ADR-0012, contract installer-cli.md).
# Front end only: parses inputs, checks prerequisites, then hands over to install-helper.ts,
# which does all file work. Uses bash builtins plus `node` and `az`; never writes a file itself.
set -euo pipefail

usage() {
  printf '%s\n' \
    'Usage: install.sh --org <org> --project <project> --repo <repo> [--path <path>] [--branch <branch>] [--mode defaults|enforce]' \
    '       install.sh --help' \
    '' \
    'Installs the Azure DevOps remote-config plugin and your personal Kilo config.' \
    'Inputs can also come from KILO_AZDO_ORG, KILO_AZDO_PROJECT, KILO_AZDO_REPO,' \
    'KILO_AZDO_PATH, KILO_AZDO_BRANCH and KILO_AZDO_MODE (flags win).' \
    'Your Bifrost virtual key is read from KILO_BIFROST_KEY (there is no flag for it).' \
    'Requires Node.js 22.18 or later and either `az login` or AZDO_PAT.'
}

usage_error() {
  printf 'install.sh: error: %s\n' "$1" >&2
  printf 'Run install.sh --help for usage.\n' >&2
  exit 2
}

for arg in "$@"; do
  case $arg in
    -h | --help)
      usage
      exit 0
      ;;
  esac
done

f_org=''
f_project=''
f_repo=''
f_path=''
f_branch=''
f_mode=''
while [ "$#" -gt 0 ]; do
  case $1 in
    --org | --project | --repo | --path | --branch | --mode)
      [ "$#" -ge 2 ] || usage_error 'unknown option or argument.'
      case $1 in
        --org) f_org=$2 ;;
        --project) f_project=$2 ;;
        --repo) f_repo=$2 ;;
        --path) f_path=$2 ;;
        --branch) f_branch=$2 ;;
        --mode) f_mode=$2 ;;
      esac
      shift 2
      ;;
    *)
      usage_error 'unknown option or argument.'
      ;;
  esac
done

org=${f_org:-${KILO_AZDO_ORG:-}}
project=${f_project:-${KILO_AZDO_PROJECT:-}}
repo=${f_repo:-${KILO_AZDO_REPO:-}}
path=${f_path:-${KILO_AZDO_PATH:-/kilo.jsonc}}
branch=${f_branch:-${KILO_AZDO_BRANCH:-main}}
mode=${f_mode:-${KILO_AZDO_MODE:-defaults}}

missing=0
if [ -z "$org" ]; then
  printf 'install.sh: error: missing required input --org (or KILO_AZDO_ORG).\n' >&2
  missing=1
fi
if [ -z "$project" ]; then
  printf 'install.sh: error: missing required input --project (or KILO_AZDO_PROJECT).\n' >&2
  missing=1
fi
if [ -z "$repo" ]; then
  printf 'install.sh: error: missing required input --repo (or KILO_AZDO_REPO).\n' >&2
  missing=1
fi
if [ "$missing" -ne 0 ]; then
  printf 'Run install.sh --help for usage.\n' >&2
  exit 2
fi

# ---- prerequisites: report every failure, then exit 1 ----
prereq_failed=0

node_ok=0
if command -v node >/dev/null 2>&1; then
  node_version=$(node -p process.versions.node 2>/dev/null) || node_version=''
  node_version=${node_version//$'\r'/}
  node_major=${node_version%%.*}
  node_rest=${node_version#*.}
  node_minor=${node_rest%%.*}
  case "$node_major.$node_minor" in
    '' | . | *[!0-9.]* | .* | *.) ;;
    *)
      if [ "$node_major" -gt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -ge 18 ]; }; then
        node_ok=1
      fi
      ;;
  esac
  if [ "$node_ok" -eq 0 ]; then
    printf 'install.sh: error: Node.js 22.18 or later is required (found %s).\n' "${node_version:-unknown}" >&2
    prereq_failed=1
  fi
else
  printf 'install.sh: error: Node.js was not found on PATH. Install Node.js 22.18 or later and re-run.\n' >&2
  prereq_failed=1
fi

if [ -z "${AZDO_PAT:-}" ] && [ -z "${AZURE_DEVOPS_EXT_PAT:-}" ] && [ -z "${KILO_AZDO_PAT:-}" ]; then
  if ! command -v az >/dev/null 2>&1; then
    printf "install.sh: error: No Azure DevOps credentials: install the Azure CLI and run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope.\n" >&2
    prereq_failed=1
  elif ! az account show --output none >/dev/null 2>&1; then
    printf "install.sh: error: The Azure CLI is not logged in: run 'az login', or set AZDO_PAT to a personal access token with Code (Read) scope.\n" >&2
    prereq_failed=1
  fi
fi

if [ "$prereq_failed" -ne 0 ]; then
  exit 1
fi

# ---- hand over to the helper; values travel on stdin, never in argv ----
src=${BASH_SOURCE[0]}
case $src in
  */*) script_dir=${src%/*} ;;
  *) script_dir=. ;;
esac
script_dir=$(cd "$script_dir" && pwd)

printf '%s\0' "org=$org" "project=$project" "repo=$repo" "path=$path" "branch=$branch" "mode=$mode" "apiKey=${KILO_BIFROST_KEY:-}" | node "$script_dir/install-helper.ts"
