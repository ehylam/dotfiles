#!/usr/bin/env bash
# Guarded replacement for `kill-session -a` (bound to prefix-C-k in .tmux.conf).
#
# Shows exactly what would die before killing anything, and refuses to touch
# sessions holding unsaved or in-flight work. Same protection rules as
# the workspace cleanup procedure, so the two agree on what "safe to kill" means.

set -uo pipefail

bold=$'\033[1m'; green=$'\033[32m'; yellow=$'\033[33m'; dim=$'\033[2m'; reset=$'\033[0m'

# Every session with a live client, not just "the current one". `display-message
# -p '#S'` is wrong here: on a server with zero attached clients it still names a
# session, which would falsely protect it. list-clients returns nothing instead,
# and covers the multi-client case correctly.
attached=$(tmux list-clients -F '#{client_session}' 2>/dev/null | sort -u)

# A session is protected if any pane runs an editor (unsaved buffers), a dev
# server (killing it breaks a live preview), or an agent mid-run.
protect_pattern='^(nvim|vim|node|shopify|vite|wrangler|next|webpack|claude|codex)$'

kill_list=() protected=()

while IFS= read -r s; do
    [ -n "$s" ] || continue
    if printf '%s\n' "$attached" | grep -qxF "$s"; then
        protected+=("$s|attached")
        continue
    fi
    cmds=$(tmux list-panes -s -t "=$s" -F '#{pane_current_command}' 2>/dev/null | sort -u)
    reason=$(printf '%s\n' "$cmds" | grep -E "$protect_pattern" | paste -sd, -)
    if [ -n "$reason" ]; then
        protected+=("$s|$reason")
    else
        kill_list+=("$s|$(printf '%s' "$cmds" | paste -sd, -)")
    fi
done < <(tmux list-sessions -F '#{session_name}' 2>/dev/null)

if [ ${#kill_list[@]} -eq 0 ]; then
    printf '%sNothing to kill.%s\n\n' "$green" "$reset"
else
    printf '%sWould kill %d session(s):%s\n' "$bold" "${#kill_list[@]}" "$reset"
    for e in "${kill_list[@]}"; do
        printf '  %-34s %s%s%s\n' "${e%%|*}" "$dim" "${e#*|}" "$reset"
    done
    printf '\n'
fi

if [ ${#protected[@]} -gt 0 ]; then
    printf '%sProtected, skipping %d:%s\n' "$yellow" "${#protected[@]}" "$reset"
    for e in "${protected[@]}"; do
        printf '  %-34s %s%s%s\n' "${e%%|*}" "$dim" "${e#*|}" "$reset"
    done
    printf '\n'
fi

[ ${#kill_list[@]} -eq 0 ] && { printf 'Press any key to close.'; read -r -n 1 -s; exit 0; }

printf 'Kill the %d above? [y/N] ' "${#kill_list[@]}"
read -r answer
case "$answer" in
    y|Y|yes|YES)
        for e in "${kill_list[@]}"; do
            s="${e%%|*}"
            if tmux kill-session -t "=$s" 2>/dev/null; then
                printf '  killed %s\n' "$s"
            else
                printf '  %sfailed%s %s\n' "$yellow" "$reset" "$s"
            fi
        done
        printf '\nDone. Press any key to close.'
        ;;
    *)
        printf '\nCancelled, nothing killed. Press any key to close.'
        ;;
esac
read -r -n 1 -s
