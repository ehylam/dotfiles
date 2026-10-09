#!/usr/bin/env bash
# Per-tmux-session breadcrumbs for "Claude needs your attention".
# Read by sesh-list-decorated.sh to mark sessions in the sesh fzf picker.

set -euo pipefail

state_dir="${AGENT_BREADCRUMB_DIR:-${HOME}/.claude/state/agent-breadcrumbs}"

if ! command -v tmux >/dev/null 2>&1 || [ -z "${TMUX:-}" ] || [ -z "${TMUX_PANE:-}" ]; then
    exit 0
fi

session=$(tmux display-message -p -t "$TMUX_PANE" '#S' 2>/dev/null || true)
[ -z "$session" ] && exit 0

mkdir -p "$state_dir"

case "${1:-}" in
    write)
        case "${2:-}" in
            done|needs-input)
                printf '%s' "$2" > "$state_dir/$session"
                ;;
            *)
                echo "Usage: $(basename "$0") write <done|needs-input>" >&2
                exit 1
                ;;
        esac
        ;;
    clear)
        rm -f "$state_dir/$session"
        ;;
    *)
        echo "Usage: $(basename "$0") {write <done|needs-input>|clear}" >&2
        exit 1
        ;;
esac
