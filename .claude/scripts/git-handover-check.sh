#!/usr/bin/env bash
# Stop hook: surface git state you would otherwise find out about tomorrow.
#
# Catches the Task 820 shape: commits exist locally, remote has diverged, no PR opened.
# Advisory only. Always exits 0, so it can never trap a session. Output goes out as a
# JSON `systemMessage` on stdout: plain stderr on exit 0 reaches neither the model nor
# the normal UI, which is why this used to be invisible.

set -uo pipefail

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
[ "$branch" = "HEAD" ] && exit 0

notes=""; ahead=0
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
[ "$dirty" -gt 0 ] && notes="${notes}  ${dirty} uncommitted file(s)\n"

if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  read -r behind ahead <<<"$(git rev-list --left-right --count '@{u}...HEAD' 2>/dev/null)"
  [ "${ahead:-0}" -gt 0 ] && [ "${behind:-0}" -gt 0 ] \
    && notes="${notes}  DIVERGED from upstream: ${ahead} ahead, ${behind} behind\n"
  [ "${ahead:-0}" -gt 0 ] && [ "${behind:-0}" -eq 0 ] \
    && notes="${notes}  ${ahead} commit(s) unpushed\n"
else
  [ "$(git rev-list --count HEAD 2>/dev/null || echo 0)" -gt 0 ] \
    && notes="${notes}  branch '${branch}' has no upstream\n"
  # A new branch may have local work even before its first push.
  for base in refs/remotes/origin/HEAD refs/remotes/origin/main refs/remotes/origin/master refs/heads/main refs/heads/master; do
    if git rev-parse --verify "$base" >/dev/null 2>&1; then
      ahead=$(git rev-list --count "$base..HEAD" 2>/dev/null || echo 0)
      break
    fi
  done
fi

# A clean, synced review branch needs no network lookup.
case "$branch" in
  main|master) ;;
  *)
    if { [ "$dirty" -gt 0 ] || [ "${ahead:-0}" -gt 0 ]; } && command -v gh >/dev/null 2>&1; then
      # Cache unavailable results too, so auth/network failures do not retry each Stop.
      cache="${TMPDIR:-/tmp}/.git-handover-pr-$(printf '%s\t%s' "$(git rev-parse --show-toplevel)" "$branch" | shasum | cut -c1-16)"
      if [ -n "$(find "$cache" -mmin -10 2>/dev/null)" ]; then
        pr=$(cat "$cache")
      else
        # perl ships with macOS; GNU `timeout` does not. A timeout yields "skip", never "0".
        if ! pr=$(perl -e 'alarm shift; exec @ARGV' 8 gh pr list --head "$branch" --json number --jq 'length' 2>/dev/null); then pr=skip; fi
        case "$pr" in ''|*[!0-9]*) pr=skip ;; esac
        printf '%s' "$pr" > "$cache"
      fi
      [ "$pr" = "0" ] && notes="${notes}  no open PR for '${branch}'\n"
    fi
    ;;
esac

[ -n "$notes" ] && printf 'git state on exit (%s):\n%b' "$branch" "$notes" \
  | jq -Rs '{systemMessage: rtrimstr("\n")}' 2>/dev/null
exit 0
