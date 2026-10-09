#!/usr/bin/env bash
# Wraps `sesh list` and prefixes entries with a status marker when a tmux
# session has a Claude or Codex breadcrumb.
#
# Output is two tab-separated columns: <marker>\t<session-or-path>.
# Caller is expected to feed this into fzf with --delimiter='\t'
# --with-nth=1,2, then strip column 1 from the selection.

set -euo pipefail

state_dirs=(
    "${HOME}/.claude/state/agent-breadcrumbs"
    "${HOME}/.codex/state/agent-breadcrumbs"
)

green=$'\033[32m'
yellow=$'\033[33m'
reset=$'\033[0m'

sesh list "$@" | while IFS= read -r line; do
    state=""
    for state_dir in "${state_dirs[@]}"; do
        marker_file="$state_dir/$line"
        [ -f "$marker_file" ] || continue
        marker_state=$(cat "$marker_file" 2>/dev/null || true)
        if [ "$marker_state" = "needs-input" ]; then
            state="needs-input"
            break
        fi
        if [ "$marker_state" = "done" ] && [ -z "$state" ]; then
            state="done"
        fi
    done

    case "$state" in
        done)        printf '%s●%s\t%s\n' "$green"  "$reset" "$line" ;;
        needs-input) printf '%s●%s\t%s\n' "$yellow" "$reset" "$line" ;;
        *)           printf ' \t%s\n' "$line" ;;
    esac
done
