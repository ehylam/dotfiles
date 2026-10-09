#!/usr/bin/env bash
# Session-start state sweep for a Shopify theme repo.
#
#   theme-status.sh              this repo
#   theme-status.sh --all        every repo under ~/Documents/dev with a worktree in play
#   theme-status.sh --store      also query the Shopify store (slow, needs auth)
#   theme-status.sh --store example.myshopify.com --theme-limit 20
#
# Git and PR state are fast and always run. Store checks are opt-in because they need
# network and auth, and a status sweep that hangs is a status sweep nobody runs.

set -uo pipefail

DEV_ROOT="${DEV_ROOT:-$HOME/Documents/dev}"
ALL=0; STORE=0; TARGET_STORE=""; THEME_LIMIT=""; RESULT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --all)   ALL=1; shift ;;
    --store) STORE=1; shift; if [ $# -gt 0 ] && [[ "$1" != --* ]]; then TARGET_STORE="$1"; shift; fi ;;
    --theme-limit) THEME_LIMIT="${2:?--theme-limit requires the verified plan limit}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
if [ -n "$THEME_LIMIT" ] && ! [[ "$THEME_LIMIT" =~ ^[1-9][0-9]*$ ]]; then
  echo "--theme-limit must be a positive integer" >&2; exit 2
fi

row() { printf '%-34s %-26s %-18s %-10s %s\n' "$1" "$2" "$3" "$4" "$5"; }

inspect() {
  local p="$1" name sync pr dirty branch
  name=$(basename "$p")
  git -C "$p" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return
  branch=$(git -C "$p" rev-parse --abbrev-ref HEAD 2>/dev/null)

  if git -C "$p" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
    read -r behind ahead <<<"$(git -C "$p" rev-list --left-right --count '@{u}...HEAD' 2>/dev/null)"
    if   [ "${ahead:-0}" -gt 0 ] && [ "${behind:-0}" -gt 0 ]; then sync="DIVERGED ${ahead}/${behind}"
    elif [ "${ahead:-0}" -gt 0 ]; then sync="ahead ${ahead}"
    elif [ "${behind:-0}" -gt 0 ]; then sync="behind ${behind}"
    else sync="level"; fi
  else
    sync="NO UPSTREAM"
  fi

  local n; n=$(git -C "$p" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -eq 0 ] && dirty="clean" || dirty="${n} dirty"

  pr="-"
  case "$branch" in
    main|master) pr="n/a" ;;
    *) if command -v gh >/dev/null 2>&1; then
         pr=$(cd "$p" && timeout 8 gh pr list --head "$branch" --json number --jq '.[0].number // "none"' 2>/dev/null || echo "?")
       fi ;;
  esac

  row "$name" "$branch" "$sync" "$dirty" "PR:$pr"
}

echo "Repo state  ($(date '+%Y-%m-%d %H:%M'))"
row "REPO" "BRANCH" "VS UPSTREAM" "TREE" "PR"
printf '%s\n' "$(printf '%.0s-' {1..100})"

if [ "$ALL" -eq 1 ]; then
  for d in "$DEV_ROOT"/*/; do [ -d "$d/.git" ] || [ -f "$d/.git" ] && inspect "${d%/}"; done
else
  inspect "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

if [ "$STORE" -eq 1 ]; then
  echo
  echo "Store:"
  s="${TARGET_STORE:-${SHOPIFY_FLAG_STORE:-}}"
  if [ -z "$s" ]; then
    echo "  unavailable: specify --store <domain> or SHOPIFY_FLAG_STORE"; RESULT=2
  elif ! command -v shopify >/dev/null || ! command -v timeout >/dev/null || ! command -v jq >/dev/null; then
    echo "  unavailable: shopify, timeout and jq are required"; RESULT=2
  else
    echo "  store: $s"
    # An explicit target must not inherit fish's production-store Theme Access token.
    token_args=()
    [ -z "$TARGET_STORE" ] || token_args=(-u SHOPIFY_CLI_THEME_TOKEN)
    if inventory=$(env ${token_args[@]+"${token_args[@]}"} -u SHOPIFY_FLAG_STORE \
      -u SHOPIFY_FLAG_ID -u SHOPIFY_FLAG_NAME -u SHOPIFY_FLAG_ROLE -u SHOPIFY_FLAG_ENVIRONMENT \
      timeout 45 shopify theme list --store "$s" --json 2>/dev/null) && \
      n=$(printf '%s' "$inventory" | jq -er 'if type == "array" then length else error("expected theme array") end'); then
      echo "  themes: $n"
      if [ -z "$THEME_LIMIT" ]; then
        echo "  capacity: UNKNOWN (verify plan; Basic/Grow/Advanced 20, Plus 100, Starter restricted)"
      elif [ "$n" -ge "$THEME_LIMIT" ]; then
        echo "  capacity: FULL ($n/$THEME_LIMIT); no new theme until an approved cleanup"; RESULT=2
      else
        echo "  capacity: $((THEME_LIMIT - n)) remaining ($n/$THEME_LIMIT)"
      fi
    else
      echo "  themes: UNAVAILABLE (auth, timeout or unexpected CLI output); resolve before rollout"; RESULT=2
    fi
  fi
fi

echo
echo "Ports 9292-9299 in use:"
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ':929[0-9]' | awk '{print "  "$1" pid "$2" "$9}' || echo "  none"
exit "$RESULT"
