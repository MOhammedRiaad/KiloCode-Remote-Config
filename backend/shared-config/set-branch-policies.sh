#!/usr/bin/env bash
# Creates the branch policies that protect main of the shared Kilo config repo (kilo-config).
# Contract: docs/architecture/contracts/shared-config-repo.md section 4 (ADR-0015).
set -u

usage() {
  local line
  while IFS= read -r line; do
    printf '%s
' "$line"
  done <<'EOF'
Usage:
  bash set-branch-policies.sh --org <org> --project <project> --repository-id <guid> \
                              --reviewer-group <group> --build-definition-id <n> [--dry-run]
  bash set-branch-policies.sh --help

Creates three policies on the main branch: minimum approver count (1), a required
reviewer group, and a blocking build validation that runs the pipeline.

Options:
  --org <org>                  Organization name or https://dev.azure.com/<org>
  --project <project>          Project name
  --repository-id <guid>       Repository GUID. Get it with:
                               az repos show --repository <name> --query id -o tsv
  --reviewer-group <group>     Reviewer group (identity GUID recommended)
  --build-definition-id <n>    Id of the pipeline (build definition) running azure-pipelines.yml
  --dry-run                    Print the az commands instead of running them
  --help, -h                   Show this help

Authentication uses "az login" or the AZURE_DEVOPS_EXT_PAT environment variable.
No token argument exists. Re-running creates duplicate policies.
EOF
}

for arg in "$@"; do
  if [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then
    usage
    exit 0
  fi
done

problems=()
add_problem() { problems+=("$1"); }

org="" project="" repo="" group="" build=""
have_org=0 have_project=0 have_repo=0 have_group=0 have_build=0 dry_run=0

# A value is usable when it is non-empty and does not start with "-".
value_ok() {
  case "$1" in
    "" | -*) return 1 ;;
  esac
  return 0
}

while [ $# -gt 0 ]; do
  flag="$1"
  case "$flag" in
    --org | --project | --repository-id | --reviewer-group | --build-definition-id)
      if [ $# -lt 2 ] || ! value_ok "$2"; then
        add_problem "$flag requires a value"
        shift
        continue
      fi
      value="$2"
      shift 2
      case "$flag" in
        --org)
          if [ "$have_org" = 1 ]; then add_problem "$flag given more than once"; else org="$value"; have_org=1; fi ;;
        --project)
          if [ "$have_project" = 1 ]; then add_problem "$flag given more than once"; else project="$value"; have_project=1; fi ;;
        --repository-id)
          if [ "$have_repo" = 1 ]; then add_problem "$flag given more than once"; else repo="$value"; have_repo=1; fi ;;
        --reviewer-group)
          if [ "$have_group" = 1 ]; then add_problem "$flag given more than once"; else group="$value"; have_group=1; fi ;;
        --build-definition-id)
          if [ "$have_build" = 1 ]; then add_problem "$flag given more than once"; else build="$value"; have_build=1; fi ;;
      esac
      ;;
    --dry-run)
      if [ "$dry_run" = 1 ]; then add_problem "--dry-run given more than once"; fi
      dry_run=1
      shift
      ;;
    -*)
      add_problem "unknown option"
      shift
      ;;
    *)
      add_problem "unexpected argument"
      shift
      ;;
  esac
done

[ "$have_org" = 1 ] || add_problem "missing required option --org"
[ "$have_project" = 1 ] || add_problem "missing required option --project"
[ "$have_repo" = 1 ] || add_problem "missing required option --repository-id"
[ "$have_group" = 1 ] || add_problem "missing required option --reviewer-group"
[ "$have_build" = 1 ] || add_problem "missing required option --build-definition-id"

ORG_NAME_RE='^[A-Za-z0-9]([A-Za-z0-9-]{0,48}[A-Za-z0-9])?$'
GUID_RE='^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
BUILD_RE='^[1-9][0-9]{0,9}$'

# Text rule: 1..256 characters, no control character, does not start with "-".
text_ok() {
  local v="$1"
  [ "${#v}" -ge 1 ] && [ "${#v}" -le 256 ] || return 1
  case "$v" in
    -*) return 1 ;;
    *[[:cntrl:]]*) return 1 ;;
  esac
  return 0
}

