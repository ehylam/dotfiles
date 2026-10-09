#!/usr/bin/env bash
# Preview pane for the sesh picker (bound to prefix-s / prefix-C-j in .tmux.conf).
#
# Takes the session-or-path from field 2 of sesh-list-decorated.sh output.
# Live tmux sessions show agent state, windows, and what is running in each pane;
# everything else is treated as a directory and shows git state.
#
# Note: `tmux list-panes -s -t <session>` scopes to one session. Do NOT use -a,
# which means "all sessions on the server" and silently ignores -t.

name="${1:-}"
[ -n "$name" ] || exit 0

green=$'\033[32m'
yellow=$'\033[33m'
dim=$'\033[2m'
reset=$'\033[0m'

# Same precedence as sesh-list-decorated.sh: needs-input beats done, and the
# Claude and Codex breadcrumb dirs are both consulted.
breadcrumb_dirs=(
    "${HOME}/.claude/state/agent-breadcrumbs"
    "${HOME}/.codex/state/agent-breadcrumbs"
)

human_age() {
    local secs=$1
    if   [ "$secs" -lt 60 ]    ; then printf '%ds' "$secs"
    elif [ "$secs" -lt 3600 ]  ; then printf '%dm' "$((secs / 60))"
    elif [ "$secs" -lt 86400 ] ; then printf '%dh' "$((secs / 3600))"
    else                              printf '%dd' "$((secs / 86400))"
    fi
}

# Prints the agent line, if this name has a breadcrumb.
agent_line() {
    local target="$1" state="" mtime=0 f content
    for dir in "${breadcrumb_dirs[@]}"; do
        f="$dir/$target"
        [ -f "$f" ] || continue
        content=$(cat "$f" 2>/dev/null || true)
        if [ "$content" = "needs-input" ]; then
            state="needs-input"
            mtime=$(stat -f %m "$f" 2>/dev/null || echo 0)
            break
        fi
        if [ "$content" = "done" ] && [ -z "$state" ]; then
            state="done"
            mtime=$(stat -f %m "$f" 2>/dev/null || echo 0)
        fi
    done
    [ -n "$state" ] || return 0

    local age=""
    if [ "$mtime" -gt 0 ]; then
        age=" ($(human_age $(( $(date +%s) - mtime )) ))"
    fi

    case "$state" in
        needs-input) printf '  agent: %sNEEDS INPUT%s%s\n' "$yellow" "$reset" "$age" ;;
        done)        printf '  agent: %sdone%s%s\n'        "$green"  "$reset" "$age" ;;
    esac
}

# Computed once: this runs on every keystroke in the picker.
agent=$(agent_line "$name")

if tmux has-session -t "=$name" 2>/dev/null; then
    printf 'tmux session: %s\n' "$name"
    [ -n "$agent" ] && printf '%s\n' "$agent"
    printf '\n'
    tmux list-windows -t "=$name" \
        -F '  win #{window_index}: #{window_name} (#{window_panes}p)' 2>/dev/null
    printf '\n'
    tmux list-panes -s -t "=$name" \
        -F '  #{pane_current_command}  #{pane_current_path}' 2>/dev/null | sort -u
    exit 0
fi

dir="${name/#\~/$HOME}"
[ -d "$dir" ] || dir="$HOME/Documents/dev/$name"

# A breadcrumb with no live session is left over from a killed one. Say so in
# both branches below, otherwise the coloured dot in the list reads as current.
stale_note() {
    [ -n "$agent" ] || return 0
    printf '%s\n' "$agent"
    printf '  %s(stale: no live session by this name)%s\n' "$dim" "$reset"
}

if [ ! -d "$dir" ]; then
    printf 'no session, no directory: %s\n' "$name"
    stale_note
    exit 0
fi

printf 'directory: %s\n' "$dir"
stale_note

if git -C "$dir" rev-parse --git-dir >/dev/null 2>&1; then
    printf '  branch:  %s\n' "$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)"
    printf '  changed: %s files\n' "$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    printf '\n  recent:\n'
    git -C "$dir" log --oneline -5 --color=always 2>/dev/null | sed 's/^/    /'
fi