normalise_org() {
  local o="${1%/}" n
  if [[ "$o" == https://dev.azure.com/* ]]; then
    n="${o#https://dev.azure.com/}"
  elif [[ "$o" == https://*.visualstudio.com ]]; then
    n="${o#https://}"
    n="${n%.visualstudio.com}"
  else
    n="$o"
  fi
  [[ "$n" =~ $ORG_NAME_RE ]] || return 1
  org_url="https://dev.azure.com/$n"
}

org_url=""
if [ "$have_org" = 1 ] && ! normalise_org "$org"; then
  add_problem "invalid value for --org (expected an organization name or https://dev.azure.com/<org>)"
fi
if [ "$have_repo" = 1 ] && ! [[ "$repo" =~ $GUID_RE ]]; then
  add_problem "invalid value for --repository-id (expected the repository GUID)"
fi
if [ "$have_build" = 1 ] && ! [[ "$build" =~ $BUILD_RE ]]; then
  add_problem "invalid value for --build-definition-id (expected a positive integer)"
fi
if [ "$have_project" = 1 ] && ! text_ok "$project"; then
  add_problem "invalid value for --project"
fi
if [ "$have_group" = 1 ]; then
  if ! text_ok "$group"; then
    add_problem "invalid value for --reviewer-group"
  else
    case "$group" in
      *";"*) add_problem "invalid value for --reviewer-group" ;;
    esac
  fi
fi

if [ "${#problems[@]}" -gt 0 ]; then
  for p in "${problems[@]}"; do
    printf 'set-branch-policies: usage error: %s\n' "$p" >&2
  done
  usage >&2
  exit 2
fi

common=(--org "$org_url" --project "$project" --repository-id "$repo" --branch main --branch-match-type exact --enabled true --blocking true)

cmd_approver=(repos policy approver-count create "${common[@]}" --minimum-approver-count 1 --creator-vote-counts false --allow-downvotes false --reset-on-source-push true --output none)
cmd_reviewer=(repos policy required-reviewer create "${common[@]}" --required-reviewer-ids "$group" --message "Platform team review is required for shared Kilo config changes." --output none)
cmd_build=(repos policy build create "${common[@]}" --build-definition-id "$build" --display-name "kilo-config PR validation" --manual-queue-only false --queue-on-source-update-only false --valid-duration 0 --output none)

# print_command <argv...>: one POSIX shell line that reproduces the az argv exactly.
print_command() {
  local sq="'" esc="'\\''" v
  printf 'az'
  for v in "$@"; do
    case "$v" in
      *[!A-Za-z0-9_./:=@%+,-]*) printf " '%s'" "${v//$sq/$esc}" ;;
      *) printf ' %s' "$v" ;;
    esac
  done
  printf '\n'
}

if [ "$dry_run" = 1 ]; then
  print_command "${cmd_approver[@]}"
  print_command "${cmd_reviewer[@]}"
  print_command "${cmd_build[@]}"
  exit 0
fi

if ! command -v az >/dev/null 2>&1; then
  echo "set-branch-policies: az was not found on PATH (install the Azure CLI and its azure-devops extension)" >&2
  exit 1
fi

# run_policy <policy-name> <argv...>
run_policy() {
  local name="$1" code
  shift
  az "$@" </dev/null >/dev/null 2>&1
  code=$?
  if [ "$code" -ne 0 ]; then
    printf 'set-branch-policies: failed to create the %s policy (az exit %s); later policies were not created. Check az login or AZURE_DEVOPS_EXT_PAT, the ids and your permissions; run with --dry-run to see the commands.\n' "$name" "$code" >&2
    exit 1
  fi
  printf 'set-branch-policies: created %s policy on main\n' "$name"
}

run_policy approver-count "${cmd_approver[@]}"
run_policy required-reviewer "${cmd_reviewer[@]}"
run_policy build "${cmd_build[@]}"
echo "set-branch-policies: done (3 policies created; re-running creates duplicate policies)"
exit 0
